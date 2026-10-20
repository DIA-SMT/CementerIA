/**
 * Normalizaciones de texto que tienen que dar lo mismo en TypeScript y en la
 * base, porque se comparan entre sí:
 *
 * - `normalizar()` es `f_normalizar()` de la migración reglas_base: arma
 *   `expedientes.busqueda` (2.13(g)) y normaliza la consulta de la caja única.
 * - `normalizarNumero()` es lo que hace el trigger `expedientes_preparar` con
 *   `numero_municipal_norm` y `padron_norm`.
 * - `normalizarDni()` es cómo se guarda `expediente_personas.dni`.
 *
 * tests/integracion/busqueda.test.ts compara las dos implementaciones con la base.
 */

// `unaccent` también traduce letras que no son "letra + diacrítico" y que NFD
// no separa. Las que pueden aparecer en un apellido.
const LIGADURAS: Readonly<Record<string, string>> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
};

/** Sin acentos ni diéresis ("GONZÁLEZ" → "GONZALEZ", "Ñandú" → "Nandu"). */
export function sinAcentos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[ßæœøłđðþ]/giu, (c) => {
      const minuscula = LIGADURAS[c.toLowerCase()] ?? c;
      return c === c.toLowerCase() ? minuscula : minuscula.toUpperCase();
    });
}

/**
 * `f_normalizar()`: sin acentos, minúsculas, todo lo que no sea [a-z0-9] pasa a
 * un espacio y los espacios se colapsan. "GONZÁLEZ, María-José" → "gonzalez maria jose".
 */
export function normalizar(texto: string): string {
  return sinAcentos(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Las palabras de `normalizar()`, sin vacías. */
export function tokens(texto: string): string[] {
  const n = normalizar(texto);
  return n === "" ? [] : n.split(" ");
}

/**
 * Como `numero_municipal_norm` y `padron_norm` (trigger expedientes_preparar):
 * mayúsculas y solo alfanuméricos. "12.345/2026" y "12345-2026" dan lo mismo.
 * `null` si no queda nada.
 */
export function normalizarNumero(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined) return null;
  const n = sinAcentos(texto).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return n === "" ? null : n;
}

/**
 * Un DNI como se guarda: solo dígitos y sin ceros a la izquierda ("07.123.456"
 * → "7123456"), para que buscarlo por igualdad no dependa de cómo se tipeó.
 * `null` si no hay dígitos.
 */
export function normalizarDni(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined) return null;
  const digitos = texto.replace(/\D/g, "").replace(/^0+/, "");
  return digitos === "" ? null : digitos;
}

/** El DNI que contiene un CUIL/CUIT de 11 dígitos (los 8 del medio), normalizado. */
export function dniDeCuil(cuil: string): string | null {
  const digitos = cuil.replace(/\D/g, "");
  if (digitos.length !== 11) return null;
  return normalizarDni(digitos.slice(2, 10));
}

/** Espacios de más fuera: "  Pérez   Gómez " → "Pérez Gómez". */
export function colapsarEspacios(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}
