// Levanta un PostgreSQL 15 efímero para la corrida de integración.
//
// Cada corrida usa su propio directorio temporal y un puerto que elige el
// sistema operativo, así que dos corridas simultáneas (dos terminales, CI con
// varios jobs) no chocan entre sí ni tocan la base local de desarrollo. Al
// terminar se detiene el servidor y se borra el directorio. El trabajo lo hace
// ./base-efimera.ts, que comparte con las pruebas de punta a punta.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { levantarBaseEfimera } from "./base-efimera";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { base, limpiar } = await levantarBaseEfimera("cementeria-it-", RAIZ);
  try {
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
