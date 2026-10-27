import type { NextRequest } from "next/server";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { entorno } from "@/lib/entorno";
import { responderAutorizacion } from "@/lib/presentacion/adjuntos-http";

/**
 * POST /api/expedientes/[numero]/adjuntos/autorizar: primera mitad de la
 * subida directa a Supabase Storage (ADJUNTOS_ALMACEN=supabase, el despliegue
 * en Vercel; docs/despliegue-vercel.md). Cuerpo JSON `{ documento, version,
 * comando, bytes }`; responde la URL firmada de subida hacia `tmp/<uuid>` y el
 * ticket para confirmar. Con el disco responde un error: ahí se sube por
 * `POST …/adjuntos`.
 *
 * Como la subida de siempre, queda FUERA del matcher de src/proxy.ts y se
 * autentica sola con getUsuarioActual(). La lógica está en
 * src/lib/presentacion/adjuntos-http.ts.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/expedientes/[numero]/adjuntos/autorizar">): Promise<Response> {
  const { numero } = await ctx.params;
  const usuario = await getUsuarioActual();
  return responderAutorizacion(expedientes, usuario, numero, request, entorno().secretoSesion);
}
