import { describe, expect, it } from "vitest";
import { escala, porcentajeDe, saltoDeRotulos } from "./graficos";

describe("escala de los gráficos", () => {
  it("de 0 a un tope redondo (1, 2 o 5 × 10ⁿ) que deja el máximo adentro", () => {
    expect(escala(7)).toEqual({ tope: 8, marcas: [0, 2, 4, 6, 8], paso: 2 });
    expect(escala(45)).toEqual({ tope: 60, marcas: [0, 20, 40, 60], paso: 20 });
    expect(escala(100)).toEqual({ tope: 100, marcas: [0, 50, 100], paso: 50 });
    expect(escala(17)).toEqual({ tope: 20, marcas: [0, 5, 10, 15, 20], paso: 5 });
    expect(escala(1234).tope).toBe(1500);
  });

  it("marcas enteras: con valores chicos el paso es 1", () => {
    expect(escala(3)).toEqual({ tope: 3, marcas: [0, 1, 2, 3], paso: 1 });
    expect(escala(1)).toEqual({ tope: 1, marcas: [0, 1], paso: 1 });
    expect(escala(0.4)).toEqual({ tope: 1, marcas: [0, 1], paso: 1 });
  });

  it("sin datos, de 0 a 1 (nunca divide por cero)", () => {
    expect(escala(0)).toEqual({ tope: 1, marcas: [0, 1], paso: 1 });
    expect(escala(Number.NaN)).toEqual({ tope: 1, marcas: [0, 1], paso: 1 });
    expect(escala(-3)).toEqual({ tope: 1, marcas: [0, 1], paso: 1 });
  });

  it("el máximo nunca queda afuera y hay como mucho 4 intervalos (más el que redondea)", () => {
    for (let max = 1; max <= 500; max += 7) {
      const e = escala(max);
      expect(e.tope).toBeGreaterThanOrEqual(max);
      expect(e.marcas.at(-1)).toBe(e.tope);
      expect(e.marcas.length).toBeLessThanOrEqual(6);
    }
  });
});

describe("porcentajeDe", () => {
  it("la parte del eje, entre 0 y 100", () => {
    expect(porcentajeDe(4, 8)).toBe(50);
    expect(porcentajeDe(1, 3)).toBe(33.33);
    expect(porcentajeDe(12, 8)).toBe(100);
    expect(porcentajeDe(-1, 8)).toBe(0);
    expect(porcentajeDe(null, 8)).toBe(0);
    expect(porcentajeDe(5, 0)).toBe(0);
  });
});

describe("saltoDeRotulos", () => {
  it("hasta 8 rótulos en el eje", () => {
    expect(saltoDeRotulos(6)).toBe(1);
    expect(saltoDeRotulos(8)).toBe(1);
    expect(saltoDeRotulos(13)).toBe(2);
    expect(saltoDeRotulos(26)).toBe(4);
  });
});
