import { describe, expect, it } from "vitest";
import { cuilValido, cuitJuridicaValido, digitoVerificadorCuil, formatearCuit } from "./cuil";

// Solo números ficticios: DNI 00000001 a 00000009.

describe("digitoVerificadorCuil", () => {
  it("calcula el dígito con módulo 11", () => {
    expect(digitoVerificadorCuil("2000000000")).toBe(1);
    expect(digitoVerificadorCuil("2700000002")).toBe(2);
    expect(digitoVerificadorCuil("2000000002")).toBe(8);
  });

  it("da 0 cuando el resto es 11", () => {
    expect(digitoVerificadorCuil("2000000006")).toBe(0);
  });

  it("da null cuando el resto es 10 (ese número no existe con ese prefijo)", () => {
    expect(digitoVerificadorCuil("2700000009")).toBeNull();
  });

  it("rechaza lo que no son 10 dígitos", () => {
    expect(() => digitoVerificadorCuil("20-0000000")).toThrow();
  });
});

describe("cuilValido", () => {
  it("acepta un CUIL con el dígito correcto", () => {
    expect(cuilValido("20000000001")).toBe(true);
    expect(cuilValido("27000000022")).toBe(true);
  });

  it("rechaza el dígito equivocado", () => {
    expect(cuilValido("20000000002")).toBe(false);
  });

  it("rechaza separadores, largo distinto de 11 y prefijos desconocidos", () => {
    expect(cuilValido("20-00000000-1")).toBe(false);
    expect(cuilValido("2000000001")).toBe(false);
    // SISTEMA: tiene 11 dígitos (pasa el CHECK de la base) pero no es un CUIL.
    expect(cuilValido("00000000000")).toBe(false);
  });
});

describe("cuitJuridicaValido (personas jurídicas, semana 4)", () => {
  it("acepta el CUIT de una persona jurídica con el dígito correcto", () => {
    // Ficticios de la semilla (30-99999NNN-D).
    expect(cuitJuridicaValido("30999990130")).toBe(true);
    expect(cuitJuridicaValido("30999991226")).toBe(true);
  });

  it("rechaza el dígito equivocado y el CUIL de una persona humana", () => {
    expect(cuitJuridicaValido("30999990131")).toBe(false);
    expect(cuitJuridicaValido("20000000001")).toBe(false);
  });

  it("formatearCuit pone los guiones; lo que no son 11 dígitos queda igual", () => {
    expect(formatearCuit("30999990130")).toBe("30-99999013-0");
    expect(formatearCuit("123")).toBe("123");
  });
});
