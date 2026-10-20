#!/usr/bin/env node
// Base de desarrollo sin instalar nada: PostgreSQL 15 de embedded-postgres.
//
//   node scripts/db-local.mjs iniciar          crea el clúster la primera vez y lo arranca
//   node scripts/db-local.mjs detener          lo detiene
//   node scripts/db-local.mjs estado           dice si corre y qué bases tiene
//   node scripts/db-local.mjs recrear-base     borra y recrea la base `cementeria` (db:reset)
//   node scripts/db-local.mjs reiniciar-datos  BORRA el clúster entero y lo crea de nuevo
//
// Reemplaza al PostgreSQL nativo o WSL2 de la sección 6 de la propuesta: en las
// máquinas del equipo no hay instalador ni Docker. Los datos quedan en
// .local/pgdata y el log en .local/postgres.log; el servidor sigue corriendo
// cuando el comando termina, como un servicio, hasta que se lo detiene.

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as cargarEnv } from "dotenv";
import pg from "pg";
import {
  SUPERUSUARIO,
  arrancar,
  correrScript,
  crearCluster,
  detener,
  estaCorriendo,
} from "./lib/postgres-local.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_LOCAL = path.join(RAIZ, ".local");
const DATOS = path.join(DIR_LOCAL, "pgdata");
const LOG = path.join(DIR_LOCAL, "postgres.log");
const LOG_PG_CTL = path.join(DIR_LOCAL, "pg_ctl.log");
const INIT_SQL = path.join(RAIZ, "scripts", "db-init.sql");

cargarEnv({ path: path.join(RAIZ, ".env.local"), quiet: true });

/**
 * Las claves de los roles salen de las mismas URLs que usan la app y Prisma,
 * para que no haya dos lugares donde cambiarlas.
 */
function configuracion() {
  const faltan = ["DATABASE_URL", "MIGRATE_DATABASE_URL", "DB_LOCAL_CLAVE_SUPERUSUARIO"].filter(
    (v) => !process.env[v],
  );
  if (faltan.length) {
    throw new Error(
      `Faltan en .env.local: ${faltan.join(", ")}.\nCopiá .env.example a .env.local y completalo.`,
    );
  }
  const app = new URL(String(process.env.DATABASE_URL));
  const deploy = new URL(String(process.env.MIGRATE_DATABASE_URL));
  if (!["localhost", "127.0.0.1"].includes(app.hostname)) {
    throw new Error(
      `DATABASE_URL apunta a ${app.hostname}: db-local solo maneja la base local. No se toca nada.`,
    );
  }
  const puerto = Number(app.port || 54329);
  return {
    puerto,
    claveSuperusuario: String(process.env.DB_LOCAL_CLAVE_SUPERUSUARIO),
    claveApp: decodeURIComponent(app.password),
    claveDeploy: decodeURIComponent(deploy.password),
  };
}

async function correrInit(cfg) {
  await correrScript(INIT_SQL, {
    puerto: cfg.puerto,
    usuario: SUPERUSUARIO,
    clave: cfg.claveSuperusuario,
    parametros: {
      "cementeria.clave_app": cfg.claveApp,
      "cementeria.clave_deploy": cfg.claveDeploy,
    },
  });
}

async function iniciar() {
  const cfg = configuracion();
  const nuevo = !existsSync(path.join(DATOS, "PG_VERSION"));
  if (nuevo) {
    console.log(`Creando el clúster en ${path.relative(RAIZ, DATOS)}…`);
    await crearCluster({ datos: DATOS, puerto: cfg.puerto, claveSuperusuario: cfg.claveSuperusuario, log: LOG_PG_CTL });
  }
  if (await estaCorriendo(DATOS, LOG_PG_CTL)) {
    console.log(`PostgreSQL ya estaba corriendo en localhost:${cfg.puerto}.`);
  } else {
    await arrancar({ datos: DATOS, puerto: cfg.puerto, log: LOG, logPgCtl: LOG_PG_CTL });
    console.log(`PostgreSQL arrancó en localhost:${cfg.puerto} (log: ${path.relative(RAIZ, LOG)}).`);
  }
  // db-init.sql es idempotente y se corre siempre, no solo la primera vez: así
  // un cambio de clave en .env.local llega a la base con solo volver a iniciar.
  await correrInit(cfg);
  if (nuevo) {
    console.log("Roles, bases y extensiones creados. Siguiente paso: npm run db:deploy (o db:reset).");
  }
}

async function detenerServidor() {
  if (!(await estaCorriendo(DATOS, LOG_PG_CTL))) {
    console.log("PostgreSQL local no estaba corriendo.");
    return;
  }
  await detener({ datos: DATOS, logPgCtl: LOG_PG_CTL });
  console.log("PostgreSQL local detenido.");
}

async function estado() {
  if (!existsSync(path.join(DATOS, "PG_VERSION"))) {
    console.log("Sin clúster local. Crealo con: npm run db:local");
    return;
  }
  if (!(await estaCorriendo(DATOS, LOG_PG_CTL))) {
    console.log(`Clúster en ${path.relative(RAIZ, DATOS)}, DETENIDO. Arrancalo con: npm run db:local`);
    return;
  }
  const cfg = configuracion();
  const cliente = new pg.Client({
    host: "localhost",
    port: cfg.puerto,
    user: SUPERUSUARIO,
    password: cfg.claveSuperusuario,
    database: "postgres",
  });
  await cliente.connect();
  try {
    const version = (await cliente.query("SHOW server_version")).rows[0].server_version;
    const bases = (
      await cliente.query("SELECT datname FROM pg_database WHERE datname LIKE 'cementeria%' ORDER BY 1")
    ).rows.map((f) => f.datname);
    console.log(`PostgreSQL ${version} CORRIENDO en localhost:${cfg.puerto}.`);
    console.log(`Bases: ${bases.join(", ") || "(ninguna)"}`);
  } finally {
    await cliente.end();
  }
}

/** Borra y recrea la base `cementeria`. Las migraciones y la semilla van aparte. */
async function recrearBase() {
  await iniciar();
  const cfg = configuracion();
  const cliente = new pg.Client({
    host: "localhost",
    port: cfg.puerto,
    user: SUPERUSUARIO,
    password: cfg.claveSuperusuario,
    database: "postgres",
  });
  await cliente.connect();
  try {
    // FORCE corta las conexiones abiertas (un `next dev` olvidado, Prisma Studio).
    await cliente.query("DROP DATABASE IF EXISTS cementeria WITH (FORCE)");
  } finally {
    await cliente.end();
  }
  await correrInit(cfg);
  console.log("Base cementeria recreada, vacía y sin migraciones.");
}

async function reiniciarDatos() {
  if (await estaCorriendo(DATOS, LOG_PG_CTL)) {
    await detener({ datos: DATOS, logPgCtl: LOG_PG_CTL });
  }
  await rm(DATOS, { recursive: true, force: true });
  console.log(`Clúster borrado (${path.relative(RAIZ, DATOS)}).`);
  await iniciar();
}

const COMANDOS = {
  iniciar,
  detener: detenerServidor,
  estado,
  "recrear-base": recrearBase,
  "reiniciar-datos": reiniciarDatos,
};

const comando = process.argv[2] ?? "";
const accion = COMANDOS[comando];
if (!accion) {
  console.error(`Uso: node scripts/db-local.mjs <${Object.keys(COMANDOS).join("|")}>`);
  process.exit(2);
}
try {
  await accion();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
