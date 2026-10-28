import { describe, expect, it } from "vitest";
import {
  ALFABETO_CODIGO,
  codigoDeSemilla,
  CODIGOS_SEMILLA,
  esCodigoConsulta,
  formatearCodigoConsulta,
  generarCodigoConsulta,
  LARGO_CODIGO,
  normalizarCodigoConsulta,
} from "./codigo-consulta";

describe("código de consulta: alfabeto", () => {
  it("es Crockford base32 sin I, L, O ni U: 32 caracteres distintos", () => {
    expect(ALFABETO_CODIGO).toHaveLength(32);
    expect(new Set(ALFABETO_CODIGO).size).toBe(32);
    for (const ambiguo of ["I", "L", "O", "U"]) expect(ALFABETO_CODIGO).not.toContain(ambiguo);
  });
});

describe("generarCodigoConsulta", () => {
  it("da 8 caracteres del alfabeto, sin guion", () => {
    for (let i = 0; i < 500; i++) {
      const c = generarCodigoConsulta();
      expect(c).toHaveLength(LARGO_CODIGO);
      expect(esCodigoConsulta(c)).toBe(true);
      expect([...c].every((x) => ALFABETO_CODIGO.includes(x))).toBe(true);
    }
  });

  it("no se repite en 5000 (40 bits al azar) y usa todo el alfabeto en cada posición", () => {
    const codigos = Array.from({ length: 5000 }, generarCodigoConsulta);
    expect(new Set(codigos).size).toBe(5000);
    for (let pos = 0; pos < LARGO_CODIGO; pos++) {
      expect(new Set(codigos.map((c) => c[pos])).size).toBe(32);
    }
  });
});

describe("normalizarCodigoConsulta", () => {
  it.each([
    ["K7QM3XZP", "K7QM3XZP"],
    ["K7QM-3XZP", "K7QM3XZP"],
    ["k7qm-3xzp", "K7QM3XZP"],
    ["  k7qm 3xzp ", "K7QM3XZP"],
    ["K7QM–3XZP", "K7QM3XZP"],
    // Lo que el alfabeto no usa por parecido: O es 0; I y L son 1.
    ["OOOO-IIII", "00001111"],
    ["llll-oooo", "11110000"],
  ])("%s → %s", (escrito, esperado) => {
    expect(normalizarCodigoConsulta(escrito)).toBe(esperado);
  });

  it.each(["", "K7QM", "K7QM-3XZP9", "UUUU-UUUU", "K7QM-3XZ!", "CEM-2026-00042"])("%s no es un código", (escrito) => {
    expect(normalizarCodigoConsulta(escrito)).toBeNull();
  });
});

describe("formatearCodigoConsulta", () => {
  it("lo muestra XXXX-XXXX", () => {
    expect(formatearCodigoConsulta("K7QM3XZP")).toBe("K7QM-3XZP");
  });

  it("lo que no es un código queda como está", () => {
    expect(formatearCodigoConsulta("abc")).toBe("abc");
  });
});

describe("codigoDeSemilla (solo la semilla de desarrollo)", () => {
  it("los documentados en el README", () => {
    expect(codigoDeSemilla("CEM-2026-00001")).toBe("PRVE8A01");
    expect(codigoDeSemilla("CEM-2026-00052")).toBe("PRVE8A52");
    expect(codigoDeSemilla("CEM-2026-00058")).toBe("PRVE8A58");
    for (const c of Object.values(CODIGOS_SEMILLA)) expect(esCodigoConsulta(c)).toBe(true);
  });

  it("el resto: determinista, válido y distinto entre los 67 de la semilla", () => {
    const numeros = Array.from({ length: 67 }, (_, i) => `CEM-2026-${String(i + 1).padStart(5, "0")}`);
    const codigos = numeros.map(codigoDeSemilla);
    expect(numeros.map(codigoDeSemilla)).toEqual(codigos);
    expect(codigos.every(esCodigoConsulta)).toBe(true);
    expect(new Set(codigos).size).toBe(67);
  });
});
