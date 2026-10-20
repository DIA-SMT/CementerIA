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
