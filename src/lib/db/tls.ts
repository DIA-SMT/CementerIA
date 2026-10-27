import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * TLS con CA explícita para la base (Supabase, docs/despliegue.md, "Base en
 * Supabase").
 *
 * Supabase firma los certificados de la base y del pooler con su propia CA
 * ("Supabase Root 2021 CA", el prod-ca-2021.crt que se baja del panel en
 * Settings → Database → SSL Configuration), que no está en el almacén de Node.
 * Con `ssl: true` la conexión falla con SELF_SIGNED_CERT_IN_CHAIN, y la salida
 * fácil (rejectUnauthorized: false, sslmode=no-verify) cifra pero no sabe con
 * quién habla: está prohibida. Acá se le da la CA a quien se conecta, igual
 * que con el intermedio de Cidituc (CIDITUC_CA_PEM), y se verifican la cadena
 * y el nombre del host.
 *
 * Variables (la primera que esté gana):
 *   DATABASE_CA_PEM   el contenido PEM del certificado
 *   DATABASE_CA_FILE  la ruta del archivo PEM (relativa al directorio de trabajo)
 * Sin ninguna, la conexión queda como antes (la base local no tiene TLS).
 */

/** Parámetros de TLS de la URL que se reemplazan por la configuración explícita. */
const PARAMETROS_TLS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "sslaccept", "sslidentity"];

/** Hosts que exigen la CA: sin ella la conexión fallaría o no verificaría al servidor. */
const HOST_SUPABASE = /(^|\.)supabase\.(co|com)$/i;

type Entorno = Readonly<Record<string, string | undefined>>;

export interface CaDeBase {
  pem: string;
  /** De dónde salió, para los mensajes (nunca es secreto: el certificado es público). */
  origen: "DATABASE_CA_PEM" | "DATABASE_CA_FILE";
  /** La ruta absoluta, si vino de DATABASE_CA_FILE. */
  archivo?: string;
}

/**
 * La CA configurada, o null si no hay ninguna.
 * @throws si DATABASE_CA_FILE apunta a un archivo que no existe o lo que hay no es un PEM.
 */
export function leerCaDeBase(entorno: Entorno = process.env, cwd: string = process.cwd()): CaDeBase | null {
  const pem = entorno.DATABASE_CA_PEM?.trim();
  if (pem) {
    exigirPem(pem, "DATABASE_CA_PEM");
    return { pem: `${pem}\n`, origen: "DATABASE_CA_PEM" };
  }
  const ruta = entorno.DATABASE_CA_FILE?.trim();
  if (!ruta) return null;
  const archivo = path.resolve(cwd, ruta);
  // turbopackIgnore: la ruta es de configuración (en el servidor,
  // /etc/cementeria/…; en Vercel no se usa: va DATABASE_CA_PEM). Sin el
  // comentario, Turbopack rastrea el proyecto ENTERO hacia el paquete de cada
  // función (aviso "Dynamic filesystem access causes tracing of the whole
  // project"), lo que en Vercel arriesga el límite de tamaño.
  if (!existsSync(/*turbopackIgnore: true*/ archivo)) {
    throw new Error(
      `DATABASE_CA_FILE apunta a ${archivo}, que no existe. Es el certificado raíz de Supabase ` +
        "(Settings → Database → SSL Configuration → Download certificate); ver docs/despliegue.md, \"Base en Supabase\".",
    );
  }
  const contenido = readFileSync(/*turbopackIgnore: true*/ archivo, "utf8");
  exigirPem(contenido, `DATABASE_CA_FILE (${archivo})`);
  return { pem: contenido, origen: "DATABASE_CA_FILE", archivo };
}

function exigirPem(texto: string, origen: string): void {
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(texto)) {
    throw new Error(`${origen} no tiene un certificado PEM (-----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----).`);
  }
}

/** La URL sin los parámetros de TLS: con CA explícita, la configuración va aparte. */
export function sinParametrosTls(url: string): string {
  const u = new URL(url);
  for (const p of PARAMETROS_TLS) u.searchParams.delete(p);
  return u.toString();
}

export interface ConexionPg {
  connectionString: string;
  /**
   * Para `pg`: la CA y nada más. `rejectUnauthorized` queda en true (el
   * default) y `pg` le pasa a TLS el host como `servername`, así que Node
   * verifica la cadena y que el certificado sea de ese host.
   */
  ssl?: { ca: string; rejectUnauthorized: true };
}

/**
 * Cómo conectarse con `pg` (o @prisma/adapter-pg) a `url`.
 *
 * Con CA: se sacan los parámetros ssl* de la URL, porque `pg` los aplica POR
 * ENCIMA de la configuración (y `sslmode=require` con sslrootcert verifica la
 * cadena pero no el host), y se pasa `ssl` explícito.
 *
 * @throws si el host es de Supabase y no hay CA: mejor un error claro que un
 *   SELF_SIGNED_CERT_IN_CHAIN o una conexión sin verificar.
 */
export function conexionPg(url: string, entorno: Entorno = process.env, cwd: string = process.cwd()): ConexionPg {
  const ca = leerCaDeBase(entorno, cwd);
  if (!ca) {
    if (HOST_SUPABASE.test(hostDe(url))) {
      throw new Error(
        "La base es de Supabase y falta su certificado raíz: definí DATABASE_CA_FILE (por ejemplo " +
          "certs/supabase-prod-ca-2021.crt) o DATABASE_CA_PEM. Se baja del panel en Settings → Database → " +
          "SSL Configuration. Ver docs/despliegue.md, \"Base en Supabase\".",
      );
    }
    return { connectionString: url };
  }
  return { connectionString: sinParametrosTls(url), ssl: { ca: ca.pem, rejectUnauthorized: true } };
}

/**
 * La URL para la CLI de Prisma (`migrate deploy`, `migrate status`).
 *
 * La CLI no usa `pg`: se conecta con el motor de migraciones (schema-engine),
 * que lee el TLS de la URL. Con CA se le pone `sslmode=require` (TLS
 * obligatorio), `sslcert=<ruta de la CA>` (el certificado raíz con el que
 * verifica) y `sslaccept=strict` (verifica la cadena y el host; el default,
 * accept_invalid_certs, no verifica nada). Si la CA vino como PEM, se escribe
 * en un archivo temporal: el motor necesita una ruta. Probado contra el
 * simulador de Supabase con TLS (scripts/supabase/probar-local.mjs): con otra
 * CA o con otro nombre de host, la CLI no se conecta.
 */
export function urlParaPrisma(url: string, entorno: Entorno = process.env, cwd: string = process.cwd()): string {
  const ca = leerCaDeBase(entorno, cwd);
  if (!ca) return url;
  const archivo = ca.archivo ?? archivoTemporal(ca.pem);
  const u = new URL(sinParametrosTls(url));
  u.searchParams.set("sslmode", "require");
  u.searchParams.set("sslcert", archivo.replaceAll("\\", "/"));
  u.searchParams.set("sslaccept", "strict");
  return u.toString();
}

function archivoTemporal(pem: string): string {
  const huella = createHash("sha256").update(pem).digest("hex").slice(0, 16);
  const archivo = path.join(os.tmpdir(), `cementeria-ca-${huella}.crt`);
  if (!existsSync(archivo)) writeFileSync(archivo, pem, { mode: 0o644 });
  return archivo;
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
