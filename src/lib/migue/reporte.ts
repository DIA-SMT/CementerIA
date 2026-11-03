import { randomUUID } from "node:crypto";
import { log } from "@/lib/log";
import type { CanalMigue } from "./registro";

/**
 * El reporte de cada consulta al tablero de Migues de la Dirección de IA
 * (organizacionDIA, sección Migue; el contrato está en su
 * docs/migue-conexion.md: POST /api/migue/conversaciones con
 * `Authorization: Bearer <MIGUE_API_KEY>`). Igual que Applaza
 * (lib/migue-report.ts) y Presupuesto Participativo (src/lib/migue-reporte.ts):
 * cada pregunta cuenta como una conversación.
 *
 * - **Apagado** sin MIGUE_API_KEY o sin MIGUE_DASHBOARD_URL (las dos juntas,
 *   las valida src/lib/entorno.ts).
 * - **Solo cuatro campos**: un id propio (uuid al azar, sin relación con la
 *   persona ni con el registro), `started_at`, el canal y el resultado. Nada de
 *   la pregunta, la respuesta, el usuario, la IP, la pantalla ni los tokens.
 * - **Nunca demora ni rompe la respuesta**: se manda con `after()` (después de
 *   contestar), con 3 s como mucho, y cualquier falla queda en el log y se
 *   descarta.
 *
 * Para que el tablero lo muestre hay que dar de alta el slug `cementeria` en
 * organizacionDIA (lib/migue.ts o "Migue > Agregar Migue") y generar su clave
 * (README, "Migue").
 */

const TIEMPO_MAXIMO_MS = 3000;

export interface ConfigTablero {
  clave: string;
  url: string;
}

/** Conversación en el formato de POST /api/migue/conversaciones, con lo mínimo. */
export interface ReporteMigue {
  conversation_id: string;
  started_at: string;
  channel: "Web" | "App";
  outcome: "resuelta" | "sin_respuesta";
}

/**
 * Lo público es la página web; lo interno, el sistema que usa el personal
 * ("App", como Applaza). `resuelta`: la persona recibió una respuesta con
 * contenido (del modelo, del buscador o de un atajo); lo demás, sin respuesta.
 */
export function armarReporte(d: { canal: CanalMigue; resuelta: boolean; empezo: Date }, id: string = randomUUID()): ReporteMigue {
  return {
    conversation_id: id,
    started_at: d.empezo.toISOString(),
    channel: d.canal === "publico" ? "Web" : "App",
    outcome: d.resuelta ? "resuelta" : "sin_respuesta",
  };
}

/** Manda el reporte. Nunca tira: si algo falla, lo anota en el log (sin el contenido) y sigue. */
export async function enviarReporte(
  reporte: ReporteMigue,
  config: ConfigTablero,
  enviar: typeof fetch = fetch,
  tiempoMaximoMs: number = TIEMPO_MAXIMO_MS,
): Promise<void> {
  try {
    const respuesta = await enviar(`${config.url}/api/migue/conversaciones`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ conversations: [reporte] }),
      signal: AbortSignal.timeout(tiempoMaximoMs),
    });
    if (!respuesta.ok) {
      log.warn("migue.tablero_rechazo", { estado: respuesta.status });
      return;
    }
    // El tablero responde 200 aunque descarte la fila: el motivo viene en "rejected".
    const cuerpo = (await respuesta.json().catch(() => null)) as { rejected?: Array<{ error?: string }> } | null;
    if (Array.isArray(cuerpo?.rejected) && cuerpo.rejected.length > 0) {
      log.warn("migue.tablero_descarto", { motivo: String(cuerpo.rejected[0]?.error ?? "sin motivo").slice(0, 120) });
    }
  } catch (error) {
    log.warn("migue.tablero_sin_respuesta", { error: error instanceof Error ? error.name : typeof error });
  }
}
