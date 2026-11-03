/**
 * Las fotos que sube la Dirección para el sitio público (30/10/2026;
 * docs/api-dominio.md, sección 25.7): qué se acepta, reconocido por los
 * primeros bytes del archivo (*magic bytes*) y no por la extensión ni por el
 * `Content-Type`, que los elige quien sube. Puro y sin módulos de Node: lo usan
 * el servidor (./procesar.ts, que además decodifica la imagen) y el navegador,
 * para avisar antes de subir.
 *
 * Los mismos límites los repiten los CHECKs de la migración *_sitio_fotos.
 */

/** Hasta 15 MB el original (una foto de celular de 50 MP en JPEG pesa 10 a 14 MB). */
export const MAXIMO_BYTES_FOTO = 15 * 1024 * 1024;
/** Más angosta no sirve ni para la tarjeta de un cementerio. */
export const ANCHO_MINIMO_FOTO = 600;
/** La proporción ancho/alto: de 1:2 (vertical) a 4:1 (panorámica). */
export const PROPORCION_MINIMA = 0.5;
export const PROPORCION_MAXIMA = 4;
/** 100 megapíxeles: más es un archivo armado para agotar la memoria al decodificar. */
export const MAXIMO_PIXELES_FOTO = 100_000_000;
/** Las dos versiones que se guardan y se sirven (sin agrandar si el original es más chico). */
export const ANCHOS_FOTO = [960, 1920] as const;
export type AnchoFoto = (typeof ANCHOS_FOTO)[number];
/** Cuántas fotos activas puede haber a la vez. */
export const MAXIMO_FOTOS_ACTIVAS = 200;
/** Cuántos bytes del comienzo hacen falta para reconocer el tipo (WebP: RIFF…WEBP, 12). */
export const BYTES_CABECERA_FOTO = 16;
/** El `accept` del input: así iOS entrega JPEG en lugar de HEIC. */
export const ACCEPT_FOTO = "image/jpeg,image/png,image/webp";

export type MimeFoto = "image/jpeg" | "image/png" | "image/webp";

export const MENSAJES_FOTO = {
  vacia: "El archivo está vacío.",
  tipo: "Solo se admiten fotos JPG, PNG o WebP.",
  gif: "Los GIF no se admiten: subí la foto como JPG, PNG o WebP.",
  svg: "Los SVG no se admiten: subí una foto JPG, PNG o WebP.",
  heic: "Es una foto HEIC (iPhone): subila como JPG. En el iPhone: Ajustes > Cámara > Formatos > Más compatible.",
  grande: "La foto supera los 15 MB. Achicala un poco y probá de nuevo.",
  ilegible: "No se pudo leer la imagen: puede estar dañada o no ser lo que dice ser.",
  pixeles: "La foto tiene demasiados píxeles (más de 100 megapíxeles): achicala y probá de nuevo.",
} as const;

function empiezaCon(cabecera: Uint8Array, bytes: readonly number[], desde = 0): boolean {
  if (cabecera.length < desde + bytes.length) return false;
  return bytes.every((b, i) => cabecera[desde + i] === b);
}

/** El tipo de una foto por sus primeros bytes, o null si no es JPEG, PNG ni WebP. */
export function detectarTipoFoto(cabecera: Uint8Array): MimeFoto | null {
  // JPEG: SOI (FF D8) seguido de otro marcador (FF).
  if (empiezaCon(cabecera, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG: \x89PNG\r\n\x1a\n
  if (empiezaCon(cabecera, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: "RIFF" <largo, 4 bytes> "WEBP"
  if (empiezaCon(cabecera, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(cabecera, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

const MARCAS_HEIF = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif", "avis"];

/**
 * Por qué no sirve el archivo, mirando solo los primeros bytes, o null si es
 * JPEG, PNG o WebP. GIF, SVG y HEIC tienen su propio mensaje.
 */
export function rechazoPorCabecera(cabecera: Uint8Array): string | null {
  if (cabecera.length === 0) return MENSAJES_FOTO.vacia;
  if (detectarTipoFoto(cabecera)) return null;
  // "GIF87a" / "GIF89a"
  if (empiezaCon(cabecera, [0x47, 0x49, 0x46, 0x38])) return MENSAJES_FOTO.gif;
  // Caja `ftyp` en el byte 4 y la marca en el 8 (HEIC, HEIF, AVIF).
  if (empiezaCon(cabecera, [0x66, 0x74, 0x79, 0x70], 4) && cabecera.length >= 12) {
    const marca = String.fromCharCode(cabecera[8], cabecera[9], cabecera[10], cabecera[11]);
    if (MARCAS_HEIF.includes(marca)) return MENSAJES_FOTO.heic;
  }
  // SVG (o cualquier XML/HTML): texto que empieza con "<", quizás después de un BOM o espacios.
  const texto = String.fromCharCode(...cabecera.slice(0, BYTES_CABECERA_FOTO)).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart();
  if (texto.startsWith("<")) return MENSAJES_FOTO.svg;
  return MENSAJES_FOTO.tipo;
}

/** El tamaño del original, contra el máximo. */
export function rechazoPorTamano(bytes: number): string | null {
  if (bytes <= 0) return MENSAJES_FOTO.vacia;
  return bytes > MAXIMO_BYTES_FOTO ? MENSAJES_FOTO.grande : null;
}

/**
 * Las medidas del original (ya orientado): al menos 600 px de ancho, una
 * proporción razonable y no más de 100 megapíxeles. Devuelve el mensaje o null.
 */
export function rechazoPorMedidas(ancho: number, alto: number): string | null {
  if (!Number.isSafeInteger(ancho) || !Number.isSafeInteger(alto) || ancho <= 0 || alto <= 0) return MENSAJES_FOTO.ilegible;
  if (ancho * alto > MAXIMO_PIXELES_FOTO) return MENSAJES_FOTO.pixeles;
  if (ancho < ANCHO_MINIMO_FOTO) return `La foto tiene ${ancho} px de ancho: hacen falta ${ANCHO_MINIMO_FOTO} o más para que se vea bien.`;
  const proporcion = ancho / alto;
  if (proporcion < PROPORCION_MINIMA) return `La foto es demasiado alta para su ancho (${ancho} × ${alto} px): como mucho, el doble de alta que de ancha.`;
  if (proporcion > PROPORCION_MAXIMA) return `La foto es demasiado alargada (${ancho} × ${alto} px): como mucho, 4 veces más ancha que alta.`;
  return null;
}

/** El ancho real de una versión: el nominal (960, 1920) o el del original si es más chico. */
export function anchoDeVersion(nominal: AnchoFoto, anchoOriginal: number): number {
  return Math.min(nominal, anchoOriginal);
}

/** El alto que corresponde a un ancho, con la proporción del original. */
export function altoParaAncho(ancho: number, anchoOriginal: number, altoOriginal: number): number {
  return Math.max(1, Math.round((altoOriginal * ancho) / anchoOriginal));
}

/** La foto no sirve: el mensaje es para la persona que la subió (lo arma ./procesar.ts). */
export class FotoRechazada extends Error {
  constructor(
    mensaje: string,
    readonly motivo: "tipo" | "tamano" | "medidas" | "ilegible",
  ) {
    super(mensaje);
    this.name = "FotoRechazada";
  }
}

/** Una versión ya procesada de una foto. */
export interface VersionFoto {
  /** El nominal: 960 o 1920 (el nombre del archivo y de la URL). */
  nominal: AnchoFoto;
  ancho: number;
  alto: number;
  datos: Uint8Array;
}

/** Lo que devuelve el procesamiento: las dos versiones y lo que se guarda del original. */
export interface FotoProcesada {
  mimeOriginal: MimeFoto;
  /** Del original, ya orientado. */
  ancho: number;
  alto: number;
  bytes: number;
  sha256: string;
  versiones: VersionFoto[];
}
