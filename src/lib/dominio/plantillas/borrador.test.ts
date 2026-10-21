import { describe, expect, it } from "vitest";
import { PLANTILLAS } from "../../../../prisma/semilla/plantillas";
import { definicionEditable, definicionInicial } from "./borrador";
import { analizarDefinicion } from "./esquema";

describe("definicionEditable (borradores, semana 5)", () => {
  it.each(PLANTILLAS.map((p) => [p.codigo, p.definicion] as const))("%s publicada no cambia", (_, def) => {
    expect(definicionEditable(def)).toEqual(def);
    // Ida y vuelta por JSON (como la columna jsonb): igual.
    expect(definicionEditable(JSON.parse(JSON.stringify(def)))).toEqual(def);
  });

  it("un borrador roto queda con la forma completa del esquema, sin claves de más", () => {
    const d = definicionEditable({
      forma_pago: "trueque",
      tipos_monumento: ["SEPULTURA", 3],
      pasos: [{ clave: "MESA", dias_alerta: "7", subtareas: [{ clave: "X", dato: "hora" }], extra: true }, "no es un paso"],
      personas: null,
      sobrante: 1,
    });
    expect(d).toEqual({
      forma_pago: "contado",
      tipos_monumento: ["SEPULTURA"],
      ubicacion_obligatoria: true,
      requiere_contacto: true,
      personas: [],
      campos_extra: [],
      documentos: [],
      conceptos: [],
      pasos: [
        {
          clave: "MESA",
          nombre: "",
          area: "",
          custodia: null,
          estado: "en_tramite",
          omitible: false,
          dias_alerta: 7,
          instrucciones: null,
          plazo: null,
          subtareas: [{ clave: "X", nombre: "", obligatoria: true, dato: null, dato_obligatorio: false, solo_cementerios: null, excepto_cementerios: null }],
        },
        { clave: "", nombre: "", area: "", custodia: null, estado: "en_tramite", omitible: false, dias_alerta: 5, instrucciones: null, plazo: null, subtareas: [] },
      ],
    });
    // Con la forma, el esquema solo marca valores (no "falta la clave tal").
    const r = analizarDefinicion(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.every((e) => !/Required|Requerido|esperado/i.test(e.mensaje) || e.ruta !== "")).toBe(true);
  });

  it("un filtro 'Solo en…' sin cementerios marcados se conserva vacío (Validar lo señala)", () => {
    const d = definicionEditable({ conceptos: [{ clave: "C", nombre: "C", via: "boleta", paso: "P", solo_cementerios: [] }] });
    expect(d.conceptos[0].solo_cementerios).toEqual([]);
    const r = analizarDefinicion({ ...d, pasos: [{ ...definicionEditable({ pasos: [{}] }).pasos[0] }] });
    expect(r.ok ? [] : r.errores.map((e) => e.ruta)).toContain("conceptos[0].solo_cementerios");
  });

  it("la plantilla nueva tiene un titular vivo y ningún paso", () => {
    const d = definicionInicial();
    expect(d.personas).toEqual([{ rol: "titular", etiqueta: "Titular de la concesión", min: 1, max: 1, fallecido: "no", pide_vinculo: false, admite_juridica: false }]);
    expect(d.pasos).toEqual([]);
    expect(definicionEditable(d)).toEqual(d);
  });
});
