import type { NextRequest } from "next/server";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { responderSubida } from "@/lib/presentacion/adjuntos-http";

/**
 * POST /api/expedientes/[numero]/adjuntos (sección 6, "Adjuntos"): el archivo
 * es el cuerpo del request y los metadatos van en la query (`nombre`,
 * `documento`, `version`, `comando`).
 *
 * Esta ruta está FUERA del matcher de src/proxy.ts: el proxy no toca el cuerpo
 * (hasta 10 MB, en streaming) y por eso la ruta se autentica sola con
 * getUsuarioActual(). El cuerpo no se lee acá: `request.body` va sin
 * bufferear a `subirAdjunto`, que lo escribe en disco mientras calcula el
 * sha256. La lógica está en src/lib/presentacion/adjuntos-http.ts.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/expedientes/[numero]/adjuntos">): Promise<Response> {
  const { numero } = await ctx.params;
  const usuario = await getUsuarioActual();
  return responderSubida(expedientes, usuario, numero, request);
}
