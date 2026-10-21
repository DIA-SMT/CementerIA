import type { Prisma } from "@/generated/prisma/client";
import { hoyEnTucuman } from "@/lib/fechas";
import { log, resumenError } from "@/lib/log";
import { evaluarPermiso, exigirPermiso, type ExpedientePermisos, type UsuarioPermisos } from "../permisos";
import type { DefinicionPlantilla } from "../plantillas/esquema";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, exigirMotivo, limpiarMotivo } from "./errores";
import { esAnterior, interpretarFechaEfectiva, validarFechaEfectiva, type EntradaFechaEfectiva, type FechaEfectiva } from "./flujo";
import type { ItemsExpediente } from "./items";
import {
  busquedaActual,
  cargarMovimientos,
  ejecutarAccion,
  entornoReconstruccion,
  fechaInicioDe,
  proyeccionParaDb,
  type ContextoAccion,
} from "./operacion";
import {
  datosDe,
  esRecepcionImplicita,
  movimientosRevertidos,
  movimientosVigentes,
  reconstruirProyeccion,
  TIPOS_UBICACION,
  type MovimientoReconstruible,
} from "./reconstruccion";
import { validarDato } from "./subtareas";

/**
 * Correcciones de errores de carga (docs/propuesta-mvp.md, 2.13(b), tabla
 * "Cómo se corrige cada error de carga"). Ninguna reescribe el historial:
 * cada una agrega un movimiento `correccion` con `corrige_movimiento_id` y
 * motivo (lo exige el CHECK) y deja la proyección como corresponde.
 *
 * | Corrección | `datos` | Quién |
 * |---|---|---|
 * | `revertir` | `{revertir: true, arrastra: [ids]}` | autor (7 días) o admin |
 * | `corregirFecha` | `{fecha_efectiva: [a, b], precision: [a, b]}` | autor (7 días) o admin |
 * | `corregirObservacion` | `{observacion: [a, b]}` | autor (7 días) o admin |
 * | `corregirSubtarea` | `{subtarea, dato: [a, b]}` o `{subtarea, hecha: false}` | autor del tilde (7 días) o admin |
 * | `retirarAdjunto` | `{retirar_adjunto: id, purgar: false}` | autor (7 días, aunque haya movimientos después) o admin |
 * | `purgarAdjunto` | `{retirar_adjunto: id, purgar: true}` | admin (Ley 25.326): borra el archivo; nombre, tamaño y sha256 siguen en el historial |
 * | `suprimirPersona` | `{suprimir_persona: id}` | admin (Ley 25.326) |
 *
 * La proyección no se "deshace" a mano: se reconstruye desde el historial
 * (reconstruccion.ts) con la corrección ya insertada. Revertir es
 * reconstruir sin el movimiento revertido y lo que arrastra (la recepción
 * implícita que insertó la misma acción y las recepciones y notas
 * posteriores); el resultado es la proyección que había antes.
 *
 * En archivado y anulado solo corrige el admin, salvo retirar un adjunto (3.1).
 */

export type TipoCorreccion = "revertir" | "fecha" | "observacion" | "subtarea" | "retirar_adjunto" | "purgar_adjunto";

export interface ResultadoCorreccion {
  numero: string;
  version: number;
  repetido: boolean;
  /** El movimiento `correccion`. */
  movimientoId: string;
  /** El movimiento corregido. */
  corrigeMovimientoId: string;
  /** Revertir: los movimientos que se revirtieron junto con el corregido. */
  arrastrados: string[];
}

/** Los tipos que "Revertir" acepta como último movimiento (2.13(b)). */
const REVERTIBLES: ReadonlySet<string> = new Set(["pase", "devolucion", "estado", "subtarea"]);

/** ¿Cambia este movimiento las columnas del flujo? Las notas, recepciones y ediciones de datos no. */
function cambiaElFlujo(m: MovimientoReconstruible): boolean {
  const d = datosDe(m);
  if (m.tipo === "nota" || m.tipo === "recepcion") return false;
  if (m.tipo === "edicion") {
    const cambios = typeof d.cambios === "object" && d.cambios !== null ? (d.cambios as Record<string, unknown>) : {};
    return "carga_historica" in cambios || "ubicacion_archivo" in cambios;
  }
  if (m.tipo === "correccion") return d.subtarea !== undefined || d.retirar_adjunto !== undefined || d.fecha_efectiva !== undefined;
  return true;
}

export type ObjetivoReversion =
  | { ok: true; objetivo: MovimientoReconstruible; arrastra: MovimientoReconstruible[] }
  | { ok: false; mensaje: string };

/**
 * Qué revertiría "Revertir" (puro): el último movimiento vigente que cambió
 * el flujo, si es un pase, una devolución, un cambio de estado o una subtarea
 * del paso actual. Las recepciones y notas posteriores (y la recepción
 * implícita de la misma acción) se revierten con él.
 */
export function objetivoDeReversion(movimientos: readonly MovimientoReconstruible[], pasoActual: string): ObjetivoReversion {
  const vigentes = movimientosVigentes(movimientos);
  const arrastra: MovimientoReconstruible[] = [];
  let objetivo: MovimientoReconstruible | undefined;
  for (let i = vigentes.length - 1; i >= 0; i--) {
    const m = vigentes[i];
    if (m.tipo === "nota" || m.tipo === "recepcion") {
      arrastra.push(m);
      continue;
    }
    if (!cambiaElFlujo(m)) continue;
    objetivo = m;
    break;
  }
  if (!objetivo || objetivo.tipo === "alta") return { ok: false, mensaje: "No hay un movimiento para revertir: el expediente está como en el alta" };
  if (!REVERTIBLES.has(objetivo.tipo)) {
    return { ok: false, mensaje: `El último movimiento que cambió el expediente es ${objetivo.tipo === "correccion" ? "una corrección" : `un movimiento de tipo ${objetivo.tipo}`}: no se revierte` };
  }
  if (objetivo.tipo === "subtarea" && datosDe(objetivo).paso !== pasoActual) {
    return { ok: false, mensaje: "Solo se revierte una subtarea del paso actual; para un paso cerrado está la corrección de la subtarea" };
  }
  const o = objetivo;
  // La recepción implícita que insertó la misma acción, antes que ella.
  for (const m of vigentes) {
    if (m.secuencia < o.secuencia && m.comandoId === o.comandoId && esRecepcionImplicita(m)) arrastra.push(m);
  }
  return { ok: true, objetivo: o, arrastra: arrastra.sort((a, b) => a.secuencia - b.secuencia) };
}

/** El movimiento original detrás de una cadena de correcciones (una subtarea corregida dos veces). */
function origenDe(movimientos: readonly MovimientoReconstruible[], id: bigint): bigint {
  let actual = id;
  for (let i = 0; i < movimientos.length; i++) {
    const m = movimientos.find((x) => x.id === actual);
    if (!m || m.tipo !== "correccion" || m.corrigeMovimientoId === null) return actual;
    actual = m.corrigeMovimientoId;
  }
  return actual;
}

/** Lo que el permiso necesita del movimiento corregido. */
function contextoDe(m: Pick<MovimientoReconstruible, "usuarioId" | "registradoEn">, ahora: Date, retirarAdjunto = false) {
  return { movimiento: { usuarioId: m.usuarioId, registradoEn: m.registradoEn }, ahora, retirarAdjunto };
}

/** ¿El paso de la subtarea está cerrado? (el expediente ya salió de él, o ya no está activo). */
function pasoCerrado(def: DefinicionPlantilla, clave: string, pasoOrden: number, estado: string): boolean {
  const orden = def.pasos.findIndex((p) => p.subtareas.some((s) => s.clave === clave)) + 1;
  if (orden === 0) return false;
  return orden < pasoOrden || (estado !== "en_tramite" && estado !== "espera_pago_dim");
}

export interface EntradaCorregibles {
  def: DefinicionPlantilla;
  movimientos: readonly MovimientoReconstruible[];
  items: ItemsExpediente;
  pasoClave: string;
  pasoOrden: number;
  estado: string;
  permisos: ExpedientePermisos;
  usuario: UsuarioPermisos;
  ahora: Date;
}

/**
 * Para la ficha: qué correcciones puede hacer el usuario sobre cada
 * movimiento (por id). Las mismas reglas que exigen las acciones.
 */
export function correccionesPosibles(e: EntradaCorregibles): Map<string, TipoCorreccion[]> {
  const r = new Map<string, TipoCorreccion[]>();
  const revertidos = movimientosRevertidos(e.movimientos);
  const reversion = objetivoDeReversion(e.movimientos, e.pasoClave);
  const puede = (m: MovimientoReconstruible, retirar = false) =>
    evaluarPermiso("corregir_movimiento", e.permisos, e.usuario, contextoDe(m, e.ahora, retirar)).permitido;
  const admin = evaluarPermiso("purgar_adjunto", e.permisos, e.usuario).permitido;
  for (const m of e.movimientos) {
    const id = m.id.toString();
    if (revertidos.has(id) || m.tipo === "correccion") continue;
    const tipos: TipoCorreccion[] = [];
    const d = datosDe(m);
    if (reversion.ok && reversion.objetivo.id === m.id && puede(m)) tipos.push("revertir");
    if (m.tipo !== "alta" && m.tipo !== "edicion" && m.tipo !== "adjunto" && !esRecepcionImplicita(m) && puede(m)) tipos.push("fecha");
    if (puede(m)) tipos.push("observacion");
    if (m.tipo === "subtarea" && typeof d.subtarea === "string") {
      const item = e.items.subtareas[d.subtarea];
      if (item?.hecha && item.mov !== null && origenDe(e.movimientos, BigInt(item.mov)).toString() === id && pasoCerrado(e.def, d.subtarea, e.pasoOrden, e.estado) && puede(m)) tipos.push("subtarea");
    }
    if (m.tipo === "adjunto") {
      const a = e.items.adjuntos[id];
      if (a?.vigente && puede(m, true)) tipos.push("retirar_adjunto");
      if (a && !a.purgado && admin) tipos.push("purgar_adjunto");
    }
    if (tipos.length > 0) r.set(id, tipos);
  }
  return r;
}

// ---------------------------------------------------------------------------
// El esqueleto común
// ---------------------------------------------------------------------------

interface Correccion {
  corrige: bigint;
  motivo: string;
  datos: Prisma.InputJsonObject;
  fecha?: FechaEfectiva;
  /** Antes de insertar la corrección (por ejemplo, suprimir la persona). */
  antes?: () => Promise<void>;
}

async function registrarCorreccion(ctx: ContextoAccion, usuario: UsuarioPermisos, c: Correccion, arrastrados: string[] = []): Promise<ResultadoCorreccion> {
  const { tx, exp } = ctx;
  await c.antes?.();
  const m = await tx.movimiento.create({
    data: {
      expedienteId: exp.id,
      tipo: "correccion",
      fechaEfectiva: c.fecha?.instante ?? ctx.ahora,
      precisionFecha: c.fecha?.precision ?? "minuto",
      usuarioId: usuario.id,
      motivo: c.motivo,
      datos: c.datos,
      corrigeMovimientoId: c.corrige,
      comandoId: ctx.comando,
    },
    select: { id: true },
  });
  // La proyección del flujo, reconstruida con la corrección ya en el historial.
  const p = reconstruirProyeccion(ctx.def, await cargarMovimientos(tx, exp.id), await entornoReconstruccion(tx));
  const busqueda = await busquedaActual(ctx);
  const actualizado = await tx.expediente.update({
    where: { id: exp.id },
    data: { ...proyeccionParaDb(p), busqueda, version: { increment: 1 } },
    select: { version: true },
  });
  return {
    numero: exp.numeroInterno,
    version: actualizado.version,
    repetido: false,
    movimientoId: m.id.toString(),
    corrigeMovimientoId: c.corrige.toString(),
    arrastrados,
  };
}

function opciones(numero: string, comandoId: string, motivo: string, versionVista: number) {
  return {
    numero,
    comandoId,
    tipo: "correccion" as const,
    motivo,
    versionVista,
    repetido: async (tx: ContextoAccion["tx"], expedienteId: bigint, movimientoId: bigint): Promise<ResultadoCorreccion> => {
      const e = await tx.expediente.findUniqueOrThrow({ where: { id: expedienteId }, select: { numeroInterno: true, version: true } });
      const m = await tx.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { corrigeMovimientoId: true, datos: true } });
      const d = (m.datos ?? {}) as Record<string, unknown>;
      return {
        numero: e.numeroInterno,
        version: e.version,
        repetido: true,
        movimientoId: movimientoId.toString(),
        corrigeMovimientoId: m.corrigeMovimientoId?.toString() ?? "",
        arrastrados: Array.isArray(d.arrastra) ? d.arrastra.map(String) : [],
      };
    },
  };
}

function idDeMovimiento(valor: string, ruta = "movimientoId"): bigint {
  if (!/^\d{1,18}$/.test(valor)) throw errorValidacion([{ ruta, mensaje: "Movimiento inválido" }]);
  return BigInt(valor);
}

/** El movimiento corregido, vigente, de este expediente. */
async function movimientoCorregible(ctx: ContextoAccion, id: bigint): Promise<{ m: MovimientoReconstruible; todos: MovimientoReconstruible[] }> {
  const todos = await cargarMovimientos(ctx.tx, ctx.exp.id);
  const m = todos.find((x) => x.id === id);
  if (!m) throw new ErrorDominio("no_encontrado", "No existe ese movimiento en el expediente");
  if (movimientosRevertidos(todos).has(id.toString())) throw new ErrorDominio("estado_no_admite", "Ese movimiento ya fue revertido");
  if (m.tipo === "correccion") throw new ErrorDominio("estado_no_admite", "Una corrección no se corrige: se corrige el movimiento original");
  return { m, todos };
}

// ---------------------------------------------------------------------------
// Las correcciones
// ---------------------------------------------------------------------------

/**
 * Revierte el último movimiento que cambió el expediente (pase, devolución,
 * cambio de estado o subtarea del paso actual), con su recepción implícita y
 * las recepciones y notas posteriores. `movimientoId` es el que el usuario ve
 * en la ficha (`historial[i].correcciones` incluye `revertir`): si ya no es el
 * último, `estado_no_admite`.
 *
 * @throws PermisoDenegado (no es el autor, pasaron 7 días, archivado o anulado sin ser admin)
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`
 */
export async function revertir(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  movimientoId: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoCorreccion> {
  const motivoFinal = exigirMotivo(motivo, "Revertir un movimiento");
  const id = idDeMovimiento(movimientoId);
  return ejecutarAccion(deps, usuario, opciones(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    const { m, todos } = await movimientoCorregible(ctx, id);
    exigirPermiso("corregir_movimiento", ctx.permisos, usuario, contextoDe(m, ctx.ahora));
    const r = objetivoDeReversion(todos, ctx.exp.pasoClave);
    if (!r.ok) throw new ErrorDominio("estado_no_admite", r.mensaje);
    if (r.objetivo.id !== id) throw new ErrorDominio("estado_no_admite", "Se revierte solo el último movimiento que cambió el expediente: recargá la ficha");
    // Un reinicio o una caducidad ya continuados en otro expediente no se deshacen acá.
    const d = datosDe(m);
    if (m.tipo === "estado" && (d.reinicio === true || d.abre_vinculado === true)) {
      const siguiente = await ctx.tx.expediente.findFirst({ where: { expedienteAnteriorId: ctx.exp.id }, select: { numeroInterno: true } });
      if (siguiente) throw new ErrorDominio("estado_no_admite", `El expediente continúa en ${siguiente.numeroInterno}: no se revierte`);
    }
    const arrastra = r.arrastra.map((x) => x.id.toString());
    return registrarCorreccion(ctx, usuario, { corrige: id, motivo: motivoFinal, datos: { revertir: true, arrastra } }, arrastra);
  });
}

/**
 * Corrige la fecha efectiva de un movimiento. Si es un movimiento de
 * ubicación (recepción, pase, devolución, estado), la fecha nueva no puede
 * quedar antes del anterior ni después del siguiente (decisión 6); la
 * proyección se reconstruye (`en_area_desde`, `recibido_en`).
 *
 * @param fecha `"YYYY-MM-DD"` (precisión de día) o `datetime-local`, como en las acciones.
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`, `sin_cambios`
 */
export async function corregirFecha(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  movimientoId: string,
  fecha: EntradaFechaEfectiva,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoCorreccion> {
  const motivoFinal = exigirMotivo(motivo, "Corregir la fecha de un movimiento");
  const id = idDeMovimiento(movimientoId);
  return ejecutarAccion(deps, usuario, opciones(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    const { m, todos } = await movimientoCorregible(ctx, id);
    exigirPermiso("corregir_movimiento", ctx.permisos, usuario, contextoDe(m, ctx.ahora));
    if (m.tipo === "alta" || m.tipo === "edicion" || m.tipo === "adjunto" || esRecepcionImplicita(m)) {
      throw new ErrorDominio(
        "estado_no_admite",
        m.tipo === "alta" ? "La fecha del alta es la de inicio: se corrige editando el expediente" : "La fecha de este movimiento es la de su registro: no se corrige",
      );
    }
    if (fecha === undefined || fecha === null || (typeof fecha === "string" && fecha.trim() === "")) {
      throw errorValidacion([{ ruta: "fechaEfectiva", mensaje: "Indicá la fecha correcta" }]);
    }
    const nueva = interpretarFechaEfectiva(fecha, ctx.ahora);
    validarFechaEfectiva(nueva, { ahora: ctx.ahora, fechaInicio: fechaInicioDe(ctx.exp), diasAtras: m.cargaHistorica ? null : undefined });
    const vieja: FechaEfectiva = { instante: m.fechaEfectiva, precision: m.precisionFecha === "dia" ? "dia" : "minuto" };
    if (vieja.instante.getTime() === nueva.instante.getTime() && vieja.precision === nueva.precision) {
      throw new ErrorDominio("sin_cambios", "Esa ya es la fecha del movimiento");
    }
    if (TIPOS_UBICACION.has(m.tipo)) {
      const ubicacion = movimientosVigentes(todos).filter((x) => TIPOS_UBICACION.has(x.tipo) && !esRecepcionImplicita(x));
      const i = ubicacion.findIndex((x) => x.id === id);
      const anterior = ubicacion[i - 1];
      const siguiente = ubicacion[i + 1];
      const comoFecha = (x: MovimientoReconstruible): FechaEfectiva => ({ instante: x.fechaEfectiva, precision: x.precisionFecha === "dia" ? "dia" : "minuto" });
      if (anterior && esAnterior(nueva, comoFecha(anterior))) {
        throw errorValidacion([{ ruta: "fechaEfectiva", mensaje: "La fecha no puede ser anterior al movimiento del papel que la precede" }], "Revisá la fecha");
      }
      if (siguiente && esAnterior(comoFecha(siguiente), nueva)) {
        throw errorValidacion([{ ruta: "fechaEfectiva", mensaje: "La fecha no puede ser posterior al movimiento del papel que la sigue" }], "Revisá la fecha");
      }
    }
    return registrarCorreccion(ctx, usuario, {
      corrige: id,
      motivo: motivoFinal,
      datos: {
        fecha_efectiva: [vieja.instante.toISOString(), nueva.instante.toISOString()],
        precision: [vieja.precision, nueva.precision],
      },
    });
  });
}

/**
 * Corrige la observación de un movimiento (la línea de tiempo muestra la
 * original tachada). No cambia la proyección.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `sin_cambios`, `validacion`
 */
export async function corregirObservacion(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  movimientoId: string,
  observacion: string | null,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoCorreccion> {
  const motivoFinal = exigirMotivo(motivo, "Corregir una observación");
  const id = idDeMovimiento(movimientoId);
  const nueva = limpiarMotivo(observacion);
  if (nueva !== null && nueva.length > 2000) throw errorValidacion([{ ruta: "observacion", mensaje: "Hasta 2000 caracteres" }]);
  return ejecutarAccion(deps, usuario, opciones(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    const { m, todos } = await movimientoCorregible(ctx, id);
    exigirPermiso("corregir_movimiento", ctx.permisos, usuario, contextoDe(m, ctx.ahora));
    // La que vale hoy: la última corrección, o la original.
    let actual = m.observacion;
    for (const c of todos) {
      const d = datosDe(c);
      if (c.tipo === "correccion" && c.corrigeMovimientoId === id && Array.isArray(d.observacion)) actual = typeof d.observacion[1] === "string" ? d.observacion[1] : null;
    }
    if (actual === nueva) throw new ErrorDominio("sin_cambios", "La observación ya es esa");
    return registrarCorreccion(ctx, usuario, { corrige: id, motivo: motivoFinal, datos: { observacion: [actual, nueva] } });
  });
}

export type CambioSubtarea = { dato: string | null } | { hecha: false };

/**
 * Corrige el dato o el tilde de una subtarea de un paso ya cerrado (2.13(b)):
 * actualiza `items` y `busqueda` sin devolver el papel. Si el paso actual mide
 * su plazo con esa subtarea (la notificación de Tributario para el plazo de
 * la DIM), el plazo sigue al dato corregido. Para una subtarea del paso
 * actual están tildar y destildar.
 *
 * @throws PermisoDenegado (el autor del tilde, 7 días, o el admin)
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`, `sin_cambios`
 */
export async function corregirSubtarea(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  clave: string,
  cambio: CambioSubtarea,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoCorreccion> {
  const motivoFinal = exigirMotivo(motivo, "Corregir una subtarea");
  return ejecutarAccion(deps, usuario, opciones(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    const { def, exp, items } = ctx;
    const orden = def.pasos.findIndex((p) => p.subtareas.some((s) => s.clave === clave)) + 1;
    const s = orden > 0 ? def.pasos[orden - 1].subtareas.find((x) => x.clave === clave) : undefined;
    if (!s) throw errorValidacion([{ ruta: "subtarea", mensaje: "No existe esa subtarea en la plantilla" }], "Subtarea desconocida");
    if (!pasoCerrado(def, clave, exp.pasoOrden, exp.estado)) {
      throw new ErrorDominio("estado_no_admite", "La subtarea es del paso actual: se tilda o se destilda desde el paso");
    }
    const item = items.subtareas[clave];
    if (!item?.hecha || item.mov === null) throw new ErrorDominio("sin_cambios", `"${s.nombre}" no está tildada`);
    // El tilde original: si ya se corrigió, `mov` es la corrección, que apunta a él.
    const id = origenDe(await cargarMovimientos(ctx.tx, exp.id), BigInt(item.mov));
    const { m } = await movimientoCorregible(ctx, id);
    exigirPermiso("corregir_movimiento", ctx.permisos, usuario, contextoDe(m, ctx.ahora));
    let datos: Prisma.InputJsonObject;
    if ("hecha" in cambio) {
      datos = { subtarea: clave, hecha: false, dato: [item.dato, null] };
    } else {
      const dato = validarDato(s, cambio.dato, { hoy: hoyEnTucuman(ctx.ahora), fechaInicio: fechaInicioDe(exp) });
      if (dato === item.dato) throw new ErrorDominio("sin_cambios", `"${s.nombre}" ya tiene ese dato`);
      datos = { subtarea: clave, dato: [item.dato, dato] };
    }
    return registrarCorreccion(ctx, usuario, { corrige: id, motivo: motivoFinal, datos });
  });
}

async function adjuntoDelExpediente(ctx: ContextoAccion, adjuntoId: string) {
  const id = idDeMovimiento(adjuntoId, "adjunto");
  const { m } = await movimientoCorregible(ctx, id);
  if (m.tipo !== "adjunto") throw new ErrorDominio("no_encontrado", "No existe ese adjunto");
  return { id, m, item: ctx.items.adjuntos[adjuntoId] };
}

/**
 * Retira un adjunto equivocado (2.13(b)): deja de verse y el archivo se
 * conserva. El autor, dentro de los 7 días aunque haya movimientos después, o
 * el admin; también en archivado y anulado (3.1).
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `sin_cambios`
 */
export async function retirarAdjunto(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  adjuntoId: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoCorreccion> {
  const motivoFinal = exigirMotivo(motivo, "Retirar un adjunto");
  return ejecutarAccion(deps, usuario, opciones(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    const { id, m, item } = await adjuntoDelExpediente(ctx, adjuntoId);
    exigirPermiso("corregir_movimiento", ctx.permisos, usuario, contextoDe(m, ctx.ahora, true));
    if (!item?.vigente) throw new ErrorDominio("sin_cambios", "Ese adjunto ya fue retirado");
    return registrarCorreccion(ctx, usuario, { corrige: id, motivo: motivoFinal, datos: { retirar_adjunto: adjuntoId, purgar: false } });
  });
}

/**
 * Purga un adjunto (Ley 25.326, solo el admin): lo retira si estaba vigente y
 * borra el archivo del disco después del commit. El nombre, el tamaño y el
 * sha256 quedan en el movimiento `adjunto` (que no se modifica).
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `sin_cambios`
 */
export async function purgarAdjunto(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  adjuntoId: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoCorreccion> {
  if (!deps.almacen) throw new Error("Falta el almacenamiento de adjuntos en las dependencias del dominio");
  const almacen = deps.almacen;
  const motivoFinal = exigirMotivo(motivo, "Purgar un adjunto");
  let ruta: string | null = null;
  const r = await ejecutarAccion(deps, usuario, opciones(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    exigirPermiso("purgar_adjunto", ctx.permisos, usuario);
    const { id, m, item } = await adjuntoDelExpediente(ctx, adjuntoId);
    if (!item || item.purgado) throw new ErrorDominio("sin_cambios", "Ese adjunto ya fue purgado");
    const d = datosDe(m);
    ruta = typeof d.ruta === "string" ? d.ruta : null;
    return registrarCorreccion(ctx, usuario, { corrige: id, motivo: motivoFinal, datos: { retirar_adjunto: adjuntoId, purgar: true } });
  });
  if (r.repetido || ruta === null) return r;
  // Recién con el commit hecho: si la transacción falló, el archivo sigue.
  try {
    await almacen.borrar(ruta);
  } catch (error) {
    log.error("adjunto.purgar_fallo", { movimiento: adjuntoId, ruta, ...resumenError(error) });
    throw error;
  }
  return r;
}

/**
 * Suprime los datos personales de una versión de persona (Ley 25.326, solo el
 * admin): apellido, nombres, DNI, razón social, CUIT, contacto y vínculo en
 * NULL; quedan el rol, el tipo y la constancia (`suprimida_en`). La
 * corrección apunta al movimiento que creó la persona. `busqueda` se rearma.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `sin_cambios`
 */
export async function suprimirPersona(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  personaId: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoCorreccion> {
  const motivoFinal = exigirMotivo(motivo, "Suprimir los datos de una persona");
  const id = idDeMovimiento(personaId, "persona");
  return ejecutarAccion(deps, usuario, opciones(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    exigirPermiso("suprimir_persona", ctx.permisos, usuario);
    const p = await ctx.tx.expedientePersona.findUnique({ where: { id }, select: { expedienteId: true, suprimidaEn: true, creadaMovId: true } });
    if (!p || p.expedienteId !== ctx.exp.id) throw new ErrorDominio("no_encontrado", "No existe esa persona en el expediente");
    if (p.suprimidaEn !== null) throw new ErrorDominio("sin_cambios", "Los datos de esa persona ya fueron suprimidos");
    return registrarCorreccion(ctx, usuario, {
      corrige: p.creadaMovId,
      motivo: motivoFinal,
      datos: { suprimir_persona: personaId },
      // El trigger exige todos los datos personales en NULL y app.motivo (lo fija conActor).
      antes: async () => {
        await ctx.tx.expedientePersona.update({
          where: { id },
          data: {
            apellido: null,
            nombres: null,
            dni: null,
            razonSocial: null,
            cuit: null,
            telefono: null,
            email: null,
            domicilio: null,
            vinculo: null,
            suprimidaEn: ctx.ahora,
          },
        });
      },
    });
  });
}
