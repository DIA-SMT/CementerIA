/**
 * Estadísticas descriptivas de las métricas de gestión. Puro.
 *
 * Los tiempos son días hábiles enteros (`f_dias_habiles_entre`), así que las
 * medidas se eligieron para que se puedan explicar en una reunión:
 *
 * - **Mediana**: el valor del medio (con un número par de casos, el promedio de
 *   los dos del medio). Es la medida principal: un expediente que estuvo
 *   trabado tres meses no la mueve.
 * - **Percentil 90 por rango más cercano**: el menor valor que deja al 90 % de
 *   los casos en o por debajo de él (`ordenados[ceil(0,9 · n) − 1]`). Siempre
 *   es un caso real ("9 de cada 10 tardaron 14 días hábiles o menos"), no una
 *   interpolación. Con menos de 10 casos coincide con el máximo o casi: por eso
 *   la pantalla muestra siempre `n`.
 * - **Promedio** con un decimal, para comparar con lo que ya se mide a mano.
 */

export interface Resumen {
  /** Cantidad de casos. */
  n: number;
  mediana: number | null;
  promedio: number | null;
  p90: number | null;
  maximo: number | null;
  /** La suma: los días hábiles acumulados (el "cuello de botella por acumulado"). */
  total: number;
}

export const RESUMEN_VACIO: Resumen = { n: 0, mediana: null, promedio: null, p90: null, maximo: null, total: 0 };

function ordenar(valores: readonly number[]): number[] {
  return [...valores].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

/** La mediana, o null sin valores. */
export function mediana(valores: readonly number[]): number | null {
  const o = ordenar(valores);
  if (o.length === 0) return null;
  const medio = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[medio] : (o[medio - 1] + o[medio]) / 2;
}

/**
 * El percentil `p` (0 a 100) por rango más cercano, o null sin valores.
 *
 * @throws RangeError si `p` no está entre 0 (excluido) y 100.
 */
export function percentil(valores: readonly number[], p: number): number | null {
  if (!(p > 0 && p <= 100)) throw new RangeError(`Percentil fuera de rango: ${p}`);
  const o = ordenar(valores);
  if (o.length === 0) return null;
  return o[Math.ceil((p / 100) * o.length) - 1];
}

/** Redondea a un decimal (12,25 → 12,3). */
export function unDecimal(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/** El promedio con un decimal, o null sin valores. */
export function promedio(valores: readonly number[]): number | null {
  const o = ordenar(valores);
  if (o.length === 0) return null;
  return unDecimal(o.reduce((s, v) => s + v, 0) / o.length);
}

/** n, mediana, promedio, percentil 90, máximo y total de una lista de días. */
export function resumir(valores: readonly number[]): Resumen {
  const o = ordenar(valores);
  if (o.length === 0) return RESUMEN_VACIO;
  return {
    n: o.length,
    mediana: mediana(o),
    promedio: promedio(o),
    p90: percentil(o, 90),
    maximo: o[o.length - 1],
    total: o.reduce((s, v) => s + v, 0),
  };
}

/** Una proporción (0 a 1) con tres decimales, o null si el total es 0. */
export function tasa(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 1000 : null;
}

/** Agrupa por una clave conservando el orden de aparición. */
export function agruparPor<T, K>(items: readonly T[], clave: (item: T) => K): Map<K, T[]> {
  const r = new Map<K, T[]>();
  for (const item of items) {
    const k = clave(item);
    const lista = r.get(k);
    if (lista) lista.push(item);
    else r.set(k, [item]);
  }
  return r;
}
