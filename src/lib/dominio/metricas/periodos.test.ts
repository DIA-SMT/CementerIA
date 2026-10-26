import { describe, expect, it } from "vitest";
import { ErrorDominio } from "../expedientes/errores";
import { filtrosPorDefecto, inicioDeMesAnterior, lunesDe, periodosEntre, validarFiltros, type FiltrosMetricas } from "./periodos";

describe("período por defecto", () => {
  it("los últimos 6 meses: el mes en curso y los 5 anteriores, enteros", () => {
    expect(filtrosPorDefecto("2026-10-26")).toEqual({ desde: "2026-05-01", hasta: "2026-10-26", historicos: "excluir", agrupar: "mes" });
    expect(inicioDeMesAnterior("2026-03-15", 5)).toBe("2025-10-01");
    expect(inicioDeMesAnterior("2026-01-31", 0)).toBe("2026-01-01");
    expect(inicioDeMesAnterior("2026-01-31", 12)).toBe("2025-01-01");
  });
});

describe("cortes del período", () => {
  it("por mes, recortados al período", () => {
    expect(periodosEntre("2026-08-15", "2026-10-26", "mes")).toEqual([
      { clave: "2026-08", agrupacion: "mes", desde: "2026-08-15", hasta: "2026-08-31" },
      { clave: "2026-09", agrupacion: "mes", desde: "2026-09-01", hasta: "2026-09-30" },
      { clave: "2026-10", agrupacion: "mes", desde: "2026-10-01", hasta: "2026-10-26" },
    ]);
    // Cambio de año y febrero.
    expect(periodosEntre("2027-12-01", "2028-02-29", "mes").map((p) => [p.clave, p.hasta])).toEqual([
      ["2027-12", "2027-12-31"],
      ["2028-01", "2028-01-31"],
      ["2028-02", "2028-02-29"],
    ]);
  });

  it("por semana, de lunes a domingo", () => {
    expect(lunesDe("2026-10-26")).toBe("2026-10-26"); // lunes
    expect(lunesDe("2026-11-01")).toBe("2026-10-26"); // domingo
    expect(lunesDe("2026-10-28")).toBe("2026-10-26");
    expect(periodosEntre("2026-10-21", "2026-11-03", "semana")).toEqual([
      { clave: "2026-10-19", agrupacion: "semana", desde: "2026-10-21", hasta: "2026-10-25" },
      { clave: "2026-10-26", agrupacion: "semana", desde: "2026-10-26", hasta: "2026-11-01" },
      { clave: "2026-11-02", agrupacion: "semana", desde: "2026-11-02", hasta: "2026-11-03" },
    ]);
  });

  it("un solo día", () => {
    expect(periodosEntre("2026-10-26", "2026-10-26", "mes")).toHaveLength(1);
  });
});

describe("validarFiltros", () => {
  const base: FiltrosMetricas = { desde: "2026-05-01", hasta: "2026-10-26", historicos: "excluir", agrupar: "mes" };
  const error = (f: Partial<FiltrosMetricas>) => {
    try {
      validarFiltros({ ...base, ...f }, "2026-10-26");
      return null;
    } catch (e) {
      if (!(e instanceof ErrorDominio)) throw e;
      return { codigo: e.codigo, ruta: e.errores[0]?.ruta, mensaje: e.message };
    }
  };

  it("acepta el período por defecto", () => {
    expect(error({})).toBeNull();
  });

  it("rechaza un período al revés, en el futuro, de más de 3 años o con demasiadas semanas", () => {
    expect(error({ desde: "2026-11-01" })).toMatchObject({ codigo: "validacion", ruta: "desde" });
    expect(error({ hasta: "2026-10-27" })).toMatchObject({ ruta: "hasta" });
    expect(error({ desde: "2023-01-01" })).toMatchObject({ ruta: "desde", mensaje: "El período puede ser de hasta 3 años" });
    expect(error({ agrupar: "semana" })).toMatchObject({ ruta: "agrupar" });
    expect(error({ agrupar: "semana", desde: "2026-06-01" })).toBeNull();
    expect(error({ desde: "2026-02-30" })).toMatchObject({ ruta: "desde" });
  });
});
