// Un OpenRouter de mentira para las pruebas de punta a punta de Migue
// (tests/e2e/migue.spec.ts). Lo levanta global-setup.ts en un puerto libre y la
// app lo usa con OPENROUTER_URL: así se prueba el camino entero (la ruta, el
// prompt, las herramientas, el registro) sin llamar NUNCA a OpenRouter real ni
// gastar un centavo.
//
// Contesta según lo que le llega, sin estado, para que las pruebas puedan
// correr en paralelo:
// - si la última pregunta dice «provocar falla», responde 500 (el fallback);
// - si dice «con formato», una respuesta con markdown (negritas y una lista
//   con renglones en blanco, como escribe el modelo de verdad);
// - con herramientas (el Migue del sistema): si la pregunta trae un número de
//   expediente, pide `estado_expediente`; cuando le vuelve el resultado, arma
//   la respuesta con los datos de la herramienta y el enlace a la ficha;
// - sin herramientas (el de la página pública), una respuesta fija con un
//   enlace válido y otro inventado (que la app tiene que descartar).
//
// GET /__registro devuelve los pedidos recibidos (para mirar qué le llegó al
// "modelo": la llamada a la herramienta y lo que devolvió).

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

interface Mensaje {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface PedidoRecibido {
  autorizacion: string | null;
  titulo: string | null;
  modelo: unknown;
  temperatura: unknown;
  maxTokens: unknown;
  proveedor: unknown;
  herramientas: string[];
  mensajes: Mensaje[];
}

export const RESPUESTA_CON_FORMATO =
  "Para manejar las plantillas, tené en cuenta lo siguiente:\n\n- **Plantillas de trámite**: definen los pasos y los documentos.\n\n- **Nueva plantilla**: nace como *borrador* y se publica después.";

export const RESPUESTA_PUBLICA = "Respuesta de prueba de Migue: según lo que publica la Dirección, te conviene mirar los horarios.";

function respuesta(cuerpo: { messages?: Mensaje[]; tools?: Array<{ function: { name: string } }> }): { status: number; json: unknown } {
  const mensajes = cuerpo.messages ?? [];
  const ultimo = mensajes.at(-1);
  const ultimaPregunta = [...mensajes].reverse().find((m) => m.role === "user")?.content ?? "";
  const uso = { prompt_tokens: 1200, completion_tokens: 60 };
  if (/provocar falla/i.test(ultimaPregunta)) return { status: 500, json: { error: { code: 500, message: "falla provocada por la prueba" } } };

  const texto = (content: string) => ({ status: 200, json: { id: "falso", model: "openai/gpt-4o-mini", choices: [{ message: { role: "assistant", content } }], usage: uso } });
  if (/con formato/i.test(ultimaPregunta)) return texto(RESPUESTA_CON_FORMATO);

  if (cuerpo.tools?.length) {
    if (ultimo?.role === "tool") {
      let datos: Record<string, unknown> = {};
      try {
        datos = JSON.parse(ultimo.content ?? "{}") as Record<string, unknown>;
      } catch {
        // Si no es JSON, se contesta igual.
      }
      if (typeof datos.error === "string") return texto(`No pude: ${datos.error}`);
      const paso = datos.paso as { orden?: number; total?: number; nombre?: string } | undefined;
      return texto(
        `El expediente ${String(datos.numero)} (${String(datos.tramite)}) está ${String(datos.estado).toLowerCase()} en ${String(datos.areaActual)}, en el paso ${paso?.orden} de ${paso?.total} («${paso?.nombre}»).\nENLACE: /expedientes/${String(datos.numero)}`,
      );
    }
    const numero = /CEM\W?\d{4}\W?\d{1,6}|\d{1,6}\/\d{4}/i.exec(ultimaPregunta)?.[0];
    if (numero) {
      return {
        status: 200,
        json: {
          id: "falso",
          model: "openai/gpt-4o-mini",
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "llamada-1", type: "function", function: { name: "estado_expediente", arguments: JSON.stringify({ numero }) } }] } }],
          usage: uso,
        },
      };
    }
    return texto("Respuesta de prueba del Migue del sistema.\nENLACE: /bandeja");
  }
  return texto(`${RESPUESTA_PUBLICA}\nENLACE: /horarios\nENLACE: /inventada`);
}

export async function levantarOpenRouterFalso(): Promise<{ url: string; cerrar: () => Promise<void> }> {
  const recibidos: PedidoRecibido[] = [];
  const servidor: Server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/__registro") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recibidos));
      return;
    }
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let crudo = "";
    req.setEncoding("utf8");
    req.on("data", (parte: string) => (crudo += parte));
    req.on("end", () => {
      let cuerpo: { model?: unknown; temperature?: unknown; max_tokens?: unknown; provider?: unknown; messages?: Mensaje[]; tools?: Array<{ function: { name: string } }> } = {};
      try {
        cuerpo = JSON.parse(crudo);
      } catch {
        // Un cuerpo roto se anota vacío.
      }
      recibidos.push({
        autorizacion: req.headers.authorization ?? null,
        titulo: (req.headers["x-title"] as string | undefined) ?? null,
        modelo: cuerpo.model,
        temperatura: cuerpo.temperature,
        maxTokens: cuerpo.max_tokens,
        proveedor: cuerpo.provider,
        herramientas: (cuerpo.tools ?? []).map((t) => t.function.name),
        mensajes: cuerpo.messages ?? [],
      });
      const r = respuesta(cuerpo);
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    cerrar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
  };
}
