import { Prisma } from "@/generated/prisma/client";
import { inicioDelDiaEnTucuman, type FechaISO } from "@/lib/fechas";
import type { Lector } from "../expedientes/dependencias";
import type { AreaMetricas, ExpedienteMetricas } from "./calculo";
import type { FiltrosMetricas } from "./periodos";
import type { MovimientoMetricas, PasoMetricas } from "./recorrido";

/**
 * Las lecturas de las métricas. Solo SELECT, en serie (el lector puede ser el
 * `tx` de una transacción, que tiene una sola conexión).
 */

/** Los tipos que el recorrido necesita: ubicación, subtareas (el plazo DIM) y correcciones. */
const TIPOS_MOVIMIENTO = ["alta", "recepcion", "pase", "devolucion", "estado", "subtarea", "correccion"];
/** Ids por consulta: lejos del límite de parámetros de PostgreSQL. */
const LOTE_IDS = 2000;
/** Pares por consulta de días hábiles. */
const LOTE_PARES = 5000;

function condicionesFiltros(f: FiltrosMetricas): Prisma.Sql {
  const c: Prisma.Sql[] = [];
  if (f.tipoTramiteId !== undefined) c.push(Prisma.sql`e.tipo_tramite_id = ${f.tipoTramiteId}`);
  if (f.plantillaCodigo !== undefined) c.push(Prisma.sql`pl.codigo = ${f.plantillaCodigo}`);
  if (f.cementerioId !== undefined) c.push(Prisma.sql`e.cementerio_id = ${f.cementerioId}`);
  return c.length > 0 ? Prisma.sql`AND ${Prisma.join(c, " AND ")}` : Prisma.empty;
}

export async function leerAreas(lector: Lector): Promise<Map<number, AreaMetricas>> {
  const areas = await lector.area.findMany({ select: { id: true, codigo: true, nombre: true, tipo: true, orden: true } });
  return new Map(areas.map((a) => [a.id, a]));
}

/**
 * Los expedientes que pueden aportar algo: los que vivieron en el período
 * (empezaron antes de que termine y siguen en trámite o tuvieron movimientos
 * desde que empezó) y todos los de carga histórica (la línea de base no se
 * filtra por período). Con los filtros de trámite, plantilla y cementerio.
 */
export async function leerExpedientes(lector: Lector, f: FiltrosMetricas): Promise<ExpedienteMetricas[]> {
  const desde = inicioDelDiaEnTucuman(f.desde);
  const filas = await lector.$queryRaw<
    Array<{
      id: string;
      numero_interno: string;
      fecha_inicio: string;
      estado: string;
      plantilla_id: number;
      plantilla_codigo: string;
      plantilla_nombre: string;
      tipo_tramite_id: number;
      tramite: string;
      cementerio_id: number;
      carga_historica: boolean;
      alta_historica: boolean;
      area_actual_id: number;
      paso_clave: string;
      en_area_desde: Date;
    }>
  >`
    SELECT e.id::text AS id, e.numero_interno, e.fecha_inicio::text AS fecha_inicio, e.estado, e.plantilla_id::int AS plantilla_id,
           pl.codigo AS plantilla_codigo, pl.nombre AS plantilla_nombre, e.tipo_tramite_id::int AS tipo_tramite_id,
           tt.nombre AS tramite, e.cementerio_id::int AS cementerio_id, e.carga_historica,
           coalesce((SELECT m.carga_historica FROM public.movimientos m
                      WHERE m.expediente_id = e.id AND m.tipo = 'alta' ORDER BY m.secuencia LIMIT 1), false) AS alta_historica,
           e.area_actual_id::int AS area_actual_id, e.paso_clave, e.en_area_desde
      FROM public.expedientes e
      JOIN public.plantillas pl ON pl.id = e.plantilla_id
      JOIN public.tipos_tramite tt ON tt.id = e.tipo_tramite_id
     WHERE TRUE ${condicionesFiltros(f)}
       AND (
             (e.fecha_inicio <= ${f.hasta}::date
              AND (e.estado IN ('en_tramite', 'espera_pago_dim')
                   OR EXISTS (SELECT 1 FROM public.movimientos m WHERE m.expediente_id = e.id AND m.fecha_efectiva >= ${desde})))
             OR EXISTS (SELECT 1 FROM public.movimientos m WHERE m.expediente_id = e.id AND m.tipo = 'alta' AND m.carga_historica)
           )
     ORDER BY e.id`;
  return filas.map((x) => ({
    id: x.id,
    numero: x.numero_interno,
    fechaInicio: x.fecha_inicio,
    estado: x.estado,
    plantillaId: x.plantilla_id,
    plantillaCodigo: x.plantilla_codigo,
    plantillaNombre: x.plantilla_nombre,
    tipoTramiteId: x.tipo_tramite_id,
    tipoTramiteNombre: x.tramite,
    cementerioId: x.cementerio_id,
    cargaHistoricaAbierta: x.carga_historica,
    origen: x.alta_historica ? "historico" : "sistema",
    areaActualId: x.area_actual_id,
    pasoClave: x.paso_clave,
    enAreaDesde: x.en_area_desde,
  }));
}

/** Los pasos de cada plantilla, por clave (de la definición congelada de cada versión). */
export async function leerPasos(lector: Lector, plantillaIds: readonly number[]): Promise<Map<number, Map<string, PasoMetricas>>> {
  const r = new Map<number, Map<string, PasoMetricas>>();
  if (plantillaIds.length === 0) return r;
  const plantillas = await lector.plantilla.findMany({ where: { id: { in: [...plantillaIds] } }, select: { id: true, definicion: true } });
  for (const p of plantillas) r.set(p.id, pasosDeDefinicion(p.definicion));
  return r;
}

/**
 * Los pasos de una definición, leídos sin exigir el esquema entero (una
 * versión vieja con otra forma no rompe las métricas).
 */
export function pasosDeDefinicion(definicion: unknown): Map<string, PasoMetricas> {
  const r = new Map<string, PasoMetricas>();
  const pasos = (definicion as { pasos?: unknown } | null)?.pasos;
  if (!Array.isArray(pasos)) return r;
  pasos.forEach((p: unknown, i) => {
    const x = (p ?? {}) as Record<string, unknown>;
    if (typeof x.clave !== "string") return;
    const plazo = (x.plazo ?? null) as Record<string, unknown> | null;
    r.set(x.clave, {
      clave: x.clave,
      nombre: typeof x.nombre === "string" ? x.nombre : x.clave,
      orden: i + 1,
      diasAlerta: typeof x.dias_alerta === "number" ? x.dias_alerta : null,
      plazo:
        plazo && typeof plazo.dias_habiles === "number" && typeof plazo.desde_subtarea === "string" && typeof plazo.hasta_subtarea === "string"
          ? { diasHabiles: plazo.dias_habiles, desdeSubtarea: plazo.desde_subtarea, hastaSubtarea: plazo.hasta_subtarea }
          : null,
    });
  });
  return r;
}

/** Los movimientos que el recorrido necesita, de esos expedientes. */
export async function leerMovimientos(lector: Lector, expedienteIds: readonly string[]): Promise<MovimientoMetricas[]> {
  const r: MovimientoMetricas[] = [];
  for (let i = 0; i < expedienteIds.length; i += LOTE_IDS) {
    const lote = expedienteIds.slice(i, i + LOTE_IDS).map((id) => BigInt(id));
    const filas = await lector.movimiento.findMany({
      where: { expedienteId: { in: lote }, tipo: { in: TIPOS_MOVIMIENTO } },
      select: {
        id: true,
        expedienteId: true,
        secuencia: true,
        tipo: true,
        fechaEfectiva: true,
        precisionFecha: true,
        usuarioId: true,
        areaUsuarioId: true,
        pasoOrigen: true,
        pasoDestino: true,
        areaOrigenId: true,
        areaDestinoId: true,
        estadoAnterior: true,
        estadoNuevo: true,
        observacion: true,
        motivo: true,
        datos: true,
        corrigeMovimientoId: true,
        cargaHistorica: true,
        comandoId: true,
        registradoEn: true,
      },
      orderBy: [{ expedienteId: "asc" }, { secuencia: "asc" }],
    });
    for (const m of filas) r.push({ ...m, expedienteId: m.expedienteId.toString() });
  }
  return r;
}

/** Conteos de toda la historia: altas en el sistema y cargas históricas (con los filtros). */
export async function leerAcumulados(lector: Lector, f: FiltrosMetricas): Promise<{ altasSistema: number; cargasHistoricas: number }> {
  const [fila] = await lector.$queryRaw<Array<{ sistema: number; historicas: number }>>`
    SELECT count(*) FILTER (WHERE NOT a.carga_historica)::int AS sistema,
           count(*) FILTER (WHERE a.carga_historica)::int AS historicas
      FROM public.expedientes e
      JOIN public.plantillas pl ON pl.id = e.plantilla_id
      JOIN public.movimientos a ON a.expediente_id = e.id AND a.tipo = 'alta'
     WHERE TRUE ${condicionesFiltros(f)}`;
  return { altasSistema: fila?.sistema ?? 0, cargasHistoricas: fila?.historicas ?? 0 };
}

/**
 * `f_dias_habiles_entre` y `f_sumar_dias_habiles` de muchos pares a la vez:
 * los mismos feriados que el plazo DIM, la bandeja y el panel.
 */
export async function calcularDiasHabiles(
  lector: Lector,
  pares: ReadonlyArray<readonly [FechaISO, FechaISO]>,
  sumas: ReadonlyArray<readonly [FechaISO, number]>,
): Promise<{ dias: Map<string, number>; vencimientos: Map<string, FechaISO> }> {
  const dias = new Map<string, number>();
  for (let i = 0; i < pares.length; i += LOTE_PARES) {
    const lote = pares.slice(i, i + LOTE_PARES);
    const filas = await lector.$queryRaw<Array<{ d: string; h: string; dias: number }>>`
      SELECT t.d::text AS d, t.h::text AS h, public.f_dias_habiles_entre(t.d, t.h) AS dias
        FROM unnest(${lote.map((p) => p[0])}::date[], ${lote.map((p) => p[1])}::date[]) AS t(d, h)`;
    for (const f of filas) dias.set(`${f.d}|${f.h}`, f.dias);
  }
  const vencimientos = new Map<string, FechaISO>();
  for (let i = 0; i < sumas.length; i += LOTE_PARES) {
    const lote = sumas.slice(i, i + LOTE_PARES);
    const filas = await lector.$queryRaw<Array<{ d: string; n: number; vence: string }>>`
      SELECT t.d::text AS d, t.n AS n, public.f_sumar_dias_habiles(t.d, t.n)::text AS vence
        FROM unnest(${lote.map((p) => p[0])}::date[], ${lote.map((p) => p[1])}::int[]) AS t(d, n)`;
    for (const f of filas) vencimientos.set(`${f.d}|${f.n}`, f.vence);
  }
  return { dias, vencimientos };
}
