import type { NextRequest } from "next/server";
import { ipDeSolicitud } from "@/lib/auth/red";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { admin } from "@/lib/dominio/admin/servidor";
import { responderExportacionAuditoria } from "@/lib/presentacion/acciones-admin";

/**
 * GET /admin/auditoria/exportar?vista=accesos|cambios&<los filtros de la
 * pantalla> (sección 5, "Exportar" de Auditoría): solo el admin. Responde el
 * CSV como attachment (`auditoria-accesos-AAAA-MM-DD.csv`) y queda `exportar`
 * en auditoria.accesos. La lógica está en src/lib/presentacion/acciones-admin.ts;
 * acá solo la sesión, el servicio y la IP. Como el CSV del buscador, no es la
 * barrera: el dominio exige `administrar`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const usuario = await getUsuarioActual();
  return responderExportacionAuditoria(admin, usuario, request, ipDeSolicitud(request.headers));
}
