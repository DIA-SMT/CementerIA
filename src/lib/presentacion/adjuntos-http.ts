import { mismoOrigen } from "@/lib/auth/red";
import { firmarTicket, verificarTicket } from "@/lib/adjuntos/ticket";
import { MAXIMO_BYTES_ADJUNTO } from "@/lib/adjuntos/tipos";
import type { ServicioExpedientes } from "@/lib/dominio/expedientes";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { estadoDeError } from "./errores";

/**
 * Los Route Handlers de adjuntos (docs/propuesta-mvp.md, secciones 5 y 6), sin
 * Next: reciben el servicio, el usuario de la sesión (o null) y el Request, y
 * devuelven la Response. Los `route.ts` solo ponen la sesión
 * (`getUsuarioActual()`) y el servicio de la app; los tests de integración
 * llaman a esto con el servicio de la base de prueba y un almacén temporal.
 *
 * - `POST /api/expedientes/[numero]/adjuntos?nombre=&documento=&version=&comando=`
 *   con el archivo como cuerpo (sin multipart: va directo, en streaming, a
 *   `subirAdjunto`). Responde JSON.
 * - `GET /adjuntos/[movimientoId]` (`?descargar=1`; `?motivo=` o el header
 *   `X-Motivo` cuando el dominio lo pide). Responde el archivo con los headers
 *   de la sección 6.
 * - Subida directa (almacén de Supabase Storage, Vercel), JSON en los dos:
 *   `POST /api/expedientes/[numero]/adjuntos/autorizar` `{ documento, version,
 *   comando, bytes }` → `{ ok, subida: { url, ticket } }` (o el resultado, si
 *   el comando ya se usó); el navegador hace PUT del archivo a `url`; y
 *   `POST /api/expedientes/[numero]/adjuntos/confirmar` `{ ticket, nombre,
 *   documento, version, comando }` → lo mismo que la subida de siempre.
 */

/** Headers de todo lo que sirve `/adjuntos/…`: el archivo no puede ejecutar nada ni reinterpretarse. */
export const HEADERS_SEGUROS = {
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
} as const;

/** El header con el que el visor puede mandar el motivo en vez de la query. */
export const HEADER_MOTIVO = "x-motivo";

/** Status HTTP de cada error del dominio. */
export function statusDeError(codigo: string): number {
  switch (codigo) {
    case "no_encontrado":
      return 404;
    case "permiso":
    case "motivo_requerido":
      return 403;
    case "conflicto_version":
    case "ya_recibido":
      return 409;
    case "adjunto_muy_grande":
      return 413;
    case "adjunto_invalido":
      return 415;
    default:
      return 422;
  }
}

function json(cuerpo: unknown, status: number): Response {
  return Response.json(cuerpo, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function descartarCuerpo(request: Request): Promise<void> {
  await request.body?.cancel().catch(() => undefined);
}

/** Un stream vacío: `subirAdjunto` lo rechaza con "El archivo está vacío". */
function flujoVacio(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start: (c) => c.close() });
}

/** `POST /api/expedientes/[numero]/adjuntos`. */
export async function responderSubida(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos | null,
  numero: string,
  request: Request,
): Promise<Response> {
  if (!usuario) {
    await descartarCuerpo(request);
    return json({ ok: false, codigo: "sin_sesion", mensaje: "Tu sesión venció: volvé a ingresar.", errores: [] }, 401);
  }
  // La cookie es SameSite=Lax, pero igual: una subida tiene que venir de la app.
  if (!mismoOrigen(request.headers)) {
    await descartarCuerpo(request);
    return json({ ok: false, codigo: "permiso", mensaje: "Origen no permitido", errores: [] }, 403);
  }
  // Si el navegador ya avisa que es más grande, no hace falta leerlo para rechazarlo.
  const largo = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(largo) && largo > MAXIMO_BYTES_ADJUNTO) {
    await descartarCuerpo(request);
    const e = new ErrorDominio("adjunto_muy_grande", "El archivo supera los 10 MB", [{ ruta: "archivo", mensaje: "Máximo 10 MB" }]);
    return json(estadoDeError(e), 413);
  }

  const url = new URL(request.url);
  const version = Number(url.searchParams.get("version"));
  try {
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new ErrorDominio("validacion", "Falta la versión del expediente: recargá la página", [{ ruta: "version", mensaje: "Falta la versión" }]);
    }
    const r = await servicio.subirAdjunto(
      usuario,
      numero,
      request.body ?? flujoVacio(),
      { nombre: url.searchParams.get("nombre") ?? "archivo", documento: url.searchParams.get("documento") || null },
      version,
      url.searchParams.get("comando") ?? "",
    );
    return json({ ok: true, ...r }, r.repetido ? 200 : 201);
  } catch (e) {
    await descartarCuerpo(request);
    const estado = estadoDeError(e);
    return json(estado, statusDeError(estado.codigo));
  }
}

// ---------------------------------------------------------------------------
// Subida directa al almacén (Supabase Storage)
// ---------------------------------------------------------------------------

/** El cuerpo JSON de autorizar y confirmar es chico: más que esto no es nuestro. */
const MAXIMO_JSON = 16 * 1024;

function errorJson(codigo: string, mensaje: string, status: number): Response {
  return json({ ok: false, codigo, mensaje, errores: [] }, status);
}

/** Los controles comunes de las dos llamadas: sesión, origen y un JSON chico. */
async function leerPedidoJson(usuario: UsuarioPermisos | null, request: Request): Promise<{ ok: true; cuerpo: Record<string, unknown> } | { ok: false; respuesta: Response }> {
  if (!usuario) {
    await descartarCuerpo(request);
    return { ok: false, respuesta: errorJson("sin_sesion", "Tu sesión venció: volvé a ingresar.", 401) };
  }
  if (!mismoOrigen(request.headers)) {
    await descartarCuerpo(request);
    return { ok: false, respuesta: errorJson("permiso", "Origen no permitido", 403) };
  }
  const largo = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(largo) && largo > MAXIMO_JSON) {
    await descartarCuerpo(request);
    return { ok: false, respuesta: errorJson("validacion", "Pedido inválido", 413) };
  }
  let cuerpo: unknown;
  try {
    const textoCuerpo = await request.text();
    if (textoCuerpo.length > MAXIMO_JSON) throw new Error("grande");
    cuerpo = JSON.parse(textoCuerpo);
  } catch {
    return { ok: false, respuesta: errorJson("validacion", "Pedido inválido: recargá la página y probá de nuevo.", 400) };
  }
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return { ok: false, respuesta: errorJson("validacion", "Pedido inválido: recargá la página y probá de nuevo.", 400) };
  }
  return { ok: true, cuerpo: cuerpo as Record<string, unknown> };
}

function versionDe(cuerpo: Record<string, unknown>): number {
  const version = Number(cuerpo.version);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new ErrorDominio("validacion", "Falta la versión del expediente: recargá la página", [{ ruta: "version", mensaje: "Falta la versión" }]);
  }
  return version;
}

const cadena = (v: unknown): string => (typeof v === "string" ? v : "");
const documentoDe = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function respuestaDeError(e: unknown): Response {
  const estado = estadoDeError(e);
  return json(estado, statusDeError(estado.codigo));
}

/**
 * `POST /api/expedientes/[numero]/adjuntos/autorizar`: los controles de
 * siempre y la URL firmada de subida, con el ticket que ata el temporal a
 * este usuario, expediente y comando (src/lib/adjuntos/ticket.ts).
 *
 * @param secreto SESSION_SECRET (firma el ticket).
 */
export async function responderAutorizacion(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos | null,
  numero: string,
  request: Request,
  secreto: string,
): Promise<Response> {
  const pedido = await leerPedidoJson(usuario, request);
  if (!pedido.ok) return pedido.respuesta;
  const u = usuario as UsuarioPermisos;
  const { cuerpo } = pedido;
  // Si el navegador ya dice que es más grande, no se firma nada (el bucket también lo rechazaría).
  if (typeof cuerpo.bytes === "number" && cuerpo.bytes > MAXIMO_BYTES_ADJUNTO) {
    return json(estadoDeError(new ErrorDominio("adjunto_muy_grande", "El archivo supera los 10 MB", [{ ruta: "archivo", mensaje: "Máximo 10 MB" }])), 413);
  }
  try {
    const comando = cadena(cuerpo.comando);
    const r = await servicio.autorizarSubidaAdjunto(u, numero, { documento: documentoDe(cuerpo.documento) }, versionDe(cuerpo), comando);
    if (r.tipo === "repetido") return json({ ok: true, ...r.resultado }, 200);
    const ticket = firmarTicket(secreto, { usuarioId: u.id, numero, comando }, r.subida.id);
    return json({ ok: true, subida: { url: r.subida.url, ticket } }, 200);
  } catch (e) {
    return respuestaDeError(e);
  }
}

/**
 * `POST /api/expedientes/[numero]/adjuntos/confirmar`: con el archivo ya en
 * el almacén, lo mide, lo registra y lo pone en su lugar (o borra el
 * temporal). Responde como `POST …/adjuntos`.
 */
export async function responderConfirmacion(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos | null,
  numero: string,
  request: Request,
  secreto: string,
): Promise<Response> {
  const pedido = await leerPedidoJson(usuario, request);
  if (!pedido.ok) return pedido.respuesta;
  const u = usuario as UsuarioPermisos;
  const { cuerpo } = pedido;
  const comando = cadena(cuerpo.comando);
  const ticket = verificarTicket(secreto, cadena(cuerpo.ticket), { usuarioId: u.id, numero, comando });
  if (!ticket.ok) {
    return ticket.motivo === "vencido"
      ? errorJson("validacion", "Pasó demasiado tiempo desde que elegiste el archivo: subilo de nuevo.", 422)
      : errorJson("permiso", "La subida no es válida: volvé a elegir el archivo.", 403);
  }
  try {
    const r = await servicio.confirmarSubidaAdjunto(
      u,
      numero,
      ticket.id,
      { nombre: cadena(cuerpo.nombre) || "archivo", documento: documentoDe(cuerpo.documento) },
      versionDe(cuerpo),
      comando,
    );
    return json({ ok: true, ...r }, r.repetido ? 200 : 201);
  } catch (e) {
    return respuestaDeError(e);
  }
}

function texto(mensaje: string, status: number): Response {
  return new Response(mensaje, { status, headers: { ...HEADERS_SEGUROS, "Content-Type": "text/plain; charset=utf-8" } });
}

/** `Content-Disposition` con el nombre en UTF-8 y una versión ASCII para los clientes viejos. */
export function disposicion(tipo: "inline" | "attachment", nombre: string): string {
  const ascii = nombre.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

/** `GET /adjuntos/[movimientoId]`. */
export async function responderLectura(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos | null,
  movimientoId: string,
  request: Request,
  ip: string | null,
): Promise<Response> {
  if (!usuario) return texto("Tu sesión venció: volvé a ingresar.", 401);
  const url = new URL(request.url);
  const motivo = url.searchParams.get("motivo") ?? request.headers.get(HEADER_MOTIVO);
  try {
    const a = await servicio.leerAdjunto(usuario, movimientoId, { descargar: url.searchParams.get("descargar") === "1", motivo, ip });
    return new Response(a.contenido, {
      headers: {
        ...HEADERS_SEGUROS,
        "Content-Type": a.mime,
        ...(a.bytes === null ? {} : { "Content-Length": String(a.bytes) }),
        "Content-Disposition": disposicion(a.disposicion, a.nombre),
      },
    });
  } catch (e) {
    if (e instanceof ErrorDominio || e instanceof PermisoDenegado) {
      const estado = estadoDeError(e);
      const mensaje =
        estado.codigo === "motivo_requerido" ? "Tu área no trabaja este expediente: para ver el adjunto, indicá el motivo desde la ficha." : estado.mensaje;
      return texto(mensaje, statusDeError(estado.codigo));
    }
    throw e;
  }
}
