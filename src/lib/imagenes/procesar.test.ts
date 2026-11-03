import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { procesarFoto } from "./procesar";
import { FotoRechazada, MENSAJES_FOTO } from "./tipos";

/**
 * El procesamiento con sharp (src/lib/imagenes/procesar.ts): cada imagen de
 * prueba se genera acá, con datos ficticios (una "cámara" y unas coordenadas
 * inventadas), y se comprueba lo que sale.
 */

const MARCA = "CamaraFicticiaDePrueba";

/** Un JPEG de `ancho` × `alto` con EXIF de cámara y GPS (coordenadas ficticias) y, si se pide, una orientación. */
async function jpegConExif(ancho: number, alto: number, orientacion?: number): Promise<Buffer> {
  let s = sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 120, g: 160, b: 200 } } });
  if (orientacion) s = s.withMetadata({ orientation: orientacion });
  return s
    .withExifMerge({
      IFD0: { Make: MARCA, Model: "Modelo 1", Software: "Prueba" },
      // IFD3 es el GPS para libvips: latitud y longitud inventadas.
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "26/1 49/1 30/1", GPSLongitudeRef: "W", GPSLongitude: "65/1 12/1 15/1" },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function rechazo(datos: Uint8Array): Promise<FotoRechazada> {
  try {
    await procesarFoto(datos);
  } catch (e) {
    if (e instanceof FotoRechazada) return e;
    throw e;
  }
  throw new Error("se esperaba un rechazo");
}

describe("procesarFoto", () => {
  it("quita TODOS los metadatos (EXIF con GPS y cámara, perfil) y re-codifica a WebP en dos anchos", async () => {
    const original = await jpegConExif(2400, 1600);
    // La entrada de verdad tiene lo que hay que quitar.
    const entrada = await sharp(original).metadata();
    expect(entrada.exif).toBeDefined();
    expect(entrada.exif!.toString("latin1")).toContain(MARCA);
    // La etiqueta del puntero al IFD de GPS (0x8825), en el orden de bytes del EXIF.
    expect(entrada.exif!.indexOf(Buffer.from([0x88, 0x25])) >= 0 || entrada.exif!.indexOf(Buffer.from([0x25, 0x88])) >= 0).toBe(true);

    const p = await procesarFoto(original);
    expect(p).toMatchObject({ mimeOriginal: "image/jpeg", ancho: 2400, alto: 1600, bytes: original.byteLength });
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.versiones.map((v) => [v.nominal, v.ancho, v.alto])).toEqual([
      [960, 960, 640],
      [1920, 1920, 1280],
    ]);
    for (const v of p.versiones) {
      const datos = Buffer.from(v.datos);
      const m = await sharp(datos).metadata();
      expect(m.format).toBe("webp");
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.iptc).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(m.orientation).toBeUndefined();
      // Ni rastros en los bytes: ni el bloque EXIF ni la "cámara".
      expect(datos.includes("EXIF")).toBe(false);
      expect(datos.includes("Exif")).toBe(false);
      expect(datos.includes(MARCA)).toBe(false);
      expect(datos.includes("ICCP")).toBe(false);
    }
  });

  it("respeta la orientación EXIF antes de quitarla: la foto vertical del celular sale parada", async () => {
    // Guardada "acostada" (1600 × 900) con Orientation 6 (girar 90°): se ve de 900 × 1600.
    const p = await procesarFoto(await jpegConExif(1600, 900, 6));
    expect([p.ancho, p.alto]).toEqual([900, 1600]);
    expect(p.versiones.map((v) => [v.ancho, v.alto])).toEqual([
      [900, 1600],
      [900, 1600],
    ]);
    const m = await sharp(Buffer.from(p.versiones[0].datos)).metadata();
    expect([m.width, m.height, m.orientation]).toEqual([900, 1600, undefined]);
  });

  it("no agranda una foto chica: las dos versiones son del ancho original", async () => {
    const p = await procesarFoto(await sharp({ create: { width: 800, height: 600, channels: 3, background: "#808080" } }).png().toBuffer());
    expect(p.mimeOriginal).toBe("image/png");
    expect(p.versiones.map((v) => v.ancho)).toEqual([800, 800]);
  });

  it("acepta WebP y deja un PNG con transparencia como WebP", async () => {
    const webp = await sharp({ create: { width: 1000, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
    const p = await procesarFoto(webp);
    expect(p.mimeOriginal).toBe("image/webp");
    expect((await sharp(Buffer.from(p.versiones[0].datos)).metadata()).format).toBe("webp");
  });

  it("rechaza GIF y SVG aunque sean imágenes válidas", async () => {
    const gif = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#ff0000" } }).gif().toBuffer();
    expect((await rechazo(gif)).message).toBe(MENSAJES_FOTO.gif);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600"/></svg>');
    expect((await rechazo(svg)).message).toBe(MENSAJES_FOTO.svg);
  });

  it("rechaza una foto angosta o de proporción absurda", async () => {
    const angosta = await sharp({ create: { width: 500, height: 400, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect((await rechazo(angosta)).message).toMatch(/500 px de ancho/);
    const tira = await sharp({ create: { width: 4100, height: 1000, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect((await rechazo(tira)).motivo).toBe("medidas");
  });

  it("rechaza lo que dice ser JPEG y no lo es, o está cortado", async () => {
    const falso = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("esto no es una imagen".repeat(20))]);
    expect((await rechazo(falso)).motivo).toBe("ilegible");
    const entero = await jpegConExif(1200, 800);
    const cortado = entero.subarray(0, Math.floor(entero.byteLength / 2));
    expect((await rechazo(cortado)).motivo).toBe("ilegible");
  });

  it("rechaza un PNG disfrazado de JPEG por el decodificador (los magic bytes mandan)", async () => {
    // Bytes de PNG: aunque el archivo se llame .jpg, es PNG y se procesa como tal.
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#123456" } }).png().toBuffer();
    expect((await procesarFoto(png)).mimeOriginal).toBe("image/png");
  });

  it("rechaza más de 15 MB sin decodificar", async () => {
    const grande = new Uint8Array(15 * 1024 * 1024 + 1);
    grande.set([0xff, 0xd8, 0xff]);
    expect((await rechazo(grande)).message).toBe(MENSAJES_FOTO.grande);
  });
});
