/**
 * Papel ahorrado: un dato informativo, no una medición. Puro.
 *
 * Lo que sí se cuenta: **fichas de papel reemplazadas** = expedientes dados de
 * alta en el sistema (sin carga histórica) con fecha de inicio en el período.
 * Cada uno es una ficha de seguimiento que ya no se abrió en papel (el
 * expediente de papel sigue siendo el oficial: eso no se ahorra).
 *
 * Lo que se **estima**: las hojas que habrían ocupado esas fichas. Sale de las
 * anotaciones que cada área habría escrito a mano en la ficha (el alta, cada
 * pase, cada devolución y cada cambio de estado vigentes del historial) y de
 * cuántas entran en una hoja:
 *
 *     hojas de un expediente = max(1, ⌈anotaciones / anotacionesPorHoja⌉)
 *
 * `anotacionesPorHoja` es un SUPUESTO [I]: todavía no tenemos fotos de fichas
 * reales (docs/fuentes/README.md, "Lo que todavía falta pedir"), así que 12
 * es un valor inicial elegido a mano, no medido: un expediente de las cuatro
 * plantillas sembradas que va derecho (alta, un pase por paso, concluir y
 * archivar) tiene entre 9 y 12 anotaciones, y con 12 por hoja ocupa una sola;
 * cada devolución suma renglones. Cuando la Dirección pase una ficha real, se
 * cuenta cuántos pases entran y se cambia acá; la pantalla muestra el
 * supuesto con el valor que tenga.
 */

export interface ParametrosPapel {
  /** Anotaciones (alta, pases, devoluciones, cambios de estado) que entran en una hoja de la ficha. */
  anotacionesPorHoja: number;
}

export const PARAMETROS_PAPEL: ParametrosPapel = { anotacionesPorHoja: 12 };

/** Las hojas de la ficha de un expediente con `anotaciones` renglones. Siempre al menos una. */
export function hojasDeFicha(anotaciones: number, parametros: ParametrosPapel = PARAMETROS_PAPEL): number {
  const porHoja = Math.max(1, Math.floor(parametros.anotacionesPorHoja));
  return Math.max(1, Math.ceil(Math.max(0, anotaciones) / porHoja));
}
