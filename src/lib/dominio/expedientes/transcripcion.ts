import type { Prisma } from "@/generated/prisma/client";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { exigirNumero } from "./acceso";
import { validarComando } from "./alta";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, estadoNoAdmite, limpiarMotivo, MENSAJE_CONFLICTO_VERSION, noEncontrado, LARGO_MINIMO_MOTIVO, type ErrorCampo } from "./errores";
import { validarUbicacionArchivo } from "./estados";
import {
  interpretarFechaEfectiva,
  ordenDePaso,
  plazoAlEntrar,
  SIN_PLAZO,
  validarFechaEfectiva,
  type FechaEfectiva,
  type RefPaso,
} from "./flujo";
import type { ItemsExpediente } from "./items";
import {
  areasDePaso,
  busquedaActual,
  contextoBloqueado,
  ejecutarAccion,
  fechaInicioDe,
  idItem,
  ultimoMovimientoDeUbicacion,
  type ContextoAccion,
} from "./operacion";
import { plazoParaDb } from "./pase";
import { plazoPorSubtarea } from "./reconstruccion";
import { validarDato } from "./subtareas";

/**
 * La transcripción de la ficha de papel (docs/propuesta-mvp.md, 2.13(c)),
 * para un expediente dado de alta como "iniciado antes del sistema"
 * (`carga_historica`). La hacen Mesa de Entradas y el admin.
 *
 * - `transcribir`: un lote de filas (fecha, precisión, paso destino,
 *   observación, fuente). Cada fila es un `pase` (hacia adelante, salteando
 *   los pasos que la ficha no registra: `pasos_salteados`) o una `devolucion`
 *   (hacia atrás, con motivo), con `carga_historica = true`, su fuente y su
 *   propio `comando_id`: un reintento del lote no repite las filas ya
 *   registradas. No se exigen subtareas ni documentos. La fecha no tiene el
 *   límite de 30 días, pero no retrocede respecto de la fila anterior (ni del
 *   último movimiento del papel): por día si alguna tiene precisión de día.
 *   El lote es una transacción: si una fila falla, no se registra ninguna.
 * - `tildarSubtareaHistorica`: tildar una subtarea de un paso ya recorrido (o
 *   del actual) con su fecha, opcional.
 * - `transcribirEstado`: llevar el expediente a concluido o a archivado
 *   (`ubicacion_archivo` puede ser `DESCONOCIDA`).
 * - `terminarCargaHistorica`: un movimiento `edicion` que apaga la marca. Las
 *   subtareas obligatorias y los documentos obligatorios de los pasos
 *   anteriores al actual (de todos, si está concluido) que siguen sin marcar
 *   pasan a "histórico", y "Faltan N" los acepta. Desde ahí rigen las reglas
 *   normales.
 *
 * Mientras la carga está abierta el expediente no da pases ni devoluciones
 * normales, no aparece en las bandejas de trabajo ni cuenta como demorado
 * (sí en la pestaña "Carga histórica" de Mesa de Entradas).
 */

export interface FilaTranscripcion {
  /** Un UUID por fila, generado por la grilla al agregar la fila. */
  comandoId: string;
  /** `"YYYY-MM-DD"` (precisión de día) o `"YYYY-MM-DDTHH:MM"` (minuto). */
  fecha: string;
  /** Si se manda `dia` con una fecha y hora, cuenta solo el día. Por defecto, la del formato. */
  precision?: "dia" | "minuto";
  /** Clave del paso al que llegó el papel según la ficha. */
  pasoDestino: string;
  observacion?: string | null;
  /** De dónde sale: "Ficha papel", "Libro de pases de Legal". Obligatoria. */
  fuente: string | null;
  /** Obligatorio (10 caracteres o más) si la fila vuelve a un paso anterior (devolución). */
  motivo?: string | null;
}

export interface ResultadoFilaTranscripcion {
  comandoId: string;
  movimientoId: string;
  tipo: "pase" | "devolucion";
  /** La fila ya estaba registrada (reintento del lote). */
  repetida: boolean;
  paso: RefPaso;
}

export interface ResultadoTranscripcion {
  numero: string;
  version: number;
  filas: ResultadoFilaTranscripcion[];
  /** El paso en que quedó el expediente. */
  paso: RefPaso;
}

const LARGO_MAXIMO_FUENTE = 200;

function fuenteDe(valor: string | null | undefined, ruta: string): string {
  const f = limpiarMotivo(valor);
  if (f === null) throw errorValidacion([{ ruta, mensaje: 'Indicá la fuente (ej. "Ficha papel")' }], "Falta la fuente");
  if (f.length > LARGO_MAXIMO_FUENTE) throw errorValidacion([{ ruta, mensaje: `Hasta ${LARGO_MAXIMO_FUENTE} caracteres` }]);
  return f;
}

function fechaDe(valor: string, precision: "dia" | "minuto" | undefined, ahora: Date, ruta: string): FechaEfectiva {
  if (typeof valor !== "string" || valor.trim() === "") throw errorValidacion([{ ruta, mensaje: "Indicá la fecha" }], "Falta la fecha");
  try {
    const texto = precision === "dia" ? valor.trim().slice(0, 10) : valor;
    return interpretarFechaEfectiva(texto, ahora);
  } catch (error) {
    if (error instanceof ErrorDominio) throw errorValidacion([{ ruta, mensaje: error.errores[0]?.mensaje ?? "Fecha inválida" }], "Revisá la fecha");
    throw error;
  }
}

/** Controla una fecha de la transcripción: sin el límite de 30 días, sin retroceder. */
async function validarFechaHistorica(ctx: ContextoAccion, fecha: FechaEfectiva, ruta: string, conUbicacion: boolean): Promise<void> {
  try {
    validarFechaEfectiva(fecha, {
      ahora: ctx.ahora,
      fechaInicio: fechaInicioDe(ctx.exp),
      diasAtras: null,
      ultimoDeUbicacion: conUbicacion ? await ultimoMovimientoDeUbicacion(ctx.tx, ctx.exp.id) : null,
    });
  } catch (error) {
    if (error instanceof ErrorDominio) throw errorValidacion([{ ruta, mensaje: error.errores[0]?.mensaje ?? error.message }], "Revisá la fecha");
    throw error;
  }
}

function exigirCargaAbierta(ctx: ContextoAccion, usuario: UsuarioPermisos, accion: string): void {
  exigirPermiso("transcribir", ctx.permisos, usuario);
  if (ctx.exp.estado === "anulado") throw estadoNoAdmite(ctx.exp.estado, accion);
}

/**
 * Registra un lote de filas de la ficha. Ver el comentario del módulo.
 *
 * @param versionVista la `version` de la grilla; el lote entero falla con `conflicto_version` si cambió.
 * @throws PermisoDenegado (no es Mesa de Entradas ni admin, o la carga histórica no está abierta)
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion` (ruta `filas[i].campo`),
 *   `motivo_requerido` (`filas[i].motivo`)
 */
export async function transcribir(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  filas: readonly FilaTranscripcion[],
  versionVista: number,
): Promise<ResultadoTranscripcion> {
  const numeroInterno = exigirNumero(numero);
  if (!Array.isArray(filas) || filas.length === 0) throw errorValidacion([{ ruta: "filas", mensaje: "Agregá al menos una fila" }]);
  const comandos = filas.map((f, i) => {
    try {
      return validarComando(f.comandoId);
    } catch {
      throw errorValidacion([{ ruta: `filas[${i}].comandoId`, mensaje: "Fila sin identificador: recargá la grilla" }]);
    }
  });
  if (new Set(comandos).size !== comandos.length) throw errorValidacion([{ ruta: "filas", mensaje: "Hay filas repetidas" }]);
  const ahora = deps.ahora?.() ?? new Date();

  return deps.escribir(usuario.id, null, async (tx) => {
    const bloqueado = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM public.expedientes WHERE numero_interno = ${numeroInterno} FOR UPDATE`;
    const id = bloqueado[0]?.id;
    if (id === undefined) throw noEncontrado(numeroInterno);

    // Las filas ya registradas (reintento) se devuelven sin validar nada.
    const previos = await tx.movimiento.findMany({
      where: { expedienteId: id, comandoId: { in: comandos }, tipo: { in: ["pase", "devolucion"] } },
      select: { id: true, comandoId: true, tipo: true, pasoDestino: true },
    });
    const previoDe = new Map(previos.map((m) => [m.comandoId, m]));
    let ctx = await contextoBloqueado(tx, id, comandos[0], ahora);
    const nuevas = comandos.filter((c) => !previoDe.has(c));
    if (nuevas.length > 0 && ctx.exp.version !== versionVista) throw new ErrorDominio("conflicto_version", MENSAJE_CONFLICTO_VERSION);
    if (nuevas.length > 0) exigirCargaAbierta(ctx, usuario, "transcribir pases");
    if (nuevas.length > 0 && ctx.exp.estado !== "en_tramite" && ctx.exp.estado !== "espera_pago_dim") {
      throw estadoNoAdmite(ctx.exp.estado, "transcribir pases (ya está concluido o archivado)");
    }

    const resultados: ResultadoFilaTranscripcion[] = [];
    for (const [i, f] of filas.entries()) {
      const comando = comandos[i];
      const previo = previoDe.get(comando);
      if (previo) {
        const orden = ordenDePaso(ctx.def, previo.pasoDestino ?? "") ?? 0;
        resultados.push({
          comandoId: comando,
          movimientoId: previo.id.toString(),
          tipo: previo.tipo === "devolucion" ? "devolucion" : "pase",
          repetida: true,
          paso: { clave: previo.pasoDestino ?? "", nombre: ctx.def.pasos[orden - 1]?.nombre ?? previo.pasoDestino ?? "", orden },
        });
        continue;
      }
      const r = await registrarFila({ ...ctx, comando }, usuario, f, i);
      resultados.push(r);
      ctx = await contextoBloqueado(tx, id, comando, ahora);
    }

    let version = ctx.exp.version;
    if (nuevas.length > 0) {
      // Una versión nueva por lote, como una acción.
      const busqueda = await busquedaActual(ctx);
      version = (await tx.expediente.update({ where: { id }, data: { busqueda, version: { increment: 1 } }, select: { version: true } })).version;
    }
    return {
      numero: numeroInterno,
      version,
      filas: resultados,
      paso: { clave: ctx.exp.pasoClave, nombre: ctx.pasoActual.nombre, orden: ctx.exp.pasoOrden },
    };
  });
}

async function registrarFila(ctx: ContextoAccion, usuario: UsuarioPermisos, f: FilaTranscripcion, i: number): Promise<ResultadoFilaTranscripcion> {
  const { tx, exp, def, items } = ctx;
  const ruta = (campo: string) => `filas[${i}].${campo}`;
  const orden = ordenDePaso(def, f.pasoDestino);
  if (orden === null) throw errorValidacion([{ ruta: ruta("pasoDestino"), mensaje: "Ese paso no es de la plantilla" }], "Revisá el paso");
  if (orden === exp.pasoOrden) throw errorValidacion([{ ruta: ruta("pasoDestino"), mensaje: "El expediente ya está en ese paso" }], "Revisá el paso");
  const fuente = fuenteDe(f.fuente, ruta("fuente"));
  const fecha = fechaDe(f.fecha, f.precision, ctx.ahora, ruta("fecha"));
  await validarFechaHistorica(ctx, fecha, ruta("fecha"), true);
  const adelante = orden > exp.pasoOrden;
  let motivo = limpiarMotivo(f.motivo);
  if (!adelante && (motivo === null || motivo.length < LARGO_MINIMO_MOTIVO)) {
    const e: ErrorCampo = { ruta: ruta("motivo"), mensaje: `Una vuelta a un paso anterior es una devolución: escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` };
    throw new ErrorDominio("motivo_requerido", "La devolución exige motivo", [e]);
  }
  if (adelante && motivo !== null && motivo.length < LARGO_MINIMO_MOTIVO) motivo = null;

  const paso = def.pasos[orden - 1];
  const areas = await areasDePaso(ctx, paso);
  const ordenRetorno = exp.pasoRetornoClave === null ? null : ordenDePaso(def, exp.pasoRetornoClave);
  // Las mismas reglas del paso de retorno que el pase y la devolución (reconstruccion.ts).
  const retorno = adelante
    ? exp.pasoRetornoClave !== null && ordenRetorno !== null && orden < ordenRetorno
      ? exp.pasoRetornoClave
      : null
    : ordenRetorno !== null && ordenRetorno > exp.pasoOrden
      ? exp.pasoRetornoClave
      : exp.pasoClave;
  const salteados = adelante ? def.pasos.slice(exp.pasoOrden, orden - 1).map((p) => p.clave) : [];
  const m = await tx.movimiento.create({
    data: {
      expedienteId: exp.id,
      tipo: adelante ? "pase" : "devolucion",
      fechaEfectiva: fecha.instante,
      precisionFecha: fecha.precision,
      usuarioId: usuario.id,
      pasoOrigen: exp.pasoClave,
      pasoDestino: paso.clave,
      areaOrigenId: exp.areaActualId,
      areaDestinoId: areas.areaActualId,
      estadoAnterior: paso.estado !== exp.estado ? exp.estado : null,
      estadoNuevo: paso.estado !== exp.estado ? paso.estado : null,
      motivo,
      observacion: limpiarMotivo(f.observacion),
      // Los salteados no piden motivo: la ficha no registró esos pasos (no son omitibles).
      datos: adelante ? { pasos_omitidos: [], pasos_salteados: salteados, transcripcion: true } : { subtareas_reiniciadas: [], transcripcion: true },
      cargaHistorica: true,
      fuente,
      comandoId: ctx.comando,
    },
    select: { id: true },
  });
  await tx.expediente.update({
    where: { id: exp.id },
    data: {
      pasoClave: paso.clave,
      pasoOrden: orden,
      areaActualId: areas.areaActualId,
      areaResponsableId: areas.areaResponsableId,
      estado: paso.estado,
      enAreaDesde: fecha.instante,
      // Nadie confirma la recepción en una ficha de papel.
      recibidoEn: fecha.instante,
      ...plazoParaDb(plazoAlEntrar(paso, items)),
      pasoRetornoClave: retorno,
    },
  });
  return {
    comandoId: ctx.comando,
    movimientoId: m.id.toString(),
    tipo: adelante ? "pase" : "devolucion",
    repetida: false,
    paso: { clave: paso.clave, nombre: paso.nombre, orden },
  };
}

export interface ResultadoAccionHistorica {
  numero: string;
  version: number;
  repetido: boolean;
  movimientoId: string;
}

async function repetidoHistorico(tx: ContextoAccion["tx"], expedienteId: bigint, movimientoId: bigint): Promise<ResultadoAccionHistorica> {
  const e = await tx.expediente.findUniqueOrThrow({ where: { id: expedienteId }, select: { numeroInterno: true, version: true } });
  return { numero: e.numeroInterno, version: e.version, repetido: true, movimientoId: movimientoId.toString() };
}

export interface OpcionesSubtareaHistorica {
  /** El día en que se hizo según la ficha (`"YYYY-MM-DD"`). Si no, la fecha del dato (si es una fecha) o ahora. */
  fecha?: string | null;
  fuente: string | null;
  observacion?: string | null;
}

/**
 * Tilda, en la transcripción, una subtarea de un paso ya recorrido o del
 * actual, con su dato y, opcionalmente, su fecha (2.13(c): "se pueden tildar
 * con su fecha"). Movimiento `subtarea` con `carga_historica` y fuente.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`, `sin_cambios`
 */
export async function tildarSubtareaHistorica(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  clave: string,
  dato: string | null,
  opciones: OpcionesSubtareaHistorica,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoAccionHistorica> {
  return ejecutarAccion(deps, usuario, { numero, comandoId, tipo: "subtarea", motivo: null, versionVista, repetido: repetidoHistorico }, async (ctx) => {
    const { tx, exp, def } = ctx;
    exigirCargaAbierta(ctx, usuario, "tildar subtareas");
    const orden = def.pasos.findIndex((p) => p.subtareas.some((s) => s.clave === clave)) + 1;
    const s = orden > 0 ? def.pasos[orden - 1].subtareas.find((x) => x.clave === clave) : undefined;
    if (!s) throw errorValidacion([{ ruta: "subtarea", mensaje: "No existe esa subtarea en la plantilla" }], "Subtarea desconocida");
    if (orden > exp.pasoOrden) throw errorValidacion([{ ruta: "subtarea", mensaje: "Esa subtarea es de un paso al que el expediente todavía no llegó" }]);
    const fuente = fuenteDe(opciones.fuente, "fuente");
    const valor = validarDato(s, dato, { hoy: ctx.hoy, fechaInicio: fechaInicioDe(exp) });
    const anterior = ctx.items.subtareas[s.clave];
    if (anterior?.hecha && (anterior.dato ?? null) === valor) throw new ErrorDominio("sin_cambios", `"${s.nombre}" ya está tildada`);
    const texto = limpiarMotivo(opciones.fecha) ?? (s.dato === "fecha" && valor !== null ? valor : null);
    const fecha = texto === null ? { instante: ctx.ahora, precision: "minuto" as const } : fechaDe(texto, "dia", ctx.ahora, "fecha");
    // Las subtareas no entran en la regla de no retroceso (decisión 6).
    await validarFechaHistorica(ctx, fecha, "fecha", false);
    const m = await tx.movimiento.create({
      data: {
        expedienteId: exp.id,
        tipo: "subtarea",
        fechaEfectiva: fecha.instante,
        precisionFecha: fecha.precision,
        usuarioId: usuario.id,
        observacion: limpiarMotivo(opciones.observacion),
        datos: { subtarea: s.clave, hecha: true, dato: valor, paso: def.pasos[orden - 1].clave, transcripcion: true },
        cargaHistorica: true,
        fuente,
        comandoId: ctx.comando,
      },
      select: { id: true },
    });
    const items: ItemsExpediente = {
      ...ctx.items,
      subtareas: { ...ctx.items.subtareas, [s.clave]: { hecha: true, dato: valor, mov: idItem(m.id), reiniciada_por_mov: null, historica: false } },
    };
    const plazo = plazoPorSubtarea(ctx.pasoActual, s.clave, items, fecha.instante, {
      plazoDesde: exp.plazoDesde === null ? null : exp.plazoDesde.toISOString().slice(0, 10),
      plazoDiasHabiles: exp.plazoDiasHabiles,
      plazoCumplidoEn: exp.plazoCumplidoEn === null ? null : exp.plazoCumplidoEn.toISOString().slice(0, 10),
    });
    const busqueda = await busquedaActual(ctx);
    const r = await tx.expediente.update({
      where: { id: exp.id },
      data: { items, busqueda, ...plazoParaDb(plazo), version: { increment: 1 } },
      select: { version: true },
    });
    return { numero: exp.numeroInterno, version: r.version, repetido: false, movimientoId: m.id.toString() };
  });
}

export interface EntradaEstadoHistorico {
  estado: "concluido" | "archivado";
  /** `"YYYY-MM-DD"` o `datetime-local`, como las filas. */
  fecha: string;
  precision?: "dia" | "minuto";
  fuente: string | null;
  /** Archivado: la caja o el estante; `DESCONOCIDA` si no se sabe. */
  ubicacionArchivo?: string | null;
  /** Archivado sin concluir: obligatorio (lo exige también el CHECK). */
  motivo?: string | null;
  observacion?: string | null;
}

/**
 * Lleva, en la transcripción, el expediente a concluido (desde el último
 * paso, sin exigir subtareas ni documentos) o a archivado (desde concluido, o
 * sin concluir con motivo), con `ubicacion_archivo` que puede ser
 * `DESCONOCIDA`. Movimiento `estado` con `carga_historica` y fuente.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`, `motivo_requerido`
 */
export async function transcribirEstado(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  entrada: EntradaEstadoHistorico,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoAccionHistorica> {
  const motivoLimpio = limpiarMotivo(entrada.motivo);
  return ejecutarAccion(deps, usuario, { numero, comandoId, tipo: "estado", motivo: motivoLimpio, versionVista, repetido: repetidoHistorico }, async (ctx) => {
    const { tx, exp, def } = ctx;
    exigirCargaAbierta(ctx, usuario, "cambiar el estado");
    const activo = exp.estado === "en_tramite" || exp.estado === "espera_pago_dim";
    const fuente = fuenteDe(entrada.fuente, "fuente");
    const fecha = fechaDe(entrada.fecha, entrada.precision, ctx.ahora, "fecha");
    await validarFechaHistorica(ctx, fecha, "fecha", true);
    let datos: Prisma.InputJsonObject = { transcripcion: true };
    let proyeccion: Prisma.ExpedienteUpdateInput;
    let motivo: string | null = null;
    if (entrada.estado === "concluido") {
      if (!activo) throw estadoNoAdmite(exp.estado, "concluirlo");
      if (exp.pasoOrden < def.pasos.length) {
        throw errorValidacion([{ ruta: "estado", mensaje: `Se concluye desde el último paso (${def.pasos.at(-1)?.nombre ?? ""}): transcribí antes el pase` }]);
      }
      proyeccion = { ...plazoParaDb(SIN_PLAZO) };
    } else {
      if (!activo && exp.estado !== "concluido") throw estadoNoAdmite(exp.estado, "archivarlo");
      const ubicacion = validarUbicacionArchivo(entrada.ubicacionArchivo, true);
      if (activo) {
        if (motivoLimpio === null || motivoLimpio.length < LARGO_MINIMO_MOTIVO) {
          throw new ErrorDominio("motivo_requerido", "Archivar sin concluir exige motivo", [
            { ruta: "motivo", mensaje: `Escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` },
          ]);
        }
        motivo = motivoLimpio;
      }
      datos = { ubicacion_archivo: ubicacion, transcripcion: true };
      proyeccion = { ...plazoParaDb(SIN_PLAZO), estadoPrevio: exp.estado, ubicacionArchivo: ubicacion };
    }
    const m = await tx.movimiento.create({
      data: {
        expedienteId: exp.id,
        tipo: "estado",
        fechaEfectiva: fecha.instante,
        precisionFecha: fecha.precision,
        usuarioId: usuario.id,
        pasoOrigen: exp.pasoClave,
        areaOrigenId: exp.areaActualId,
        estadoAnterior: exp.estado,
        estadoNuevo: entrada.estado,
        motivo,
        observacion: limpiarMotivo(entrada.observacion),
        datos,
        cargaHistorica: true,
        fuente,
        comandoId: ctx.comando,
      },
      select: { id: true },
    });
    const r = await tx.expediente.update({
      where: { id: exp.id },
      data: { ...proyeccion, estado: entrada.estado, version: { increment: 1 } },
      select: { version: true },
    });
    return { numero: exp.numeroInterno, version: r.version, repetido: false, movimientoId: m.id.toString() };
  });
}

/** Lo que "Terminar carga histórica" pasa a histórico (puro, para la ficha y la acción). */
export function pendientesHistoricos(
  def: ContextoAccion["def"],
  items: ItemsExpediente,
  pasoOrden: number,
  concluido: boolean,
): { subtareas: string[]; documentos: string[] } {
  // Concluido: todos los pasos quedaron atrás, también el último y lo de "al concluir".
  const limite = concluido ? def.pasos.length + 1 : pasoOrden;
  const subtareas: string[] = [];
  for (let o = 1; o < limite && o <= def.pasos.length; o++) {
    for (const s of def.pasos[o - 1].subtareas) {
      const item = items.subtareas[s.clave];
      if (s.obligatoria && !(item?.hecha || item?.historica)) subtareas.push(s.clave);
    }
  }
  const documentos: string[] = [];
  for (const d of def.documentos) {
    if (!d.obligatorio) continue;
    const orden = d.exigir_al_salir_de === null ? (concluido ? def.pasos.length : null) : ordenDePaso(def, d.exigir_al_salir_de);
    if (orden === null || orden >= limite) continue;
    if ((items.documentos[d.clave]?.estado ?? "pendiente") === "pendiente") documentos.push(d.clave);
  }
  return { subtareas, documentos };
}

/**
 * "Terminar carga histórica" (2.13(c)): movimiento `edicion` con
 * `{cambios: {carga_historica: [true, false]}, historicos: {subtareas,
 * documentos}}`. Lo pendiente de los pasos anteriores pasa a histórico.
 *
 * @throws PermisoDenegado (no es Mesa de Entradas ni admin, o la carga no está abierta)
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`
 */
export async function terminarCargaHistorica(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoAccionHistorica & { historicos: { subtareas: string[]; documentos: string[] } }> {
  return ejecutarAccion(
    deps,
    usuario,
    {
      numero,
      comandoId,
      tipo: "edicion",
      motivo: null,
      versionVista,
      repetido: async (tx, id, mov) => {
        const m = await tx.movimiento.findUniqueOrThrow({ where: { id: mov }, select: { datos: true } });
        const h = ((m.datos ?? {}) as { historicos?: { subtareas?: string[]; documentos?: string[] } }).historicos ?? {};
        return { ...(await repetidoHistorico(tx, id, mov)), historicos: { subtareas: h.subtareas ?? [], documentos: h.documentos ?? [] } };
      },
    },
    async (ctx) => {
      const { tx, exp, def } = ctx;
      exigirCargaAbierta(ctx, usuario, "terminar la carga histórica");
      const concluido = exp.estado === "concluido" || (exp.estado === "archivado" && exp.estadoPrevio === "concluido");
      const historicos = pendientesHistoricos(def, ctx.items, exp.pasoOrden, concluido);
      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "edicion",
          fechaEfectiva: ctx.ahora,
          precisionFecha: "minuto",
          usuarioId: usuario.id,
          datos: { cambios: { carga_historica: [true, false] }, personas: { baja: [], reemplazadas: [] }, historicos },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });
      const mov = idItem(m.id);
      const subtareas = { ...ctx.items.subtareas };
      for (const clave of historicos.subtareas) {
        const previa = subtareas[clave];
        subtareas[clave] = { hecha: previa?.hecha ?? false, dato: previa?.dato ?? null, mov, reiniciada_por_mov: null, historica: true };
      }
      const documentos = { ...ctx.items.documentos };
      for (const clave of historicos.documentos) {
        documentos[clave] = { estado: "historico", obs: null, mov, adjuntos: documentos[clave]?.adjuntos ?? [] };
      }
      const r = await tx.expediente.update({
        where: { id: exp.id },
        data: { cargaHistorica: false, items: { ...ctx.items, subtareas, documentos }, version: { increment: 1 } },
        select: { version: true },
      });
      return { numero: exp.numeroInterno, version: r.version, repetido: false, movimientoId: m.id.toString(), historicos };
    },
  );
}

