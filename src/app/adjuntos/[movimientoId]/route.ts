import type { NextRequest } from "next/server";
import { ipDeSolicitud } from "@/lib/auth/red";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { responderLectura } from "@/lib/presentacion/adjuntos-http";

/**
 * GET /adjuntos/[movimientoId] (sección 6, "Adjuntos"): el visor de la ficha
 * (inline) y, con `?descargar=1`, la descarga (attachment). Sirve el archivo
 * con `Content-Security-Policy: sandbox; default-src 'none'`,
 * `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`, y
 * registra `ver_adjunto` o `descargar_adjunto`.
 *
 * El proxy la cubre (sin cookie redirige a /login), pero no es la barrera: la
 * ruta vuelve a pedir el usuario con getUsuarioActual() y el dominio decide si
 * puede verlo (quien no trabaja el expediente manda `?motivo=` o `X-Motivo`).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/adjuntos/[movimientoId]">): Promise<Response> {
  const { movimientoId } = await ctx.params;
  const usuario = await getUsuarioActual();
  return responderLectura(expedientes, usuario, movimientoId, request, ipDeSolicitud(request.headers));
}
