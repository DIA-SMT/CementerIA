// Levanta un PostgreSQL 15 efímero para la corrida de integración.
//
// Cada corrida usa su propio directorio temporal y un puerto que elige el
// sistema operativo, así que dos corridas simultáneas (dos terminales, CI con
// varios jobs) no chocan entre sí ni tocan la base local de desarrollo. Al
// terminar se detiene el servidor y se borra el directorio.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import {
  SUPERUSUARIO,
  arrancar,
  claveAleatoria,
  colaDelLog,
  correrScript,
  crearCluster,
  detener,
  puertoLibre,
} from "../../scripts/lib/postgres-local.mjs";
import type { BaseIntegracion } from "./contexto";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INTENTOS_DE_PUERTO = 4;

function url(usuario: string, clave: string, puerto: number, base = "cementeria"): string {
  return `postgresql://${usuario}:${encodeURIComponent(clave)}@localhost:${puerto}/${base}`;
}

/** `prisma migrate deploy` contra la base efímera, como lo haría un despliegue. */
function migrar(urlDeploy: string, urlShadow: string): Promise<void> {
  const cli = path.join(RAIZ, "node_modules", "prisma", "build", "index.js");
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [cli, "migrate", "deploy"], {
      cwd: RAIZ,
      windowsHide: true,
      // Las URLs van por entorno: prisma.config.ts carga .env.local con dotenv,
      // que no pisa lo ya definido, así que nunca se apunta a la base local.
      env: { ...process.env, MIGRATE_DATABASE_URL: urlDeploy, SHADOW_DATABASE_URL: urlShadow },
    });
    let salida = "";
    hijo.stdout.on("data", (d: Buffer) => (salida += d.toString()));
    hijo.stderr.on("data", (d: Buffer) => (salida += d.toString()));
    hijo.on("error", reject);
    hijo.on("exit", (codigo) =>
      codigo === 0 ? resolve() : reject(new Error(`prisma migrate deploy falló (${codigo}):\n${salida}`)),
    );
  });
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cementeria-it-"));
  const datos = path.join(dir, "pgdata");
  const log = path.join(dir, "postgres.log");
  const logPgCtl = path.join(dir, "pg_ctl.log");
  const claveSuperusuario = await claveAleatoria();
  const claveApp = await claveAleatoria();
  const claveDeploy = await claveAleatoria();

  let corriendo = false;
  const limpiar = async (): Promise<void> => {
    if (corriendo) {
      await detener({ datos, logPgCtl });
      corriendo = false;
    }
    // Windows suelta los archivos del servidor con un poco de demora.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };

  try {
    let puerto = await puertoLibre();
    await crearCluster({ datos, puerto, claveSuperusuario, log: logPgCtl });

    // Entre que el sistema nos da un puerto libre y PostgreSQL lo toma, otro
    // proceso puede ganarlo: se reintenta con otro.
    for (let intento = 1; ; intento++) {
      try {
        await arrancar({ datos, puerto, log, logPgCtl });
        corriendo = true;
        break;
      } catch (e) {
        if (intento >= INTENTOS_DE_PUERTO || !/could not bind|address already in use|could not create any TCP/i.test(colaDelLog(log, 50))) {
          throw e;
        }
        puerto = await puertoLibre();
      }
    }

    await correrScript(path.join(RAIZ, "scripts", "db-init.sql"), {
      puerto,
      usuario: SUPERUSUARIO,
      clave: claveSuperusuario,
      parametros: { "cementeria.clave_app": claveApp, "cementeria.clave_deploy": claveDeploy },
    });

    const base: BaseIntegracion = {
      urlApp: url("cementeria_app", claveApp, puerto),
      urlDeploy: url("cementeria_deploy", claveDeploy, puerto),
      urlSuperusuario: url(SUPERUSUARIO, claveSuperusuario, puerto),
      puerto,
    };
    await migrar(base.urlDeploy, url("cementeria_deploy", claveDeploy, puerto, "cementeria_shadow"));

    project.provide("baseIntegracion", base);
    // También por entorno: los workers nacen después del globalSetup y lo
    // heredan, y así crearCliente() sin argumentos ya apunta a la base efímera.
    process.env.DATABASE_URL = base.urlApp;
    process.env.CEMENTERIA_IT_URL_APP = base.urlApp;
    process.env.CEMENTERIA_IT_URL_DEPLOY = base.urlDeploy;
    process.env.CEMENTERIA_IT_URL_SUPERUSUARIO = base.urlSuperusuario;
  } catch (e) {
    await limpiar().catch(() => undefined);
    throw e;
  }

  return limpiar;
}
