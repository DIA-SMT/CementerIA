import type { NextRequest } from "next/server";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { sitio } from "@/lib/dominio/sitio/servidor";
import { entorno } from "@/lib/entorno";
import { responderConfirmacionFoto } from "@/lib/presentacion/fotos-http";

/**
 * POST /api/sitio/fotos/confirmar: segunda mitad de la subida directa. Cuerpo
 * JSON `{ ticket, alt, credito }`. Lee el original desde Storage (hasta
 * 15 MB), lo procesa (sharp), guarda las dos versiones, registra la foto y
 * borra el temporal. Fuera del proxy.
 */

// Bajar 15 MB desde Storage, decodificar y re-codificar: holgado, por debajo del máximo de Vercel Hobby (300 s).
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  return responderConfirmacionFoto(sitio, await getUsuarioActual(), request, entorno().secretoSesion);
}
