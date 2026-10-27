import { createHash, timingSafeEqual } from "node:crypto";
import { log, resumenError, type DatosLog } from "@/lib/log";

/**
 * Las tareas programadas en Vercel (docs/despliegue-vercel.md, "Tareas
 * programadas"): Vercel Cron llama con GET a cada ruta de `vercel.json` y, si
 * el proyecto tiene la variable CRON_SECRET, manda
 * `Authorization: Bearer <CRON_SECRET>` (vercel.com/docs/cron-jobs/manage-cron-jobs,
 * "Securing cron jobs"). Sin ese encabezado exacto la ruta responde 401 y no
 * hace nada; sin CRON_SECRET configurada, responde 401 siempre.
 *
 * Las rutas están fuera del matcher de src/proxy.ts (no hay sesión: el que
 * llama es Vercel) y no tienen nada que ver con las cookies de la app.
 */

/** Largo mínimo de CRON_SECRET (lo valida también src/lib/entorno.ts al arrancar). */
export const MINIMO_CRON_SECRET = 32;

/**
 * ¿El encabezado `Authorization` es `Bearer <secreto>`? En tiempo constante:
 * se comparan los SHA-256 de los dos textos, que tienen siempre el mismo largo
 * (así tampoco se filtra el largo del secreto).
 */
export function cronAutorizado(authorization: string | null, secreto: string | undefined): boolean {
  const s = secreto?.trim();
  if (!s || s.length < MINIMO_CRON_SECRET || !authorization) return false;
  const esperado = createHash("sha256").update(`Bearer ${s}`).digest();
  const recibido = createHash("sha256").update(authorization).digest();
  return timingSafeEqual(esperado, recibido);
}

export interface ResultadoTarea {
  /** false: la tarea corrió pero encontró un problema (la cadena rota): responde 500 para que se vea en Vercel. */
  ok: boolean;
  /** Para el log y la respuesta: solo cantidades, sin datos personales. */
  datos: DatosLog;
}

function respuesta(cuerpo: Record<string, unknown>, status: number): Response {
  return Response.json(cuerpo, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

/**
 * Lo común de las rutas de /api/cron: autenticación, una línea de log por
 * corrida (`cron.<nombre>`) y la respuesta JSON. Un error inesperado responde
 * 500 sin detalles (el detalle, resumido, va al log).
 */
export async function correrCron(
  request: Request,
  nombre: string,
  tarea: () => Promise<ResultadoTarea>,
  secreto: string | undefined = process.env.CRON_SECRET,
): Promise<Response> {
  if (!cronAutorizado(request.headers.get("authorization"), secreto)) {
    // Sin la IP ni el encabezado: solo que alguien llamó sin la credencial.
    log.warn("cron.no_autorizado", { tarea: nombre, configurado: Boolean(secreto?.trim()) });
    return respuesta({ ok: false, error: "No autorizado" }, 401);
  }
  try {
    const r = await tarea();
    if (r.ok) log.info(`cron.${nombre}`, r.datos);
    else log.error(`cron.${nombre}`, r.datos);
    return respuesta({ ok: r.ok, tarea: nombre, ...r.datos }, r.ok ? 200 : 500);
  } catch (error) {
    log.error(`cron.${nombre}_fallo`, resumenError(error));
    return respuesta({ ok: false, tarea: nombre, error: "La tarea falló: ver el log" }, 500);
  }
}
