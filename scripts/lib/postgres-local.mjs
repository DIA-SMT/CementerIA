// PostgreSQL sin instalación, con los binarios que trae embedded-postgres.
//
// Lo usan `scripts/db-local.mjs` (la base de desarrollo) y el arnés de
// integración (`tests/integracion/global-setup.ts`). Se manejan initdb y pg_ctl
// directamente, sin la clase de embedded-postgres: esa clase deja el servidor
// atado al proceso de node y en Windows lo mata con `taskkill /f`, y acá
// necesitamos lo contrario, un servidor que siga vivo cuando el comando termina.

import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import pg from "pg";

/** Nombre del superusuario del clúster. Solo existe en desarrollo y en tests. */
export const SUPERUSUARIO = "postgres";

const PAQUETES = {
  "win32-x64": "@embedded-postgres/windows-x64",
  "linux-x64": "@embedded-postgres/linux-x64",
  "linux-arm64": "@embedded-postgres/linux-arm64",
  "darwin-x64": "@embedded-postgres/darwin-x64",
  "darwin-arm64": "@embedded-postgres/darwin-arm64",
};

/**
 * Rutas de initdb y pg_ctl para esta plataforma.
 * @returns {Promise<{ initdb: string, pg_ctl: string, postgres: string }>}
 */
export async function binarios() {
  const clave = `${process.platform}-${process.arch}`;
  const paquete = PAQUETES[clave];
  if (!paquete) {
    throw new Error(`embedded-postgres no trae binarios para ${clave}.`);
  }
  try {
    return await import(paquete);
  } catch {
    throw new Error(
      `Falta el paquete ${paquete} (lo instala embedded-postgres como dependencia opcional). Corré npm install.`,
    );
  }
}

/**
 * Corre un ejecutable y devuelve su código de salida.
 *
 * La salida va a un archivo y nunca a un pipe: pg_ctl le pasa sus handles al
 * postgres que lanza, y con un pipe node se quedaría esperando a que el
 * servidor termine para dar el comando por cerrado.
 * @param {string} ejecutable
 * @param {string[]} args
 * @param {{ salida: string, env?: NodeJS.ProcessEnv }} opciones
 * @returns {Promise<number>}
 */
function correr(ejecutable, args, { salida, env }) {
  const fd = openSync(salida, "a");
  return new Promise((resolve, reject) => {
    const hijo = spawn(ejecutable, args, {
      stdio: ["ignore", fd, fd],
      windowsHide: true,
      env: { ...process.env, LC_MESSAGES: "C", ...env },
    });
    hijo.on("error", (e) => {
      closeSync(fd);
      reject(e);
    });
    hijo.on("exit", (codigo) => {
      closeSync(fd);
      resolve(codigo ?? 1);
    });
  });
}

/** Las últimas líneas de un log, para mostrar el error sin abrir el archivo. */
export function colaDelLog(archivo, lineas = 25) {
  if (!existsSync(archivo)) return "(sin log)";
  return readFileSync(archivo, "utf8").trimEnd().split(/\r?\n/).slice(-lineas).join("\n");
}

/**
 * Crea un clúster nuevo en `datos`.
 * @param {{ datos: string, puerto: number, claveSuperusuario: string, log: string }} o
 */
export async function crearCluster({ datos, puerto, claveSuperusuario, log }) {
  const { initdb } = await binarios();
  await mkdir(path.dirname(datos), { recursive: true });
  // initdb lee la clave de un archivo; se borra apenas termina.
  const archivoClave = path.join(path.dirname(datos), `.clave-${process.pid}-${Date.now()}`);
  await writeFile(archivoClave, `${claveSuperusuario}\n`, { mode: 0o600 });
  try {
    const codigo = await correr(
      initdb,
      [
        `--pgdata=${datos}`,
        `--username=${SUPERUSUARIO}`,
        `--pwfile=${archivoClave}`,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        // Locale C: el mismo comportamiento en Windows, en Linux y en CI. Las
        // comparaciones sin acentos no dependen de esto, pasan por f_normalizar.
        "--locale=C",
        "--lc-messages=C",
      ],
      { salida: log },
    );
    if (codigo !== 0) {
      throw new Error(`initdb falló (código ${codigo}).\n${colaDelLog(log)}`);
    }
  } finally {
    await rm(archivoClave, { force: true });
  }

  // Configuración propia al final de postgresql.conf: la última línea gana.
  const conf = path.join(datos, "postgresql.conf");
  const extra = [
    "",
    "# --- CementerIA (desarrollo) ---",
    `port = ${puerto}`,
    "listen_addresses = 'localhost'",
    "max_connections = 50",
    "timezone = 'America/Argentina/Tucuman'",
    "log_timezone = 'America/Argentina/Tucuman'",
    // Lo mismo que se le pide a Sistemas: el DDL queda en el log.
    "log_statement = 'ddl'",
    "",
  ].join("\n");
  await writeFile(conf, (await readFile(conf, "utf8")) + extra);
}

/**
 * ¿Hay un servidor corriendo sobre `datos`?
 * @returns {Promise<boolean>}
 */
export async function estaCorriendo(datos, log) {
  if (!existsSync(path.join(datos, "PG_VERSION"))) return false;
  const { pg_ctl } = await binarios();
  return (await correr(pg_ctl, ["status", "-D", datos], { salida: log })) === 0;
}

/**
 * Arranca el servidor como proceso independiente: sigue vivo aunque node
 * termine. pg_ctl -w espera a que acepte conexiones.
 * @param {{ datos: string, puerto: number, log: string, logPgCtl: string }} o
 */
export async function arrancar({ datos, puerto, log, logPgCtl }) {
  const { pg_ctl } = await binarios();
  const codigo = await correr(
    pg_ctl,
    ["start", "-D", datos, "-l", log, "-w", "-t", "60", "-o", `-p ${puerto}`],
    { salida: logPgCtl },
  );
  if (codigo !== 0) {
    throw new Error(
      `No arrancó PostgreSQL (pg_ctl ${codigo}).\n--- ${log} ---\n${colaDelLog(log)}\n--- ${logPgCtl} ---\n${colaDelLog(logPgCtl, 8)}`,
    );
  }
}

/** Detiene el servidor (modo fast: corta las sesiones abiertas). */
export async function detener({ datos, logPgCtl }) {
  const { pg_ctl } = await binarios();
  const codigo = await correr(pg_ctl, ["stop", "-D", datos, "-m", "fast", "-w", "-t", "60"], {
    salida: logPgCtl,
  });
  if (codigo !== 0) {
    throw new Error(`pg_ctl stop falló (código ${codigo}).\n${colaDelLog(logPgCtl, 8)}`);
  }
}

/** Un puerto TCP libre en localhost, elegido por el sistema operativo. */
export function puertoLibre() {
  return new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.unref();
    servidor.on("error", reject);
    servidor.listen(0, "127.0.0.1", () => {
      const direccion = servidor.address();
      const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;
      servidor.close(() => resolve(puerto));
    });
  });
}

/** Un secreto aleatorio apto para URL (sin caracteres que haya que escapar). */
export async function claveAleatoria(bytes = 24) {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(bytes).toString("base64url");
}


// ---------------------------------------------------------------------------
// Ejecutor mínimo de scripts SQL con sintaxis de psql
// ---------------------------------------------------------------------------

/**
 * Parte un script en sentencias, respetando comillas, identificadores entre
 * comillas dobles, dollar-quoting y comentarios. Entiende `\connect <base>`
 * (o `\c`) y `\gexec`; ignora `\set`. Cualquier otro comando de psql es error,
 * para que no se pierda en silencio algo que psql sí ejecutaría.
 * @param {string} texto
 * @returns {Array<{ tipo: "sql", sql: string, gexec: boolean } | { tipo: "connect", base: string }>}
 */
export function partirScript(texto) {
  /** @type {Array<{ tipo: "sql", sql: string, gexec: boolean } | { tipo: "connect", base: string }>} */
  const items = [];
  let actual = "";
  let i = 0;
  const cerrar = (gexec) => {
    const sql = actual.trim();
    if (sql) items.push({ tipo: "sql", sql, gexec });
    actual = "";
  };
  while (i < texto.length) {
    const c = texto[i];
    const resto = texto.slice(i);
    if (c === "-" && texto[i + 1] === "-") {
      const fin = texto.indexOf("\n", i);
      i = fin === -1 ? texto.length : fin + 1;
      actual += "\n";
      continue;
    }
    if (c === "/" && texto[i + 1] === "*") {
      const fin = texto.indexOf("*/", i + 2);
      i = fin === -1 ? texto.length : fin + 2;
      actual += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < texto.length) {
        if (texto[j] === c) {
          if (texto[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      actual += texto.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(resto);
      if (m) {
        const etiqueta = m[0];
        const fin = texto.indexOf(etiqueta, i + etiqueta.length);
        if (fin === -1) throw new Error(`Dollar-quote ${etiqueta} sin cerrar.`);
        actual += texto.slice(i, fin + etiqueta.length);
        i = fin + etiqueta.length;
        continue;
      }
    }
    if (c === "\\") {
      const fin = texto.indexOf("\n", i);
      const linea = texto.slice(i, fin === -1 ? texto.length : fin).trim();
      i = fin === -1 ? texto.length : fin + 1;
      const [comando, ...args] = linea.split(/\s+/);
      if (comando === "\\gexec") {
        cerrar(true);
      } else if (comando === "\\connect" || comando === "\\c") {
        cerrar(false);
        if (!args[0]) throw new Error("\\connect sin base.");
        items.push({ tipo: "connect", base: args[0] });
      } else if (comando === "\\set") {
        // ON_ERROR_STOP: el ejecutor ya corta en el primer error.
      } else {
        throw new Error(`Comando de psql no soportado por el ejecutor: ${comando}`);
      }
      continue;
    }
    if (c === ";") {
      actual += ";";
      cerrar(false);
      i++;
      continue;
    }
    actual += c;
    i++;
  }
  cerrar(false);
  return items;
}

/**
 * Corre un script SQL con la sintaxis de `partirScript`, sentencia por
 * sentencia y en autocommit (CREATE DATABASE no admite transacción).
 * @param {string} archivo
 * @param {{ host?: string, puerto: number, usuario: string, clave: string, base?: string, parametros?: Record<string, string> }} conexion
 */
export async function correrScript(archivo, conexion) {
  const items = partirScript(await readFile(archivo, "utf8"));
  // Los parámetros viajan como opciones de inicio de sesión, igual que con
  // PGOPTIONS en psql, así sobreviven a cada \connect.
  const options = Object.entries(conexion.parametros ?? {})
    .map(([k, v]) => `-c ${k}=${v}`)
    .join(" ");
  const abrir = async (base) => {
    const cliente = new pg.Client({
      host: conexion.host ?? "localhost",
      port: conexion.puerto,
      user: conexion.usuario,
      password: conexion.clave,
      database: base,
      options: options || undefined,
    });
    await cliente.connect();
    return cliente;
  };
  let cliente = await abrir(conexion.base ?? "postgres");
  try {
    for (const item of items) {
      if (item.tipo === "connect") {
        await cliente.end();
        cliente = await abrir(item.base);
        continue;
      }
      const resultado = await cliente.query(item.sql);
      if (item.gexec) {
        for (const fila of resultado.rows) {
          for (const valor of Object.values(fila)) {
            if (valor != null) await cliente.query(String(valor));
          }
        }
      }
    }
  } finally {
    await cliente.end();
  }
}
