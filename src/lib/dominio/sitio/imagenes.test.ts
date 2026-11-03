import { describe, expect, it } from "vitest";
import { ilustrativasDe, imagenDeFila, imagenDeKit, imagenSubida, urlFotoSitio } from "./imagenes";
import { fotoSitio, leerEntradaSitio, EntradaCementerioSitio, EntradaFotoSitio, EntradaEditarFoto, EntradaRecorrido } from "./validacion";
import { ErrorDominio } from "../expedientes/errores";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("las fotos de la página: subidas y del kit", () => {
  it("la URL lleva el id, la versión (16 del sha256) y el ancho", () => {
    expect(urlFotoSitio({ id: ID, sha256: SHA }, 960)).toBe(`/sitio/fotos/${ID}/a1b2c3d4e5f60718-960.webp`);
  });

  it("una subida: srcset con los dos anchos reales, medidas de la grande, sin «ilustrativa»", () => {
    const i = imagenSubida({ id: ID, sha256: SHA, alt: "Portón del cementerio", credito: "Archivo de la Dirección", ancho: 3000, alto: 2000 });
    expect(i).toEqual({
      src: `/sitio/fotos/${ID}/a1b2c3d4e5f60718-960.webp`,
      srcSet: `/sitio/fotos/${ID}/a1b2c3d4e5f60718-960.webp 960w, /sitio/fotos/${ID}/a1b2c3d4e5f60718-1920.webp 1920w`,
      ancho: 1920,
      alto: 1280,
      alt: "Portón del cementerio",
      ilustrativa: false,
      credito: "Archivo de la Dirección",
    });
    expect(i.alt).not.toMatch(/ilustrativa/);
  });

  it("una subida más chica que 1920: el ancho real; si las dos versiones son iguales, una sola en el srcset", () => {
    expect(imagenSubida({ id: ID, sha256: SHA, alt: "x".repeat(5), credito: null, ancho: 1200, alto: 800 }).srcSet).toMatch(/960w, .* 1200w$/);
    const chica = imagenSubida({ id: ID, sha256: SHA, alt: "x".repeat(5), credito: null, ancho: 800, alto: 600 });
    expect(chica.srcSet).toBe(`/sitio/fotos/${ID}/a1b2c3d4e5f60718-960.webp 800w`);
    expect([chica.ancho, chica.alto]).toEqual([800, 600]);
  });

  it("del kit: como antes, con «ilustrativa» en el alt", () => {
    const i = imagenDeKit(fotoSitio("panoramica")!);
    expect(i.ilustrativa).toBe(true);
    expect(i.alt).toMatch(/ilustrativa/);
    expect(i.srcSet).toBe("/assets/cementeria/hero-landing-960.webp 960w, /assets/cementeria/hero-landing.webp 1916w");
  });

  it("la de una fila: la subida si está activa; si no, la del kit; o ninguna", () => {
    const subida = { id: ID, sha256: SHA, alt: "Portón", credito: null, ancho: 2000, alto: 1000, activa: true };
    expect(imagenDeFila(null, subida)?.ilustrativa).toBe(false);
    expect(imagenDeFila("panoramica", { ...subida, activa: false })?.ilustrativa).toBe(true);
    expect(imagenDeFila(null, { ...subida, activa: false })).toBeNull();
    expect(imagenDeFila(null, null)).toBeNull();
  });

  it("qué decir de una lista: todas ilustrativas, algunas o ninguna", () => {
    const kit = imagenDeKit(fotoSitio("panoramica")!);
    const propia = imagenSubida({ id: ID, sha256: SHA, alt: "Portón", credito: null, ancho: 2000, alto: 1000 });
    expect(ilustrativasDe([kit, null, kit])).toBe("todas");
    expect(ilustrativasDe([kit, propia])).toBe("algunas");
    expect(ilustrativasDe([propia, null])).toBe("ninguna");
    expect(ilustrativasDe([null])).toBe("ninguna");
  });
});

function rutas(esquema: Parameters<typeof leerEntradaSitio>[0], valor: unknown): string[] {
  try {
    leerEntradaSitio(esquema, valor);
  } catch (e) {
    if (e instanceof ErrorDominio) return e.errores.map((x) => x.ruta);
    throw e;
  }
  return [];
}

describe("la foto elegida y el texto de una foto subida", () => {
  it("un cementerio o un recorrido: o la del kit o la subida, nunca las dos", () => {
    expect(rutas(EntradaCementerioSitio, { cementerioId: 1, visible: true, fotoId: ID })).toEqual([]);
    expect(rutas(EntradaCementerioSitio, { cementerioId: 1, visible: true, foto: "panoramica", fotoId: ID })).toEqual(["foto"]);
    expect(rutas(EntradaCementerioSitio, { cementerioId: 1, visible: true, fotoId: "no-es-un-uuid" })).toEqual(["fotoId"]);
    expect(rutas(EntradaRecorrido, { nombre: "R", activo: true, orden: 0, foto: "panoramica", fotoId: ID })).toEqual(["foto"]);
    expect(leerEntradaSitio(EntradaRecorrido, { nombre: "R", activo: true, orden: 0, fotoId: ID.toUpperCase() }).fotoId).toBe(ID);
    expect(leerEntradaSitio(EntradaRecorrido, { nombre: "R", activo: true, orden: 0, fotoId: "" }).fotoId).toBeNull();
  });

  it("el texto alternativo es obligatorio, de 5 a 200 caracteres; el crédito, opcional", () => {
    expect(rutas(EntradaFotoSitio, { alt: "" })).toEqual(["alt"]);
    expect(rutas(EntradaFotoSitio, { alt: "Pino" })).toEqual(["alt"]);
    expect(rutas(EntradaFotoSitio, { alt: "x".repeat(201) })).toEqual(["alt"]);
    expect(leerEntradaSitio(EntradaFotoSitio, { alt: "  Portón   del Oeste ", credito: "" })).toEqual({ alt: "Portón del Oeste", credito: null });
    expect(rutas(EntradaEditarFoto, { id: "x", alt: "Portón del Oeste" })).toEqual(["id"]);
  });
});
