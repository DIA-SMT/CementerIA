// Un PostgreSQL 15 efímero con los roles, las bases y las migraciones de
// CementerIA. Lo usan el arnés de integración (./global-setup.ts) y el de las
// pruebas de punta a punta (tests/e2e/global-setup.ts).
//
// Cada llamada crea su propio directorio temporal y toma un puerto que elige el
// sistema operativo, así que dos corridas simultáneas (dos terminales, CI con
// varios jobs, integración y e2e a la vez) no chocan entre sí ni tocan la base
// local de desarrollo. `limpiar()` detiene el servidor y borra el directorio.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

const INTENTOS_DE_PUERTO = 4;

export interface BaseEfimera {
  base: BaseIntegracion;
  /** El directorio temporal: datos, logs y lo que el llamador quiera dejar ahí (se borra con `limpiar`). */
  dir: string;
  /** Detiene el servidor y borra el directorio. Se puede llamar más de una vez. */
  limpiar: () => Promise<void>;
}

function url(usuario: string, clave: string, puerto: number, base = "cementeria"): string {
  return `postgresql://${usuario}:${encodeURIComponent(clave)}@localhost:${puerto}/${base}`;
}

/** `prisma migrate deploy` contra la base efímera, como lo haría un despliegue. */
function migrar(raiz: string, urlDeploy: string, urlShadow: string): Promise<void> {
  const cli = path.join(raiz, "node_modules", "prisma", "build", "index.js");
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [cli, "migrate", "deploy"], {
      cwd: raiz,
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

/**
 * Crea el clúster en `%TEMP%/<prefijo>XXXX`, lo arranca en un puerto libre,
 * corre `scripts/db-init.sql` como superusuario (roles con claves aleatorias,
 * bases y extensiones) y aplica las migraciones con `cementeria_deploy`.
 * Si algo falla, deja todo limpio antes de tirar.
 *
 * `raiz` es la del repositorio (la pasa quien llama: este módulo no usa
 * import.meta, porque Playwright lo carga como CommonJS).
 */
export async function levantarBaseEfimera(prefijo: string, raiz: string): Promise<BaseEfimera> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefijo));
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

    await correrScript(path.join(raiz, "scripts", "db-init.sql"), {
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
    await migrar(raiz, base.urlDeploy, url("cementeria_deploy", claveDeploy, puerto, "cementeria_shadow"));
    return { base, dir, limpiar };
  } catch (e) {
    await limpiar().catch(() => undefined);
    throw e;
  }
}
