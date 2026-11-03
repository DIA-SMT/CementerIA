import type { NextRequest } from "next/server";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { sitio } from "@/lib/dominio/sitio/servidor";
import { entorno } from "@/lib/entorno";
import { responderAutorizacionFoto } from "@/lib/presentacion/fotos-http";

/**
 * POST /api/sitio/fotos/autorizar: primera mitad de la subida directa de una
 * foto del sitio a Supabase Storage (ADJUNTOS_ALMACEN=supabase, Vercel: una
 * función no recibe más de 4,5 MB y una foto llega a 15). Cuerpo JSON
 * `{ alt, credito, bytes }`; responde la URL firmada hacia `tmp/<uuid>` del
 * bucket `sitio-publico` y el ticket para confirmar. Fuera del proxy, como
 * la subida de adjuntos.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return responderAutorizacionFoto(sitio, await getUsuarioActual(), request, entorno().secretoSesion);
}
