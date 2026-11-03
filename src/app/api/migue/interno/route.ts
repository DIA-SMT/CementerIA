import { NextResponse, type NextRequest } from "next/server";
import { envioDelMismoSitio } from "@/lib/auth/red";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { log, resumenError } from "@/lib/log";
import { esPantalla } from "@/lib/migue/ayuda-interna";
import { responderInterno } from "@/lib/migue/interno";
import { historialValido, LARGO_MAXIMO_INTERNO } from "@/lib/migue/limites";
import { dependenciasInterno, registrar, reportarAlTablero } from "@/lib/migue/servidor";
import { perfilDe } from "@/lib/presentacion/recorridos/motor";

/**
 * POST /api/migue/interno: el Migue del sistema (docs/api-dominio.md, 26.11).
 * `{ pregunta, pantalla?, historial? }` → `{ respuesta, enlaces }`.
 *
 * Con sesión: queda DENTRO del matcher de src/proxy.ts (que renueva la sesión
 * y, sin ella, contesta 401), y acá se vuelve a pedir el usuario con
 * getUsuarioActual(), que es la barrera de verdad (activo, `sesion_version`).
 * Con el modo prueba ("Ver como…") el usuario ES el perfil efectivo: el
 * selector cambia el área y el rol del propio usuario en la base, así que las
 * herramientas ven lo que vería ese perfil.
 *
 * Solo llegan acá las preguntas libres: las de cada pantalla traen su
 * respuesta escrita y se contestan en el navegador. Hasta 600 caracteres; con
 * DNI, CUIL, CUIT, teléfono o correo se rechaza con un mensaje amable.
 */

// Hasta 4 vueltas con el modelo (12 s cada una como mucho) dentro de un plazo de 40 s.
export const maxDuration = 60;

const CABECERAS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const usuario = await getUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401, headers: CABECERAS });
  if (!envioDelMismoSitio(request.headers)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403, headers: CABECERAS });
  let cuerpo: { pregunta?: unknown; pantalla?: unknown; historial?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400, headers: CABECERAS });
  }
  const pregunta = typeof cuerpo.pregunta === "string" ? cuerpo.pregunta.replace(/\s+/g, " ").trim() : "";
  if (!pregunta) return NextResponse.json({ error: "Falta la pregunta" }, { status: 400, headers: CABECERAS });
  if (pregunta.length > LARGO_MAXIMO_INTERNO) {
    return NextResponse.json({ error: `La pregunta es muy larga: hasta ${LARGO_MAXIMO_INTERNO} caracteres.` }, { status: 400, headers: CABECERAS });
  }
  // Una pantalla que no se conoce no es un error: el chat pudo quedar viejo después de un despliegue.
  const pantalla = esPantalla(cuerpo.pantalla) ? cuerpo.pantalla : null;

  const empezo = new Date();
  const registro = { canal: "interno" as const, usuarioId: usuario.id, pantalla, pregunta };
  try {
    const r = await responderInterno(dependenciasInterno(), usuario, perfilDe(usuario), { pregunta, historial: historialValido(cuerpo.historial), pantalla });
    await registrar({
      ...registro,
      resultado: r.resultado,
      herramientas: r.herramientas,
      duracionMs: Date.now() - empezo.getTime(),
      modelo: r.modelo,
      tokensEntrada: r.tokensEntrada,
      tokensSalida: r.tokensSalida,
      respuesta: r.respuesta,
    });
    reportarAlTablero("interno", r.resuelta, empezo);
    return NextResponse.json({ respuesta: r.respuesta, enlaces: r.enlaces }, { headers: CABECERAS });
  } catch (error) {
    log.error("migue.interno_fallo", resumenError(error));
    await registrar({ ...registro, resultado: "error", duracionMs: Date.now() - empezo.getTime(), respuesta: "" });
    reportarAlTablero("interno", false, empezo);
    return NextResponse.json({ error: "No pude responder ahora" }, { status: 500, headers: CABECERAS });
  }
}
