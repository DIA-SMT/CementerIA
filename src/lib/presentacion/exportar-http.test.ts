import { describe, expect, it } from "vitest";
import { parametrosDe, rutaExportar, rutaExportarDesde } from "./exportar-http";

describe("Exportar CSV: la URL (sección 5)", () => {
  it("lleva los mismos filtros que la búsqueda", () => {
    expect(rutaExportar("/expedientes")).toBe("/expedientes/exportar");
    expect(rutaExportar("/expedientes?q=gonzalez&estado=archivado")).toBe("/expedientes/exportar?q=gonzalez&estado=archivado");
    expect(rutaExportarDesde({ q: "gonzalez", estado: ["en_tramite", "archivado"], cementerio: "2", "u.lote": "12", basura: "x" })).toBe(
      "/expedientes/exportar?q=gonzalez&estado=en_tramite&estado=archivado&cementerio=2&u.lote=12",
    );
  });

  it("los parámetros repetidos se leen como lista, como los searchParams de una página", () => {
    expect(parametrosDe(new URLSearchParams("estado=a&estado=b&q=x"))).toEqual({ estado: ["a", "b"], q: "x" });
  });
});
