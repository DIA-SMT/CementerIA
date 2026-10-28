/**
 * El código de consulta pública de un expediente (28/10/2026; docs/api-dominio.md,
 * sección 24): lo que el concesionario escribe en /consulta junto con el
 * número, y que va en su comprobante.
 *
 * 8 caracteres del alfabeto de Crockford (base32) sin I, L, O ni U: no se
 * confunden al dictarlos ni al copiarlos del papel (0 y O, 1, I y L; la U, para
 * no armar palabras). 40 bits de aleatoriedad criptográfica (Web Crypto, igual
 * en Node y en el navegador): con el límite de intentos de la consulta (5
 * fallidos por número cada 15 minutos), adivinarlo es impracticable.
 *
 * Se guarda sin guion (`K7QM3XZP`, expedientes.codigo_consulta) y se muestra
 * `K7QM-3XZP`. Al leer lo que escribió la persona se perdona lo razonable:
 * minúsculas, espacios y guiones, y las letras que el alfabeto no usa por
 * parecidas (O es 0; I y L son 1), como propone Crockford.
 *
 * Puro: lo usan el alta (en el servidor), la semilla, las pruebas y el
 * formulario de la consulta (en el navegador, para normalizar al pegar).
 * La migración *_consulta_publica tiene el mismo alfabeto en SQL
 * (f_codigo_consulta_aleatorio, para el relleno).
 */

export const ALFABETO_CODIGO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LARGO_CODIGO = 8;
const RE_CODIGO = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * 40 bits (un entero menor que 2^40: exacto en un number) como 8 caracteres de
 * 5 bits, del más significativo al menos.
 */
function codigoDeBits(bits: number): string {
  let codigo = "";
  for (let i = LARGO_CODIGO - 1; i >= 0; i--) codigo += ALFABETO_CODIGO[Math.floor(bits / 2 ** (5 * i)) % 32];
  return codigo;
}

/** Un código nuevo, al azar (los 40 bits de 5 bytes aleatorios: sin sesgo). */
export function generarCodigoConsulta(): string {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  return codigoDeBits(bytes.reduce((bits, b) => bits * 256 + b, 0));
}

/** ¿Tiene la forma de un código guardado (8 caracteres del alfabeto, sin guion)? */
export function esCodigoConsulta(valor: string): boolean {
  return RE_CODIGO.test(valor);
}

/**
 * Lo que escribió la persona, como se guarda: sin espacios ni guiones, en
 * mayúsculas, con O → 0 e I, L → 1. `null` si no queda un código válido (la U
 * no tiene equivalente y queda inválida).
 */
export function normalizarCodigoConsulta(texto: string): string | null {
  const limpio = texto
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\-–—_.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return esCodigoConsulta(limpio) ? limpio : null;
}

/** `K7QM3XZP` → `K7QM-3XZP`. Lo que no es un código se devuelve tal cual. */
export function formatearCodigoConsulta(codigo: string): string {
  return esCodigoConsulta(codigo) ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
}

/**
 * Códigos deterministas para la SEMILLA DE DESARROLLO (prisma/semilla): el mismo
 * número da siempre el mismo código, así el README puede documentar con qué
 * probar /consulta. Los expedientes de CODIGOS_SEMILLA tienen uno legible; el
 * resto, uno derivado de su número. Nunca en producción: la semilla de
 * producción no crea expedientes, y la app usa generarCodigoConsulta().
 */
export const CODIGOS_SEMILLA: Readonly<Record<number, string>> = {
  // Secuencia del año → código. Los números son los de una base recién reseteada (README, "Semilla").
  1: "PRVE8A01",
  52: "PRVE8A52",
  58: "PRVE8A58",
};

export function codigoDeSemilla(numero: string): string {
  const secuencia = Number(/-(\d+)$/.exec(numero)?.[1] ?? Number.NaN);
  const fijo = CODIGOS_SEMILLA[secuencia];
  if (fijo) return fijo;
  // FNV-1a de 32 bits extendido a 40: estable y sin dependencias. No es secreto.
  let h = 0x811c9dc5;
  for (const c of `semilla-desarrollo|${numero}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return codigoDeBits(h * 256 + (Number.isFinite(secuencia) ? secuencia % 256 : 0));
}
