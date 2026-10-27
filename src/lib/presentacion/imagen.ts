import { detectarTipo, esHeic, MAXIMO_BYTES_ADJUNTO, type MimeAdjunto } from "@/lib/adjuntos/tipos";

/**
 * Antes de subir un adjunto (docs/propuesta-mvp.md, sección 6, "Adjuntos"):
 * en el navegador se validan el tipo y el tamaño, y las imágenes se reducen a
 * 2000 px de lado mayor y se recomprimen como JPEG 0,8 con canvas. El servidor
 * vuelve a controlar todo (magic bytes y 10 MB): esto es para avisar antes y
 * no subir 8 MB de foto para nada.
 *
 * Lo de este módulo es puro (se prueba sin navegador); `reducirImagen()` usa
 * canvas y va solo en el navegador.
 */

export const LADO_MAXIMO_IMAGEN = 2000;
export const CALIDAD_JPEG = 0.8;
/** El `accept` del input: así iOS entrega JPEG en lugar de HEIC. */
export const ACCEPT_ADJUNTO = "image/jpeg,image/png,application/pdf";

export const MENSAJE_HEIC = "Es una foto HEIC (iPhone): subila como JPG. En el iPhone: Ajustes > Cámara > Formatos > Más compatible.";
export const MENSAJE_TIPO = "Solo se admiten PDF, JPG o PNG.";
export const MENSAJE_GRANDE = "El archivo supera los 10 MB. Achicalo o escanealo con menos resolución.";
export const MENSAJE_VACIO = "El archivo está vacío.";

const EXTENSIONES_HEIC = /\.(heic|heif)$/i;

export interface ArchivoElegido {
  name: string;
  type: string;
  size: number;
}

export type Revision = { ok: true; tipo: MimeAdjunto } | { ok: false; mensaje: string };

/**
 * Revisa el archivo elegido por su nombre, el tipo que dice el navegador y sus
 * primeros bytes (`cabecera`, al menos 16). Las imágenes no se rechazan por
 * tamaño acá: primero se reducen y se revisa el resultado (`revisarTamano`).
 */
export function revisarArchivo(archivo: ArchivoElegido, cabecera: Uint8Array): Revision {
  if (archivo.size === 0) return { ok: false, mensaje: MENSAJE_VACIO };
  if (esHeic(cabecera) || /^image\/hei[cf]/i.test(archivo.type) || EXTENSIONES_HEIC.test(archivo.name)) {
    return { ok: false, mensaje: MENSAJE_HEIC };
  }
  const tipo = detectarTipo(cabecera);
  if (!tipo) return { ok: false, mensaje: MENSAJE_TIPO };
  if (tipo.mime === "application/pdf" && archivo.size > MAXIMO_BYTES_ADJUNTO) return { ok: false, mensaje: MENSAJE_GRANDE };
  return { ok: true, tipo: tipo.mime };
}

/** El tamaño final (después de reducir), contra el máximo. */
export function revisarTamano(bytes: number): string | null {
  if (bytes === 0) return MENSAJE_VACIO;
  return bytes > MAXIMO_BYTES_ADJUNTO ? MENSAJE_GRANDE : null;
}

/** Las medidas reducidas: el lado mayor a `maximo` como mucho, sin agrandar y conservando la proporción. */
export function medidasReducidas(ancho: number, alto: number, maximo = LADO_MAXIMO_IMAGEN): { ancho: number; alto: number; reducida: boolean } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= maximo || mayor === 0) return { ancho, alto, reducida: false };
  const factor = maximo / mayor;
  return { ancho: Math.max(1, Math.round(ancho * factor)), alto: Math.max(1, Math.round(alto * factor)), reducida: true };
}

/** "foto.png" → "foto.jpg" (la imagen recomprimida es JPEG). */
export function nombreJpeg(nombre: string): string {
  const base = nombre.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return `${base === "" ? "imagen" : base}.jpg`;
}

/**
 * Qué se sube: la versión recomprimida, salvo que la original no hiciera falta
 * reducirla y pese menos (una captura PNG chica pesa más como JPEG).
 */
export function elegirVersion(original: { bytes: number }, recomprimida: { bytes: number }, reducida: boolean): "original" | "recomprimida" {
  if (reducida) return "recomprimida";
  return original.bytes <= recomprimida.bytes ? "original" : "recomprimida";
}

/**
 * El mensaje para una respuesta del POST de adjuntos que no es JSON del
 * dominio (413 de nginx, 401 de la sesión vencida, un 5xx).
 */
export function mensajeRespuestaSubida(status: number): string {
  if (status === 413) return MENSAJE_GRANDE;
  if (status === 401) return "Tu sesión venció: volvé a ingresar y subilo de nuevo.";
  if (status === 403) return "No podés adjuntar en este expediente.";
  return "No se pudo subir el archivo. Probá de nuevo en un momento.";
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

export interface ArchivoParaSubir {
  contenido: Blob;
  nombre: string;
  /** El tipo por magic bytes (no el que dice el navegador): la subida directa lo manda como Content-Type. */
  mime: MimeAdjunto;
}

/**
 * Revisa el archivo y, si es una imagen, la reduce y la recomprime con canvas.
 * Devuelve lo que hay que subir o el mensaje para el usuario. Solo navegador.
 */
export async function prepararArchivo(archivo: File): Promise<{ ok: true; archivo: ArchivoParaSubir } | { ok: false; mensaje: string }> {
  const cabecera = new Uint8Array(await archivo.slice(0, 16).arrayBuffer());
  const revision = revisarArchivo(archivo, cabecera);
  if (!revision.ok) return revision;
  if (revision.tipo === "application/pdf") return { ok: true, archivo: { contenido: archivo, nombre: archivo.name, mime: revision.tipo } };

  let resultado: { blob: Blob; reducida: boolean };
  try {
    resultado = await recomprimir(archivo);
  } catch {
    return { ok: false, mensaje: "No se pudo leer la imagen. Probá con otra foto o con un PDF." };
  }
  const usar = elegirVersion({ bytes: archivo.size }, { bytes: resultado.blob.size }, resultado.reducida);
  const final: ArchivoParaSubir =
    usar === "original"
      ? { contenido: archivo, nombre: archivo.name, mime: revision.tipo }
      : { contenido: resultado.blob, nombre: nombreJpeg(archivo.name), mime: "image/jpeg" };
  const problema = revisarTamano(final.contenido.size);
  return problema ? { ok: false, mensaje: problema } : { ok: true, archivo: final };
}

async function recomprimir(archivo: Blob): Promise<{ blob: Blob; reducida: boolean }> {
  const bitmap = await createImageBitmap(archivo);
  try {
    const m = medidasReducidas(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = m.ancho;
    canvas.height = m.alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Sin canvas 2d");
    // Un PNG con transparencia queda sobre blanco (JPEG no tiene canal alfa).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, m.ancho, m.alto);
    ctx.drawImage(bitmap, 0, 0, m.ancho, m.alto);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", CALIDAD_JPEG));
    if (!blob) throw new Error("toBlob devolvió null");
    return { blob, reducida: m.reducida };
  } finally {
    bitmap.close();
  }
}
