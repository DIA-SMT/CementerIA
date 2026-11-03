import { log, resumenError } from "@/lib/log";
import { LARGO_TURNO, TURNOS_DE_MEMORIA, type Turno } from "./limites";

/**
 * El único lugar que habla con el modelo, vía OpenRouter (docs/api-dominio.md,
 * 26.3). El mismo modelo y la misma forma de llamarlo que El Sanmiguelino
 * (DiarioDigital, src/lib/migue/openrouter.ts), con lo que agregó AppAmbiente:
 *
 *  · `fetch` y no el SDK: es un solo pedido, y lo que no está instalado no se
 *    importa por accidente desde el cliente con la clave adentro.
 *  · `openai/gpt-4o-mini` por defecto (OPENROUTER_MODEL), temperatura 0,2 (no
 *    se le pide creatividad, se le pide que no se aparte de lo que se le
 *    pasa), 12 s de tiempo máximo y sin streaming.
 *  · `provider.data_collection: "deny"`: OpenRouter manda el pedido solo a
 *    proveedores que no guardan ni entrenan con lo que reciben. Es un
 *    organismo público.
 *  · Herramientas con `strict: true` (solo lo interno): el proveedor garantiza
 *    que los argumentos cumplan el esquema; lo que el esquema no dice, lo
 *    valida cada herramienta.
 *  · `HTTP-Referer` (APP_URL) y `X-Title: CementerIA`: OpenRouter los usa para
 *    atribuir el tráfico en su panel. No son credenciales.
 *
 * **Nunca tira.** Devuelve `null` si no se pudo —sin clave, error de red,
 * tiempo agotado, respuesta rara— y el llamador cae al buscador: que Migue
 * conteste peor es mejor que Migue no conteste. El log dice el estado y nunca
 * el texto (ni la pregunta ni la respuesta).
 *
 * Sin `server-only` para probarlo con un `fetch` falso, pero la clave solo la
 * tiene el servidor: llega en `ConexionModelo`, que arma src/lib/migue/servidor.ts.
 */

/** Si OpenRouter no contestó en este tiempo, se corta: un chat que tarda quince segundos ya perdió a quien preguntó. */
export const TIMEOUT_MS = 12_000;

export interface LlamadaHerramienta {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type MensajeModelo =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlamadaHerramienta[] }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Esquema estricto: todas las propiedades en `required` y
 * `additionalProperties: false`. Los opcionales no se escriben como null: se
 * usa un valor centinela del enum (`todas`) o el texto vacío.
 */
export interface DefinicionHerramienta {
  type: "function";
  function: {
    name: string;
    description: string;
    strict: true;
    parameters: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  };
}

/** Con qué se habla: lo arma el servidor desde el entorno (ConfigMigue de src/lib/entorno.ts). */
export interface ConexionModelo {
  clave: string | null;
  modelo: string;
  url: string;
  /** El origen de la app (APP_URL), para el encabezado HTTP-Referer. */
  referer: string | null;
  /** Para las pruebas; por defecto, el `fetch` global. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface RespuestaModelo {
  contenido: string | null;
  llamadas: LlamadaHerramienta[];
  /** El modelo que contestó (el que informa OpenRouter, o el pedido). */
  modelo: string;
  tokensEntrada: number | null;
  tokensSalida: number | null;
}

/** Los mensajes de sistema, los turnos anteriores (acotados) y la pregunta, en el formato de chat. */
export function armarMensajes(sistema: readonly string[], historial: readonly Turno[], pregunta: string): MensajeModelo[] {
  return [
    ...sistema.map((content) => ({ role: "system" as const, content })),
    ...historial.slice(-TURNOS_DE_MEMORIA).map((t) =>
      t.rol === "usuario"
        ? { role: "user" as const, content: t.texto.slice(0, LARGO_TURNO) }
        : { role: "assistant" as const, content: t.texto.slice(0, LARGO_TURNO) },
    ),
    { role: "user", content: pregunta },
  ];
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? Math.round(valor) : null;
}

/** Que la llamada tenga la forma que se espera; lo que no, se descarta (y el modelo no recibe nada de eso). */
function esLlamada(valor: unknown): valor is LlamadaHerramienta {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  return typeof v.id === "string" && typeof v.function?.name === "string" && typeof (v.function.arguments ?? "") === "string";
}

/**
 * Un pedido al modelo. `herramientas` solo en lo interno; `maxTokens`, 400 en
 * lo público (como el diario) y 700 en lo interno.
 */
export async function pedirAlModelo(
  conexion: ConexionModelo,
  pedido: { mensajes: MensajeModelo[]; herramientas?: DefinicionHerramienta[]; maxTokens: number },
): Promise<RespuestaModelo | null> {
  if (!conexion.clave) return null;
  const enviar = conexion.fetch ?? fetch;
  try {
    const res = await enviar(conexion.url, {
      method: "POST",
      signal: AbortSignal.timeout(conexion.timeoutMs ?? TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${conexion.clave}`,
        "Content-Type": "application/json",
        ...(conexion.referer ? { "HTTP-Referer": conexion.referer } : {}),
        "X-Title": "CementerIA",
      },
      body: JSON.stringify({
        model: conexion.modelo,
        max_tokens: pedido.maxTokens,
        temperature: 0.2,
        stream: false,
        provider: { data_collection: "deny" },
        messages: pedido.mensajes,
        ...(pedido.herramientas?.length ? { tools: pedido.herramientas, tool_choice: "auto" } : {}),
      }),
    });
    if (!res.ok) {
      log.warn("migue.modelo_rechazo", { estado: res.status });
      return null;
    }
    const datos = (await res.json().catch(() => null)) as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    } | null;
    const mensaje = datos?.choices?.[0]?.message;
    if (!mensaje) {
      log.warn("migue.modelo_respuesta_rara", { estado: res.status });
      return null;
    }
    const contenido = typeof mensaje.content === "string" && mensaje.content.trim() ? mensaje.content : null;
    const llamadas = Array.isArray(mensaje.tool_calls) ? mensaje.tool_calls.filter(esLlamada) : [];
    if (contenido === null && llamadas.length === 0) {
      log.warn("migue.modelo_respuesta_vacia", { estado: res.status });
      return null;
    }
    return {
      contenido,
      llamadas: llamadas.map((l) => ({ id: l.id, type: "function", function: { name: l.function.name, arguments: l.function.arguments ?? "" } })),
      modelo: typeof datos?.model === "string" && datos.model ? datos.model.slice(0, 100) : conexion.modelo,
      tokensEntrada: numero(datos?.usage?.prompt_tokens),
      tokensSalida: numero(datos?.usage?.completion_tokens),
    };
  } catch (error) {
    // Corte de red o tiempo agotado: el llamador usa el buscador.
    log.warn("migue.modelo_sin_respuesta", resumenError(error));
    return null;
  }
}
