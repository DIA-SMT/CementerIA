import { describe, expect, it } from "vitest";
import { mensajeDeValidez, type ControlValidable } from "./validez";

const SIN_PROBLEMAS: ControlValidable["validity"] = {
  valueMissing: false,
  typeMismatch: false,
  patternMismatch: false,
  tooShort: false,
  tooLong: false,
  rangeUnderflow: false,
  rangeOverflow: false,
  stepMismatch: false,
  badInput: false,
};

function control(type: string, problema: Partial<ControlValidable["validity"]>, extra: Partial<ControlValidable> = {}): ControlValidable {
  return { tagName: "INPUT", type, value: "", validity: { ...SIN_PROBLEMAS, ...problema }, ...extra };
}

describe("carteles de validación en castellano", () => {
  it("un campo obligatorio vacío, según el control", () => {
    expect(mensajeDeValidez(control("text", { valueMissing: true }))).toBe("Completá este campo.");
    expect(mensajeDeValidez(control("date", { valueMissing: true }))).toBe("Completá la fecha.");
    expect(mensajeDeValidez(control("checkbox", { valueMissing: true }))).toBe("Marcá esta casilla para seguir.");
    expect(mensajeDeValidez(control("radio", { valueMissing: true }))).toBe("Elegí una opción.");
    expect(mensajeDeValidez(control("file", { valueMissing: true }))).toBe("Elegí un archivo.");
    expect(mensajeDeValidez({ ...control("select-one", { valueMissing: true }), tagName: "SELECT" })).toBe("Elegí una opción.");
  });

  it("las fechas fuera de rango se dicen en dd/mm/aaaa", () => {
    expect(mensajeDeValidez(control("date", { rangeUnderflow: true }, { min: "1950-01-01" }))).toBe("La fecha tiene que ser del 01/01/1950 en adelante.");
    expect(mensajeDeValidez(control("date", { rangeOverflow: true }, { max: "2026-11-03" }))).toBe("La fecha no puede ser posterior al 03/11/2026.");
    expect(mensajeDeValidez(control("datetime-local", { rangeOverflow: true }, { max: "2026-11-03T09:30" }))).toBe(
      "La fecha no puede ser posterior al 03/11/2026 09:30.",
    );
    expect(mensajeDeValidez(control("date", { badInput: true }))).toBe("La fecha está incompleta o no existe.");
  });

  it("largo, formato y números", () => {
    expect(mensajeDeValidez(control("password", { tooShort: true }, { minLength: 12, value: "corta" }))).toBe("Escribí al menos 12 caracteres (ahora hay 5).");
    expect(mensajeDeValidez(control("text", { tooLong: true }, { maxLength: 200 }))).toBe("Escribí como máximo 200 caracteres.");
    expect(mensajeDeValidez(control("email", { typeMismatch: true }))).toBe("Escribí un correo válido, por ejemplo nombre@dominio.com.");
    expect(mensajeDeValidez(control("text", { patternMismatch: true }, { title: "11 dígitos" }))).toBe("Revisá el formato: 11 dígitos");
    expect(mensajeDeValidez(control("text", { patternMismatch: true }))).toBe("Revisá el formato de este campo.");
    expect(mensajeDeValidez(control("number", { rangeUnderflow: true }, { min: "1" }))).toBe("El valor mínimo es 1.");
    expect(mensajeDeValidez(control("number", { badInput: true }))).toBe("Escribí un número.");
  });

  it("sin problemas no hay mensaje", () => {
    expect(mensajeDeValidez(control("text", {}))).toBeNull();
  });
});
