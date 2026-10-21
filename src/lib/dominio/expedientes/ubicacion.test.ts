import { describe, expect, it } from "vitest";
import { ErrorDominio } from "./errores";
import {
  claveDeUbicacion,
  leerCamposUbicacion,
  normalizarValorUbicacion,
  textoDeUbicacion,
  validarUbicacion,
  type CampoUbicacion,
} from "./ubicacion";

const CAMPOS: CampoUbicacion[] = [
  { clave: "seccion", etiqueta: "Sección", tipo: "entero", obligatorio: true, patron: null, activo: true },
  { clave: "cuadro", etiqueta: "Cuadro", tipo: "texto", obligatorio: true, patron: "[A-Z]{1,2}", activo: true },
  { clave: "lote", etiqueta: "Lote", tipo: "entero", obligatorio: true, patron: null, activo: true },
  { clave: "numero", etiqueta: "N°", tipo: "entero", obligatorio: false, patron: null, activo: true },
  { clave: "fila", etiqueta: "Fila", tipo: "texto", obligatorio: false, patron: null, activo: false },
];

describe("normalización (2.13(d))", () => {
  it("trim, mayúsculas y enteros sin ceros a la izquierda", () => {
    expect(normalizarValorUbicacion({ tipo: "entero" }, " 012 ")).toBe("12");
    expect(normalizarValorUbicacion({ tipo: "entero" }, "000")).toBe("0");
    expect(normalizarValorUbicacion({ tipo: "texto" }, "  b  ")).toBe("B");
    expect(normalizarValorUbicacion({ tipo: "texto" }, "ala  norte")).toBe("ALA NORTE");
    expect(normalizarValorUbicacion({ tipo: "texto" }, "012")).toBe("012");
  });
});

describe("validarUbicacion", () => {
  it("normaliza y guarda solo lo que tiene valor", () => {
    expect(validarUbicacion(CAMPOS, { seccion: "03", cuadro: "b", lote: "012", numero: "" }, { obligatoria: true })).toEqual({
      ok: true,
      ubicacion: { seccion: "3", cuadro: "B", lote: "12" },
    });
  });

  it("obligatorios, entero, patrón y claves desconocidas", () => {
    const r = validarUbicacion(CAMPOS, { seccion: "tres", cuadro: "B1", otra: "x" }, { obligatoria: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores.map((e) => e.ruta).sort()).toEqual(["ubicacion.cuadro", "ubicacion.lote", "ubicacion.otra", "ubicacion.seccion"]);
    }
  });

  it("con ubicacion_obligatoria = false nada es obligatorio", () => {
    expect(validarUbicacion(CAMPOS, {}, { obligatoria: false })).toEqual({ ok: true, ubicacion: {} });
  });

  it("un campo desactivado conserva su valor y no se puede cambiar ni cargar", () => {
    const anterior = { seccion: "3", cuadro: "B", lote: "12", fila: "A" };
    expect(validarUbicacion(CAMPOS, { seccion: "3", cuadro: "B", lote: "13" }, { obligatoria: true, anterior })).toEqual({
      ok: true,
      ubicacion: { seccion: "3", cuadro: "B", lote: "13", fila: "A" },
    });
    expect(validarUbicacion(CAMPOS, { seccion: "3", cuadro: "B", lote: "13", fila: "a" }, { obligatoria: true, anterior }).ok).toBe(true);
    const r = validarUbicacion(CAMPOS, { seccion: "3", cuadro: "B", lote: "13", fila: "Z" }, { obligatoria: true, anterior });
    expect(r).toMatchObject({ ok: false, errores: [{ ruta: "ubicacion.fila" }] });
    expect(validarUbicacion(CAMPOS, { seccion: "3", cuadro: "B", lote: "1", fila: "Z" }, { obligatoria: true }).ok).toBe(false);
  });

  it("un patrón inválido es un error de configuración", () => {
    const roto = [{ ...CAMPOS[1], patron: "[A-" }];
    expect(() => validarUbicacion(roto, { cuadro: "B" }, { obligatoria: true })).toThrow(ErrorDominio);
  });
});

describe("clave y texto", () => {
  it("la clave es como la del trigger: ordenada por clave, sin vacíos", () => {
    expect(claveDeUbicacion({ seccion: "3", lote: "12", cuadro: "B", numero: "" })).toBe("cuadro=B;lote=12;seccion=3");
    expect(claveDeUbicacion({ numero: " " })).toBeNull();
  });

  it("el texto sigue el orden del cementerio", () => {
    expect(textoDeUbicacion(CAMPOS, { lote: "12", seccion: "3", cuadro: "B", numero: "45" })).toBe("Sección 3 · Cuadro B · Lote 12 · N° 45");
    expect(textoDeUbicacion(CAMPOS, { seccion: "3", vieja: "X" })).toBe("Sección 3 · vieja X");
  });

  it("leer una configuración rota avisa", () => {
    expect(() => leerCamposUbicacion([{ clave: "x" }], "Oeste")).toThrow(/mal configurada/);
    expect(leerCamposUbicacion(CAMPOS, "Oeste")).toHaveLength(5);
  });
});

describe("nomenclatura de la semana 4 (docs/fuentes)", () => {
  const SECCION_OESTE: CampoUbicacion = { clave: "seccion", etiqueta: "Sección", tipo: "texto", obligatorio: true, patron: "[A-H]", activo: true, ayuda: "una letra de la A a la H" };
  const SECCION_JARDIN: CampoUbicacion = { clave: "seccion", etiqueta: "Sección", tipo: "texto", obligatorio: true, patron: "XL|X{0,3}(?:IX|IV|V?I{0,3})", activo: true };

  it("letras y romanos se guardan en mayúsculas: la clave de ubicación no depende de cómo se tipeó", () => {
    const minuscula = validarUbicacion([SECCION_JARDIN], { seccion: " iv " }, { obligatoria: true });
    const mayuscula = validarUbicacion([SECCION_JARDIN], { seccion: "IV" }, { obligatoria: true });
    expect(minuscula).toEqual({ ok: true, ubicacion: { seccion: "IV" } });
    expect(minuscula.ok && mayuscula.ok && claveDeUbicacion(minuscula.ubicacion) === claveDeUbicacion(mayuscula.ubicacion)).toBe(true);
    expect(validarUbicacion([SECCION_OESTE], { seccion: "b" }, { obligatoria: true })).toEqual({ ok: true, ubicacion: { seccion: "B" } });
  });

  it("el error repite la ayuda del campo, si la tiene", () => {
    expect(validarUbicacion([SECCION_OESTE], { seccion: "Z" }, { obligatoria: true })).toEqual({
      ok: false,
      errores: [{ ruta: "ubicacion.seccion", mensaje: "Sección: el formato no es válido (una letra de la A a la H)" }],
    });
    expect(validarUbicacion([SECCION_JARDIN], { seccion: "IIII" }, { obligatoria: true })).toMatchObject({
      ok: false,
      errores: [{ mensaje: "Sección: el formato no es válido" }],
    });
  });

  it("leerCamposUbicacion acepta la ayuda y una configuración sin ella", () => {
    expect(leerCamposUbicacion([SECCION_OESTE, SECCION_JARDIN], "Oeste").map((c) => c.ayuda)).toEqual(["una letra de la A a la H", undefined]);
  });
});
