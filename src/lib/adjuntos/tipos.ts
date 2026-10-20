/**
 * Tipos de archivo admitidos como adjunto (docs/propuesta-mvp.md, sección 6,
 * "Adjuntos"): PDF, JPG y PNG de hasta 10 MB, reconocidos por sus primeros
 * bytes (*magic bytes*) y no por el nombre ni por el `Content-Type` que manda
 * el navegador, que los elige quien sube el archivo.
 *
 * Puro: lo usan el dominio (al recibir) y, si quiere, el navegador (para
 * avisar antes de subir).
 */

export const MAXIMO_BYTES_ADJUNTO = 10 * 1024 * 1024;

/** Cuántos bytes del comienzo hacen falta para reconocer el tipo (HEIC mira hasta el 12). */
export const BYTES_CABECERA = 16;

export type MimeAdjunto = "application/pdf" | "image/jpeg" | "image/png";

export interface TipoAdjunto {
  mime: MimeAdjunto;
  extension: "pdf" | "jpg" | "png";
}

const FIRMAS: ReadonlyArray<{ tipo: TipoAdjunto; bytes: readonly number[] }> = [
  // "%PDF-"
  { tipo: { mime: "application/pdf", extension: "pdf" }, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // JPEG: SOI (FF D8) seguido de otro marcador (FF).
  { tipo: { mime: "image/jpeg", extension: "jpg" }, bytes: [0xff, 0xd8, 0xff] },
  // PNG: \x89PNG\r\n\x1a\n
  { tipo: { mime: "image/png", extension: "png" }, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function empiezaCon(cabecera: Uint8Array, bytes: readonly number[], desde = 0): boolean {
  if (cabecera.length < desde + bytes.length) return false;
  return bytes.every((b, i) => cabecera[desde + i] === b);
}

/** El tipo del archivo por sus primeros bytes, o null si no es PDF, JPG ni PNG. */
export function detectarTipo(cabecera: Uint8Array): TipoAdjunto | null {
  return FIRMAS.find((f) => empiezaCon(cabecera, f.bytes))?.tipo ?? null;
}

const MARCAS_HEIF = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

/**
 * ¿Es una foto HEIC/HEIF de iPhone? Si llega una (el `accept` del input
 * debería evitarlo), el mensaje es "Subilo como JPG" (sección 6). Caja `ftyp`
 * en el byte 4 y la marca en el 8.
 */
export function esHeic(cabecera: Uint8Array): boolean {
  if (!empiezaCon(cabecera, [0x66, 0x74, 0x79, 0x70], 4) || cabecera.length < 12) return false;
  const marca = String.fromCharCode(cabecera[8], cabecera[9], cabecera[10], cabecera[11]);
  return MARCAS_HEIF.includes(marca);
}

/**
 * El nombre del archivo para guardar en el historial: solo el nombre (sin
 * carpetas, que algunos navegadores mandan), sin caracteres de control y de
 * hasta 150 caracteres. No se usa para el archivo en disco, que se guarda con
 * un UUID.
 */
export function limpiarNombreArchivo(nombre: string | null | undefined): string {
  const base = (nombre ?? "").split(/[\\/]/).pop() ?? "";
  const limpio = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (limpio === "" || limpio === "." || limpio === "..") return "archivo";
  return limpio.length > 150 ? limpio.slice(limpio.length - 150) : limpio;
}
