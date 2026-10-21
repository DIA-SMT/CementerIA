import type { ServicioExpedientes } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { leerParametrosBusqueda, rutaBusqueda, type ParametrosUrl } from "./busqueda";
import { estadoDeError } from "./errores";

/**
 * "Exportar CSV" del buscador (sección 5; docs/api-dominio.md, 15.7), sin
 * Next: el Route Handler `GET /expedientes/exportar?<los filtros del
 * buscador>` solo pone la sesión, el servicio y la IP. Los filtros se leen
 * igual que en `/expedientes` (`leerParametrosBusqueda`), así que el archivo
 * trae lo mismo que la pantalla (hasta 5000 filas). El dominio controla el
 * permiso (Dirección y admin), arma el CSV sin teléfono, correo ni domicilio y
 * registra `exportar` en auditoria.accesos.
 */

/** La ruta de la exportación con los mismos parámetros que la búsqueda. */
export function rutaExportar(rutaDeBusqueda: string): string {
  const i = rutaDeBusqueda.indexOf("?");
  return `/expedientes/exportar${i === -1 ? "" : rutaDeBusqueda.slice(i)}`;
}

/** La URL del buscador (`?q=…&estado=…`) que corresponde a una exportación, para el enlace. */
export function rutaExportarDesde(parametros: ParametrosUrl): string {
  const { entrada } = leerParametrosBusqueda(parametros);
  return rutaExportar(rutaBusqueda(entrada.filtros ?? {}, entrada.q));
}

/** `URLSearchParams` como los `searchParams` de una página (los repetidos, como lista). */
export function parametrosDe(q: URLSearchParams): ParametrosUrl {
  const r: ParametrosUrl = {};
  for (const clave of new Set(q.keys())) {
    const valores = q.getAll(clave);
    r[clave] = valores.length === 1 ? valores[0] : valores;
  }
  return r;
}

const HEADERS_TEXTO = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

function texto(cuerpo: string, status: number): Response {
  return new Response(cuerpo, { status, headers: HEADERS_TEXTO });
}

/**
 * La respuesta del Route Handler: el CSV como `attachment` con el nombre que
 * da el dominio (`expedientes-2026-10-20.csv`), o un error en texto plano:
 * 401 sin sesión, 403 sin permiso, 422 con filtros inválidos.
 */
export async function responderExportacion(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos | null,
  request: Request,
  ip: string | null,
): Promise<Response> {
  if (!usuario) return texto("Tu sesión venció: volvé a ingresar.", 401);
  const { entrada } = leerParametrosBusqueda(parametrosDe(new URL(request.url).searchParams));
  try {
    const csv = await servicio.exportarCsv(usuario, entrada, { ip });
    return new Response(csv.contenido, {
      status: 200,
      headers: {
        "Content-Type": csv.tipo,
        "Content-Disposition": `attachment; filename="${csv.nombreArchivo}"; filename*=UTF-8''${encodeURIComponent(csv.nombreArchivo)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Filas": String(csv.filas),
        "X-Truncado": csv.truncado ? "1" : "0",
      },
    });
  } catch (e) {
    const error = estadoDeError(e);
    return texto(error.mensaje, error.codigo === "permiso" ? 403 : 422);
  }
}
