import { prisma } from "@/lib/db/cliente";
import { almacenFotos } from "@/lib/dominio/sitio/servidor";
import { log, resumenError } from "@/lib/log";
import { responderFotoPublica } from "@/lib/presentacion/fotos-http";

/**
 * GET /sitio/fotos/[id]/[archivo] (30/10/2026; docs/api-dominio.md, sección
 * 25.7): una foto que subió la Dirección, para la página pública y sin
 * sesión. `archivo` es `<16 primeros del sha256>-<960|1920>.webp`. Solo sirve
 * fotos ACTIVAS, como image/webp, con caché larga e `immutable` (la URL cambia
 * si cambia la foto) y `nosniff`; todo lo demás es 404. El archivo sale del
 * almacén de las fotos (el disco o el bucket PRIVADO `sitio-publico`) en
 * streaming: el bucket no es público y no hay URL firmada.
 *
 * Fuera del matcher de src/proxy.ts (`sitio/fotos(?:/|$)`): es pública, no
 * hay sesión que renovar. En Vercel, cada pedido que el CDN no tiene en caché
 * es una invocación de la función (docs/despliegue-vercel.md, "Fotos del sitio").
 */
export async function GET(_request: Request, ctx: RouteContext<"/sitio/fotos/[id]/[archivo]">): Promise<Response> {
  const { id, archivo } = await ctx.params;
  return responderFotoPublica(prisma, almacenFotos(), id, archivo, (e) => log.error("publico.foto_sitio_fallo", resumenError(e)));
}
