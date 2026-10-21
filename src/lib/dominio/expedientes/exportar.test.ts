import { describe, expect, it } from "vitest";
import type { ResultadoBusquedaFila } from "../busqueda";
import { armarCsv, celdaCsv, COLUMNAS_CSV, filaCsv } from "./exportar";

describe("CSV del buscador (semana 4)", () => {
  it("celdas: comillas cuando hace falta y sin fórmulas", () => {
    expect(celdaCsv("simple")).toBe("simple");
    expect(celdaCsv(null)).toBe("");
    expect(celdaCsv(true)).toBe("Sí");
    expect(celdaCsv(3)).toBe("3");
    expect(celdaCsv('con "comillas"; y punto y coma')).toBe('"con ""comillas""; y punto y coma"');
    expect(celdaCsv("dos\nlíneas")).toBe('"dos\nlíneas"');
    expect(celdaCsv("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(celdaCsv("+54 381")).toBe("'+54 381");
    expect(celdaCsv("@algo")).toBe("'@algo");
  });

  it("archivo: BOM, separador ; y CRLF", () => {
    expect(armarCsv(["a", "b"], [["1", null]])).toBe("\uFEFFa;b\r\n1;\r\n");
  });

  it("una fila del buscador: sin teléfono, correo ni domicilio", () => {
    const fila: ResultadoBusquedaFila = {
      id: "1",
      numero: "CEM-2026-00042",
      numeroCorto: "42/2026",
      numeroMunicipal: "12.345/2026",
      estado: "espera_pago_dim",
      fechaInicio: "2026-10-15",
      cargaHistorica: false,
      sinConfirmar: false,
      tipoTramite: { codigo: "RENOVACION", nombre: "Renovación de concesión" },
      plantilla: { codigo: "RENOV_PLAN", nombre: "Renovación, plan de pagos", version: 1 },
      cementerio: { codigo: "OESTE", nombre: "Cementerio del Oeste" },
      ubicacionTexto: "Secc. B · Lote 12",
      paso: { clave: "DIM", nombre: "DIM" },
      areaActual: { codigo: "DIM", nombre: "Dirección de Ingresos Municipales" },
      titular: "FICTICIO, Titular",
      coincidencias: [],
      similitud: null,
    };
    const valores = filaCsv(fila);
    expect(valores).toHaveLength(COLUMNAS_CSV.length);
    expect(valores).toEqual([
      "CEM-2026-00042",
      "12.345/2026",
      "En espera de pago DIM",
      "15/10/2026",
      "Renovación de concesión",
      "Renovación, plan de pagos",
      1,
      "Cementerio del Oeste",
      "Secc. B · Lote 12",
      "DIM",
      "Dirección de Ingresos Municipales",
      "FICTICIO, Titular",
      false,
    ]);
    expect(COLUMNAS_CSV.join(" ")).not.toMatch(/tel|correo|mail|domicilio/i);
  });
});
