import { Prisma } from "@/generated/prisma/client";
import { fechaDesdeDb, type FechaISO } from "@/lib/fechas";
import type { Lector } from "./dependencias";
import { semaforoPlazo, textoPlazo, type SemaforoPlazo } from "./flujo";
import { SQL_PLAZO_DESDE } from "./reloj";

/**
 * El plazo de 30 días hábiles de la DIM (docs/propuesta-mvp.md, 3.6), al leer.
 *
 * El vencimiento no se guarda: se calcula cada vez con
 * `f_sumar_dias_habiles(plazo_desde, plazo_dias_habiles)`, así un asueto
 * cargado después lo corrige solo. "Faltan N" es `f_dias_habiles_entre(hoy,
 * vence)`. Si alguno de los años que abarca el plazo no está cerrado en
 * `feriados_anios`, el vencimiento es provisorio: puede faltar cargar un
 * feriado.
 *
 * El plazo corre desde `plazo_desde` o, si es posterior, desde el día en que
 * terminó la carga histórica (reloj.ts): un plazo transcripto de la ficha de
 * papel no llega al sistema vencido hace años. `desde` sigue siendo el del
 * papel.
 */

export interface PlazoCalculado {
  desde: FechaISO | null;
  diasHabiles: number;
  cumplidoEn: FechaISO | null;
  /** Vencimiento, si el plazo ya empezó. */
  vence: FechaISO | null;
  /** Días hábiles que faltan (negativo: vencido hace N), si empezó. */
  faltan: number | null;
  /** Algún año entre el inicio y el vencimiento no está cerrado en `feriados_anios`. */
  provisorio: boolean;
  /** Los años sin cerrar que lo hacen provisorio. */
  aniosSinCerrar: number[];
  semaforo: SemaforoPlazo;
  /** "vence 30/11 · faltan 3 días hábiles (provisorio)". */
  texto: string;
}

/** Las columnas `plazo_*` de un expediente, y su id: el vencimiento se calcula en la base, con el mismo SQL que la bandeja. */
export interface ColumnasPlazo {
  id: bigint;
  plazoDesde: Date | null;
  plazoDiasHabiles: number | null;
  plazoCumplidoEn: Date | null;
}

/** El plazo de un expediente (la ficha), o null si su paso no tiene plazo. */
export async function calcularPlazo(lector: Pick<Lector, "$queryRaw">, e: ColumnasPlazo, hoy: FechaISO): Promise<PlazoCalculado | null> {
  if (e.plazoDiasHabiles === null) return null;
  const desde = fechaDesdeDb(e.plazoDesde);
  const cumplidoEn = fechaDesdeDb(e.plazoCumplidoEn);
  let vence: FechaISO | null = null;
  let faltan: number | null = null;
  let aniosSinCerrar: number[] = [];
  if (desde !== null) {
    // `sqlPlazo`, como la bandeja, el panel y los avisos: una sola regla para desde cuándo corre (reloj.ts).
    const [r] = await lector.$queryRaw<Array<{ vence: string | null; faltan: number | null; anios_sin_cerrar: number[] | null }>>`
      SELECT pz.vence, pz.faltan, pz.anios_sin_cerrar
        FROM public.expedientes e
        ${sqlPlazo(hoy)}
       WHERE e.id = ${e.id}`;
    vence = r?.vence ?? null;
    faltan = r?.faltan ?? null;
    aniosSinCerrar = r?.anios_sin_cerrar ?? [];
  }
  return completarPlazo({ desde, diasHabiles: e.plazoDiasHabiles, cumplidoEn, vence, faltan, aniosSinCerrar });
}

/** De esos años, los que no están cerrados (un año sin fila en `feriados_anios` tampoco lo está). */
export async function aniosSinCerrarDe(lector: Pick<Lector, "feriadoAnio">, anios: readonly number[]): Promise<number[]> {
  if (anios.length === 0) return [];
  const cerrados = await lector.feriadoAnio.findMany({ where: { anio: { in: [...anios] }, cerrado: true }, select: { anio: true } });
  const set = new Set(cerrados.map((c) => c.anio));
  return anios.filter((a) => !set.has(a));
}

/** Arma el plazo con el semáforo y el texto a partir de lo calculado en la base. */
export function completarPlazo(p: {
  desde: FechaISO | null;
  diasHabiles: number;
  cumplidoEn: FechaISO | null;
  vence: FechaISO | null;
  faltan: number | null;
  aniosSinCerrar: number[];
}): PlazoCalculado {
  const provisorio = p.aniosSinCerrar.length > 0;
  return {
    ...p,
    provisorio,
    semaforo: semaforoPlazo(p),
    texto: textoPlazo({ ...p, provisorio }),
  };
}

/**
 * Las columnas SQL del plazo para un expediente `e` (bandeja, panel, avisos y
 * ficha): `vence` (text), `faltan` (int) y `anios_sin_cerrar` (int[]: los
 * años del tramo que se cuenta). Van en un LATERAL. El plazo corre desde
 * `SQL_PLAZO_DESDE` (reloj.ts), no desde `plazo_desde` a secas.
 */
export function sqlPlazo(hoy: FechaISO): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT v.vence::text AS vence,
             public.f_dias_habiles_entre(${hoy}::date, v.vence) AS faltan,
             (SELECT array_agg(y.anio ORDER BY y.anio)
                FROM generate_series(extract(year FROM v.desde)::int, extract(year FROM v.vence)::int) AS y(anio)
               WHERE NOT EXISTS (SELECT 1 FROM public.feriados_anios fa WHERE fa.anio = y.anio AND fa.cerrado)) AS anios_sin_cerrar
        FROM (SELECT d.desde, public.f_sumar_dias_habiles(d.desde, e.plazo_dias_habiles) AS vence
                FROM (SELECT ${SQL_PLAZO_DESDE} AS desde) d) v
       WHERE e.plazo_desde IS NOT NULL AND e.plazo_dias_habiles IS NOT NULL
    ) pz ON true`;
}
