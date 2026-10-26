/**
 * La escala de los gráficos hechos a mano (barras y columnas en CSS, docs/diseno.md,
 * "Gráficos"). Puro.
 *
 * Todos los gráficos de las métricas son de magnitudes que empiezan en 0
 * (días, cantidades): el eje arranca en 0 y termina en un número "redondo"
 * (1, 2 o 5 por una potencia de 10) que deja el máximo adentro. Las marcas son
 * enteras, porque se cuentan expedientes y días hábiles.
 */

export interface Escala {
  /** El valor del tope del eje (100 % del largo). */
  tope: number;
  /** Las marcas del eje, de 0 al tope. */
  marcas: number[];
  paso: number;
}

/** Un paso "redondo" (1, 2 o 5 × 10ⁿ, entero) que da como mucho `marcas` intervalos hasta `maximo`. */
function pasoRedondo(maximo: number, marcas: number): number {
  const crudo = maximo / marcas;
  const potencia = 10 ** Math.floor(Math.log10(crudo));
  for (const m of [1, 2, 5, 10]) {
    const paso = m * potencia;
    if (paso >= crudo) return Math.max(1, paso);
  }
  return Math.max(1, 10 * potencia);
}

/**
 * La escala para valores entre 0 y `maximo`, con hasta `intervalos` divisiones.
 * Sin datos (o todo en 0), un eje de 0 a 1.
 */
export function escala(maximo: number, intervalos = 4): Escala {
  const max = Number.isFinite(maximo) && maximo > 0 ? maximo : 0;
  if (max === 0) return { tope: 1, marcas: [0, 1], paso: 1 };
  const paso = pasoRedondo(max, Math.max(1, intervalos));
  const tope = Math.ceil(max / paso) * paso;
  const marcas: number[] = [];
  for (let v = 0; v <= tope + paso / 2; v += paso) marcas.push(Math.round(v * 1000) / 1000);
  return { tope, marcas, paso };
}

/** Qué parte del eje ocupa `valor` (0 a 100, con dos decimales). Nunca se sale del eje. */
export function porcentajeDe(valor: number | null | undefined, tope: number): number {
  if (valor === null || valor === undefined || !Number.isFinite(valor) || tope <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (valor / tope) * 100)) * 100) / 100;
}

/**
 * Cada cuántos rótulos se muestra uno en el eje de las columnas para que no se
 * pisen (hasta `maximo` rótulos). El dato de cada columna sigue en su globo y
 * en la tabla.
 */
export function saltoDeRotulos(cantidad: number, maximo = 8): number {
  return cantidad <= maximo ? 1 : Math.ceil(cantidad / maximo);
}
