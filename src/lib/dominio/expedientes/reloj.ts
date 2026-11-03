import { Prisma } from "@/generated/prisma/client";
import type { FechaISO } from "@/lib/fechas";

/**
 * Desde cuándo corre el reloj de un expediente: los días hábiles en el área
 * que lo hacen "demorado" (contra `dias_alerta` del paso), el vencimiento del
 * plazo (la DIM, 3.6) y los avisos por tiempo. Es una sola regla, en SQL, y la
 * usan todos los que cuentan: la bandeja, el panel, los avisos por tiempo, las
 * métricas (demorados hoy) y la ficha (el plazo y lo que dice Migue).
 *
 * Normalmente el reloj arranca cuando el papel llegó al área
 * (`en_area_desde`) y cuando empezó el plazo (`plazo_desde`). La excepción es
 * el expediente iniciado antes del sistema: al "Terminar carga histórica"
 * (2.13(c)) queda en el paso donde lo dejó la ficha, con las fechas del papel.
 * Contar desde ahí lo daría demorado al instante (una ficha que quedó en Legal
 * en 1998 tendría miles de días hábiles), con el plazo vencido hace años, y
 * los avisos por tiempo le escribirían a toda el área. El trabajo con el
 * sistema empieza al terminar la carga: el reloj arranca, como muy temprano,
 * en ese momento.
 *
 * - Días en el área: desde `GREATEST(en_area_desde, fin de la carga)`.
 * - Plazo: desde `GREATEST(plazo_desde, día del fin de la carga)`, si empezó.
 *
 * La historia no se toca: `en_area_desde`, `plazo_desde` y los movimientos
 * conservan las fechas de la ficha, y así los muestran la ficha, la línea de
 * tiempo y los tramos. Después del primer pase con el sistema,
 * `en_area_desde` ya es posterior al fin de la carga y la regla no cambia
 * nada; en un expediente que nunca tuvo carga histórica, tampoco.
 *
 * El fin de la carga no se guarda en otra columna: ya está en el historial,
 * es la fecha efectiva del `edicion` de "Terminar carga histórica"
 * (`cambios.carga_historica`), que no se revierte ni se corrige
 * (correcciones.ts). Así no hay una proyección más que mantener ni que
 * reconstruir. Con la carga abierta todavía no hay fin (NULL, y GREATEST
 * ignora los NULL), pero esos expedientes no están en trabajo: las consultas
 * los dejan afuera aparte (`NOT e.carga_historica`).
 *
 * Los fragmentos suponen que el expediente es `e` en la consulta (con `id`,
 * `en_area_desde` y `plazo_desde`).
 */

/** El fin de la carga histórica de `e` (timestamptz), o NULL si nunca la tuvo o sigue abierta. */
export const SQL_FIN_CARGA_HISTORICA = Prisma.sql`(SELECT max(fc.fecha_efectiva) FROM public.movimientos fc
   WHERE fc.expediente_id = e.id AND fc.tipo = 'edicion' AND fc.datos -> 'cambios' -> 'carga_historica' IS NOT NULL)`;

/** Desde cuándo cuentan los días en el área de `e` (timestamptz). */
export const SQL_RELOJ_DESDE = Prisma.sql`GREATEST(e.en_area_desde, ${SQL_FIN_CARGA_HISTORICA})`;

/** Los días hábiles en el área de `e` hasta `hoy`, como los cuenta la demora (`f_dias_habiles_entre`). */
export function sqlDiasEnArea(hoy: FechaISO): Prisma.Sql {
  return Prisma.sql`public.f_dias_habiles_entre((${SQL_RELOJ_DESDE} AT TIME ZONE 'America/Argentina/Tucuman')::date, ${hoy}::date)`;
}

/**
 * Desde qué día corre el plazo de `e` (date), o NULL si no empezó. Sin el
 * CASE, GREATEST(NULL, fin) daría por empezado un plazo que no empezó.
 */
export const SQL_PLAZO_DESDE = Prisma.sql`CASE WHEN e.plazo_desde IS NOT NULL
   THEN GREATEST(e.plazo_desde, (${SQL_FIN_CARGA_HISTORICA} AT TIME ZONE 'America/Argentina/Tucuman')::date) END`;

/**
 * Para mostrar: el momento desde el que cuentan los días si no es la llegada
 * al área (es decir, el fin de la carga histórica, posterior a la llegada), o
 * null. La bandeja y el panel lo muestran junto al "desde" del papel.
 */
export function cuentaDesdeDe(enAreaDesde: Date, relojDesde: Date | null): Date | null {
  return relojDesde !== null && relojDesde.getTime() > enAreaDesde.getTime() ? relojDesde : null;
}
