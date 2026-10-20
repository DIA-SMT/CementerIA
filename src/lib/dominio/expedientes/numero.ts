/**
 * Número interno del expediente (docs/propuesta-mvp.md, 2.13(f)):
 * `CEM-AAAA-NNNNN`, con el año de REGISTRO y una secuencia por año sin huecos.
 * La forma corta es `N/AAAA` ("42/2026"), la que se dice en voz alta.
 */

export const PREFIJO_NUMERO = "CEM";

export interface PartesNumero {
  anio: number;
  secuencia: number;
}

/** `CEM-2026-00042`. Con más de 99.999 en un año, la secuencia sigue con 6 dígitos. */
export function formatearNumeroInterno(anio: number, secuencia: number): string {
  return `${PREFIJO_NUMERO}-${anio}-${String(secuencia).padStart(5, "0")}`;
}

/** `42/2026`. */
export function numeroCorto(anio: number, secuencia: number): string {
  return `${secuencia}/${anio}`;
}

// 2.13(g): "Si la consulta empieza con CEM y coincide con ^CEM\D*(\d{4})\D+(\d{1,6})$".
const RE_NUMERO_INTERNO = /^CEM\D*(\d{4})\D+(\d{1,6})$/i;
const RE_FORMA_CORTA = /^(\d{1,6})\s*\/\s*(\d{4})$/;

function partes(anio: string, secuencia: string): PartesNumero | null {
  const p = { anio: Number(anio), secuencia: Number(secuencia) };
  return p.secuencia >= 1 ? p : null;
}

/**
 * Lee un número interno escrito de cualquier forma razonable: "CEM-2026-00042",
 * "cem 2026 42", "CEM2026/42". `null` si no lo es.
 */
export function interpretarNumeroInterno(texto: string): PartesNumero | null {
  const m = RE_NUMERO_INTERNO.exec(texto.trim());
  return m ? partes(m[1], m[2]) : null;
}

/** "42/2026" (también "42 / 2026"). `null` si no tiene esa forma. */
export function interpretarFormaCorta(texto: string): PartesNumero | null {
  const m = RE_FORMA_CORTA.exec(texto.trim());
  return m ? partes(m[2], m[1]) : null;
}

/**
 * El número interno canónico a partir de lo que llega en una URL o en un
 * formulario (`CEM-2026-00042`, `cem-2026-42` o `42/2026`). `null` si no se
 * reconoce.
 */
export function canonizarNumeroInterno(texto: string): string | null {
  const p = interpretarNumeroInterno(texto) ?? interpretarFormaCorta(texto);
  return p ? formatearNumeroInterno(p.anio, p.secuencia) : null;
}
