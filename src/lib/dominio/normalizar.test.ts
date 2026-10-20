import { describe, expect, it } from "vitest";
import { colapsarEspacios, dniDeCuil, normalizar, normalizarDni, normalizarNumero, sinAcentos, tokens } from "./normalizar";

describe("normalizar (f_normalizar)", () => {
  it("sin acentos, minúsculas, separadores a un espacio", () => {
    expect(normalizar("GONZÁLEZ, María-José")).toBe("gonzalez maria jose");
    expect(normalizar("  Ñandú   Güemes  ")).toBe("nandu guemes");
    expect(normalizar("CEM-2026-00042")).toBe("cem 2026 00042");
    expect(normalizar("42/2026")).toBe("42 2026");
    expect(normalizar("---")).toBe("");
  });

  it("letras que NFD no separa, como unaccent", () => {
    expect(sinAcentos("Straße Øster Łódź")).toBe("Strasse Oster Lodz");
    expect(normalizar("Æon")).toBe("aeon");
  });

  it("tokens", () => {
    expect(tokens("  López  de la Fuente ")).toEqual(["lopez", "de", "la", "fuente"]);
    expect(tokens(" .- ")).toEqual([]);
  });
});

describe("normalizarNumero (numero_municipal_norm, padron_norm)", () => {
  it("mayúsculas y solo alfanuméricos", () => {
    expect(normalizarNumero("12.345/2026")).toBe("123452026");
    expect(normalizarNumero("12345-2026")).toBe("123452026");
    expect(normalizarNumero("exp-á 12")).toBe("EXPA12");
    expect(normalizarNumero(" / ")).toBeNull();
    expect(normalizarNumero(null)).toBeNull();
  });
});

describe("DNI", () => {
  it("solo dígitos, sin ceros a la izquierda", () => {
    expect(normalizarDni("07.123.456")).toBe("7123456");
    expect(normalizarDni("30 111 222")).toBe("30111222");
    expect(normalizarDni("abc")).toBeNull();
    expect(normalizarDni("")).toBeNull();
  });

  it("el DNI de un CUIL de 11 dígitos", () => {
    expect(dniDeCuil("20-30111222-3")).toBe("30111222");
    expect(dniDeCuil("27071234561")).toBe("7123456");
    expect(dniDeCuil("2030111222")).toBeNull();
  });
});

describe("colapsarEspacios", () => {
  it("quita espacios de más", () => {
    expect(colapsarEspacios("  Pérez \t Gómez \n")).toBe("Pérez Gómez");
  });
});
