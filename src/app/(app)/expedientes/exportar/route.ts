import type { NextRequest } from "next/server";
import { ipDeSolicitud } from "@/lib/auth/red";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { responderExportacion } from "@/lib/presentacion/exportar-http";

/**
 * GET /expedientes/exportar?<los filtros del buscador> (sección 5, "Exportar
 * CSV"; docs/api-dominio.md, 15.7): Dirección y admin. Responde el CSV como
 * attachment (`expedientes-AAAA-MM-DD.csv`, UTF-8 con BOM para que Excel
 * muestre bien los acentos), sin teléfono, correo ni domicilio, y queda
 * `exportar` en auditoria.accesos. La lógica está en
 * src/lib/presentacion/exportar-http.ts; acá solo la sesión y el servicio.
 *
 * El proxy la cubre (sin cookie, a /login), pero no es la barrera: la ruta
 * vuelve a pedir el usuario y el dominio controla el permiso. Un GET de un
 * Route Handler no se cachea (sin `dynamic = "force-static"`).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const usuario = await getUsuarioActual();
  return responderExportacion(expedientes, usuario, request, ipDeSolicitud(request.headers));
}
