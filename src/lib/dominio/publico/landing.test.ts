import { describe, expect, it } from "vitest";
import type { DocumentoPlantilla } from "../plantillas/esquema";
import { documentosParaTraer, NOTA_PERSONA_JURIDICA, NOTA_SEGUN_CEMENTERIO } from "./landing";

function doc(nombre: string, extra: Partial<DocumentoPlantilla> = {}): DocumentoPlantilla {
  return {
    clave: nombre.toUpperCase().replace(/[^A-Z]/g, "_"),
    nombre,
    origen: "concesionario",
    obligatorio: true,
    exigir_al_salir_de: null,
    adjunto: "no",
    solo_cementerios: null,
    excepto_cementerios: null,
    solo_si_juridica: null,
    ...extra,
  };
}

describe("documentosParaTraer", () => {
  it("solo los de origen concesionario, unidos sin repetir (el mismo nombre, aunque cambie la clave o las tildes)", () => {
    const r = documentosParaTraer([
      { documentos: [doc("Fotocopia del DNI"), doc("Boleta emitida", { origen: "direccion" }), doc("Título anterior")] },
      { documentos: [doc("Fotocopia del DNÍ", { clave: "OTRA" }), doc("Copia del comprobante de pago")] },
    ]);
    expect(r).toEqual([
      { nombre: "Fotocopia del DNI", nota: null },
      { nombre: "Título anterior", nota: null },
      { nombre: "Copia del comprobante de pago", nota: null },
    ]);
  });

  it("la nota, solo si en todas las plantillas está condicionado", () => {
    const r = documentosParaTraer([
      { documentos: [doc("Personería jurídica", { solo_si_juridica: "titular" }), doc("Informe técnico", { solo_cementerios: ["OESTE"] })] },
      { documentos: [doc("Personería jurídica", { solo_si_juridica: "titular" }), doc("Informe técnico")] },
      { documentos: [doc("Plano", { excepto_cementerios: ["JARDIN"] })] },
    ]);
    expect(r).toEqual([
      { nombre: "Personería jurídica", nota: NOTA_PERSONA_JURIDICA },
      { nombre: "Informe técnico", nota: null },
      { nombre: "Plano", nota: NOTA_SEGUN_CEMENTERIO },
    ]);
  });

  it("sin plantillas, nada", () => {
    expect(documentosParaTraer([])).toEqual([]);
  });
});
