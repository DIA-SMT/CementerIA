import { describe, expect, it } from "vitest";
import { ATAJOS_DEVOLUCION } from "@/lib/presentacion/flujo";
import { grupoDeMotivo, MOTIVOS_DEVOLUCION } from "./calculo";
import { agruparPor, mediana, percentil, promedio, resumir, tasa } from "./estadisticas";
import { hojasDeFicha, PARAMETROS_PAPEL } from "./papel";

describe("mediana", () => {
  it("impar: el del medio; par: el promedio de los dos del medio", () => {
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([7])).toBe(7);
  });

  it("sin valores, null (no 0: no es lo mismo no saber que tardar cero días)", () => {
    expect(mediana([])).toBeNull();
  });

  it("no la mueve un caso extremo", () => {
    expect(mediana([3, 4, 5, 6, 200])).toBe(5);
  });
});

describe("percentil 90 por rango más cercano", () => {
  it("es siempre un caso real", () => {
    const diez = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentil(diez, 90)).toBe(9);
    expect(percentil([...diez, 11], 90)).toBe(10); // ceil(0,9 · 11) = 10
    expect(percentil([10, 2, 30], 90)).toBe(30); // con pocos casos es el máximo
    expect(percentil([4], 90)).toBe(4);
    expect(percentil(diez, 50)).toBe(5);
    expect(percentil(diez, 100)).toBe(10);
  });

  it("sin valores, null; fuera de rango, error", () => {
    expect(percentil([], 90)).toBeNull();
    expect(() => percentil([1], 0)).toThrow(RangeError);
    expect(() => percentil([1], 101)).toThrow(RangeError);
  });
});

describe("resumir", () => {
  it("n, mediana, promedio con un decimal, p90, máximo y total", () => {
    expect(resumir([2, 4, 4, 10])).toEqual({ n: 4, mediana: 4, promedio: 5, p90: 10, maximo: 10, total: 20 });
    expect(resumir([1, 2])).toMatchObject({ promedio: 1.5, mediana: 1.5 });
    expect(promedio([1, 1, 2])).toBe(1.3);
  });

  it("vacío", () => {
    expect(resumir([])).toEqual({ n: 0, mediana: null, promedio: null, p90: null, maximo: null, total: 0 });
  });

  it("descarta lo que no es un número finito", () => {
    expect(resumir([3, Number.NaN, 5]).n).toBe(2);
  });
});

describe("tasa y agrupar", () => {
  it("la tasa es una proporción con tres decimales, null sin total", () => {
    expect(tasa(1, 3)).toBe(0.333);
    expect(tasa(0, 0)).toBeNull();
  });

  it("agrupa conservando el orden de aparición", () => {
    const g = agruparPor(["b1", "a1", "b2"], (x) => x[0]);
    expect([...g.keys()]).toEqual(["b", "a"]);
    expect(g.get("b")).toEqual(["b1", "b2"]);
  });
});

describe("motivos de devolución", () => {
  it("los grupos son los atajos del diálogo, más Otros", () => {
    expect(MOTIVOS_DEVOLUCION.filter((m) => m !== "Otros")).toEqual([...ATAJOS_DEVOLUCION]);
  });

  it("agrupa por el atajo del comienzo, sin acentos ni mayúsculas", () => {
    expect(grupoDeMotivo("Falta firma: del director")).toBe("Falta firma");
    expect(grupoDeMotivo("falta firma del director en la resolución")).toBe("Falta firma");
    expect(grupoDeMotivo("ERROR EN BOLETA: el importe")).toBe("Error en boleta");
    expect(grupoDeMotivo("Falta documentacion. DNI vencido")).toBe("Falta documentación");
    expect(grupoDeMotivo("El titular pidió revisar el monto")).toBe("Otros");
    // Mencionarlo en el medio no alcanza: el atajo va al comienzo.
    expect(grupoDeMotivo("Revisar: falta firma")).toBe("Otros");
    expect(grupoDeMotivo(null)).toBe("Otros");
  });
});

describe("hojas estimadas de la ficha de papel", () => {
  it("max(1, ⌈anotaciones / por hoja⌉)", () => {
    expect(PARAMETROS_PAPEL.anotacionesPorHoja).toBe(12);
    expect(hojasDeFicha(0)).toBe(1);
    expect(hojasDeFicha(9)).toBe(1);
    expect(hojasDeFicha(12)).toBe(1);
    expect(hojasDeFicha(13)).toBe(2);
    expect(hojasDeFicha(25)).toBe(3);
  });

  it("el supuesto se configura", () => {
    expect(hojasDeFicha(13, { anotacionesPorHoja: 20 })).toBe(1);
    expect(hojasDeFicha(13, { anotacionesPorHoja: 6 })).toBe(3);
    // Un valor absurdo no divide por cero.
    expect(hojasDeFicha(3, { anotacionesPorHoja: 0 })).toBe(3);
  });
});
