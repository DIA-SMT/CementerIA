import type { Expediente } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { fechaDesdeDb, hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { armarBusqueda } from "../busqueda";
import type { ExpedientePermisos, UsuarioPermisos } from "../permisos";
import type { DefinicionPlantilla, PasoPlantilla } from "../plantillas/esquema";
import { exigirNumero, permisosDelExpediente } from "./acceso";
import { extrasBuscables, validarComando } from "./alta";
import { leerDefinicion } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, MENSAJE_CONFLICTO_VERSION, noEncontrado } from "./errores";
import type { FechaEfectiva, PrecisionFecha } from "./flujo";
import { leerItems, type ItemsExpediente } from "./items";
import { areasDelPaso, type AreasDelPaso, type EntornoAreas } from "./proyeccion";

/**
 * El esqueleto común de las acciones del flujo de la semana 3 (recepción,
 * subtareas, documentos, adjuntos, pase y devolución), según 3.3:
 *
 * 1. **Idempotencia primero.** Si el `comando_id` ya hizo esta acción en el
 *    expediente, se devuelve ese resultado sin validar nada más (un doble clic
 *    o un reintento no muestra un error falso).
 * 2. `SELECT … FOR UPDATE` sobre el expediente, y la idempotencia de nuevo con
 *    el lock tomado: dos reintentos simultáneos del mismo comando no hacen la
 *    acción dos veces (el segundo espera el lock y ve el movimiento del primero).
 * 3. La versión que vio el usuario (bloqueo optimista). Va ANTES que el estado
 *    y el permiso: si otro usuario dio el pase en el medio, el expediente ya es
 *    de otra área, y lo que corresponde decir es "Otro usuario modificó el
 *    expediente; recargá", no "no sos el responsable".
 * 4. La acción, con el contexto ya cargado.
 *
 * Todo dentro de `deps.escribir()` (conActor) con el usuario como actor.
 */

/** Los tipos de movimiento que cambian la ubicación del papel (decisión 6). */
const TIPOS_UBICACION = ["alta", "recepcion", "pase", "devolucion", "estado"] as const;

export interface ContextoAccion {
  tx: Transaccion;
  /** La fila del expediente, leída con el lock tomado. */
  exp: Expediente;
  def: DefinicionPlantilla;
  items: ItemsExpediente;
  pasoActual: PasoPlantilla;
  permisos: ExpedientePermisos;
  /** El área externa del cementerio del expediente (`$CEMENTERIO`). */
  areaCementerioId: number;
  comando: string;
  ahora: Date;
  hoy: FechaISO;
}

export interface OpcionesEjecucion<R> {
  numero: string;
  comandoId: string;
  /** El tipo del movimiento principal de la acción: con él se busca el comando repetido. */
  tipo: "recepcion" | "subtarea" | "documento" | "adjunto" | "pase" | "devolucion";
  /** Motivo de la transacción (`app.motivo`). */
  motivo: string | null;
  /** La `version` que vio el usuario; `null` = la acción no la controla. */
  versionVista: number | null;
  /** El resultado de la primera vez, si el comando ya se había usado. */
  repetido: (tx: Transaccion, expedienteId: bigint, movimientoId: bigint) => Promise<R>;
}

export async function ejecutarAccion<R>(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  opciones: OpcionesEjecucion<R>,
  accion: (ctx: ContextoAccion) => Promise<R>,
): Promise<R> {
  const comando = validarComando(opciones.comandoId);
  const numeroInterno = exigirNumero(opciones.numero);
  const ahora = deps.ahora?.() ?? new Date();

  return deps.escribir(usuario.id, opciones.motivo, async (tx) => {
    const fila = await tx.expediente.findUnique({ where: { numeroInterno }, select: { id: true } });
    if (!fila) throw noEncontrado(numeroInterno);
    const repetidoAntes = await movimientoDelComando(tx, fila.id, comando, opciones.tipo);
    if (repetidoAntes !== null) return opciones.repetido(tx, fila.id, repetidoAntes);

    await tx.$queryRaw`SELECT id FROM public.expedientes WHERE id = ${fila.id} FOR UPDATE`;
    const repetido = await movimientoDelComando(tx, fila.id, comando, opciones.tipo);
    if (repetido !== null) return opciones.repetido(tx, fila.id, repetido);

    const exp = await tx.expediente.findUniqueOrThrow({ where: { id: fila.id } });
    if (opciones.versionVista !== null && exp.version !== opciones.versionVista) {
      throw new ErrorDominio("conflicto_version", MENSAJE_CONFLICTO_VERSION);
    }
    const plantilla = await tx.plantilla.findUniqueOrThrow({
      where: { id: exp.plantillaId },
      select: { codigo: true, version: true, definicion: true },
    });
    const def = leerDefinicion(plantilla.definicion, plantilla.codigo, plantilla.version);
    const pasoActual = def.pasos[exp.pasoOrden - 1];
    if (!pasoActual || pasoActual.clave !== exp.pasoClave) {
      throw new ErrorDominio("configuracion_incompleta", `El paso ${exp.pasoClave} no está en la plantilla ${plantilla.codigo} v${plantilla.version}`);
    }
    const cementerio = await tx.cementerio.findUniqueOrThrow({ where: { id: exp.cementerioId }, select: { areaId: true } });
    const permisos = await permisosDelExpediente(tx, exp, def.pasos.length);
    return accion({
      tx,
      exp,
      def,
      items: leerItems(exp.items),
      pasoActual,
      permisos,
      areaCementerioId: cementerio.areaId,
      comando,
      ahora,
      hoy: hoyEnTucuman(ahora),
    });
  });
}

async function movimientoDelComando(tx: Transaccion, expedienteId: bigint, comandoId: string, tipo: string): Promise<bigint | null> {
  const m = await tx.movimiento.findUnique({
    where: { expedienteId_comandoId_tipo: { expedienteId, comandoId, tipo } },
    select: { id: true },
  });
  return m?.id ?? null;
}

function comoPrecision(valor: string): PrecisionFecha {
  return valor === "dia" ? "dia" : "minuto";
}

/** Las áreas y cementerios para resolver el área de un paso (`$CEMENTERIO`, `$CAMPO:x`). */
export async function entornoAreas(ctx: Pick<ContextoAccion, "tx" | "exp" | "areaCementerioId">): Promise<EntornoAreas> {
  const areas = await ctx.tx.area.findMany({ select: { id: true, codigo: true, tipo: true } });
  const cementerios = await ctx.tx.cementerio.findMany({ select: { codigo: true, areaId: true } });
  return {
    areas: new Map(areas.map((a) => [a.codigo, a])),
    areaCementerioId: ctx.areaCementerioId,
    areaDeCementerio: new Map(cementerios.map((c) => [c.codigo, c.areaId])),
    datosExtra: ctx.exp.datosExtra as Record<string, unknown>,
  };
}

export async function areasDePaso(ctx: ContextoAccion, paso: PasoPlantilla): Promise<AreasDelPaso> {
  return areasDelPaso(paso, await entornoAreas(ctx));
}

/**
 * El último movimiento que cambió la ubicación del papel: alta, recepción
 * EXPLÍCITA, pase, devolución o estado (3.3, punto 7). La recepción implícita
 * no cuenta: su fecha es la de llegada, no un acto del área.
 */
export async function ultimoMovimientoDeUbicacion(tx: Transaccion, expedienteId: bigint): Promise<FechaEfectiva | null> {
  const movimientos = await tx.movimiento.findMany({
    where: { expedienteId, tipo: { in: [...TIPOS_UBICACION] } },
    select: { tipo: true, fechaEfectiva: true, precisionFecha: true, datos: true },
    orderBy: [{ fechaEfectiva: "desc" }, { secuencia: "desc" }],
  });
  const ultimo = movimientos.find((m) => !(m.tipo === "recepcion" && esImplicita(m.datos)));
  return ultimo ? { instante: ultimo.fechaEfectiva, precision: comoPrecision(ultimo.precisionFecha) } : null;
}

function esImplicita(datos: unknown): boolean {
  return typeof datos === "object" && datos !== null && !Array.isArray(datos) && (datos as Record<string, unknown>).implicita === true;
}

/**
 * La precisión con que se registró un instante de la proyección
 * (`en_area_desde`, `recibido_en`): la del último movimiento de ubicación con
 * esa misma fecha efectiva. Un alta con fecha de inicio pasada, o un pase
 * cargado "el 15", tienen precisión de día y se muestran sin hora.
 */
export async function precisionDe(lector: Pick<Transaccion, "movimiento">, expedienteId: bigint, instante: Date | null): Promise<PrecisionFecha> {
  if (instante === null) return "minuto";
  const m = await lector.movimiento.findFirst({
    where: { expedienteId, fechaEfectiva: instante, tipo: { in: [...TIPOS_UBICACION] } },
    select: { precisionFecha: true },
    orderBy: { secuencia: "desc" },
  });
  return m ? comoPrecision(m.precisionFecha) : "minuto";
}

/**
 * Recepción implícita (decisión 8 y 3.3, "Efectos del pase"): si el área donde
 * está el papel actúa sin haber confirmado la recepción, primero se inserta
 * una `recepcion` con `implicita: true` y `fecha_efectiva = en_area_desde`.
 *
 * Solo la dispara el área donde está el papel (que es la que confirma): que
 * Mesa de Entradas marque un documento de un expediente que está en Legal no
 * es una recepción de Legal.
 *
 * @returns la fecha de recepción para `recibido_en` y el id del movimiento, o
 *   null si no correspondía.
 */
export async function recepcionImplicita(
  ctx: ContextoAccion,
  usuario: UsuarioPermisos,
): Promise<{ movimientoId: bigint; recibidoEn: Date } | null> {
  const { exp } = ctx;
  if (exp.recibidoEn !== null || usuario.area?.id !== exp.areaActualId) return null;
  const precision = await precisionDe(ctx.tx, exp.id, exp.enAreaDesde);
  const m = await ctx.tx.movimiento.create({
    data: {
      expedienteId: exp.id,
      tipo: "recepcion",
      fechaEfectiva: exp.enAreaDesde,
      precisionFecha: precision,
      usuarioId: usuario.id,
      pasoDestino: exp.pasoClave,
      areaDestinoId: exp.areaActualId,
      datos: { implicita: true },
      comandoId: ctx.comando,
    },
    select: { id: true },
  });
  return { movimientoId: m.id, recibidoEn: exp.enAreaDesde };
}

/**
 * `busqueda` rearmada con los datos actuales (2.13(g)). Las acciones que
 * tocan `items` la rearman en la misma transacción aunque hoy no incluya datos
 * de subtareas (la búsqueda por N° de dictamen o de resolución es de la fase
 * 2): así, cuando se sumen, no queda ningún camino que la deje vieja.
 */
export async function busquedaActual(ctx: Pick<ContextoAccion, "tx" | "exp" | "def">): Promise<string> {
  const { tx, exp, def } = ctx;
  const personas = await tx.expedientePersona.findMany({
    where: { expedienteId: exp.id, vigente: true, suprimidaEn: null },
    select: { apellido: true, nombres: true, dni: true },
    orderBy: [{ rol: "asc" }, { orden: "asc" }],
  });
  const cementerios = await tx.cementerio.findMany({ select: { id: true, codigo: true, nombre: true } });
  const cementerio = cementerios.find((c) => c.id === exp.cementerioId);
  return armarBusqueda({
    anio: exp.anio,
    secuencia: exp.secuencia,
    numeroMunicipal: exp.numeroMunicipal,
    padron: exp.padron,
    cementerio: cementerio?.nombre ?? "",
    ubicacionTexto: exp.ubicacionTexto,
    personas,
    extrasBuscables: extrasBuscables(def, exp.datosExtra as Record<string, unknown>, new Map(cementerios.map((c) => [c.codigo, c.nombre]))),
  });
}

/** `fecha_inicio` del expediente como fecha del dominio. */
export function fechaInicioDe(exp: Pick<Expediente, "fechaInicio">): FechaISO {
  return fechaDesdeDb(exp.fechaInicio);
}

/** Un id de movimiento para `items` (número, como lo guarda el alta). */
export function idItem(id: bigint): number {
  return Number(id);
}
