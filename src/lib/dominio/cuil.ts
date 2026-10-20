/**
 * Dígito verificador del CUIL/CUIT (módulo 11, pesos 5432765432).
 *
 * La base solo exige 11 dígitos (CHECK de usuarios.cuil): el CUIL llega de
 * Cidituc y no se rechaza un ingreso por el dígito. Esto sirve para avisar de
 * un error de tipeo en el alta de un usuario y para que los CUIL ficticios de
 * la semilla tengan formato válido.
 */

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Prefijos de persona humana (20, 23, 24, 27) y jurídica (30, 33, 34). */
const PREFIJOS = new Set(["20", "23", "24", "27", "30", "33", "34"]);

/**
 * El dígito que corresponde a los 10 primeros dígitos, o null si da 10: en ese
 * caso la AFIP (ARCA) cambia el prefijo (a 23 o 33) y el número no existe así.
 */
export function digitoVerificadorCuil(base10: string): number | null {
  if (!/^[0-9]{10}$/.test(base10)) {
    throw new Error(`Se esperaban 10 dígitos y llegó "${base10}"`);
  }
  const suma = PESOS.reduce((acc, peso, i) => acc + peso * Number(base10[i]), 0);
  const resto = 11 - (suma % 11);
  if (resto === 11) return 0;
  if (resto === 10) return null;
  return resto;
}

/** 11 dígitos sin separadores, prefijo conocido y dígito verificador correcto. */
export function cuilValido(cuil: string): boolean {
  if (!/^[0-9]{11}$/.test(cuil) || !PREFIJOS.has(cuil.slice(0, 2))) return false;
  return digitoVerificadorCuil(cuil.slice(0, 10)) === Number(cuil[10]);
}
