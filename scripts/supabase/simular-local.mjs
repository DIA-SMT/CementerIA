#!/usr/bin/env node
// Simulador local de una base de Supabase, para probar preparar.mjs y los
// archivos de supabase/sql/ sin tocar el proyecto real.
//
//   node scripts/supabase/simular-local.mjs iniciar --dir <carpeta> [--env-salida <archivo>]
//        [--sin-tls] [--extensiones-en-extensions] [--puerto <n>]
//   node scripts/supabase/simular-local.mjs detener --dir <carpeta> [--borrar]
//
// Es un clúster aparte de embedded-postgres (PostgreSQL 15), en su propia
// carpeta y en un puerto libre: no toca la base de desarrollo (54329). Imita lo
// que importa de Supabase:
//   * el superusuario se llama supabase_admin y nadie más lo usa;
//   * `postgres` NO es superusuario: LOGIN, CREATEROLE, CREATEDB, REPLICATION
//     y BYPASSRLS, y es el dueño de la base `postgres` (la única que se usa);
//   * los roles de la Data API: anon, authenticated y service_role (NOLOGIN),
//     y authenticator, que entra y los toma; postgres es miembro de los tres;
//   * el esquema `extensions` con uuid-ossp y pgcrypto, y el search_path de
//     postgres con él;
//   * USAGE sobre public para los roles de la API y los privilegios por defecto
//     que Supabase les da sobre lo que crean postgres y supabase_admin en public;
//   * el esquema storage (storage.buckets y storage.objects con RLS, de
//     supabase_storage_admin, con privilegios por defecto para postgres): lo
//     justo para aplicar y verificar 45_storage.sql;
//   * la base en UTC;
//   * TLS obligatorio (hostssl) con un certificado de servidor firmado por una
//     CA propia, generada para la prueba con openssl (el equivalente a
//     prod-ca-2021.crt); con --sin-tls, sin TLS.
// Con --extensiones-en-extensions, unaccent y pg_trgm ya habilitadas en el
// esquema extensions (como si alguien las hubiera prendido desde el panel):
// sirve para probar que preparar.mjs las mueve a public.
//
// Lo que NO imita: Supavisor (el pooler: usuarios rol.<ref>, modo transacción),
// supautils, la versión (Supabase usa 15 o 17; acá 15) ni los servicios (la API
// de Storage la imitan los tests con un servidor falso: tests/stubs/storage-falso.ts).
//
// --env-salida escribe un .env con SUPABASE_ADMIN_URL, ADMIN_INICIAL_CUIL
// (ficticio) y DATABASE_CA_FILE, listo para `preparar.mjs --env <archivo>`.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, copyFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { arrancar, claveAleatoria, crearCluster, detener, estaCorriendo, puertoLibre } from "../lib/postgres-local.mjs";
import { verificadorScram } from "./lib.mjs";

export const SUPERUSUARIO_SUPABASE = "supabase_admin";

/** CUIL ficticio del admin inicial en el simulador (DNI 00000000, dígito correcto). */
export const ADMIN_CUIL_SIMULADOR = "20000000001";

const PUERTOS_PROHIBIDOS = new Set([54329, 3000, 3001]);

// ---------------------------------------------------------------------------
// Certificados de prueba
// ---------------------------------------------------------------------------

/** openssl: el del PATH o el que trae Git para Windows. */
export function buscarOpenssl() {
  const candidatos = ["openssl"];
  if (process.platform === "win32") {
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files"]) {
      if (!base) continue;
      candidatos.push(path.join(base, "Git", "mingw64", "bin", "openssl.exe"), path.join(base, "Git", "usr", "bin", "openssl.exe"));
    }
  }
  for (const c of candidatos) {
    try {
      execFileSync(c, ["version"], { stdio: "ignore", windowsHide: true });
      return c;
    } catch {
      // siguiente
    }
  }
  return null;
}

/**
 * Una CA y un certificado de servidor para `localhost` firmado por ella, como
 * los de Supabase (CA propia, que no está en el almacén del sistema).
 * @returns {{ ca: string, caClave: string, servidor: string, servidorClave: string }} rutas
 */
export function generarCertificados(dir, { openssl = buscarOpenssl(), nombre = "Simulador Supabase Root CA (prueba)", host = "localhost" } = {}) {
  if (!openssl) throw new Error("No encontré openssl (viene con Git para Windows). Probá con --sin-tls.");
  mkdirSync(dir, { recursive: true });
  const r = (n) => path.join(dir, n);
  const correr = (args) => execFileSync(openssl, args, { stdio: "pipe", windowsHide: true });
  correr([
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3",
    "-keyout", r("ca.key"), "-out", r("ca.crt"), "-subj", `/CN=${nombre}`,
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  correr(["req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", r("server.key"), "-out", r("server.csr"), "-subj", `/CN=${host}`]);
  writeFileSync(
    r("server.ext"),
    `basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${host}\n`,
  );
  correr([
    "x509", "-req", "-in", r("server.csr"), "-CA", r("ca.crt"), "-CAkey", r("ca.key"), "-CAcreateserial",
    "-out", r("server.crt"), "-days", "3", "-sha256", "-extfile", r("server.ext"),
  ]);
  return { ca: r("ca.crt"), caClave: r("ca.key"), servidor: r("server.crt"), servidorClave: r("server.key") };
}

// ---------------------------------------------------------------------------
// Lo que Supabase trae de fábrica
// ---------------------------------------------------------------------------

function sqlDeFabrica(verificadorPostgres) {
  return `
    CREATE ROLE postgres LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS PASSWORD '${verificadorPostgres}';
    ALTER DATABASE postgres OWNER TO postgres;
    ALTER DATABASE postgres SET timezone TO 'UTC';

    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    CREATE ROLE authenticator LOGIN NOINHERIT;
    GRANT anon, authenticated, service_role TO authenticator;
    GRANT anon, authenticated, service_role TO postgres;

    CREATE SCHEMA extensions AUTHORIZATION postgres;
    GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    ALTER ROLE postgres SET search_path = "$user", public, extensions;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON SCHEMA public TO postgres;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

    -- Storage, lo que importa para 45_storage.sql: el esquema storage de
    -- supabase_admin con privilegios por defecto para postgres y los roles de la
    -- API, storage.buckets y storage.objects con RLS y sin políticas, de
    -- supabase_storage_admin (como las migraciones de supabase/storage y
    -- supabase/postgres). Las columnas, las de buckets que usa la app.
    CREATE ROLE supabase_storage_admin LOGIN NOINHERIT;
    CREATE SCHEMA storage AUTHORIZATION supabase_admin;
    GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      owner uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      public boolean DEFAULT false,
      avif_autodetection boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[],
      owner_id text
    );
    CREATE UNIQUE INDEX bname ON storage.buckets (name);
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets (id),
      name text,
      owner uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      last_accessed_at timestamptz DEFAULT now(),
      metadata jsonb,
      version text,
      owner_id text
    );
    CREATE UNIQUE INDEX bucketid_objname ON storage.objects (bucket_id, name);
    ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT ALL PRIVILEGES ON SCHEMA storage TO supabase_storage_admin;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin;
    ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
    ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
  `;
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

function rutas(dir) {
  return {
    datos: path.join(dir, "pgdata"),
    log: path.join(dir, "postgres.log"),
    logPgCtl: path.join(dir, "pg_ctl.log"),
    certs: path.join(dir, "certs"),
    estado: path.join(dir, "simulador.json"),
  };
}

async function elegirPuerto(pedido) {
  if (pedido) {
    if (PUERTOS_PROHIBIDOS.has(pedido)) throw new Error(`El puerto ${pedido} está reservado (base de desarrollo o la app).`);
    return pedido;
  }
  for (;;) {
    const p = await puertoLibre();
    if (!PUERTOS_PROHIBIDOS.has(p)) return p;
  }
}

/**
 * Crea y arranca un simulador nuevo.
 * @param {{ dir?: string, puerto?: number, tls?: boolean, extensionesEnExtensions?: boolean }} o
 */
export async function levantarSimulador({ dir, puerto, tls = true, extensionesEnExtensions = false } = {}) {
  const propio = !dir;
  dir ??= await mkdtemp(path.join(os.tmpdir(), "cementeria-supa-"));
  const r = rutas(dir);
  if (existsSync(path.join(r.datos, "PG_VERSION"))) throw new Error(`Ya hay un simulador en ${dir}. Detenelo con --borrar antes.`);
  mkdirSync(dir, { recursive: true });
  const claveSuper = await claveAleatoria();
  const claveAdmin = await claveAleatoria();
  let corriendo = false;

  const detenerSimulador = async () => {
    if (corriendo) {
      await detener({ datos: r.datos, logPgCtl: r.logPgCtl });
      corriendo = false;
    }
  };
  const limpiar = async () => {
    await detenerSimulador();
    if (propio || existsSync(r.estado)) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };

  try {
    const p = await elegirPuerto(puerto);
    await crearCluster({ datos: r.datos, puerto: p, claveSuperusuario: claveSuper, log: r.logPgCtl, superusuario: SUPERUSUARIO_SUPABASE });

    let certs = null;
    const conf = [
      "",
      "# --- Simulador de Supabase (scripts/supabase/simular-local.mjs) ---",
      "timezone = 'UTC'",
      "log_timezone = 'UTC'",
      "log_statement = 'ddl'",
    ];
    if (tls) {
      certs = generarCertificados(r.certs);
      copyFileSync(certs.servidor, path.join(r.datos, "server.crt"));
      copyFileSync(certs.servidorClave, path.join(r.datos, "server.key"));
      if (process.platform !== "win32") chmodSync(path.join(r.datos, "server.key"), 0o600);
      conf.push("ssl = on", "ssl_cert_file = 'server.crt'", "ssl_key_file = 'server.key'");
      // Como Supabase con "Enforce SSL": por TCP solo con TLS.
      const hba = path.join(r.datos, "pg_hba.conf");
      writeFileSync(hba, readFileSync(hba, "utf8").replace(/^host(\s)/gm, "hostssl$1"));
    }
    const archivoConf = path.join(r.datos, "postgresql.conf");
    writeFileSync(archivoConf, readFileSync(archivoConf, "utf8") + conf.join("\n") + "\n");

    await arrancar({ datos: r.datos, puerto: p, log: r.log, logPgCtl: r.logPgCtl });
    corriendo = true;

    const ssl = certs ? { ca: readFileSync(certs.ca, "utf8"), rejectUnauthorized: true } : undefined;
    const c = new pg.Client({ host: "localhost", port: p, user: SUPERUSUARIO_SUPABASE, password: claveSuper, database: "postgres", ssl });
    await c.connect();
    try {
      await c.query(sqlDeFabrica(verificadorScram(claveAdmin)));
    } finally {
      await c.end();
    }
    if (extensionesEnExtensions) {
      const a = new pg.Client({ host: "localhost", port: p, user: "postgres", password: claveAdmin, database: "postgres", ssl });
      await a.connect();
      try {
        await a.query("CREATE EXTENSION unaccent WITH SCHEMA extensions; CREATE EXTENSION pg_trgm WITH SCHEMA extensions;");
      } finally {
        await a.end();
      }
    }

    const sim = {
      dir,
      puerto: p,
      urlAdmin: `postgresql://postgres:${encodeURIComponent(claveAdmin)}@localhost:${p}/postgres`,
      urlSuperusuario: `postgresql://${SUPERUSUARIO_SUPABASE}:${encodeURIComponent(claveSuper)}@localhost:${p}/postgres`,
      ca: certs ? certs.ca : null,
      secretos: [claveAdmin, claveSuper],
    };
    // Para `detener` desde otra invocación (sin claves: no hacen falta para pg_ctl).
    writeFileSync(r.estado, JSON.stringify({ puerto: p, tls }, null, 2));
    return { ...sim, detener: detenerSimulador, limpiar };
  } catch (e) {
    await limpiar().catch(() => undefined);
    throw e;
  }
}

/** Escribe el .env que espera preparar.mjs para este simulador. */
export function escribirEnvSimulador(archivo, sim, { adminCuil = ADMIN_CUIL_SIMULADOR } = {}) {
  const lineas = [
    "# Simulador local de Supabase (scripts/supabase/simular-local.mjs). Efímero, valores de prueba.",
    `SUPABASE_ADMIN_URL=${sim.urlAdmin}`,
    `ADMIN_INICIAL_CUIL=${adminCuil}`,
  ];
  if (sim.ca) lineas.push(`DATABASE_CA_FILE=${sim.ca.replaceAll("\\", "/")}`);
  writeFileSync(archivo, lineas.join("\n") + "\n", { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Línea de comandos
// ---------------------------------------------------------------------------

function argumentos(argv) {
  const o = { flags: new Set(), valores: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--dir", "--env-salida", "--puerto"].includes(a)) o.valores[a.slice(2)] = argv[++i];
    else o.flags.add(a.replace(/^--/, ""));
  }
  return o;
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  const a = argumentos(resto);
  if (!a.valores.dir) throw new Error("Falta --dir <carpeta>.");
  const dir = path.resolve(a.valores.dir);
  if (comando === "iniciar") {
    const sim = await levantarSimulador({
      dir,
      puerto: a.valores.puerto ? Number(a.valores.puerto) : undefined,
      tls: !a.flags.has("sin-tls"),
      extensionesEnExtensions: a.flags.has("extensiones-en-extensions"),
    });
    if (a.valores["env-salida"]) escribirEnvSimulador(path.resolve(a.valores["env-salida"]), sim);
    console.log(`Simulador de Supabase corriendo en localhost:${sim.puerto} (${sim.ca ? "TLS con CA de prueba" : "sin TLS"}).`);
    console.log(`Carpeta: ${dir}`);
    if (a.valores["env-salida"]) console.log(`Entorno para preparar.mjs: ${a.valores["env-salida"]}`);
    console.log(`Para terminar: node scripts/supabase/simular-local.mjs detener --dir "${dir}" --borrar`);
  } else if (comando === "detener") {
    const r = rutas(dir);
    if (await estaCorriendo(r.datos, r.logPgCtl)) await detener({ datos: r.datos, logPgCtl: r.logPgCtl });
    if (a.flags.has("borrar")) {
      if (!existsSync(r.estado)) throw new Error(`${dir} no parece un simulador (falta simulador.json): no se borra.`);
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      console.log(`Simulador detenido y borrado (${dir}).`);
    } else {
      console.log("Simulador detenido.");
    }
  } else {
    throw new Error("Uso: simular-local.mjs <iniciar|detener> --dir <carpeta> [opciones]");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
