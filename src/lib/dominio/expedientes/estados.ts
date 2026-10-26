import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { avisarCierre } from "../avisos/eventos";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { exigirNumero, registrarAcceso, type OpcionesAcceso } from "./acceso";
import { numeroCorto } from "./numero";
import { altaEn, validarComando, type ResultadoAlta } from "./alta";
import { definicionDelExpediente } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, estadoNoAdmite, exigirMotivo, limpiarMotivo, noEncontrado } from "./errores";
import type { DatosAlta, PersonaEntrada, ValorCampoExtra } from "./esquemas";
import {
  erroresDeFaltantes,
  faltantesParaConcluir,
  interpretarFechaEfectiva,
  plazoAlEntrar,
  SIN_PLAZO,
  validarFechaEfectiva,
  type EntradaFechaEfectiva,
  type FechaEfectiva,
  type RefPaso,
} from "./flujo";
import {
  areasDePaso,
  ejecutarAccion,
  fechaInicioDe,
  recepcionImplicita,
  ultimoMovimientoDeUbicacion,
  type ContextoAccion,
} from "./operacion";
import { plazoParaDb } from "./pase";

/**
 * Los cambios de estado (docs/propuesta-mvp.md, 3.1), "Reiniciar con otra
 * plantilla" (2.13(a)) y "archivar y abrir vinculado" (docs/fuentes, punto 6).
 *
 * | Acción | De → A | Quién | Exige |
 * |---|---|---|---|
 * | `concluir` | en trámite → concluido | el área responsable del último paso | lo del pase más los documentos y campos "al concluir" |
 * | `archivar` | concluido → archivado | responsable, Mesa de Entradas, admin | `ubicacion_archivo` |
 * | `archivarSinConcluir` | en trámite / espera DIM → archivado | Mesa de Entradas, admin | motivo y `ubicacion_archivo`; desde un paso externo registra el regreso del papel |
 * | `desarchivar` | archivado → `estado_previo` | Mesa de Entradas, admin | motivo; vuelve al paso en que estaba |
 * | `anular` | en trámite / espera DIM → anulado | Mesa de Entradas, admin | motivo |
 * | `reabrir` | anulado → `estado_previo` | admin | motivo (no depende de que sea el último movimiento) |
 * | `cambiarUbicacionArchivo` | archivado | responsable, Mesa de Entradas, admin | la ubicación nueva (movimiento `edicion`) |
 *
 * Todas siguen el esqueleto de operacion.ts (idempotencia, FOR UPDATE,
 * versión) e insertan un movimiento `estado` con `estado_anterior` y
 * `estado_nuevo`; los motivos los exige también el CHECK de movimientos. La
 * fecha efectiva sigue la regla del pase (no retrocede respecto del último
 * movimiento de ubicación, hasta 30 días atrás).
 *
 * El plazo (3.6) se limpia al salir de los estados activos y se vuelve a
 * cargar al volver (desarchivar, reabrir) con las subtareas como estén. En
 * concluido, archivado y anulado no hay pases (3.1): el permiso lo controla.
 */

/** Lo que se admite como `ubicacion_archivo` solo en la carga histórica (2.6). */
export const UBICACION_ARCHIVO_DESCONOCIDA = "DESCONOCIDA";
const LARGO_MAXIMO_UBICACION = 120;

export interface OpcionesEstado {
  /** Cuándo pasó, si no fue ahora (ver `EntradaFechaEfectiva`). */
  fechaEfectiva?: EntradaFechaEfectiva;
  observacion?: string | null;
}

export interface ResultadoEstado {
  numero: string;
  version: number;
  repetido: boolean;
  movimientoId: string;
  recepcionImplicitaId: string | null;
  estado: string;
  estadoPrevio: string | null;
  ubicacionArchivo: string | null;
  paso: RefPaso;
  areaActual: { id: number; codigo: string; nombre: string };
  areaResponsable: { id: number; codigo: string; nombre: string };
}

async function resultadoDe(
  tx: Transaccion,
  expedienteId: bigint,
  movimientoId: bigint,
  repetido: boolean,
  recepcionId: bigint | null,
): Promise<ResultadoEstado> {
  const e = await tx.expediente.findUniqueOrThrow({
    where: { id: expedienteId },
    include: {
      plantilla: { select: { codigo: true, version: true, definicion: true } },
      areaActual: { select: { id: true, codigo: true, nombre: true } },
      areaResponsable: { select: { id: true, codigo: true, nombre: true } },
    },
  });
  const def = await definicionDelExpediente(tx, e, e.plantilla);
  let recepcion = recepcionId;
  if (repetido) {
    const m = await tx.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { comandoId: true } });
    const r = await tx.movimiento.findFirst({ where: { expedienteId, tipo: "recepcion", comandoId: m.comandoId }, select: { id: true } });
    recepcion = r?.id ?? null;
  }
  return {
    numero: e.numeroInterno,
    version: e.version,
    repetido,
    movimientoId: movimientoId.toString(),
    recepcionImplicitaId: recepcion?.toString() ?? null,
    estado: e.estado,
    estadoPrevio: e.estadoPrevio,
    ubicacionArchivo: e.ubicacionArchivo,
    paso: { clave: e.pasoClave, nombre: def.pasos[e.pasoOrden - 1]?.nombre ?? e.pasoClave, orden: e.pasoOrden },
    areaActual: e.areaActual,
    areaResponsable: e.areaResponsable,
  };
}

function esActivo(estado: string): boolean {
  return estado === "en_tramite" || estado === "espera_pago_dim";
}

/**
 * La caja o el estante. `DESCONOCIDA` solo en la carga histórica: en el
 * archivo de hoy el papel tiene un lugar.
 */
export function validarUbicacionArchivo(valor: string | null | undefined, admiteDesconocida: boolean): string {
  const u = limpiarMotivo(valor);
  if (u === null) throw errorValidacion([{ ruta: "ubicacionArchivo", mensaje: "Indicá la caja o el estante" }], "Falta la ubicación en el archivo");
  if (u.length > LARGO_MAXIMO_UBICACION) {
    throw errorValidacion([{ ruta: "ubicacionArchivo", mensaje: `Hasta ${LARGO_MAXIMO_UBICACION} caracteres` }]);
  }
  if (!admiteDesconocida && u.toUpperCase() === UBICACION_ARCHIVO_DESCONOCIDA) {
    throw errorValidacion([{ ruta: "ubicacionArchivo", mensaje: "DESCONOCIDA se admite solo en la carga histórica" }]);
  }
  return u.toUpperCase() === UBICACION_ARCHIVO_DESCONOCIDA ? UBICACION_ARCHIVO_DESCONOCIDA : u;
}

/** La fecha efectiva de un cambio de estado: las reglas del pase (3.3, punto 7). */
async function fechaDelCambio(ctx: ContextoAccion, entrada: EntradaFechaEfectiva): Promise<FechaEfectiva> {
  const fecha = interpretarFechaEfectiva(entrada, ctx.ahora);
  validarFechaEfectiva(fecha, {
    ahora: ctx.ahora,
    fechaInicio: fechaInicioDe(ctx.exp),
    ultimoDeUbicacion: await ultimoMovimientoDeUbicacion(ctx.tx, ctx.exp.id),
  });
  return fecha;
}

interface Cambio {
  estadoNuevo: string;
  motivo: string | null;
  fecha: FechaEfectiva;
  observacion: string | null;
  datos: Prisma.InputJsonObject;
  /** Si el papel se mueve con el cambio (regreso desde afuera, desarchivo al paso). */
  areaDestinoId?: number | null;
  pasoDestino?: string | null;
  /** Lo que se escribe en el expediente, además de `estado` y `version`. */
  proyeccion: Prisma.ExpedienteUpdateInput;
}

/** Inserta el movimiento `estado` y actualiza la proyección. */
async function registrarCambio(ctx: ContextoAccion, usuario: UsuarioPermisos, c: Cambio): Promise<ResultadoEstado> {
  const { tx, exp } = ctx;
  const recepcion = esActivo(exp.estado) ? await recepcionImplicita(ctx, usuario) : null;
  const m = await tx.movimiento.create({
    data: {
      expedienteId: exp.id,
      tipo: "estado",
      fechaEfectiva: c.fecha.instante,
      precisionFecha: c.fecha.precision,
      usuarioId: usuario.id,
      pasoOrigen: exp.pasoClave,
      pasoDestino: c.pasoDestino ?? null,
      areaOrigenId: exp.areaActualId,
      areaDestinoId: c.areaDestinoId ?? null,
      estadoAnterior: exp.estado,
      estadoNuevo: c.estadoNuevo,
      motivo: c.motivo,
      observacion: c.observacion,
      datos: c.datos,
      comandoId: ctx.comando,
    },
    select: { id: true },
  });
  await tx.expediente.update({
    where: { id: exp.id },
    data: {
      ...(recepcion ? { recibidoEn: recepcion.recibidoEn } : {}),
      ...c.proyeccion,
      estado: c.estadoNuevo,
      version: { increment: 1 },
    },
  });
  return resultadoDe(tx, exp.id, m.id, false, recepcion?.movimientoId ?? null);
}

/**
 * "Concluido o archivado" para Mesa de Entradas (informativo; cada usuario lo
 * puede apagar), en la misma transacción que el movimiento `estado`
 * (docs/api-dominio.md, 21.2). Solo al concluir y al archivar: desarchivar o
 * reabrir no avisan.
 */
async function conAvisoDeCierre(ctx: ContextoAccion, usuario: UsuarioPermisos, r: ResultadoEstado, sinConcluir: boolean): Promise<ResultadoEstado> {
  if (r.estado === "concluido" || r.estado === "archivado") {
    await avisarCierre(ctx.tx, {
      expedienteId: ctx.exp.id,
      movimientoId: BigInt(r.movimientoId),
      actorId: usuario.id,
      actorAreaId: usuario.area?.id ?? null,
      estado: r.estado,
      ubicacionArchivo: r.estado === "archivado" ? r.ubicacionArchivo : null,
      sinConcluir,
      ahora: ctx.ahora,
    });
  }
  return r;
}

function opcionesDe(numero: string, comandoId: string, motivo: string | null, versionVista: number) {
  return {
    numero,
    comandoId,
    tipo: "estado" as const,
    motivo,
    versionVista,
    repetido: (tx: Transaccion, id: bigint, mov: bigint) => resultadoDe(tx, id, mov, true, null),
  };
}

// ---------------------------------------------------------------------------
// Concluir y archivar
// ---------------------------------------------------------------------------

/**
 * Concluye el expediente desde el último paso (3.1): las validaciones del pase
 * (subtareas del paso, documentos y campos acumulados) más los documentos y
 * campos extra con `exigir_al_salir_de: null`. Si falta algo,
 * `faltan_requisitos` con la lista ("Faltan N", como el pase).
 *
 * @throws PermisoDenegado (no es el responsable, no es el último paso, carga histórica abierta)
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `faltan_requisitos`, `validacion` (fecha)
 */
export async function concluir(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesEstado = {},
): Promise<ResultadoEstado> {
  return ejecutarAccion(deps, usuario, opcionesDe(numero, comandoId, null, versionVista), async (ctx) => {
    if (!esActivo(ctx.exp.estado)) throw estadoNoAdmite(ctx.exp.estado, "concluir");
    exigirPermiso("concluir", ctx.permisos, usuario);
    const faltan = faltantesParaConcluir(ctx.def, ctx.items, ctx.exp.datosExtra as Record<string, unknown>);
    if (faltan.length > 0) {
      throw new ErrorDominio("faltan_requisitos", `Faltan ${faltan.length}: ${faltan.map((f) => f.mensaje).join("; ")}`, erroresDeFaltantes(faltan));
    }
    const fecha = await fechaDelCambio(ctx, opciones.fechaEfectiva);
    const r = await registrarCambio(ctx, usuario, {
      estadoNuevo: "concluido",
      motivo: null,
      fecha,
      observacion: limpiarMotivo(opciones.observacion),
      datos: {},
      proyeccion: { ...plazoParaDb(SIN_PLAZO) },
    });
    return conAvisoDeCierre(ctx, usuario, r, false);
  });
}

/**
 * Archiva un expediente concluido (3.1) en la caja o estante indicado.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion` (ubicación, fecha)
 */
export async function archivar(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  ubicacionArchivo: string,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesEstado = {},
): Promise<ResultadoEstado> {
  const ubicacion = validarUbicacionArchivo(ubicacionArchivo, false);
  return ejecutarAccion(deps, usuario, opcionesDe(numero, comandoId, null, versionVista), async (ctx) => {
    if (ctx.exp.estado !== "concluido") throw estadoNoAdmite(ctx.exp.estado, "archivarlo como concluido (se archiva sin concluir)");
    exigirPermiso("archivar_concluido", ctx.permisos, usuario);
    const fecha = await fechaDelCambio(ctx, opciones.fechaEfectiva);
    const r = await registrarCambio(ctx, usuario, {
      estadoNuevo: "archivado",
      motivo: null,
      fecha,
      observacion: limpiarMotivo(opciones.observacion),
      datos: { ubicacion_archivo: ubicacion },
      proyeccion: { estadoPrevio: "concluido", ubicacionArchivo: ubicacion },
    });
    return conAvisoDeCierre(ctx, usuario, r, false);
  });
}

export interface EntradaArchivarSinConcluir extends OpcionesEstado {
  motivo: string | null;
  ubicacionArchivo: string;
}

/** Lo de "archivar sin concluir" ya dentro de la acción (lo usa también "archivar y abrir vinculado"). */
async function archivarSinConcluirEn(
  ctx: ContextoAccion,
  usuario: UsuarioPermisos,
  entrada: EntradaArchivarSinConcluir,
  extra: Prisma.InputJsonObject,
): Promise<ResultadoEstado> {
  if (!esActivo(ctx.exp.estado)) throw estadoNoAdmite(ctx.exp.estado, "archivarlo sin concluir");
  exigirPermiso("archivar_sin_concluir", ctx.permisos, usuario);
  const motivo = exigirMotivo(entrada.motivo, "Archivar sin concluir");
  const ubicacion = validarUbicacionArchivo(entrada.ubicacionArchivo, false);
  const fecha = await fechaDelCambio(ctx, entrada.fechaEfectiva);
  const actual = await ctx.tx.area.findUniqueOrThrow({ where: { id: ctx.exp.areaActualId }, select: { tipo: true } });
  // Desde un paso externo (la DIM que devolvió sin pago, un cementerio): el
  // papel vuelve a la custodia en el mismo movimiento (3.1 y 3.5).
  const externo = actual.tipo === "externa";
  const regreso = externo ? { fecha: fecha.instante.toISOString(), area_id: ctx.exp.areaResponsableId } : null;
  const r = await registrarCambio(ctx, usuario, {
    estadoNuevo: "archivado",
    motivo,
    fecha,
    observacion: limpiarMotivo(entrada.observacion),
    datos: { ubicacion_archivo: ubicacion, ...(regreso ? { regreso_papel: regreso } : {}), ...extra },
    areaDestinoId: regreso ? regreso.area_id : null,
    proyeccion: {
      ...plazoParaDb(SIN_PLAZO),
      estadoPrevio: ctx.exp.estado,
      ubicacionArchivo: ubicacion,
      ...(regreso ? { areaActual: { connect: { id: regreso.area_id } }, enAreaDesde: fecha.instante, recibidoEn: fecha.instante } : {}),
    },
  });
  return conAvisoDeCierre(ctx, usuario, r, true);
}

/**
 * Archiva sin concluir (3.1): Mesa de Entradas o el admin, con motivo y
 * ubicación. Si el paso actual es externo, el mismo movimiento registra el
 * regreso del papel a la custodia (`datos.regreso_papel`: fecha y área).
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`
 */
export async function archivarSinConcluir(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  entrada: EntradaArchivarSinConcluir,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoEstado> {
  const motivo = exigirMotivo(entrada.motivo, "Archivar sin concluir");
  return ejecutarAccion(deps, usuario, opcionesDe(numero, comandoId, motivo, versionVista), (ctx) =>
    archivarSinConcluirEn(ctx, usuario, entrada, {}),
  );
}

/**
 * Desarchiva (3.1): vuelve a `estado_previo`. Si estaba en trámite, vuelve al
 * paso en que estaba: el papel sale del archivo hacia el área del paso (o su
 * custodia, si es externo), que lo tiene que confirmar como en un pase.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion` (fecha)
 */
export async function desarchivar(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesEstado = {},
): Promise<ResultadoEstado> {
  const motivoFinal = exigirMotivo(motivo, "Desarchivar");
  return ejecutarAccion(deps, usuario, opcionesDe(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    const { exp } = ctx;
    if (exp.estado !== "archivado") throw estadoNoAdmite(exp.estado, "desarchivarlo");
    exigirPermiso("desarchivar", ctx.permisos, usuario);
    const previo = exp.estadoPrevio ?? "concluido";
    const fecha = await fechaDelCambio(ctx, opciones.fechaEfectiva);
    const base = {
      estadoNuevo: previo,
      motivo: motivoFinal,
      fecha,
      observacion: limpiarMotivo(opciones.observacion),
      datos: { ubicacion_archivo: exp.ubicacionArchivo },
    };
    if (!esActivo(previo)) {
      return registrarCambio(ctx, usuario, { ...base, proyeccion: { estadoPrevio: null, ubicacionArchivo: null } });
    }
    const areas = await areasDePaso(ctx, ctx.pasoActual);
    const recibido = areas.externa || usuario.area?.id === areas.areaActualId;
    return registrarCambio(ctx, usuario, {
      ...base,
      areaDestinoId: areas.areaActualId,
      pasoDestino: exp.pasoClave,
      proyeccion: {
        estadoPrevio: null,
        ubicacionArchivo: null,
        areaActual: { connect: { id: areas.areaActualId } },
        areaResponsable: { connect: { id: areas.areaResponsableId } },
        enAreaDesde: fecha.instante,
        recibidoEn: recibido ? fecha.instante : null,
        ...plazoParaDb(plazoAlEntrar(ctx.pasoActual, ctx.items)),
      },
    });
  });
}

/**
 * Cambia la caja o el estante de un archivado (3.1). Es un movimiento
 * `edicion` con `{cambios: {ubicacion_archivo: [antes, después]}}`: un dato
 * del expediente, no un cambio de estado. El motivo es opcional.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`, `sin_cambios`
 */
export async function cambiarUbicacionArchivo(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  ubicacionArchivo: string,
  versionVista: number,
  comandoId: string,
  opciones: { motivo?: string | null } = {},
): Promise<ResultadoEstado> {
  const ubicacion = validarUbicacionArchivo(ubicacionArchivo, true);
  const motivo = limpiarMotivo(opciones.motivo);
  return ejecutarAccion(
    deps,
    usuario,
    { ...opcionesDe(numero, comandoId, motivo, versionVista), tipo: "edicion" },
    async (ctx) => {
      const { tx, exp } = ctx;
      if (exp.estado !== "archivado") throw estadoNoAdmite(exp.estado, "cambiar la ubicación en el archivo");
      exigirPermiso("cambiar_ubicacion_archivo", ctx.permisos, usuario);
      // DESCONOCIDA es de la carga histórica: se puede reemplazar por una real, no al revés.
      if (ubicacion === UBICACION_ARCHIVO_DESCONOCIDA && exp.ubicacionArchivo !== UBICACION_ARCHIVO_DESCONOCIDA) {
        validarUbicacionArchivo(ubicacion, false);
      }
      if (ubicacion === exp.ubicacionArchivo) throw new ErrorDominio("sin_cambios", "El expediente ya está en esa ubicación");
      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "edicion",
          fechaEfectiva: ctx.ahora,
          precisionFecha: "minuto",
          usuarioId: usuario.id,
          motivo,
          datos: { cambios: { ubicacion_archivo: [exp.ubicacionArchivo, ubicacion] }, personas: { baja: [], reemplazadas: [] } },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });
      await tx.expediente.update({ where: { id: exp.id }, data: { ubicacionArchivo: ubicacion, version: { increment: 1 } } });
      return resultadoDe(tx, exp.id, m.id, false, null);
    },
  );
}

// ---------------------------------------------------------------------------
// Anular, reabrir y reiniciar
// ---------------------------------------------------------------------------

async function anularEn(ctx: ContextoAccion, usuario: UsuarioPermisos, motivo: string, opciones: OpcionesEstado, reinicio: boolean): Promise<ResultadoEstado> {
  if (!esActivo(ctx.exp.estado)) throw estadoNoAdmite(ctx.exp.estado, "anularlo");
  exigirPermiso(reinicio ? "reiniciar_con_otra_plantilla" : "anular", ctx.permisos, usuario);
  const fecha = await fechaDelCambio(ctx, opciones.fechaEfectiva);
  return registrarCambio(ctx, usuario, {
    estadoNuevo: "anulado",
    motivo,
    fecha,
    observacion: limpiarMotivo(opciones.observacion),
    // `reinicio` habilita el alta que lo continúa (alta.ts, validarAnterior).
    datos: reinicio ? { reinicio: true } : {},
    proyeccion: { ...plazoParaDb(SIN_PLAZO), estadoPrevio: ctx.exp.estado },
  });
}

/**
 * Anula (3.1): Mesa de Entradas o el admin, con motivo. Conserva el número.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion` (fecha)
 */
export async function anular(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesEstado = {},
): Promise<ResultadoEstado> {
  const motivoFinal = exigirMotivo(motivo, "Anular");
  return ejecutarAccion(deps, usuario, opcionesDe(numero, comandoId, motivoFinal, versionVista), (ctx) => anularEn(ctx, usuario, motivoFinal, opciones, false));
}

/**
 * Reabre un anulado (3.1): solo el admin, con motivo. Vuelve a `estado_previo`
 * en el mismo paso y área; no depende de que la anulación sea el último
 * movimiento.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion` (fecha)
 */
export async function reabrir(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesEstado = {},
): Promise<ResultadoEstado> {
  const motivoFinal = exigirMotivo(motivo, "Reabrir");
  return ejecutarAccion(deps, usuario, opcionesDe(numero, comandoId, motivoFinal, versionVista), async (ctx) => {
    const { exp } = ctx;
    if (exp.estado !== "anulado") throw estadoNoAdmite(exp.estado, "reabrirlo");
    exigirPermiso("reabrir", ctx.permisos, usuario);
    const previo = exp.estadoPrevio ?? "en_tramite";
    const fecha = await fechaDelCambio(ctx, opciones.fechaEfectiva);
    return registrarCambio(ctx, usuario, {
      estadoNuevo: previo,
      motivo: motivoFinal,
      fecha,
      observacion: limpiarMotivo(opciones.observacion),
      datos: {},
      proyeccion: { estadoPrevio: null, ubicacionArchivo: null, ...plazoParaDb(plazoAlEntrar(ctx.pasoActual, ctx.items)) },
    });
  });
}

export interface ResultadoReinicio extends ResultadoEstado {
  /** Para `/expedientes/nuevo?desde=<numero>`: lo mismo que devuelve `precargaAlta`. */
  precarga: PrecargaAlta;
}

/**
 * "Reiniciar con otra plantilla" (2.13(a)): anula el expediente con motivo
 * (la anulación lleva `datos.reinicio`) y devuelve los datos para precargar el
 * alta nueva, que lo referencia con `expedienteAnteriorId`. El alta se hace
 * después, con el formulario (`alta()`), como pide la propuesta: el nuevo
 * arranca en el primer paso de su plantilla.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`
 */
export async function reiniciar(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesEstado = {},
): Promise<ResultadoReinicio> {
  const motivoFinal = exigirMotivo(motivo, "Reiniciar con otra plantilla");
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());
  return ejecutarAccion<ResultadoReinicio>(
    deps,
    usuario,
    {
      ...opcionesDe(numero, comandoId, motivoFinal, versionVista),
      repetido: async (tx, id, mov) => ({ ...(await resultadoDe(tx, id, mov, true, null)), precarga: await armarPrecarga(tx, id, hoy) }),
    },
    async (ctx) => {
      const r = await anularEn(ctx, usuario, motivoFinal, opciones, true);
      return { ...r, precarga: await armarPrecarga(ctx.tx, ctx.exp.id, hoy) };
    },
  );
}

// ---------------------------------------------------------------------------
// Precarga del alta (?desde=<numero>)
// ---------------------------------------------------------------------------

export interface PrecargaAlta {
  desde: {
    id: string;
    numero: string;
    estado: string;
    plantilla: { id: number; codigo: string; nombre: string; version: number };
    tipoTramite: { id: number; codigo: string; nombre: string };
    fechaInicio: FechaISO;
    /** Anulado por "Reiniciar con otra plantilla" y todavía sin siguiente: el alta lo puede continuar. */
    reiniciable: boolean;
  };
  /**
   * Para el formulario de alta: todo menos la plantilla, que se elige. Las
   * personas vigentes van sin id (son personas nuevas del expediente nuevo),
   * con su contacto completo; el formulario quita las de roles que la
   * plantilla elegida no tiene. `expedienteAnteriorId` viene solo si es un
   * reinicio pendiente. La fecha de inicio es hoy (el alta normal admite hasta
   * 30 días atrás); la del anterior está en `desde.fechaInicio`.
   */
  datos: Omit<DatosAlta, "plantillaId"> & { plantillaId: null };
}

async function armarPrecarga(tx: Pick<Transaccion, "expediente" | "expedientePersona" | "movimiento">, id: bigint, hoy: FechaISO): Promise<PrecargaAlta> {
  const e = await tx.expediente.findUniqueOrThrow({
    where: { id },
    include: {
      plantilla: { select: { id: true, codigo: true, nombre: true, version: true } },
      tipoTramite: { select: { id: true, codigo: true, nombre: true } },
      reiniciadoEn: { select: { id: true } },
    },
  });
  const personas = await tx.expedientePersona.findMany({
    where: { expedienteId: id, vigente: true, suprimidaEn: null },
    orderBy: [{ rol: "asc" }, { orden: "asc" }],
  });
  let reiniciable = false;
  if (e.estado === "anulado" && e.reiniciadoEn.length === 0) {
    const anulacion = await tx.movimiento.findFirst({
      where: { expedienteId: id, tipo: "estado", estadoNuevo: "anulado" },
      orderBy: { secuencia: "desc" },
      select: { datos: true },
    });
    reiniciable = (anulacion?.datos as Record<string, unknown> | null)?.reinicio === true;
  }
  return {
    desde: {
      id: e.id.toString(),
      numero: e.numeroInterno,
      estado: e.estado,
      plantilla: e.plantilla,
      tipoTramite: e.tipoTramite,
      fechaInicio: fechaInicioDe(e),
      reiniciable,
    },
    datos: {
      plantillaId: null,
      cementerioId: e.cementerioId,
      tipoMonumento: e.tipoMonumento,
      ubicacion: e.ubicacion as Record<string, string>,
      padron: e.padron,
      numeroMunicipal: e.numeroMunicipal,
      formaPago: e.formaPago === "contado" || e.formaPago === "plan_pagos" ? e.formaPago : null,
      personas: personas.map(
        (p): PersonaEntrada => ({
          rol: p.rol,
          tipo: p.tipoPersona === "juridica" ? "juridica" : "fisica",
          apellido: p.apellido,
          nombres: p.nombres,
          dni: p.dni,
          razonSocial: p.razonSocial,
          cuit: p.cuit,
          fallecido: p.fallecido,
          fechaDefuncion: p.fechaDefuncion ? p.fechaDefuncion.toISOString().slice(0, 10) : null,
          vinculo: p.vinculo,
          telefono: p.telefono,
          telefonoWhatsapp: p.telefonoWhatsapp,
          email: p.email,
          domicilio: p.domicilio,
          esContacto: p.esContacto,
        }),
      ),
      datosExtra: e.datosExtra as Record<string, ValorCampoExtra>,
      documentosRecibidos: [],
      observaciones: e.observaciones,
      fechaInicio: hoy,
      expedienteAnteriorId: reiniciable ? e.id.toString() : null,
    },
  };
}

/**
 * Los datos para precargar `/expedientes/nuevo?desde=<numero>` (2.13(a)):
 * datos, personas vigentes (con contacto), ubicación, padrón y N° municipal.
 * Sirve para el reinicio y para "archivar y abrir vinculado". Es de quien
 * puede reiniciar (Mesa de Entradas, admin) y registra `ver_expediente`
 * (`detalle.para = "precargar_alta"`), porque trae el contacto completo.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`
 */
export async function precargaAlta(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  opciones: OpcionesAcceso = {},
): Promise<PrecargaAlta> {
  exigirPermiso("reiniciar_con_otra_plantilla", null, usuario);
  const numeroInterno = exigirNumero(numero);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());
  return deps.escribir(usuario.id, null, async (tx) => {
    const e = await tx.expediente.findUnique({ where: { numeroInterno }, select: { id: true } });
    if (!e) throw noEncontrado(numeroInterno);
    const precarga = await armarPrecarga(tx, e.id, hoy);
    await registrarAcceso(tx, { usuarioId: usuario.id, accion: "ver_expediente", expedienteId: e.id, detalle: { para: "precargar_alta" }, ip: opciones.ip });
    return precarga;
  });
}

// ---------------------------------------------------------------------------
// Archivar y abrir vinculado (caducidad)
// ---------------------------------------------------------------------------

export interface ResultadoVinculado {
  archivado: ResultadoEstado;
  /** El expediente nuevo, con `expediente_anterior_id` = el archivado. */
  nuevo: ResultadoAlta;
}

/**
 * "Archivar sin concluir con motivo y abrir un expediente vinculado"
 * (docs/fuentes, "Cambios que esto implica", punto 6): cuando el
 * concesionario no paga después de la notificación, el expediente se archiva
 * sin concluir y se abre otro (la caducidad) que lo referencia con
 * `expediente_anterior_id`, SIN anularlo: el anterior fue un trámite real que
 * terminó así. Todo en una transacción: no puede quedar uno sin el otro.
 *
 * El mecanismo es general (cualquier plantilla para el nuevo); la plantilla de
 * caducidad todavía no existe porque la Dirección no pasó el circuito.
 *
 * @param datosAlta el alta del nuevo (`DatosAlta`; `precargaAlta()` la arma).
 *   `expedienteAnteriorId` se completa solo.
 * @param comandoId uno para las dos cosas: un reintento devuelve lo mismo.
 * @throws PermisoDenegado (archivar sin concluir o alta)
 * @throws ErrorDominio los de `archivarSinConcluir` y los de `alta`
 */
export async function archivarYAbrirVinculado(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  entrada: EntradaArchivarSinConcluir,
  datosAlta: unknown,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoVinculado> {
  exigirPermiso("archivar_sin_concluir", null, usuario);
  exigirPermiso("alta", null, usuario);
  const comando = validarComando(comandoId);
  const motivo = exigirMotivo(entrada.motivo, "Archivar sin concluir");
  const nuevoRepetido = async (tx: Transaccion, id: bigint, mov: bigint): Promise<ResultadoVinculado> => {
    const archivado = await resultadoDe(tx, id, mov, true, null);
    const alta = await tx.movimiento.findFirst({
      where: { comandoId: comando, tipo: "alta" },
      select: { expediente: { select: { id: true, numeroInterno: true, anio: true, secuencia: true, version: true } } },
    });
    if (!alta) throw new ErrorDominio("configuracion_incompleta", "Falta el expediente vinculado del comando");
    const n = alta.expediente;
    return {
      archivado,
      nuevo: { id: n.id.toString(), numero: n.numeroInterno, numeroCorto: numeroCorto(n.anio, n.secuencia), version: n.version, repetido: true, avisos: [] },
    };
  };
  return ejecutarAccion<ResultadoVinculado>(
    deps,
    usuario,
    { ...opcionesDe(numero, comando, motivo, versionVista), repetido: nuevoRepetido },
    async (ctx) => {
      const archivado = await archivarSinConcluirEn(ctx, usuario, entrada, { abre_vinculado: true });
      const datos = typeof datosAlta === "object" && datosAlta !== null ? { ...(datosAlta as Record<string, unknown>) } : datosAlta;
      if (typeof datos === "object" && datos !== null && !("expedienteAnteriorId" in datos)) {
        (datos as Record<string, unknown>).expedienteAnteriorId = ctx.exp.id.toString();
      }
      const nuevo = await altaEn(ctx.tx, usuario, datos, ctx.comando, ctx.ahora, {
        anteriorVinculado: { id: ctx.exp.id, numero: ctx.exp.numeroInterno },
      });
      return { archivado, nuevo };
    },
  );
}

