import { describe, expect, it } from "vitest";
import { cantidadDeFiltros, leerParametrosBusqueda } from "./busqueda";

describe("parámetros de /expedientes", () => {
  it("sin nada: lista sin criterio", () => {
    const r = leerParametrosBusqueda({});
    expect(r.entrada).toEqual({ q: null, filtros: {} });
    expect(r.conCriterio).toBe(false);
    expect(cantidadDeFiltros(r.valores)).toBe(0);
  });

  it("la caja única y todos los filtros", () => {
    const r = leerParametrosBusqueda({
      q: "  gonzalez maria ",
      estado: ["en_tramite", "concluido", "en_tramite"],
      tramite: "2",
      plantilla: "RENOV_CONTADO",
      cementerio: "1",
      "u.seccion": "03",
      "u.lote": "",
      area: "4",
      desde: "2026-01-01",
      hasta: "2026-10-20",
      anulados: "1",
    });
    expect(r.entrada).toEqual({
      q: "gonzalez maria",
      filtros: {
        estados: ["en_tramite", "concluido"],
        tipoTramiteId: 2,
        plantillaCodigo: "RENOV_CONTADO",
        cementerioId: 1,
        ubicacion: { seccion: "03" },
        areaActualId: 4,
        fechaInicioDesde: "2026-01-01",
        fechaInicioHasta: "2026-10-20",
        incluirAnulados: true,
      },
    });
    expect(r.conCriterio).toBe(true);
    expect(cantidadDeFiltros(r.valores)).toBe(9);
  });

  it("lo que no tiene forma válida se ignora", () => {
    const r = leerParametrosBusqueda({
      estado: ["borrado", "<script>"],
      tramite: "-1",
      plantilla: "renov; drop",
      cementerio: "abc",
      "u.Sección": "3",
      area: "0",
      anulados: "si",
    });
    expect(r.entrada.filtros).toEqual({});
    expect(r.conCriterio).toBe(false);
  });

  it("toma el primer valor de un parámetro repetido y corta una consulta larguísima", () => {
    const r = leerParametrosBusqueda({ q: ["CEM-2026-42", "otra"], cementerio: ["2", "3"] });
    expect(r.entrada).toEqual({ q: "CEM-2026-42", filtros: { cementerioId: 2 } });
    expect(leerParametrosBusqueda({ q: "a".repeat(500) }).valores.q).toHaveLength(200);
  });
});
