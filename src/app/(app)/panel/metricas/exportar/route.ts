import type { NextRequest } from "next/server";
import { ipDeSolicitud } from "@/lib/auth/red";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { metricas } from "@/lib/dominio/metricas/servidor";
import { responderExportacionMetricas } from "@/lib/presentacion/metricas";

/**
 * GET /panel/metricas/exportar?tabla=<pasos|flujo|…>&<los filtros de la
 * pantalla> (docs/api-dominio.md, sección 20): Dirección y admin. Responde la
 * tabla como CSV (`metricas-<tabla>-AAAA-MM-DD.csv`, UTF-8 con BOM) y queda
 * `exportar` en auditoria.accesos, como el CSV del buscador. La lógica está en
 * src/lib/presentacion/metricas.ts; acá solo la sesión y el servicio.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const usuario = await getUsuarioActual();
  return responderExportacionMetricas(metricas, usuario, request, ipDeSolicitud(request.headers));
}
