import { describe, expect, it } from "vitest";
import { cantidadDeFiltros, leerParametrosBusqueda, rutaBusqueda } from "./busqueda";

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

describe("rutaBusqueda (semana 4: los enlaces del panel)", () => {
  it("es la inversa de leerParametrosBusqueda", () => {
    const filtros = {
      estados: ["en_tramite" as const, "espera_pago_dim" as const],
      tipoTramiteId: 2,
      cementerioId: 1,
      ubicacion: { seccion: "B" },
      areaActualId: 4,
      fechaInicioDesde: "2026-01-01",
      incluirAnulados: true,
      cargaHistorica: false,
    };
    const ruta = rutaBusqueda(filtros);
    expect(ruta.startsWith("/expedientes?")).toBe(true);
    const parametros: Record<string, string | string[]> = {};
    for (const [k, v] of new URLSearchParams(ruta.split("?")[1])) {
      const previo = parametros[k];
      parametros[k] = previo === undefined ? v : [...(Array.isArray(previo) ? previo : [previo]), v];
    }
    expect(leerParametrosBusqueda(parametros).entrada.filtros).toEqual(filtros);
    expect(rutaBusqueda({})).toBe("/expedientes");
    expect(leerParametrosBusqueda({ historica: "1" }).entrada.filtros).toEqual({ cargaHistorica: true });
  });
});
