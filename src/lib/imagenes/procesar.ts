import "server-only";
import { createHash } from "node:crypto";
import {
  ANCHOS_FOTO,
  anchoDeVersion,
  BYTES_CABECERA_FOTO,
  MAXIMO_PIXELES_FOTO,
  MENSAJES_FOTO,
  rechazoPorCabecera,
  rechazoPorMedidas,
  rechazoPorTamano,
  detectarTipoFoto,
  FotoRechazada,
  type AnchoFoto,
  type FotoProcesada,
  type VersionFoto,
} from "./tipos";

export { FotoRechazada, type FotoProcesada, type VersionFoto };

/**
 * El procesamiento de una foto del sitio público (30/10/2026; docs/api-dominio.md,
 * sección 25.7), con sharp (libvips). El servidor nunca sirve el archivo tal
 * como lo mandó el navegador:
 *
 * 1. El tipo por los magic bytes (JPEG, PNG o WebP; GIF, SVG y HEIC, no), y
 *    que el decodificador diga lo mismo.
 * 2. Decodifica con `failOn: "error"` y un límite de píxeles (una "bomba" de
 *    descompresión no llega a ocupar la memoria) y solo el primer cuadro (un
 *    WebP o PNG animado queda quieto).
 * 3. Respeta la orientación EXIF (`autoOrient`) ANTES de quitarla: la foto
 *    de un celular sale derecha.
 * 4. Mide el original ya orientado: 600 px de ancho como mínimo y una
 *    proporción razonable (./tipos.ts).
 * 5. Re-codifica a WebP en dos anchos (960 y 1920, sin agrandar) en sRGB y
 *    SIN metadatos: sharp no copia EXIF (GPS, cámara, fecha), XMP, IPTC ni el
 *    perfil ICC salvo que se le pida (`keepMetadata`, `withMetadata`), y acá
 *    no se pide. La conversión a sRGB la hace sharp al salir; sin perfil, el
 *    navegador asume sRGB.
 *
 * Devuelve las dos versiones y lo que se guarda del original (medidas, bytes,
 * sha256). El original no se guarda en ningún lado.
 */

/**
 * sharp se carga recién al procesar la primera foto, no al importar este
 * módulo: lo importa (a través del servicio del sitio) también la página
 * pública, y un binario nativo que no cargara no tiene que poder tirarla.
 * Solo las rutas de subida lo usan (y next.config.ts les suma al rastreo las
 * bibliotecas de libvips, que el rastreo no ve: las carga el binario).
 */
let cargado: Promise<typeof import("sharp")> | undefined;
async function cargarSharp() {
  cargado ??= import("sharp");
  return (await cargado).default;
}

/** La calidad del WebP: la chica, un poco más (se ve en tarjetas, donde un artefacto se nota más). */
const CALIDAD: Record<AnchoFoto, number> = { 960: 82, 1920: 80 };

export async function procesarFoto(original: Uint8Array): Promise<FotoProcesada> {
  const problemaTamano = rechazoPorTamano(original.byteLength);
  if (problemaTamano) throw new FotoRechazada(problemaTamano, "tamano");
  const cabecera = original.subarray(0, BYTES_CABECERA_FOTO);
  const problemaTipo = rechazoPorCabecera(cabecera);
  const mime = detectarTipoFoto(cabecera);
  if (problemaTipo || !mime) throw new FotoRechazada(problemaTipo ?? MENSAJES_FOTO.tipo, "tipo");

  const entrada = Buffer.from(original.buffer, original.byteOffset, original.byteLength);
  const sharp = await cargarSharp();
  const opciones = { failOn: "error", limitInputPixels: MAXIMO_PIXELES_FOTO, autoOrient: true, animated: false, pages: 1 } as const;

  let ancho: number;
  let alto: number;
  try {
    const m = await sharp(entrada, opciones).metadata();
    // Lo que dice el decodificador tiene que coincidir con los magic bytes.
    const formato = m.format === "jpeg" ? "image/jpeg" : m.format === "png" ? "image/png" : m.format === "webp" ? "image/webp" : null;
    if (formato !== mime) throw new FotoRechazada(MENSAJES_FOTO.tipo, "tipo");
    // `autoOrient`: las medidas como se ven (una foto vertical del celular, con Orientation 6, viene "acostada").
    ancho = m.autoOrient?.width ?? m.width ?? 0;
    alto = m.autoOrient?.height ?? m.height ?? 0;
  } catch (e) {
    if (e instanceof FotoRechazada) throw e;
    throw new FotoRechazada(/pixel limit/i.test(String((e as Error)?.message)) ? MENSAJES_FOTO.pixeles : MENSAJES_FOTO.ilegible, "ilegible");
  }
  const problemaMedidas = rechazoPorMedidas(ancho, alto);
  if (problemaMedidas) throw new FotoRechazada(problemaMedidas, "medidas");

  const versiones: VersionFoto[] = [];
  try {
    for (const nominal of ANCHOS_FOTO) {
      const objetivo = anchoDeVersion(nominal, ancho);
      const { data, info } = await sharp(entrada, opciones)
        .resize({ width: objetivo, withoutEnlargement: true })
        .toColourspace("srgb")
        .webp({ quality: CALIDAD[nominal], effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      versiones.push({ nominal, ancho: info.width, alto: info.height, datos: data });
    }
  } catch {
    throw new FotoRechazada(MENSAJES_FOTO.ilegible, "ilegible");
  }

  return {
    mimeOriginal: mime,
    ancho,
    alto,
    bytes: original.byteLength,
    sha256: createHash("sha256").update(entrada).digest("hex"),
    versiones,
  };
}
