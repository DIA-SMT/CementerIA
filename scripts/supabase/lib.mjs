// Piezas comunes de los scripts de Supabase (preparar.mjs, generar-sql.mjs,
// simular-local.mjs, probar-local.mjs). Ver docs/despliegue.md, "Base en
// Supabase".
//
// Regla de todo este directorio: ninguna contraseña ni URL con contraseña se
// imprime, se loguea ni se escribe fuera de .env.supabase.local (y de los
// archivos de supabase/sql/.local/, que solo llevan verificadores SCRAM y el
// hash scrypt del admin inicial). La única excepción es la contraseña
// TEMPORAL del admin inicial (login propio): va en texto SOLO a
// supabase/sql/.local/clave-admin-inicial.txt (y, con preparar.mjs, la semilla
// la imprime una vez a quien la corre).

import { spawn } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomInt, scryptSync, timingSafeEqual, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parsearEnv } from "dotenv";
import pg from "pg";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** El archivo local con la conexión de administración y las URLs generadas. */
export const ENV_SUPABASE = path.join(RAIZ, ".env.supabase.local");

/**
 * La contraseña temporal del admin inicial en texto (login propio): solo acá,
 * ignorado por git. La escriben el generador del paquete SQL y, con el proyecto
 * real, la semilla que corre preparar.mjs.
 */
export const ARCHIVO_CLAVE_ADMIN = path.join(RAIZ, "supabase", "sql", ".local", "clave-admin-inicial.txt");

/** Donde se espera el certificado raíz de Supabase si no se dice otra cosa. */
export const CA_POR_DEFECTO = "certs/supabase-prod-ca-2021.crt";

/** Los tres roles de CementerIA (docs/propuesta-mvp.md, sección 2, "Roles de base"). */
export const ROLES = { owner: "cementeria_owner", deploy: "cementeria_deploy", app: "cementeria_app" };

/** Los roles de la API de Supabase (PostgREST): no tienen que ver nada de CementerIA. */
export const ROLES_API = ["anon", "authenticated", "service_role"];

/** Las fuentes SQL compartidas por preparar.mjs y por el generador de supabase/sql/. */
export const FUENTES_SQL = path.join(RAIZ, "scripts", "supabase", "sql");

export function leerFuente(nombre) {
  return readFileSync(path.join(FUENTES_SQL, nombre), "utf8");
}

// ---------------------------------------------------------------------------
// Errores para el usuario
// ---------------------------------------------------------------------------

/** Un error que se muestra tal cual, sin stack: dice qué hacer. */
export class ErrorPreparacion extends Error {}

// ---------------------------------------------------------------------------
// CUIL (igual que src/lib/dominio/cuil.ts; scripts/supabase/lib.test.ts lo compara)
// ---------------------------------------------------------------------------

const PESOS_CUIL = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const PREFIJOS_CUIL = new Set(["20", "23", "24", "27", "30", "33", "34"]);

/** 11 dígitos sin separadores, prefijo conocido y dígito verificador correcto. */
export function cuilValido(cuil) {
  if (!/^[0-9]{11}$/.test(cuil) || !PREFIJOS_CUIL.has(cuil.slice(0, 2))) return false;
  const suma = PESOS_CUIL.reduce((acc, peso, i) => acc + peso * Number(cuil[i]), 0);
  const resto = 11 - (suma % 11);
  const digito = resto === 11 ? 0 : resto === 10 ? null : resto;
  return digito === Number(cuil[10]);
}

// ---------------------------------------------------------------------------
// Archivo de entorno
// ---------------------------------------------------------------------------

const INICIO_BLOQUE = "# --- Generado por npm run supabase:preparar / supabase:sql: no editar a mano ---";
const FIN_BLOQUE = "# --- Fin de lo generado ---";

/** Las variables del archivo (vacío si no existe). */
export function leerEnv(archivo) {
  if (!existsSync(archivo)) return {};
  return parsearEnv(readFileSync(archivo, "utf8"));
}

/**
 * Escribe `valores` en el bloque generado del archivo, sin tocar lo demás (lo
 * que completa la persona: SUPABASE_ADMIN_URL, ADMIN_INICIAL_CUIL…). Escribe a
 * un temporal y lo renombra: un corte a mitad de camino no deja el archivo por
 * la mitad.
 * @param {string} archivo
 * @param {Record<string, string>} valores
 */
export function escribirBloqueEnv(archivo, valores) {
  const actual = existsSync(archivo) ? readFileSync(archivo, "utf8").replace(/\r\n/g, "\n") : "";
  const sinBloque = actual.replace(new RegExp(`\\n*${escaparRegex(INICIO_BLOQUE)}[\\s\\S]*?${escaparRegex(FIN_BLOQUE)}\\n?`), "\n");
  const bloque = [
    INICIO_BLOQUE,
    "# DATABASE_URL: la app (rol cementeria_app). MIGRATE_DATABASE_URL: las migraciones",
    "# (rol cementeria_deploy, que entra como cementeria_owner). Ver .env.supabase.ejemplo.",
    ...Object.entries(valores).map(([k, v]) => `${k}=${v}`),
    FIN_BLOQUE,
  ].join("\n");
  const contenido = `${sinBloque.trimEnd()}\n\n${bloque}\n`.replace(/^\n+/, "");
  const temporal = `${archivo}.${process.pid}.tmp`;
  writeFileSync(temporal, contenido, { mode: 0o600 });
  renameSync(temporal, archivo);
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// URLs de conexión
// ---------------------------------------------------------------------------

/**
 * Lo que interesa de SUPABASE_ADMIN_URL. El usuario del pooler de Supabase
 * (Supavisor) es `<rol>.<ref del proyecto>`; contra una conexión directa (o el
 * simulador local) es el rol solo.
 * @param {string} url
 */
export function analizarUrlAdmin(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new ErrorPreparacion("SUPABASE_ADMIN_URL no es una URL válida (postgresql://postgres.<ref>:<clave>@<host>:5432/postgres).");
  }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) {
    throw new ErrorPreparacion("SUPABASE_ADMIN_URL tiene que empezar con postgresql://");
  }
  const usuario = decodeURIComponent(u.username);
  const [rol, ...resto] = usuario.split(".");
  const ref = resto.join(".") || null;
  if (rol !== "postgres") {
    throw new ErrorPreparacion(`SUPABASE_ADMIN_URL tiene que ser la del rol postgres de Supabase (llegó el usuario "${rol}").`);
  }
  const base = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  if (base !== "postgres") {
    throw new ErrorPreparacion(`En Supabase la base es "postgres" (llegó "${base}"): no se puede crear otra.`);
  }
  const puerto = Number(u.port || 5432);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return { host: u.hostname, puerto, ref, base, local, pooler: /\.pooler\.supabase\.com$/i.test(u.hostname) };
}

/**
 * La URL de un rol propio. Por el pooler, `<rol>.<ref>`; el puerto elige el
 * modo: 5432 sesión, 6543 transacción.
 */
export function armarUrl({ rol, ref, host, puerto, clave }) {
  const usuario = ref ? `${rol}.${ref}` : rol;
  return `postgresql://${encodeURIComponent(usuario)}:${encodeURIComponent(clave)}@${host}:${puerto}/postgres`;
}

/** La clave de una URL si es de `rol` (con o sin ref) en `host`; si no, null. */
export function claveDeUrl(url, { rol, ref, host }) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const esperado = ref ? `${rol}.${ref}` : rol;
    if (decodeURIComponent(u.username) !== esperado || u.hostname !== host) return null;
    const clave = decodeURIComponent(u.password);
    return clave || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claves
// ---------------------------------------------------------------------------

/** 32 bytes aleatorios en base64url: 43 caracteres sin nada que escapar en una URL. */
export function claveAleatoria() {
  return randomBytes(32).toString("base64url");
}

/**
 * El verificador SCRAM-SHA-256 de una clave, como lo calcula PostgreSQL (y
 * `\password` de psql). Con `ALTER ROLE … PASSWORD '<verificador>'` la clave
 * en texto plano nunca viaja a la base, ni queda en su log, ni en el historial
 * del SQL Editor de Supabase.
 * @param {string} clave ASCII (claveAleatoria): no hace falta SASLprep.
 */
export function verificadorScram(clave, sal = randomBytes(16), iteraciones = 4096) {
  if (!/^[\x21-\x7e]+$/.test(clave)) throw new Error("verificadorScram: la clave tiene que ser ASCII imprimible");
  const salada = pbkdf2Sync(clave, sal, iteraciones, 32, "sha256");
  const claveCliente = createHmac("sha256", salada).update("Client Key").digest();
  const guardada = createHash("sha256").update(claveCliente).digest();
  const claveServidor = createHmac("sha256", salada).update("Server Key").digest();
  return `SCRAM-SHA-256$${iteraciones}:${sal.toString("base64")}$${guardada.toString("base64")}:${claveServidor.toString("base64")}`;
}

/** `ALTER ROLE … PASSWORD` con el verificador (nunca la clave). */
export function sqlClave(rol, clave) {
  return `ALTER ROLE ${rol} PASSWORD '${verificadorScram(clave)}';`;
}

// ---------------------------------------------------------------------------
// Contraseña del admin inicial (login propio; igual que src/lib/auth/clave.ts,
// scripts/supabase/lib.test.ts controla que la app verifique estos hashes)
// ---------------------------------------------------------------------------

/** Los parámetros de scrypt de la app (PARAMETROS_ACTUALES de src/lib/auth/clave.ts). */
export const PARAMETROS_SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 3 });

/** `scrypt$N$r$p$<sal>$<hash>` (base64url): el formato de usuarios.clave_hash. */
export function hashClave(clave, { N, r, p } = PARAMETROS_SCRYPT) {
  const sal = randomBytes(16);
  const hash = scryptSync(clave.normalize("NFC"), sal, 32, { N, r, p, maxmem: 256 * N * r });
  return ["scrypt", N, r, p, sal.toString("base64url"), hash.toString("base64url")].join("$");
}

/** ¿`clave` es la de ese hash? (para las pruebas del paquete SQL) */
export function verificarHashClave(clave, guardado) {
  const partes = String(guardado ?? "").split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [N, r, p] = partes.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return false;
  const esperado = Buffer.from(partes[5], "base64url");
  const calculado = scryptSync(clave.normalize("NFC"), Buffer.from(partes[4], "base64url"), esperado.length, { N, r, p, maxmem: 256 * N * r });
  return timingSafeEqual(calculado, esperado);
}

/** Como generarClaveTemporal() de la app: cuatro grupos de cuatro, sin caracteres ambiguos. */
export const ALFABETO_TEMPORAL = "abcdefghjkmnpqrstuvwxyz23456789";
export function claveTemporal() {
  const grupos = [];
  for (let g = 0; g < 4; g++) {
    let grupo = "";
    for (let i = 0; i < 4; i++) grupo += ALFABETO_TEMPORAL[randomInt(ALFABETO_TEMPORAL.length)];
    grupos.push(grupo);
  }
  return grupos.join("-");
}

const RE_TEMPORAL = /^[a-hj-km-np-z2-9]{4}(?:-[a-hj-km-np-z2-9]{4}){3}$/;

/**
 * La contraseña de un archivo de clave del admin inicial (la primera línea que
 * no es comentario), o null si no existe o no tiene una con la forma de una
 * temporal.
 */
export function leerArchivoClave(archivo) {
  if (!existsSync(archivo)) return null;
  const linea = readFileSync(archivo, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return linea && RE_TEMPORAL.test(linea) ? linea : null;
}

/** Escribe el archivo de clave del admin inicial (solo para el dueño: 0600). */
export function escribirArchivoClave(archivo, clave, origen) {
  mkdirSync(path.dirname(archivo), { recursive: true });
  const lineas = [
    `# Contraseña TEMPORAL del administrador inicial de CementerIA (${origen}).`,
    "# Se ingresa en /login con el CUIL de ADMIN_INICIAL_CUIL y esta contraseña; CementerIA",
    "# pide cambiarla en el primer ingreso. Entregala en mano y BORRÁ este archivo después.",
    "# No se versiona (.gitignore). En la base va solo su hash (scrypt).",
    clave,
    "",
  ];
  writeFileSync(archivo, lineas.join("\n"), { mode: 0o600 });
}

/** Reemplaza cada secreto (y su forma escapada para URL) por ***. */
export function redactar(texto, secretos) {
  let r = String(texto);
  for (const s of secretos) {
    if (!s) continue;
    for (const forma of new Set([s, encodeURIComponent(s)])) r = r.split(forma).join("***");
  }
  return r;
}

// ---------------------------------------------------------------------------
// Certificado raíz
// ---------------------------------------------------------------------------

/**
 * El certificado raíz de Supabase: DATABASE_CA_FILE del archivo de entorno o,
 * si no está, certs/supabase-prod-ca-2021.crt. Devuelve la ruta absoluta, el
 * PEM y un resumen público (sujeto y huella).
 */
export function cargarCa(env) {
  const relativa = env.DATABASE_CA_FILE?.trim() || CA_POR_DEFECTO;
  const archivo = path.resolve(RAIZ, relativa);
  if (!existsSync(archivo)) {
    throw new ErrorPreparacion(
      `Falta el certificado raíz de Supabase en ${path.relative(RAIZ, archivo) || archivo}.\n` +
        "Bajalo del panel del proyecto: Settings → Database → SSL Configuration → Download certificate\n" +
        `(prod-ca-2021.crt) y guardalo como ${CA_POR_DEFECTO} (o poné su ruta en DATABASE_CA_FILE de .env.supabase.local).\n` +
        "Es público: se puede versionar. Sin él no hay forma de verificar al servidor y no se sigue.",
    );
  }
  const pem = readFileSync(archivo, "utf8");
  let cert;
  try {
    cert = new X509Certificate(pem);
  } catch {
    throw new ErrorPreparacion(`${archivo} no es un certificado PEM válido.`);
  }
  if (!cert.ca) throw new ErrorPreparacion(`${archivo} no es un certificado de CA (le falta basicConstraints CA:TRUE).`);
  return {
    archivo,
    // Relativa a la raíz si está adentro del repositorio (así se escribe en el .env).
    relativa: (path.relative(RAIZ, archivo).startsWith("..") ? archivo : path.relative(RAIZ, archivo)).replaceAll("\\", "/"),
    pem,
    resumen: `${cert.subject.replace(/\n/g, ", ")} (SHA-256 ${cert.fingerprint256.slice(0, 23)}…, vence ${new Date(cert.validTo).toISOString().slice(0, 10)})`,
  };
}

// ---------------------------------------------------------------------------
// Conexiones
// ---------------------------------------------------------------------------

/**
 * Un cliente de `pg` con TLS verificado contra `ca` (cadena y host). Sin `ca`
 * solo se acepta un host local (el simulador).
 * @param {string} url
 * @param {{ ca?: { pem: string } | null, aplicacion?: string }} [o]
 */
export function clientePg(url, { ca = null, aplicacion = "cementeria-supabase" } = {}) {
  const u = new URL(url);
  for (const p of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslaccept"]) u.searchParams.delete(p);
  if (!ca && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) {
    throw new ErrorPreparacion("Sin certificado raíz solo se aceptan bases locales (el simulador).");
  }
  return new pg.Client({
    connectionString: u.toString(),
    ssl: ca ? { ca: ca.pem, rejectUnauthorized: true } : undefined,
    application_name: aplicacion,
    connectionTimeoutMillis: 20_000,
  });
}

/** ¿Es un error de autenticación (o del pooler que todavía no conoce al rol)? */
export function esErrorDeIngreso(e) {
  const m = e instanceof Error ? e.message : String(e);
  return (
    (e && typeof e === "object" && "code" in e && (e.code === "28P01" || e.code === "28000")) ||
    /password authentication failed|EAUTHQUERY|Tenant or user not found|authentication/i.test(m)
  );
}

/**
 * Conecta, con reintentos si el error es de ingreso: después de crear un rol o
 * cambiarle la clave, el pooler de Supabase tarda unos segundos en enterarse
 * (guarda las credenciales un rato; ver docs/despliegue.md).
 */
export async function conectarConReintentos(url, opciones = {}, { intentos = 8, esperaMs = 5000 } = {}) {
  for (let i = 1; ; i++) {
    const c = clientePg(url, opciones);
    try {
      await c.connect();
      return c;
    } catch (e) {
      await c.end().catch(() => undefined);
      if (i >= intentos || !esErrorDeIngreso(e)) throw e;
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Procesos hijos
// ---------------------------------------------------------------------------

export const CLI_PRISMA = path.join(RAIZ, "node_modules", "prisma", "build", "index.js");
export const CLI_TSX = path.join(RAIZ, "node_modules", "tsx", "dist", "cli.mjs");

/**
 * Corre un proceso de node y muestra su salida con los secretos tapados.
 * Devuelve el código de salida y la salida (también tapada).
 * @param {string[]} args argumentos de node (el primero, el script)
 * @param {{ env: NodeJS.ProcessEnv, secretos: string[], mostrar?: boolean, prefijo?: string }} o
 */
export function correrNode(args, { env, secretos, mostrar = true, prefijo = "  │ " }) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, args, { cwd: RAIZ, env, windowsHide: true });
    let salida = "";
    const tomar = (d) => {
      const texto = redactar(d.toString(), secretos);
      salida += texto;
      if (mostrar) process.stdout.write(texto.replace(/^(?=.)/gm, prefijo));
    };
    hijo.stdout.on("data", tomar);
    hijo.stderr.on("data", tomar);
    hijo.on("error", reject);
    hijo.on("exit", (codigo) => resolve({ codigo: codigo ?? 1, salida }));
  });
}

/**
 * El entorno de los hijos: el del proceso, sin nada de la base que pudiera
 * venir de afuera, más lo que se pasa. prisma.config.ts y la semilla cargan
 * .env.local con dotenv, que NO pisa lo ya definido: por eso las variables de
 * la base van todas, aunque sea vacías, para que nunca se cuele la base de
 * desarrollo.
 */
export function entornoHijo(extra) {
  const base = { ...process.env };
  for (const k of [
    "DATABASE_URL",
    "MIGRATE_DATABASE_URL",
    "SHADOW_DATABASE_URL",
    "DATABASE_CA_FILE",
    "DATABASE_CA_PEM",
    "ADMIN_INICIAL_CUIL",
    "ADMIN_INICIAL_CLAVE_ARCHIVO",
    "SUPABASE_ADMIN_URL",
  ]) {
    base[k] = "";
  }
  return { ...base, ...extra };
}

// ---------------------------------------------------------------------------
// Migraciones
// ---------------------------------------------------------------------------

/**
 * Las migraciones de prisma/migrations en orden, con su checksum: el SHA-256
 * del contenido de migration.sql, byte a byte, que es lo que Prisma guarda en
 * _prisma_migrations.checksum (probar-local.mjs lo compara con lo que deja
 * `prisma migrate deploy`).
 */
export async function listarMigraciones() {
  const { readdirSync, statSync } = await import("node:fs");
  const dir = path.join(RAIZ, "prisma", "migrations");
  return readdirSync(dir)
    .filter((n) => statSync(path.join(dir, n)).isDirectory() && existsSync(path.join(dir, n, "migration.sql")))
    .sort()
    .map((nombre) => {
      const bytes = readFileSync(path.join(dir, nombre, "migration.sql"));
      return { nombre, sql: bytes.toString("utf8"), checksum: createHash("sha256").update(bytes).digest("hex") };
    });
}
