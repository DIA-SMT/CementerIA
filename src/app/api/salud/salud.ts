/**
 * Lógica de GET /api/salud, aparte del Route Handler para testearla sin Next
 * (un route.ts solo puede exportar los métodos HTTP y la configuración).
 *
 * La consultan nginx, el monitoreo de Sistemas y el checklist posterior a cada
 * despliegue (docs/despliegue.md), sin cookie: por eso está fuera del matcher
 * de src/proxy.ts. Como no pide sesión, la respuesta no lleva nada que sirva
 * para atacar: ni el host de la base, ni el mensaje del error, ni el entorno.
 */

/** Lo que tarda como máximo la consulta antes de dar la base por caída. */
export const TIMEOUT_BASE_MS = 3000;

export interface RespuestaSalud {
  status: 200 | 503;
  cuerpo: { estado: "ok" | "degradado"; version: string; base: "ok" | "sin_respuesta" };
}

/**
 * La versión del build: `npm run empaquetar` compila con NEXT_DEPLOYMENT_ID
 * (versión del package.json y commit), que Next además usa para que una
 * pestaña abierta con el build anterior recargue en vez de fallar. Next no
 * admite puntos en ese id, así que llega como 0_1_0-b0e15db y acá se muestra
 * como 0.1.0-b0e15db, igual que el nombre del paquete. Fuera de un paquete
 * (next dev, next build a mano) queda "desarrollo".
 */
export function versionDelBuild(fuente: Readonly<Record<string, string | undefined>> = process.env): string {
  const id = fuente.NEXT_DEPLOYMENT_ID?.trim();
  // En Vercel no hay paquete: el id del despliegue (dpl_…) no dice qué código
  // corre, el commit sí (VERCEL_GIT_COMMIT_SHA, variable de sistema de Vercel).
  const commit = fuente.VERCEL_GIT_COMMIT_SHA?.trim();
  if (commit && (!id || id.startsWith("dpl_"))) return `vercel-${commit.slice(0, 7)}`;
  if (!id) return "desarrollo";
  return id.replace(/^(\d+)_(\d+)_(\d+)-/, "$1.$2.$3-");
}

/**
 * Corre `consultar` (un SELECT 1) con un límite de tiempo. El pool de `pg` no
 * tiene timeout de conexión por defecto: con la base colgada (no caída) la
 * consulta esperaría para siempre y el monitoreo vería un timeout propio en
 * vez de un 503.
 *
 * @param alFallar recibe el error para el log; nunca llega a la respuesta.
 */
export async function comprobarSalud(
  consultar: () => Promise<unknown>,
  version: string,
  alFallar: (error: unknown) => void,
  timeoutMs: number = TIMEOUT_BASE_MS,
): Promise<RespuestaSalud> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(`La base no respondió en ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([consultar(), limite]);
    return { status: 200, cuerpo: { estado: "ok", version, base: "ok" } };
  } catch (error) {
    alFallar(error);
    return { status: 503, cuerpo: { estado: "degradado", version, base: "sin_respuesta" } };
  } finally {
    clearTimeout(temporizador);
  }
}
