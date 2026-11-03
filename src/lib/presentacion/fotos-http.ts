import { mismoOrigen } from "@/lib/auth/red";
import type { AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
import { firmarTicket, verificarTicket } from "@/lib/adjuntos/ticket";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { exigirPermiso, type UsuarioPermisos } from "@/lib/dominio/permisos";
import type { ServicioSitio } from "@/lib/dominio/sitio";
import { LARGO_VERSION_FOTO } from "@/lib/dominio/sitio/imagenes";
import { RE_UUID } from "@/lib/dominio/sitio/validacion";
import { MAXIMO_BYTES_FOTO, MENSAJES_FOTO } from "@/lib/imagenes/tipos";
import { descartarCuerpo, errorJson, json, leerPedidoJson } from "./adjuntos-http";
import { estadoDeError } from "./errores";

/**
 * Los Route Handlers de las fotos del sitio público (30/10/2026;
 * docs/api-dominio.md, sección 25.7), sin Next: reciben el servicio, el
 * usuario de la sesión (o null) y el Request, y devuelven la Response. Los
 * `route.ts` ponen la sesión y el servicio de la app; los tests llaman a esto
 * con la base de prueba y un almacén temporal.
 *
 * Subida (Dirección y admin, permiso `editar_sitio_publico`; JSON de vuelta):
 * - por la app, `POST /api/sitio/fotos?alt=&credito=` con la foto como cuerpo,
 *   leída en streaming hasta 15 MB (el disco, o un servidor sin el límite de
 *   4,5 MB de Vercel);
 * - directa a Supabase Storage (Vercel): `POST /api/sitio/fotos/autorizar`
 *   `{ alt, credito, bytes }` → `{ ok, subida: { url, ticket } }`; el navegador
 *   hace PUT del original a `url` (tmp/<uuid> del bucket `sitio-publico`); y
 *   `POST /api/sitio/fotos/confirmar` `{ ticket, alt, credito }`.
 *
 * Lectura, pública y sin sesión: `GET /sitio/fotos/<id>/<versión>-<960|1920>.webp`
 * (`responderFotoPublica`).
 */

/** El "expediente" del ticket de una foto: no hay, es el sitio. */
const DESTINO_TICKET = "sitio";

function statusFoto(codigo: string): number {
  switch (codigo) {
    case "permiso":
      return 403;
    case "no_encontrado":
      return 404;
    case "ya_existe":
    case "limite_alcanzado":
      return 409;
    case "imagen_invalida":
      return 415;
    default:
      return 422;
  }
}

function respuestaDeError(e: unknown): Response {
  const estado = estadoDeError(e);
  return json(estado, statusFoto(estado.codigo));
}

const cadena = (v: unknown): string => (typeof v === "string" ? v : "");

/** Lee el cuerpo entero (la foto) hasta `max`; más, y corta. */
async function leerCuerpo(cuerpo: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | "grande"> {
  if (!cuerpo) return new Uint8Array();
  const lector = cuerpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lector.cancel().catch(() => undefined);
        return "grande";
      }
      partes.push(value);
    }
  } finally {
    lector.releaseLock();
  }
  return Buffer.concat(partes);
}

/** `POST /api/sitio/fotos`: la foto como cuerpo, el texto en la query. */
export async function responderSubidaFoto(servicio: ServicioSitio, usuario: UsuarioPermisos | null, request: Request): Promise<Response> {
  if (!usuario) {
    await descartarCuerpo(request);
    return errorJson("sin_sesion", "Tu sesión venció: volvé a ingresar.", 401);
  }
  if (!mismoOrigen(request.headers)) {
    await descartarCuerpo(request);
    return errorJson("permiso", "Origen no permitido", 403);
  }
  // Antes de leer hasta 15 MB: quien no puede subir no manda nada (el dominio lo vuelve a controlar).
  try {
    exigirPermiso("editar_sitio_publico", null, usuario);
  } catch (e) {
    await descartarCuerpo(request);
    return respuestaDeError(e);
  }
  const grande = () => json(estadoDeError(new ErrorDominio("imagen_invalida", MENSAJES_FOTO.grande, [{ ruta: "archivo", mensaje: "Máximo 15 MB" }])), 413);
  const largo = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(largo) && largo > MAXIMO_BYTES_FOTO) {
    await descartarCuerpo(request);
    return grande();
  }
  const url = new URL(request.url);
  const entrada = { alt: url.searchParams.get("alt") ?? "", credito: url.searchParams.get("credito") ?? "" };
  try {
    const original = await leerCuerpo(request.body, MAXIMO_BYTES_FOTO);
    if (original === "grande") return grande();
    const r = await servicio.subirFoto(usuario, original, entrada);
    return json({ ok: true, ...r }, 201);
  } catch (e) {
    await descartarCuerpo(request);
    return respuestaDeError(e);
  }
}

/** `POST /api/sitio/fotos/autorizar`: los controles y la URL firmada, con el ticket. */
export async function responderAutorizacionFoto(servicio: ServicioSitio, usuario: UsuarioPermisos | null, request: Request, secreto: string): Promise<Response> {
  const pedido = await leerPedidoJson(usuario, request);
  if (!pedido.ok) return pedido.respuesta;
  const u = usuario as UsuarioPermisos;
  const { cuerpo } = pedido;
  try {
    const bytes = typeof cuerpo.bytes === "number" && Number.isFinite(cuerpo.bytes) ? cuerpo.bytes : null;
    const subida = await servicio.autorizarSubidaFoto(u, { alt: cadena(cuerpo.alt), credito: cadena(cuerpo.credito) }, bytes);
    const ticket = firmarTicket(secreto, { usuarioId: u.id, numero: DESTINO_TICKET, comando: "", tipo: "foto_sitio" }, subida.id);
    return json({ ok: true, subida: { url: subida.url, ticket } }, 200);
  } catch (e) {
    return respuestaDeError(e);
  }
}

/** `POST /api/sitio/fotos/confirmar`: con el original ya en Storage, lo procesa y lo registra. */
export async function responderConfirmacionFoto(servicio: ServicioSitio, usuario: UsuarioPermisos | null, request: Request, secreto: string): Promise<Response> {
  const pedido = await leerPedidoJson(usuario, request);
  if (!pedido.ok) return pedido.respuesta;
  const u = usuario as UsuarioPermisos;
  const { cuerpo } = pedido;
  const ticket = verificarTicket(secreto, cadena(cuerpo.ticket), { usuarioId: u.id, numero: DESTINO_TICKET, comando: "", tipo: "foto_sitio" });
  if (!ticket.ok) {
    return ticket.motivo === "vencido"
      ? errorJson("validacion", "Pasó demasiado tiempo desde que elegiste la foto: subila de nuevo.", 422)
      : errorJson("permiso", "La subida no es válida: volvé a elegir la foto.", 403);
  }
  try {
    const r = await servicio.confirmarSubidaFoto(u, ticket.id, { alt: cadena(cuerpo.alt), credito: cadena(cuerpo.credito) });
    return json({ ok: true, ...r }, 201);
  } catch (e) {
    return respuestaDeError(e);
  }
}

// ---------------------------------------------------------------------------
// La foto pública
// ---------------------------------------------------------------------------

/**
 * Lo que cachea una foto: un año en el navegador, `immutable` (la URL lleva
 * la versión, los primeros 16 del sha256: una foto distinta es otra URL), y
 * un día en el CDN de Vercel (`s-maxage`): así, una foto dada de baja deja de
 * servirse desde el CDN a más tardar al día siguiente. Cada vez que el CDN no
 * la tiene (un "miss"), es una invocación de la función.
 */
export const CACHE_FOTO = "public, max-age=31536000, s-maxage=86400, immutable";

/** El nombre del archivo en la URL: `<16 hex>-<960|1920>.webp`. */
const RE_ARCHIVO = new RegExp(`^([0-9a-f]{${LARGO_VERSION_FOTO}})-(960|1920)\\.webp$`);

export interface LectorFotoPublica {
  sitioFoto: {
    findUnique(args: { where: { id: string }; select: { ruta: true; sha256: true; activa: true } }): Promise<{ ruta: string; sha256: string; activa: boolean } | null>;
  };
}

function noEncontrada(): Response {
  return new Response("No existe", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * `GET /sitio/fotos/[id]/[archivo]`: solo una foto ACTIVA y con la versión
 * correcta; todo lo demás (id inválido, foto dada de baja, otra versión, otro
 * ancho, otro nombre) es 404 igual, sin decir por qué. No hay listado: el id
 * es un uuid aleatorio y la versión sale del sha256, así que no se puede
 * enumerar.
 */
export async function responderFotoPublica(
  leer: LectorFotoPublica,
  almacen: Pick<AlmacenAdjuntos, "abrir">,
  id: string,
  archivo: string,
  alFallar?: (e: unknown) => void,
): Promise<Response> {
  const m = RE_ARCHIVO.exec(archivo);
  if (!RE_UUID.test(id) || !m) return noEncontrada();
  const [, version, ancho] = m;
  let foto: { ruta: string; sha256: string; activa: boolean } | null;
  try {
    foto = await leer.sitioFoto.findUnique({ where: { id }, select: { ruta: true, sha256: true, activa: true } });
  } catch (e) {
    alFallar?.(e);
    return new Response("No disponible", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
  if (!foto || !foto.activa || !foto.sha256.startsWith(version)) return noEncontrada();
  try {
    const a = await almacen.abrir(`${foto.ruta}/${ancho}.webp`);
    const headers: Record<string, string> = {
      "Content-Type": "image/webp",
      "Cache-Control": CACHE_FOTO,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    };
    if (a.bytes !== null) headers["Content-Length"] = String(a.bytes);
    return new Response(a.contenido, { status: 200, headers });
  } catch (e) {
    // La fila está y el archivo no: un defecto (o el almacén caído). Para quien mira, no existe.
    alFallar?.(e);
    return noEncontrada();
  }
}
