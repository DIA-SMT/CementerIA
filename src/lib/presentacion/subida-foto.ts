import type { EstadoError } from "./errores";
import { mensajeRechazoStorage } from "./subida-directa";
import { BYTES_CABECERA_FOTO, detectarTipoFoto, MENSAJES_FOTO, rechazoPorCabecera, rechazoPorMedidas, rechazoPorTamano, type MimeFoto } from "@/lib/imagenes/tipos";

/**
 * La subida de una foto del sitio público desde el navegador (30/10/2026;
 * docs/api-dominio.md, sección 25.7). Dos transportes, como los adjuntos:
 *
 * - `app` (el disco: servidor municipal y desarrollo): `POST /api/sitio/fotos`
 *   con la foto como cuerpo y el texto en la query.
 * - `directa` (Supabase Storage, Vercel: una función no recibe más de 4,5 MB
 *   y una foto llega a 15): autorizar → PUT del original a la URL firmada →
 *   confirmar.
 *
 * En los dos, el servidor vuelve a mirar todo y re-codifica la foto: lo de acá
 * es para avisar antes y no subir 15 MB para nada. Sin módulos de servidor:
 * corre en el navegador (y en los tests, con un `fetch` falso).
 */

export type ModoSubidaFoto = "app" | "directa";

export interface TextoFoto {
  alt: string;
  credito: string;
}

export type RespuestaFoto = { ok: true; id: string; alt: string; src: string } | EstadoError;

const MENSAJE_RED = "No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.";

export const RUTA_SUBIR_FOTO = "/api/sitio/fotos";
export const RUTA_AUTORIZAR_FOTO = "/api/sitio/fotos/autorizar";
export const RUTA_CONFIRMAR_FOTO = "/api/sitio/fotos/confirmar";

function fallo(codigo: string, mensaje: string): EstadoError {
  return { ok: false, codigo, mensaje, errores: [{ ruta: "archivo", mensaje }] };
}

/** El mensaje para una respuesta que no es JSON de la app (413 de nginx o de Vercel, 401, un 5xx). */
export function mensajeRespuestaFoto(status: number): string {
  if (status === 413) return MENSAJES_FOTO.grande;
  if (status === 401) return "Tu sesión venció: volvé a ingresar y subila de nuevo.";
  if (status === 403) return "No podés subir fotos al sitio público.";
  return "No se pudo subir la foto. Probá de nuevo en un momento.";
}

/** La URL de la subida por la app, con el texto en la query. */
export function urlSubidaFoto(t: TextoFoto): string {
  const q = new URLSearchParams({ alt: t.alt });
  if (t.credito.trim() !== "") q.set("credito", t.credito);
  return `${RUTA_SUBIR_FOTO}?${q.toString()}`;
}

/**
 * Revisa la foto elegida antes de subirla: tipo por los primeros bytes,
 * tamaño y, si el navegador la puede leer, medidas (ya orientada). Devuelve el
 * tipo o el mensaje.
 */
export function revisarFotoElegida(bytes: number, cabecera: Uint8Array, medidas: { ancho: number; alto: number } | null): { ok: true; mime: MimeFoto } | { ok: false; mensaje: string } {
  const tipo = rechazoPorCabecera(cabecera);
  if (tipo) return { ok: false, mensaje: tipo };
  const tamano = rechazoPorTamano(bytes);
  if (tamano) return { ok: false, mensaje: tamano };
  if (medidas) {
    const m = rechazoPorMedidas(medidas.ancho, medidas.alto);
    if (m) return { ok: false, mensaje: m };
  }
  return { ok: true, mime: detectarTipoFoto(cabecera) as MimeFoto };
}

/** Solo navegador: la cabecera y las medidas (si el navegador sabe decodificarla). */
export async function leerFotoElegida(archivo: File): Promise<{ ok: true; mime: MimeFoto } | { ok: false; mensaje: string }> {
  const cabecera = new Uint8Array(await archivo.slice(0, BYTES_CABECERA_FOTO).arrayBuffer());
  let medidas: { ancho: number; alto: number } | null = null;
  if (!rechazoPorCabecera(cabecera)) {
    try {
      // `imageOrientation: "from-image"`: las medidas como se ven (una vertical del celular, parada).
      const bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" });
      medidas = { ancho: bitmap.width, alto: bitmap.height };
      bitmap.close();
    } catch {
      medidas = null; // que decida el servidor
    }
  }
  return revisarFotoElegida(archivo.size, cabecera, medidas);
}

async function leerRespuesta(r: Response): Promise<RespuestaFoto> {
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j || typeof j !== "object" || !("ok" in j)) return fallo(String(r.status), mensajeRespuestaFoto(r.status));
  return j as unknown as RespuestaFoto;
}

async function postJson(pedir: typeof fetch, url: string, cuerpo: unknown): Promise<RespuestaFoto | { ok: true; [k: string]: unknown }> {
  let r: Response;
  try {
    r = await pedir(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  } catch {
    return fallo("red", MENSAJE_RED);
  }
  return leerRespuesta(r) as Promise<RespuestaFoto | { ok: true; [k: string]: unknown }>;
}

export async function subirFoto(
  archivo: Blob,
  mime: MimeFoto,
  texto: TextoFoto,
  modo: ModoSubidaFoto,
  pedir: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<RespuestaFoto> {
  if (modo === "app") {
    let r: Response;
    try {
      r = await pedir(urlSubidaFoto(texto), { method: "POST", headers: { "Content-Type": mime }, body: archivo });
    } catch {
      return fallo("red", MENSAJE_RED);
    }
    return leerRespuesta(r);
  }

  // 1. Autorización.
  const a = await postJson(pedir, RUTA_AUTORIZAR_FOTO, { alt: texto.alt, credito: texto.credito, bytes: archivo.size });
  if (!a.ok) return a;
  const subida = (a as { subida?: { url?: unknown; ticket?: unknown } }).subida;
  if (!subida || typeof subida.url !== "string" || typeof subida.ticket !== "string") return fallo("validacion", "No se pudo subir la foto. Probá de nuevo en un momento.");

  // 2. El original, directo a Storage.
  let r: Response;
  try {
    r = await pedir(subida.url, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" }, body: archivo });
  } catch {
    return fallo("red", MENSAJE_RED);
  }
  if (!r.ok) {
    const mensaje = mensajeRechazoStorage(r.status, await r.json().catch(() => null));
    // Los mensajes de los adjuntos hablan de "10 MB" y de PDF: para una foto, los de acá.
    return fallo(String(r.status), r.status === 413 || /10 MB/.test(mensaje) ? MENSAJES_FOTO.grande : /PDF/.test(mensaje) ? MENSAJES_FOTO.tipo : mensaje);
  }

  // 3. Confirmación: el servidor la procesa y la registra.
  const c = await postJson(pedir, RUTA_CONFIRMAR_FOTO, { ticket: subida.ticket, alt: texto.alt, credito: texto.credito });
  return c as RespuestaFoto;
}
