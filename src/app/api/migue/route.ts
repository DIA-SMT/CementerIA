import { NextResponse, type NextRequest } from "next/server";
import { envioDelMismoSitio, ipDeSolicitud } from "@/lib/auth/red";
import { log, resumenError } from "@/lib/log";
import { historialValido, LARGO_MAXIMO_PUBLICO } from "@/lib/migue/limites";
import { responderPublico } from "@/lib/migue/publico";
import { dependenciasPublico, registrar, reportarAlTablero } from "@/lib/migue/servidor";

/**
 * POST /api/migue: el Migue de la página pública (docs/api-dominio.md, 26.9).
 * `{ pregunta, historial? }` → `{ respuesta, enlaces }`.
 *
 * ABIERTO, sin sesión: queda fuera del matcher de src/proxy.ts (como las
 * páginas públicas). El costo lo frenan el tope por IP y el global
 * (src/lib/migue/tope.ts, en la base); el abuso desde otro sitio, que el
 * pedido salga de una página de este mismo sitio (como el formulario de
 * /consulta). La pregunta, hasta 500 caracteres; el historial, 8 turnos de
 * 600.
 *
 * No consulta expedientes ni lee nada que no muestren ya las páginas públicas.
 * Anota la consulta (sin nada que identifique a la persona) y la reporta al
 * tablero después de contestar.
 */

const CABECERAS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!envioDelMismoSitio(request.headers)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403, headers: CABECERAS });
  let cuerpo: { pregunta?: unknown; historial?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400, headers: CABECERAS });
  }
  const pregunta = typeof cuerpo.pregunta === "string" ? cuerpo.pregunta.replace(/\s+/g, " ").trim() : "";
  if (!pregunta) return NextResponse.json({ error: "Falta la pregunta" }, { status: 400, headers: CABECERAS });
  if (pregunta.length > LARGO_MAXIMO_PUBLICO) {
    return NextResponse.json({ error: `La pregunta es muy larga: hasta ${LARGO_MAXIMO_PUBLICO} caracteres.` }, { status: 400, headers: CABECERAS });
  }

  const empezo = new Date();
  try {
    const r = await responderPublico(dependenciasPublico(), { pregunta, historial: historialValido(cuerpo.historial) }, ipDeSolicitud(request.headers));
    await registrar({ canal: "publico", resultado: r.resultado, duracionMs: Date.now() - empezo.getTime(), modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida, pregunta, respuesta: r.respuesta });
    reportarAlTablero("publico", r.resuelta, empezo);
    return NextResponse.json({ respuesta: r.respuesta, enlaces: r.enlaces }, { headers: CABECERAS });
  } catch (error) {
    log.error("migue.publico_fallo", resumenError(error));
    await registrar({ canal: "publico", resultado: "error", duracionMs: Date.now() - empezo.getTime(), pregunta, respuesta: "" });
    reportarAlTablero("publico", false, empezo);
    return NextResponse.json({ error: "No pude responder ahora" }, { status: 500, headers: CABECERAS });
  }
}
