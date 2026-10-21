// Arnés de las pruebas de punta a punta (Playwright).
//
// Una vez por corrida, y sin tocar la base ni la configuración de desarrollo:
//
// 1. Levanta un PostgreSQL 15 efímero con migraciones (el mismo módulo que la
//    batería de integración, tests/integracion/base-efimera.ts) en
//    `%TEMP%/cementeria-e2e-XXXX` y un puerto libre.
// 2. Carga la semilla con los 30 expedientes ficticios y los escenarios
//    (`prisma/seed.ts`).
// 3. `next build` (salvo E2E_SIN_BUILD=1) y `next start` en otro puerto libre,
//    con NODE_ENV=test: así Next NO lee .env.local (Next solo lee .env.test*
//    y .env con NODE_ENV=test), el login simulado se puede habilitar sin
//    debilitar la regla de producción (entorno.ts la exige con
//    NODE_ENV=production, y con test no aplica) y el servidor usa el runtime
//    de producción de React (Next elige el de desarrollo solo con
//    NODE_ENV=development).
// 4. Espera a que /api/salud responda 200 y deja la URL en E2E_BASE_URL, que
//    los workers heredan (playwright.config.ts la usa como baseURL).
//
// Devuelve el teardown: detiene la app y PostgreSQL y borra el directorio.
//
// Por qué no el `webServer` de Playwright: Playwright lo arranca ANTES del
// globalSetup (no habría base todavía) y en Windows lo termina con
// `taskkill /T /F`, sin apagado ordenado. El PostgreSQL efímero quedaría
// huérfano y su carpeta sin borrar. Acá el ciclo completo está en un solo lugar.

import type { FullConfig } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { puertoLibre } from "../../scripts/lib/postgres-local.mjs";
import { ADMIN_CUIL_DESARROLLO } from "../../prisma/semilla/usuarios";
import { levantarBaseEfimera } from "../integracion/base-efimera";

const ESPERA_ARRANQUE_MS = 120_000;

/** La raíz del repositorio: donde está playwright.config.ts (los módulos se cargan como CommonJS, sin import.meta). */
let RAIZ = process.cwd();

/**
 * Variables que la app lee y que pueden venir del entorno de quien corre las
 * pruebas: se sacan para que la app use solo las de acá (y nunca la base de
 * desarrollo ni la configuración de staging).
 */
const VARIABLES_AJENAS = [
  "DATABASE_URL",
  "MIGRATE_DATABASE_URL",
  "SHADOW_DATABASE_URL",
  "DB_LOCAL_CLAVE_SUPERUSUARIO",
  "SESSION_SECRET",
  "APP_URL",
  "AUTH_DEV_LOGIN",
  "AUTH_DEV_LOGIN_STAGING",
  "ADMIN_INICIAL_CUIL",
  "CIDITUC_HABILITADO",
  "CIDITUC_DERIVADOR_URL",
  "CIDITUC_CLAVE",
  "CIDITUC_API_URL",
  "CIDITUC_CA_PEM",
  "ADJUNTOS_DIR",
  "NODE_ENV",
  "PORT",
  "HOSTNAME",
];

function entornoLimpio(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const v of VARIABLES_AJENAS) delete env[v];
  return { ...env, NEXT_TELEMETRY_DISABLED: "1", ...extra };
}

function cola(archivo: string, lineas = 40): string {
  if (!existsSync(archivo)) return "(sin log)";
  return readFileSync(archivo, "utf8").trimEnd().split(/\r?\n/).slice(-lineas).join("\n");
}

/** Corre un comando de node hasta que termina; la salida va a `log` y, si falla, al error. */
function correr(nombre: string, args: string[], env: NodeJS.ProcessEnv, log: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const salida = createWriteStream(log, { flags: "a" });
    const hijo = spawn(process.execPath, args, { cwd: RAIZ, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    hijo.stdout.pipe(salida, { end: false });
    hijo.stderr.pipe(salida, { end: false });
    hijo.on("error", (e) => {
      salida.end();
      reject(e);
    });
    hijo.on("close", (codigo) => {
      salida.end(() => (codigo === 0 ? resolve() : reject(new Error(`${nombre} falló (código ${codigo}):\n${cola(log)}`))));
    });
  });
}

/** Termina la app y todo lo que haya lanzado. En Windows, el árbol entero. */
async function terminar(hijo: ChildProcess): Promise<void> {
  if (hijo.exitCode !== null || hijo.signalCode !== null || hijo.pid === undefined) return;
  const salio = new Promise<void>((resolve) => hijo.once("exit", () => resolve()));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    // Se lanzó con `detached`: el grupo de procesos entero.
    try {
      process.kill(-hijo.pid, "SIGTERM");
    } catch {
      hijo.kill("SIGTERM");
    }
  }
  await Promise.race([salio, new Promise((r) => setTimeout(r, 10_000))]);
}

/** Espera a que /api/salud responda 200 (la app arrancó y llega a la base). */
async function esperarSalud(url: string, hijo: ChildProcess, log: string): Promise<void> {
  const limite = Date.now() + ESPERA_ARRANQUE_MS;
  while (Date.now() < limite) {
    if (hijo.exitCode !== null) throw new Error(`next start terminó con código ${hijo.exitCode}:\n${cola(log)}`);
    try {
      const r = await fetch(`${url}/api/salud`, { signal: AbortSignal.timeout(5_000) });
      if (r.status === 200) return;
    } catch {
      // Todavía no escucha.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`La app no respondió en ${url}/api/salud en ${ESPERA_ARRANQUE_MS / 1000} s:\n${cola(log)}`);
}

export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  const inicio = Date.now();
  if (config.configFile) RAIZ = path.dirname(config.configFile);
  const { base, dir, limpiar } = await levantarBaseEfimera("cementeria-e2e-", RAIZ);
  let app: ChildProcess | null = null;
  const teardown = async (): Promise<void> => {
    if (app) await terminar(app);
    app = null;
    await limpiar();
  };

  try {
    const logSemilla = path.join(dir, "semilla.log");
    const logBuild = path.join(dir, "build.log");
    const logApp = path.join(dir, "app.log");
    const adjuntos = path.join(dir, "adjuntos");
    await mkdir(adjuntos, { recursive: true });

    // La semilla, con el rol de la app y el admin ficticio de desarrollo. prisma/seed.ts
    // carga .env.local con dotenv, que no pisa lo que ya está definido acá. Los
    // adjuntos de los escenarios, en la carpeta de la app (no en ./.data).
    await correr(
      "La semilla",
      [path.join(RAIZ, "node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "seed.ts")],
      entornoLimpio({ DATABASE_URL: base.urlApp, ADMIN_INICIAL_CUIL: ADMIN_CUIL_DESARROLLO, NODE_ENV: "development", ADJUNTOS_DIR: adjuntos }),
      logSemilla,
    );

    const next = path.join(RAIZ, "node_modules", "next", "dist", "bin", "next");
    if (process.env.E2E_SIN_BUILD === "1" && existsSync(path.join(RAIZ, ".next", "BUILD_ID"))) {
      console.log("[e2e] E2E_SIN_BUILD=1: se usa el build que ya está en .next");
    } else {
      // El build no necesita base ni secretos (entorno.ts lee perezoso).
      await correr("next build", [next, "build"], entornoLimpio({}), logBuild);
    }

    const puerto = await puertoLibre();
    const url = `http://127.0.0.1:${puerto}`;
    const salidaApp = createWriteStream(logApp, { flags: "a" });
    app = spawn(process.execPath, [next, "start", "--port", String(puerto), "--hostname", "127.0.0.1"], {
      cwd: RAIZ,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: entornoLimpio({
        NODE_ENV: "test",
        // La hora del servidor, como en producción (deploy/systemd/cementeria.service).
        TZ: "America/Argentina/Tucuman",
        DATABASE_URL: base.urlApp,
        SESSION_SECRET: randomBytes(48).toString("base64url"),
        AUTH_DEV_LOGIN: "1",
        CIDITUC_HABILITADO: "0",
        ADJUNTOS_DIR: adjuntos,
      }),
    });
    app.stdout?.pipe(salidaApp);
    app.stderr?.pipe(salidaApp);
    await esperarSalud(url, app, logApp);

    process.env.E2E_BASE_URL = url;
    console.log(`[e2e] App en ${url} con base efímera en el puerto ${base.puerto} (${Math.round((Date.now() - inicio) / 1000)} s)`);
  } catch (e) {
    await teardown().catch(() => undefined);
    throw e;
  }
  return teardown;
}
