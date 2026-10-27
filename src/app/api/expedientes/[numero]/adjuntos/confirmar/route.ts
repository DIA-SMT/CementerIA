import type { NextRequest } from "next/server";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { entorno } from "@/lib/entorno";
import { responderConfirmacion } from "@/lib/presentacion/adjuntos-http";

/**
 * POST /api/expedientes/[numero]/adjuntos/confirmar: segunda mitad de la
 * subida directa. Cuerpo JSON `{ ticket, nombre, documento, version, comando }`.
 * Lee el temporal desde Storage en streaming (tamaño, sha256, magic bytes),
 * registra el movimiento `adjunto` y lo mueve a `AAAA/MM/<uuid>`; si algo
 * falla, borra el temporal. Fuera del matcher de src/proxy.ts, como
 * `POST …/adjuntos`.
 */

// Leer 10 MB desde Storage y moverlo: holgado, por debajo del máximo de Vercel Hobby (300 s).
export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: RouteContext<"/api/expedientes/[numero]/adjuntos/confirmar">): Promise<Response> {
  const { numero } = await ctx.params;
  const usuario = await getUsuarioActual();
  return responderConfirmacion(expedientes, usuario, numero, request, entorno().secretoSesion);
}
