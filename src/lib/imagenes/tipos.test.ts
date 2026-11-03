import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  altoParaAncho,
  anchoDeVersion,
  ANCHO_MINIMO_FOTO,
  detectarTipoFoto,
  MAXIMO_BYTES_FOTO,
  MAXIMO_PIXELES_FOTO,
  MENSAJES_FOTO,
  PROPORCION_MAXIMA,
  PROPORCION_MINIMA,
  rechazoPorCabecera,
  rechazoPorMedidas,
  rechazoPorTamano,
} from "./tipos";

const bytes = (...b: number[]) => new Uint8Array(b);
const texto = (t: string) => new TextEncoder().encode(t);

describe("el tipo de una foto, por sus magic bytes", () => {
  it.each([
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46), "image/jpeg"],
    ["PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d), "image/png"],
    ["WebP", new Uint8Array([...texto("RIFF"), 0x24, 0, 0, 0, ...texto("WEBPVP8 ")]), "image/webp"],
  ])("%s", (_n, cabecera, mime) => {
    expect(detectarTipoFoto(cabecera)).toBe(mime);
    expect(rechazoPorCabecera(cabecera)).toBeNull();
  });

  it.each([
    ["vacío", new Uint8Array(), MENSAJES_FOTO.vacia],
    ["GIF89a", texto("GIF89a\x01\x00\x01\x00"), MENSAJES_FOTO.gif],
    ["GIF87a", texto("GIF87a\x01\x00\x01\x00"), MENSAJES_FOTO.gif],
    ["SVG", texto('<svg xmlns="http://www.w3.org/2000/svg">'), MENSAJES_FOTO.svg],
    ["SVG con declaración XML", texto('<?xml version="1.0"?><svg>'), MENSAJES_FOTO.svg],
    ["SVG con BOM y espacios", new Uint8Array([0xef, 0xbb, 0xbf, ...texto("  <svg>")]), MENSAJES_FOTO.svg],
    ["HTML", texto("<!doctype html><script>"), MENSAJES_FOTO.svg],
    ["HEIC", new Uint8Array([0, 0, 0, 0x18, ...texto("ftypheic"), 0, 0, 0, 0]), MENSAJES_FOTO.heic],
    ["AVIF", new Uint8Array([0, 0, 0, 0x1c, ...texto("ftypavif"), 0, 0, 0, 0]), MENSAJES_FOTO.heic],
    ["PDF", texto("%PDF-1.7\n%"), MENSAJES_FOTO.tipo],
    ["RIFF que no es WebP (un WAV)", new Uint8Array([...texto("RIFF"), 0x24, 0, 0, 0, ...texto("WAVEfmt ")]), MENSAJES_FOTO.tipo],
    ["JPEG cortado (solo FF D8)", bytes(0xff, 0xd8), MENSAJES_FOTO.tipo],
  ])("rechaza %s", (_n, cabecera, mensaje) => {
    expect(detectarTipoFoto(cabecera)).toBeNull();
    expect(rechazoPorCabecera(cabecera)).toBe(mensaje);
  });

  it("no le importa la extensión ni lo que diga el navegador: solo los bytes", () => {
    // Un PNG "llamado" foto.jpg y mandado como image/jpeg sigue siendo PNG.
    expect(detectarTipoFoto(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });
});

describe("tamaño y medidas", () => {
  it("hasta 15 MB, y no vacío", () => {
    expect(rechazoPorTamano(MAXIMO_BYTES_FOTO)).toBeNull();
    expect(rechazoPorTamano(MAXIMO_BYTES_FOTO + 1)).toBe(MENSAJES_FOTO.grande);
    expect(rechazoPorTamano(0)).toBe(MENSAJES_FOTO.vacia);
  });

  it("600 px de ancho como mínimo y una proporción entre 1:2 y 4:1", () => {
    expect(rechazoPorMedidas(ANCHO_MINIMO_FOTO, 400)).toBeNull();
    expect(rechazoPorMedidas(ANCHO_MINIMO_FOTO - 1, 400)).toMatch(/599 px de ancho/);
    expect(rechazoPorMedidas(800, 1600)).toBeNull();
    expect(rechazoPorMedidas(800, 1601)).toMatch(/demasiado alta/);
    expect(rechazoPorMedidas(4000, 1000)).toBeNull();
    expect(rechazoPorMedidas(4001, 1000)).toMatch(/demasiado alargada/);
    expect(rechazoPorMedidas(12000, 9000)).toBe(MENSAJES_FOTO.pixeles);
    expect(rechazoPorMedidas(0, 10)).toBe(MENSAJES_FOTO.ilegible);
  });

  it("las versiones no agrandan y conservan la proporción", () => {
    expect(anchoDeVersion(960, 4000)).toBe(960);
    expect(anchoDeVersion(1920, 1200)).toBe(1200);
    expect(altoParaAncho(960, 4000, 3000)).toBe(720);
  });
});

describe("los mismos límites que la migración *_sitio_fotos", () => {
  const sql = readFileSync(path.join("prisma", "migrations", "20261030120000_sitio_fotos", "migration.sql"), "utf8");
  it("ancho mínimo, píxeles, proporción y bytes", () => {
    expect(sql).toContain(`ancho >= ${ANCHO_MINIMO_FOTO} `);
    expect(sql).toContain(`ancho::bigint * alto <= ${MAXIMO_PIXELES_FOTO}`);
    expect(sql).toContain(`ancho::numeric / alto BETWEEN ${PROPORCION_MINIMA} AND ${PROPORCION_MAXIMA}`);
    expect(sql).toContain(`bytes BETWEEN 1 AND ${MAXIMO_BYTES_FOTO}`);
  });
});
