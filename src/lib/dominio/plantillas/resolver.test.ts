import { describe, expect, it } from "vitest";
import { NUEVA_CONC_CONTADO } from "../../../../prisma/semilla/plantillas/nueva-conc-contado";
import { RENOV_CONTADO } from "../../../../prisma/semilla/plantillas/renov-contado";
import { RENOV_PLAN } from "../../../../prisma/semilla/plantillas/renov-plan";
import { RENOV_SPT_CONTADO } from "../../../../prisma/semilla/plantillas/renov-spt-contado";
import type { DefinicionPlantilla } from "./esquema";
import { aplicaEnCementerio, resolverDefinicion, resolverPorCementerio } from "./resolver";

// Con las plantillas de la semilla: lo que importa es que cada cementerio vea
// lo que dicen los procedimientos (docs/fuentes).

const claves = (lista: ReadonlyArray<{ clave: string }>) => lista.map((x) => x.clave);
const subtareasDe = (def: DefinicionPlantilla, paso: string) => def.pasos.find((p) => p.clave === paso)?.subtareas.map((s) => s.nombre) ?? [];

describe("aplicaEnCementerio", () => {
  it("sin filtro, en todos; con solo o excepto, según la lista", () => {
    expect(aplicaEnCementerio({ solo_cementerios: null, excepto_cementerios: null }, "NORTE")).toBe(true);
    expect(aplicaEnCementerio({ solo_cementerios: ["OESTE"], excepto_cementerios: null }, "NORTE")).toBe(false);
    expect(aplicaEnCementerio({ solo_cementerios: ["OESTE"], excepto_cementerios: null }, "OESTE")).toBe(true);
    expect(aplicaEnCementerio({ solo_cementerios: null, excepto_cementerios: ["JARDIN_NORTE"] }, "JARDIN_NORTE")).toBe(false);
  });
});

describe("conceptos y boleta según el cementerio (docs/fuentes, punto 2)", () => {
  it("en Jardín la renovación no cobra inspección técnica; en el Oeste y el Norte sí", () => {
    for (const def of [RENOV_CONTADO, RENOV_PLAN, RENOV_SPT_CONTADO]) {
      expect(claves(resolverPorCementerio(def, "JARDIN_NORTE").conceptos)).not.toContain("INSPECCION_TECNICA");
      expect(claves(resolverPorCementerio(def, "OESTE").conceptos)).toContain("INSPECCION_TECNICA");
      expect(claves(resolverPorCementerio(def, "NORTE").conceptos)).toContain("INSPECCION_TECNICA");
    }
  });

  it("la nueva concesión no la cobra en ningún cementerio", () => {
    for (const c of ["OESTE", "NORTE", "JARDIN_NORTE"]) {
      expect(claves(resolverPorCementerio(NUEVA_CONC_CONTADO, c).conceptos)).not.toContain("INSPECCION_TECNICA");
    }
  });

  it("la boleta de Jardín no nombra la inspección técnica", () => {
    expect(subtareasDe(resolverPorCementerio(RENOV_CONTADO, "JARDIN_NORTE"), "LIQUIDACION")).toEqual([
      "Liquidación practicada y débitos generados",
      "Boleta emitida: oficina y arrendamiento",
      "Pago verificado: Rapipago, Pago Fácil o Banco Macro",
    ]);
    expect(subtareasDe(resolverPorCementerio(RENOV_CONTADO, "OESTE"), "LIQUIDACION")).toContain(
      "Boleta emitida: oficina, inspección técnica y arrendamiento",
    );
    expect(subtareasDe(resolverPorCementerio(RENOV_PLAN, "JARDIN_NORTE"), "LIQUIDACION")).toContain("Boleta emitida: derecho de oficina");
    for (const c of ["OESTE", "NORTE", "JARDIN_NORTE"]) {
      for (const def of [RENOV_CONTADO, RENOV_PLAN, RENOV_SPT_CONTADO]) {
        const boletas = subtareasDe(resolverPorCementerio(def, c), "LIQUIDACION").filter((n) => n.startsWith("Boleta"));
        expect(boletas).toHaveLength(1);
        expect(boletas[0].includes("inspección técnica")).toBe(c !== "JARDIN_NORTE");
      }
    }
  });
});

describe("Conservación pagada (docs/fuentes, punto 5)", () => {
  it("se pide en las renovaciones del Oeste y de Jardín, no en el Norte (a confirmar)", () => {
    for (const def of [RENOV_CONTADO, RENOV_PLAN, RENOV_SPT_CONTADO]) {
      expect(claves(resolverPorCementerio(def, "OESTE").documentos)).toContain("CONSERVACION");
      expect(claves(resolverPorCementerio(def, "JARDIN_NORTE").documentos)).toContain("CONSERVACION");
      expect(claves(resolverPorCementerio(def, "NORTE").documentos)).not.toContain("CONSERVACION");
    }
    expect(claves(NUEVA_CONC_CONTADO.documentos)).not.toContain("CONSERVACION");
  });
});

describe("persona jurídica (docs/fuentes, punto 3)", () => {
  it("la personería y la designación de asamblea, solo si el titular es jurídica", () => {
    const fisica = resolverDefinicion(RENOV_CONTADO, { cementerio: "OESTE", rolesJuridicos: [] });
    const juridica = resolverDefinicion(RENOV_CONTADO, { cementerio: "OESTE", rolesJuridicos: ["titular"] });
    expect(claves(fisica.documentos)).not.toContain("PERSONERIA");
    expect(claves(juridica.documentos)).toEqual(expect.arrayContaining(["PERSONERIA", "DESIGNACION_ASAMBLEA"]));
    // Un solicitante jurídico no las pide: dependen del titular.
    expect(claves(resolverDefinicion(RENOV_PLAN, { cementerio: "NORTE", rolesJuridicos: ["solicitante"] }).documentos)).not.toContain("PERSONERIA");
  });

  it("la renovación SPT no admite jurídica ni pide su documentación", () => {
    expect(RENOV_SPT_CONTADO.personas.some((p) => p.admite_juridica)).toBe(false);
    expect(claves(RENOV_SPT_CONTADO.documentos)).not.toContain("PERSONERIA");
  });

  it("resolver por cementerio deja los documentos que dependen de las personas (el alta los muestra según lo cargado)", () => {
    expect(claves(resolverPorCementerio(RENOV_CONTADO, "OESTE").documentos)).toContain("PERSONERIA");
  });

  it("no cambia los pasos ni los demás datos", () => {
    const r = resolverDefinicion(RENOV_PLAN, { cementerio: "JARDIN_NORTE", rolesJuridicos: [] });
    expect(r.pasos.map((p) => p.clave)).toEqual(RENOV_PLAN.pasos.map((p) => p.clave));
    expect(r.personas).toEqual(RENOV_PLAN.personas);
    expect(r.campos_extra).toEqual(RENOV_PLAN.campos_extra);
  });
});
