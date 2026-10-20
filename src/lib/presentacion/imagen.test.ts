import { describe, expect, it } from "vitest";
import { MAXIMO_BYTES_ADJUNTO } from "@/lib/adjuntos/tipos";
import {
  elegirVersion,
  medidasReducidas,
  mensajeRespuestaSubida,
  MENSAJE_GRANDE,
  MENSAJE_HEIC,
  MENSAJE_TIPO,
  MENSAJE_VACIO,
  nombreJpeg,
  revisarArchivo,
  revisarTamano,
} from "./imagen";

const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const archivo = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("revisar el archivo antes de subir", () => {
  it("PDF, JPG y PNG por su contenido, no por el nombre", () => {
    expect(revisarArchivo(archivo("a.pdf", "application/pdf"), PDF)).toEqual({ ok: true, tipo: "application/pdf" });
    expect(revisarArchivo(archivo("foto.jpg", "image/jpeg"), JPG)).toEqual({ ok: true, tipo: "image/jpeg" });
    // Un PNG con nombre .jpg sigue siendo PNG.
    expect(revisarArchivo(archivo("captura.jpg", "image/jpeg"), PNG)).toEqual({ ok: true, tipo: "image/png" });
    expect(revisarArchivo(archivo("planilla.pdf", "application/pdf"), ZIP)).toEqual({ ok: false, mensaje: MENSAJE_TIPO });
  });

  it("una foto HEIC se rechaza con 'subila como JPG', aunque venga renombrada o sin tipo", () => {
    expect(revisarArchivo(archivo("IMG_0001.HEIC", ""), HEIC)).toEqual({ ok: false, mensaje: MENSAJE_HEIC });
    expect(revisarArchivo(archivo("IMG_0001.jpg", "image/jpeg"), HEIC)).toEqual({ ok: false, mensaje: MENSAJE_HEIC });
    expect(revisarArchivo(archivo("x", "image/heif"), ZIP)).toEqual({ ok: false, mensaje: MENSAJE_HEIC });
    expect(MENSAJE_HEIC).toMatch(/JPG/);
  });

  it("vacío o un PDF de más de 10 MB; las imágenes se miden después de reducirlas", () => {
    expect(revisarArchivo(archivo("a.pdf", "application/pdf", 0), PDF)).toEqual({ ok: false, mensaje: MENSAJE_VACIO });
    expect(revisarArchivo(archivo("a.pdf", "application/pdf", MAXIMO_BYTES_ADJUNTO + 1), PDF)).toEqual({ ok: false, mensaje: MENSAJE_GRANDE });
    expect(revisarArchivo(archivo("a.png", "image/png", MAXIMO_BYTES_ADJUNTO * 2), PNG)).toEqual({ ok: true, tipo: "image/png" });
    expect(revisarTamano(MAXIMO_BYTES_ADJUNTO)).toBeNull();
    expect(revisarTamano(MAXIMO_BYTES_ADJUNTO + 1)).toBe(MENSAJE_GRANDE);
    expect(revisarTamano(0)).toBe(MENSAJE_VACIO);
  });
});

describe("reducción de imágenes", () => {
  it("lado mayor a 2000 px, con la proporción y sin agrandar", () => {
    expect(medidasReducidas(4032, 3024)).toEqual({ ancho: 2000, alto: 1500, reducida: true });
    expect(medidasReducidas(3024, 4032)).toEqual({ ancho: 1500, alto: 2000, reducida: true });
    expect(medidasReducidas(2000, 1000)).toEqual({ ancho: 2000, alto: 1000, reducida: false });
    expect(medidasReducidas(800, 600)).toEqual({ ancho: 800, alto: 600, reducida: false });
    expect(medidasReducidas(10000, 3)).toEqual({ ancho: 2000, alto: 1, reducida: true });
  });

  it("se sube la recomprimida, salvo una original chica que pesa menos", () => {
    expect(elegirVersion({ bytes: 5_000_000 }, { bytes: 600_000 }, true)).toBe("recomprimida");
    expect(elegirVersion({ bytes: 40_000 }, { bytes: 90_000 }, false)).toBe("original");
    expect(elegirVersion({ bytes: 900_000 }, { bytes: 300_000 }, false)).toBe("recomprimida");
    // Si hubo que reducirla, va la reducida aunque pese más (no pasa de 2000 px).
    expect(elegirVersion({ bytes: 100 }, { bytes: 200 }, true)).toBe("recomprimida");
  });

  it("la recomprimida es JPEG", () => {
    expect(nombreJpeg("captura.png")).toBe("captura.jpg");
    expect(nombreJpeg("foto.de.la.boleta.JPEG")).toBe("foto.de.la.boleta.jpg");
    expect(nombreJpeg(".png")).toBe("imagen.jpg");
  });
});

describe("respuestas del servidor que no son del dominio", () => {
  it("413 de nginx, sesión vencida y otros", () => {
    expect(mensajeRespuestaSubida(413)).toBe(MENSAJE_GRANDE);
    expect(mensajeRespuestaSubida(401)).toMatch(/sesión venció/);
    expect(mensajeRespuestaSubida(502)).toMatch(/No se pudo subir/);
  });
});
