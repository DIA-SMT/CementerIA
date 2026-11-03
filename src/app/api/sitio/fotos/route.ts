import type { NextRequest } from "next/server";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { sitio } from "@/lib/dominio/sitio/servidor";
import { responderSubidaFoto } from "@/lib/presentacion/fotos-http";

/**
 * POST /api/sitio/fotos?alt=&credito= (30/10/2026; docs/api-dominio.md,
 * sección 25.7): una foto para el sitio público, como cuerpo del request
 * (hasta 15 MB). La procesa el servidor (sharp: magic bytes, orientación, dos
 * WebP sin metadatos) y la registra. Es el camino del disco (servidor
 * municipal y desarrollo); en Vercel el navegador sube directo a Supabase
 * Storage (…/autorizar y …/confirmar).
 *
 * FUERA del matcher de src/proxy.ts, como la subida de adjuntos: el proxy no
 * toca el cuerpo y la ruta se autentica sola con getUsuarioActual(). La lógica
 * está en src/lib/presentacion/fotos-http.ts.
 */

// Decodificar y re-codificar una foto de 50 megapíxeles lleva unos segundos.
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  return responderSubidaFoto(sitio, await getUsuarioActual(), request);
}
