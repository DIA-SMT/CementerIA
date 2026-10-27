import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Contraseñas del login propio (27/10/2026; docs/api-dominio.md, sección 22):
 * el hash, su verificación, la política de las que elige cada persona y las
 * temporales que genera el sistema. Pura (solo node:crypto): la usan el
 * ingreso, el cambio de contraseña, la administración, la semilla y los tests.
 *
 * El hash es scrypt con sal aleatoria y los parámetros escritos en el propio
 * valor, `scrypt$N$r$p$<sal>$<hash>` (sal y hash en base64url):
 *   - subir el costo más adelante es cambiar PARAMETROS_ACTUALES; los hashes
 *     viejos se siguen verificando con los suyos y se rehacen con los nuevos
 *     en el próximo ingreso correcto (`rehacer`);
 *   - el CHECK usuarios_clave_hash_check de la base exige este formato, así
 *     que una contraseña en texto no se puede guardar por error.
 *
 * La copia en JavaScript de scripts/supabase/lib.mjs (el generador del paquete
 * SQL corre sin TypeScript) tiene que dar hashes que esto verifique:
 * scripts/supabase/lib.test.ts lo controla.
 */

export interface ParametrosScrypt {
  /** Costo de CPU y memoria (potencia de 2). */
  N: number;
  /** Tamaño de bloque. */
  r: number;
  /** Paralelismo. */
  p: number;
}

/**
 * N = 2^15, r = 8, p = 3: una de las combinaciones equivalentes que recomienda
 * OWASP (Password Storage Cheat Sheet) para scrypt. Usa 32 MiB por cálculo y
 * tarda ~160 ms en una PC de oficina: lento para quien prueba millones, nada
 * para quien ingresa una vez.
 */
export const PARAMETROS_ACTUALES: Readonly<ParametrosScrypt> = Object.freeze({ N: 2 ** 15, r: 8, p: 3 });

const LARGO_SAL = 16;
const LARGO_HASH = 32;

/** Más que esto no es una contraseña: se rechaza antes de calcular nada. */
export const LARGO_MAXIMO_CLAVE = 128;
export const LARGO_MINIMO_CLAVE = 12;

/** Cotas para leer un hash guardado: un valor raro no puede pedir un cálculo enorme. */
const COTAS = { N: [2 ** 10, 2 ** 20], r: [1, 32], p: [1, 16] } as const;

function derivar(clave: string, sal: Buffer, largo: number, { N, r, p }: ParametrosScrypt): Promise<Buffer> {
  // maxmem: scrypt necesita 128·N·r bytes (más un poco); el tope por defecto
  // de Node (32 MiB) no alcanza con N = 2^15 y r = 8.
  const opciones: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) => {
    // NFC: la misma contraseña escrita con un teclado u otro (la "ñ" compuesta
    // o con la tilde aparte) da el mismo hash.
    scrypt(clave.normalize("NFC"), sal, largo, opciones, (error, clave) => (error ? reject(error) : resolve(clave)));
  });
}

/** El hash de una contraseña, en el formato versionado, con sal nueva. */
export async function hashearClave(clave: string, parametros: ParametrosScrypt = PARAMETROS_ACTUALES): Promise<string> {
  if (clave.length === 0 || clave.length > LARGO_MAXIMO_CLAVE) throw new Error("hashearClave: largo de contraseña fuera de rango");
  const sal = randomBytes(LARGO_SAL);
  const hash = await derivar(clave, sal, LARGO_HASH, parametros);
  return `scrypt$${parametros.N}$${parametros.r}$${parametros.p}$${sal.toString("base64url")}$${hash.toString("base64url")}`;
}

export interface HashLeido {
  parametros: ParametrosScrypt;
  sal: Buffer;
  hash: Buffer;
}

const RE_HASH = /^scrypt\$([1-9]\d{0,7})\$([1-9]\d{0,2})\$([1-9]\d{0,2})\$([A-Za-z0-9_-]{22,})\$([A-Za-z0-9_-]{22,})$/;

function dentro(valor: number, [min, max]: readonly [number, number]): boolean {
  return Number.isSafeInteger(valor) && valor >= min && valor <= max;
}

/** Un hash guardado, o `null` si no tiene el formato o parámetros fuera de las cotas. */
export function leerHash(valor: string | null | undefined): HashLeido | null {
  const m = typeof valor === "string" ? RE_HASH.exec(valor) : null;
  if (!m) return null;
  const parametros = { N: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  // N tiene que ser potencia de 2 (scrypt lo exige).
  if (!dentro(parametros.N, COTAS.N) || (parametros.N & (parametros.N - 1)) !== 0) return null;
  if (!dentro(parametros.r, COTAS.r) || !dentro(parametros.p, COTAS.p)) return null;
  const sal = Buffer.from(m[4], "base64url");
  const hash = Buffer.from(m[5], "base64url");
  if (sal.length < 16 || hash.length < 16 || hash.length > 64) return null;
  return { parametros, sal, hash };
}

function mismosParametros(a: ParametrosScrypt, b: ParametrosScrypt): boolean {
  return a.N === b.N && a.r === b.r && a.p === b.p;
}

/**
 * Un hash de una contraseña que nadie conoce: con él se hace el mismo cálculo
 * cuando el usuario no existe o no tiene contraseña, para que el tiempo de
 * respuesta no delate cuál de los dos casos es.
 */
let senuelo: Promise<HashLeido> | undefined;
function hashSenuelo(): Promise<HashLeido> {
  senuelo ??= hashearClave(randomBytes(24).toString("base64url")).then((h) => leerHash(h) as HashLeido);
  return senuelo;
}

export interface Verificacion {
  ok: boolean;
  /** Es correcta pero se guardó con otros parámetros: conviene rehacer el hash. */
  rehacer: boolean;
}

/**
 * ¿`clave` es la del hash guardado? Comparación en tiempo constante
 * (`timingSafeEqual`). Sin hash válido (usuario inexistente, sin contraseña o
 * un valor roto) hace el MISMO cálculo contra un señuelo y responde que no.
 */
export async function verificarClave(clave: string, guardado: string | null | undefined): Promise<Verificacion> {
  const leido = leerHash(guardado);
  const contra = leido ?? (await hashSenuelo());
  // Una contraseña vacía o enorme no es la correcta, pero el cálculo se hace igual.
  const valida = clave.length > 0 && clave.length <= LARGO_MAXIMO_CLAVE;
  const calculado = await derivar(valida ? clave : "-", contra.sal, contra.hash.length, contra.parametros);
  const iguales = timingSafeEqual(calculado, contra.hash);
  const ok = iguales && valida && leido !== null;
  return { ok, rehacer: ok && !mismosParametros(contra.parametros, PARAMETROS_ACTUALES) };
}

// ---------------------------------------------------------------------------
// Contraseñas temporales
// ---------------------------------------------------------------------------

/**
 * Minúsculas y dígitos sin los que se confunden al leerlos o dictarlos (i, l,
 * o, 0, 1): 31 símbolos. Cuatro grupos de cuatro, con guiones: ~79 bits.
 */
export const ALFABETO_TEMPORAL = "abcdefghjkmnpqrstuvwxyz23456789";
export const RE_CLAVE_TEMPORAL = /^[a-hj-km-np-z2-9]{4}(?:-[a-hj-km-np-z2-9]{4}){3}$/;

/** Una contraseña temporal fuerte y legible, por ejemplo `k7mp-x3qa-9rtw-h2ce`. */
export function generarClaveTemporal(): string {
  const grupos: string[] = [];
  for (let g = 0; g < 4; g++) {
    let grupo = "";
    for (let i = 0; i < 4; i++) grupo += ALFABETO_TEMPORAL[randomInt(ALFABETO_TEMPORAL.length)];
    grupos.push(grupo);
  }
  return grupos.join("-");
}

// ---------------------------------------------------------------------------
// Política de las contraseñas que elige cada persona
// ---------------------------------------------------------------------------

/**
 * Claves comunes que se rechazan, también con números o signos agregados
 * ("Password2026!", "Cementeria123"). Corta a propósito: la defensa contra la
 * fuerza bruta es scrypt y el bloqueo; esto saca lo que se adivina primero.
 * Se comparan solo las letras, en minúsculas y sin tildes.
 */
export const CLAVES_COMUNES: readonly string[] = [
  "password",
  "contrasena",
  "clave",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "asdfghjkl",
  "abc",
  "abcdef",
  "abcdefghijkl",
  "admin",
  "administrador",
  "usuario",
  "bienvenido",
  "bienvenida",
  "cambiar",
  "cambiame",
  "secreto",
  "iloveyou",
  "teamo",
  "dragon",
  "monkey",
  "letmein",
  "cementeria",
  "cementerio",
  "cementerios",
  "municipalidad",
  "municipio",
  "sanmiguel",
  "sanmigueldetucuman",
  "tucuman",
  "argentina",
  "boca",
  "river",
  "atletico",
  "sanmartin",
  // La contraseña de desarrollo de la semilla (README): documentada y pública,
  // así que nadie la puede elegir de verdad.
  "cementerialocal",
];

/**
 * Qué exige la contraseña nueva (CLAVE_POLITICA en el entorno). `libre` existe
 * para probar: acepta cualquier contraseña de 1 a 128 caracteres.
 */
export type PoliticaClave = "estricta" | "libre";

/** Las reglas, como se muestran en /cambiar-clave. */
export function reglasClave(politica: PoliticaClave = "estricta"): readonly string[] {
  if (politica === "libre") {
    return [
      `Cualquier contraseña de 1 a ${LARGO_MAXIMO_CLAVE} caracteres (modo de prueba: CLAVE_POLITICA=libre).`,
      "Distinta de la actual.",
    ];
  }
  return REGLAS_CLAVE;
}

/** Las reglas de la política estricta. */
export const REGLAS_CLAVE: readonly string[] = [
  `Al menos ${LARGO_MINIMO_CLAVE} caracteres (y hasta ${LARGO_MAXIMO_CLAVE}). Una frase de varias palabras sirve y se recuerda mejor.`,
  "Que no sea tu CUIL ni contenga tu apellido.",
  "Que no sea una clave común, ni una palabra común con números o signos agregados (por ejemplo, Password2026! o Cementeria123).",
  "Al menos 5 caracteres distintos (no vale 111111111111 ni abababababab).",
  "Distinta de la actual.",
];

/** Partículas de los apellidos que no cuentan como "contener el apellido". */
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "da", "das", "do", "dos", "di", "van", "von", "y", "e", "san"]);

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export interface DatosPersona {
  cuil: string;
  apellido: string;
}

/**
 * Lo que no cumple la contraseña nueva, en palabras (vacío = cumple). No mira
 * si es igual a la actual: eso lo decide quien tiene el hash.
 */
export function problemasDeClave(clave: string, persona: DatosPersona, politica: PoliticaClave = "estricta"): string[] {
  if (politica === "libre") {
    if (clave.length === 0) return ["Escribí la contraseña nueva."];
    if (clave.length > LARGO_MAXIMO_CLAVE) return [`Tiene más de ${LARGO_MAXIMO_CLAVE} caracteres.`];
    return [];
  }
  const problemas: string[] = [];
  const largo = [...clave.normalize("NFC")].length;
  if (largo < LARGO_MINIMO_CLAVE) problemas.push(`Tiene ${largo} caracteres: tienen que ser al menos ${LARGO_MINIMO_CLAVE}.`);
  if (clave.length > LARGO_MAXIMO_CLAVE) problemas.push(`Tiene más de ${LARGO_MAXIMO_CLAVE} caracteres.`);
  if (clave.trim() !== clave) problemas.push("No puede empezar ni terminar con espacios.");

  const digitos = clave.replace(/[\s.\-/]/g, "");
  if (/^\d+$/.test(digitos) && digitos === persona.cuil) problemas.push("No puede ser tu CUIL.");

  const normal = sinTildes(clave);
  const palabras = sinTildes(persona.apellido)
    .split(/[^\p{L}]+/u)
    .filter((p) => p.length >= 3 && !PARTICULAS.has(p));
  if (palabras.some((p) => normal.includes(p))) problemas.push("No puede contener tu apellido.");

  const letras = normal.replace(/[^a-z]/g, "");
  if (/^\d+$/.test(digitos) && /^0?123456789|^987654321/.test(digitos)) {
    problemas.push("Es una secuencia de números demasiado fácil de adivinar.");
  } else if (CLAVES_COMUNES.includes(normal) || (letras.length > 0 && CLAVES_COMUNES.includes(letras))) {
    problemas.push("Es una clave común (o una palabra común con números o signos): elegí otra.");
  }

  if (new Set([...normal]).size < 5) problemas.push("Tiene que tener al menos 5 caracteres distintos.");
  return problemas;
}
