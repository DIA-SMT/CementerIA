import type { EstadoError } from "./errores";
import { MENSAJE_GRANDE, MENSAJE_TIPO, mensajeRespuestaSubida, type ArchivoParaSubir } from "./imagen";

/**
 * La subida directa de un adjunto desde el navegador a Supabase Storage
 * (ADJUNTOS_ALMACEN=supabase, el despliegue en Vercel: una función no recibe
 * más de 4,5 MB y un adjunto llega a 10 MB; docs/despliegue-vercel.md). Para
 * la persona es la misma pantalla: solo cambia el transporte.
 *
 * 1. `POST …/adjuntos/autorizar`: la app controla permisos, versión y comando
 *    y devuelve una URL firmada de subida (un solo destino, `tmp/<uuid>`) y un
 *    ticket. Si el comando ya se había usado, devuelve directamente el
 *    resultado de entonces.
 * 2. `PUT <url firmada>`: el archivo va del navegador a Storage. La URL lleva
 *    su token; la clave del servidor nunca llega acá.
 * 3. `POST …/adjuntos/confirmar`: la app lee el archivo desde Storage, lo
 *    verifica (tamaño, magic bytes, sha256) y registra el movimiento.
 *
 * Sin módulos de servidor: corre en el navegador (y en los tests, con un
 * `fetch` falso).
 */

export interface MetadatosSubida {
  documento: string | null;
  version: number;
  comando: string;
}

export type RespuestaSubida = { ok: true; version: number; nombre: string } | EstadoError;

const MENSAJE_RED = "No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.";
const MENSAJE_STORAGE = "No se pudo subir el archivo. Probá de nuevo en un momento.";

export function rutaAutorizar(numero: string): string {
  return `/api/expedientes/${encodeURIComponent(numero)}/adjuntos/autorizar`;
}

export function rutaConfirmar(numero: string): string {
  return `/api/expedientes/${encodeURIComponent(numero)}/adjuntos/confirmar`;
}

function fallo(codigo: string, mensaje: string): EstadoError {
  return { ok: false, codigo, mensaje, errores: [] };
}

/**
 * El mensaje para un rechazo de Storage al subir. Storage contesta con
 * `{ statusCode, error, message }`, a veces con el código real en
 * `statusCode` y un 400 en el HTTP.
 */
export function mensajeRechazoStorage(status: number, cuerpo: unknown): string {
  const c = (typeof cuerpo === "object" && cuerpo !== null ? cuerpo : {}) as { statusCode?: unknown; error?: unknown; message?: unknown };
  const codigo = Number(c.statusCode) || status;
  const texto = `${String(c.error ?? "")} ${String(c.message ?? "")}`;
  if (codigo === 413 || /too large|maximum allowed size|exceeded/i.test(texto)) return MENSAJE_GRANDE;
  if (codigo === 415 || /mime/i.test(texto)) return MENSAJE_TIPO;
  return MENSAJE_STORAGE;
}

/** Un POST JSON a la app; lo que no es la respuesta del dominio se traduce como en la subida de siempre. */
async function pedirApp(pedir: typeof fetch, url: string, cuerpo: unknown): Promise<{ ok: true; cuerpo: Record<string, unknown> } | { ok: false; error: EstadoError }> {
  let r: Response;
  try {
    r = await pedir(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  } catch {
    return { ok: false, error: fallo("red", MENSAJE_RED) };
  }
  const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json || typeof json !== "object" || !("ok" in json)) return { ok: false, error: fallo(String(r.status), mensajeRespuestaSubida(r.status)) };
  if (json.ok !== true) return { ok: false, error: json as unknown as EstadoError };
  return { ok: true, cuerpo: json };
}

export async function subirDirecto(
  numero: string,
  archivo: ArchivoParaSubir,
  meta: MetadatosSubida,
  pedir: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<RespuestaSubida> {
  // 1. Autorización.
  const a = await pedirApp(pedir, rutaAutorizar(numero), {
    documento: meta.documento,
    version: meta.version,
    comando: meta.comando,
    bytes: archivo.contenido.size,
  });
  if (!a.ok) return a.error;
  const subida = a.cuerpo.subida as { url?: unknown; ticket?: unknown } | undefined;
  // El comando ya se había usado (un reintento): lo de entonces.
  if (!subida) return a.cuerpo as unknown as RespuestaSubida;
  if (typeof subida.url !== "string" || typeof subida.ticket !== "string") return fallo("validacion", MENSAJE_STORAGE);

  // 2. El archivo, directo a Storage.
  let r: Response;
  try {
    r = await pedir(subida.url, {
      method: "PUT",
      headers: { "Content-Type": archivo.mime, "x-upsert": "false" },
      body: archivo.contenido,
    });
  } catch {
    return fallo("red", MENSAJE_RED);
  }
  if (!r.ok) return fallo(String(r.status), mensajeRechazoStorage(r.status, await r.json().catch(() => null)));

  // 3. Confirmación.
  const c = await pedirApp(pedir, rutaConfirmar(numero), {
    ticket: subida.ticket,
    nombre: archivo.nombre,
    documento: meta.documento,
    version: meta.version,
    comando: meta.comando,
  });
  if (!c.ok) return c.error;
  return c.cuerpo as unknown as RespuestaSubida;
}
