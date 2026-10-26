import { NextResponse } from "next/server";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { avisos } from "@/lib/dominio/avisos/servidor";

/**
 * GET /api/avisos/resumen: el refresco liviano de la campana (cada 60 s con
 * la pestaña visible, y al cambiar de pantalla). Devuelve `{ noLeidos,
 * ultimos }` del usuario de la sesión, sin datos personales (los avisos no
 * los llevan).
 *
 * Queda FUERA del matcher de src/proxy.ts a propósito: el proxy renueva la
 * sesión en cada request, y un refresco automático la mantendría viva para
 * siempre (los 60 minutos de inactividad no vencerían nunca). Acá la sesión se
 * verifica (firma, vencimiento, usuario activo y `sesion_version`) sin
 * renovarse; vencida, 401 y la campana deja de preguntar.
 */
export async function GET(): Promise<NextResponse> {
  const usuario = await getUsuarioActual();
  const cabeceras = { "Cache-Control": "private, no-store" };
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401, headers: cabeceras });
  return NextResponse.json(await avisos.resumen(usuario), { headers: cabeceras });
}
