import { diaEnTucuman, type FechaISO } from "@/lib/fechas";
import type { CodigoNombre } from "./contexto";
import type { Lector } from "./dependencias";
import type { PrecisionFecha } from "./flujo";

/**
 * El historial agrupado por paso del circuito (26/10/2026): cada "tramo" es lo
 * que pasó mientras el papel estuvo en un paso y un área, desde el movimiento
 * que lo llevó ahí (alta, pase, devolución, o un cambio de estado que lo movió:
 * el regreso del papel, desarchivar) hasta el siguiente. Lo usan la línea de
 * tiempo de la ficha (agrupada y con filtros) y la hoja impresa.
 *
 * Lo revertido no abre tramo (el papel no se movió): queda dentro del tramo en
 * que se registró, tachado. Una fecha corregida vale la corregida. El último
 * tramo de un expediente activo sigue abierto (hasta hoy); el de uno
 * concluido, archivado o anulado termina con ese cambio de estado.
 *
 * `agruparEnTramos()` es pura; `contarDiasHabiles()` completa los días
 * hábiles con `f_dias_habiles_entre` (feriados de la base), en una consulta.
 */

export interface TramoHistorial {
  /** 1, 2, 3… en el orden de la línea de tiempo. */
  orden: number;
  paso: { clave: string; nombre: string } | null;
  area: CodigoNombre | null;
  desde: Date;
  desdePrecision: PrecisionFecha;
  /** Hasta cuándo estuvo; null si sigue ahí (último tramo de un expediente activo). */
  hasta: Date | null;
  hastaPrecision: PrecisionFecha;
  /** Es el tramo en curso: el último, con el expediente activo. */
  actual: boolean;
  /** Días hábiles en el área (`f_dias_habiles_entre`, de `desde` a `hasta` o a hoy); null hasta contarlos. */
  diasHabiles: number | null;
  /** Ids de los movimientos del tramo, en el orden del historial. */
  movimientos: string[];
}

/** Lo que el agrupamiento lee de cada movimiento (`MovimientoFicha` lo cumple). */
export interface MovimientoAgrupable {
  id: string;
  tipo: string;
  fechaEfectiva: Date;
  precisionFecha: PrecisionFecha;
  pasoDestino: { clave: string; nombre: string } | null;
  areaDestino: CodigoNombre | null;
  estadoNuevo: string | null;
  revertido: boolean;
  fechaCorregida: { fechaEfectiva: Date; precisionFecha: PrecisionFecha } | null;
}

/** Los movimientos que mueven el papel de paso o de área. */
const TIPOS_QUE_MUEVEN: ReadonlySet<string> = new Set(["alta", "pase", "devolucion"]);
/** Los estados en que el expediente deja de moverse: ahí termina el último tramo. */
const ESTADOS_DE_CIERRE: ReadonlySet<string> = new Set(["concluido", "archivado", "anulado"]);

function fechaDe(m: MovimientoAgrupable): { fecha: Date; precision: PrecisionFecha } {
  return m.fechaCorregida ? { fecha: m.fechaCorregida.fechaEfectiva, precision: m.fechaCorregida.precisionFecha } : { fecha: m.fechaEfectiva, precision: m.precisionFecha };
}

function abreTramo(m: MovimientoAgrupable, actual: TramoHistorial | undefined): boolean {
  if (m.revertido) return false;
  if (TIPOS_QUE_MUEVEN.has(m.tipo)) return true;
  if (m.tipo !== "estado" || !actual) return false;
  // Un cambio de estado mueve el papel si lo lleva a otra área o a otro paso
  // (el regreso del papel al archivar sin concluir, desarchivar, reabrir).
  const otraArea = m.areaDestino !== null && m.areaDestino.codigo !== actual.area?.codigo;
  const otroPaso = m.pasoDestino !== null && m.pasoDestino.clave !== actual.paso?.clave;
  return otraArea || otroPaso;
}

/**
 * Agrupa el historial (en el orden en que se muestra) en tramos.
 *
 * @param activo el expediente está en trámite o en espera de pago: su último
 *   tramo sigue abierto.
 */
export function agruparEnTramos(historial: readonly MovimientoAgrupable[], activo: boolean): TramoHistorial[] {
  const tramos: TramoHistorial[] = [];
  // Cuándo se cerró el expediente dentro de cada tramo (el último cambio de estado a concluido, archivado o anulado).
  const cierres = new Map<number, { fecha: Date; precision: PrecisionFecha }>();
  const ultimos = new Map<number, { fecha: Date; precision: PrecisionFecha }>();
  for (const m of historial) {
    const actual = tramos.at(-1);
    const { fecha, precision } = fechaDe(m);
    if (actual === undefined || abreTramo(m, actual)) {
      if (actual) {
        actual.hasta = fecha;
        actual.hastaPrecision = precision;
      }
      tramos.push({
        orden: tramos.length + 1,
        paso: m.pasoDestino ?? actual?.paso ?? null,
        area: m.areaDestino ?? actual?.area ?? null,
        desde: fecha,
        desdePrecision: precision,
        hasta: null,
        hastaPrecision: "minuto",
        actual: false,
        diasHabiles: null,
        movimientos: [m.id],
      });
    } else {
      actual.movimientos.push(m.id);
    }
    const indice = tramos.length - 1;
    ultimos.set(indice, { fecha, precision });
    if (!m.revertido && m.tipo === "estado") {
      if (m.estadoNuevo !== null && ESTADOS_DE_CIERRE.has(m.estadoNuevo)) cierres.set(indice, { fecha, precision });
      else cierres.delete(indice);
    }
  }
  const ultimo = tramos.at(-1);
  if (ultimo) {
    if (activo) {
      ultimo.actual = true;
    } else {
      const fin = cierres.get(tramos.length - 1) ?? ultimos.get(tramos.length - 1);
      if (fin) {
        ultimo.hasta = fin.fecha;
        ultimo.hastaPrecision = fin.precision;
      }
    }
  }
  return tramos;
}

/**
 * Completa `diasHabiles` de cada tramo: días hábiles de Tucumán entre el día
 * en que llegó y el día en que salió (o `hoy`, si sigue ahí), como "días en el
 * área" de la bandeja. Una sola consulta.
 */
export async function contarDiasHabiles(lector: Pick<Lector, "$queryRaw">, tramos: TramoHistorial[], hoy: FechaISO): Promise<TramoHistorial[]> {
  if (tramos.length === 0) return tramos;
  const desdes = tramos.map((t) => diaEnTucuman(t.desde));
  const hastas = tramos.map((t) => (t.hasta ? diaEnTucuman(t.hasta) : hoy));
  const filas = await lector.$queryRaw<Array<{ i: number; dias: number | null }>>`
    SELECT t.i::integer AS i, public.f_dias_habiles_entre(t.desde, t.hasta) AS dias
      FROM unnest(${desdes}::date[], ${hastas}::date[]) WITH ORDINALITY AS t(desde, hasta, i)`;
  for (const f of filas) {
    const tramo = tramos[Number(f.i) - 1];
    // Una fecha corregida puede quedar antes de la anterior: no hay días negativos en un área.
    if (tramo) tramo.diasHabiles = f.dias === null ? null : Math.max(0, Number(f.dias));
  }
  return tramos;
}
