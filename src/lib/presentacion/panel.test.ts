import { describe, expect, it } from "vitest";
import { enlaceConteo, leerFiltrosPanel, textoCantidad, textoMes } from "./panel";

describe("panel (sección 5)", () => {
  it("los filtros de la URL: tramite y cementerio, lo demás se ignora", () => {
    expect(leerFiltrosPanel({ tramite: "2", cementerio: ["3", "4"], otro: "x" })).toEqual({ filtros: { tipoTramiteId: 2, cementerioId: 3 }, valores: { tramite: "2", cementerio: "3" } });
    expect(leerFiltrosPanel({ tramite: "abc", cementerio: "0" })).toEqual({ filtros: {}, valores: { tramite: "", cementerio: "" } });
  });

  it("cada número lleva a la búsqueda filtrada (si tiene filtro equivalente)", () => {
    expect(enlaceConteo({ estados: ["en_tramite", "espera_pago_dim"], areaActualId: 4, tipoTramiteId: 1, cargaHistorica: false })).toBe(
      "/expedientes?estado=en_tramite&estado=espera_pago_dim&tramite=1&area=4&historica=0",
    );
    expect(enlaceConteo({ estados: ["anulado"], incluirAnulados: true })).toBe("/expedientes?estado=anulado&anulados=1");
    expect(enlaceConteo(null)).toBeNull();
  });

  it("textos", () => {
    expect(textoMes("2026-10")).toBe("octubre de 2026");
    expect(textoMes("raro")).toBe("raro");
    expect(textoCantidad(1)).toBe("1 expediente");
    expect(textoCantidad(1200)).toBe("1.200 expedientes");
    expect(textoCantidad(2, "corrección", "correcciones")).toBe("2 correcciones");
  });
});
