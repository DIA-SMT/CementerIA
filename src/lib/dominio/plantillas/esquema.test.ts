import { describe, expect, it } from "vitest";
import { DefinicionPlantilla, analizarDefinicion, destinoDePaso, rutaComoTexto } from "./esquema";

/** El ejemplo de la sección 2.5 de la propuesta, tal cual. */
function ejemplo25(): Record<string, unknown> {
  return {
    forma_pago: "contado",
    tipos_monumento: ["SOTANITO", "CAPILLA", "MAUSOLEO", "SEPULTURA"],
    ubicacion_obligatoria: true,
    requiere_contacto: true,
    personas: [
      { rol: "titular", etiqueta: "Titular de la concesión", min: 1, max: 1, fallecido: "no", pide_vinculo: false },
      { rol: "solicitante", etiqueta: "Solicitante", min: 0, max: 1, fallecido: "no", pide_vinculo: true },
    ],
    campos_extra: [
      {
        clave: "concesion_hasta",
        etiqueta: "Vencimiento de la concesión",
        tipo: "fecha",
        obligatorio: false,
        exigir_al_salir_de: "COMPUTO_FINAL",
        buscable: false,
        opciones: null,
      },
    ],
    documentos: [
      {
        clave: "DNI",
        nombre: "Fotocopia del DNI",
        origen: "concesionario",
        obligatorio: true,
        exigir_al_salir_de: "MESA",
        adjunto: "no",
      },
    ],
    conceptos: [{ clave: "DERECHO_OFICINA", nombre: "Derecho de oficina", via: "boleta", paso: "LIQUIDACION" }],
    pasos: [
      {
        clave: "LIQUIDACION",
        nombre: "Liquidación y boleta",
        area: "LIQUIDACION",
        custodia: null,
        estado: "en_tramite",
        omitible: false,
        dias_alerta: 15,
        instrucciones: "Liquida, genera débitos…",
        plazo: null,
        subtareas: [{ clave: "LIQ_PAGO", nombre: "Pago verificado", obligatoria: true, dato: "fecha", dato_obligatorio: true }],
      },
    ],
  };
}

type Objeto = Record<string, unknown>;
const primerPaso = (d: Objeto): Objeto => (d.pasos as Objeto[])[0];

function errores(valor: unknown): string[] {
  const r = analizarDefinicion(valor);
  return r.ok ? [] : r.errores.map((e) => `${e.ruta}: ${e.mensaje}`);
}

describe("DefinicionPlantilla: forma", () => {
  it("acepta el ejemplo de la sección 2.5", () => {
    const r = analizarDefinicion(ejemplo25());
    expect(r.ok).toBe(true);
  });

  it("completa requiere_contacto (true) e instrucciones (null) si faltan", () => {
    const d = ejemplo25();
    delete d.requiere_contacto;
    delete primerPaso(d).instrucciones;
    const r = DefinicionPlantilla.parse(d);
    expect(r.requiere_contacto).toBe(true);
    expect(r.pasos[0].instrucciones).toBeNull();
  });

  it("completa los campos de la semana 4 si faltan: una definición vieja se lee igual", () => {
    const r = DefinicionPlantilla.parse(ejemplo25());
    expect(r.personas[0].admite_juridica).toBe(false);
    expect(r.documentos[0]).toMatchObject({ solo_cementerios: null, excepto_cementerios: null, solo_si_juridica: null });
    expect(r.conceptos[0]).toMatchObject({ solo_cementerios: null, excepto_cementerios: null });
    expect(r.pasos[0].subtareas[0]).toMatchObject({ solo_cementerios: null, excepto_cementerios: null });
  });

  it("filtros por cementerio: códigos en mayúsculas y al menos uno", () => {
    const d = ejemplo25();
    (d.conceptos as Objeto[])[0].excepto_cementerios = ["JARDIN_NORTE"];
    expect(errores(d)).toEqual([]);
    (d.conceptos as Objeto[])[0].excepto_cementerios = [];
    expect(errores(d)).toEqual(["conceptos[0].excepto_cementerios: Si se filtra por cementerio, tiene que haber al menos uno"]);
    (d.conceptos as Objeto[])[0].excepto_cementerios = ["jardin"];
    expect(errores(d)).toEqual([expect.stringMatching(/^conceptos\[0\]\.excepto_cementerios\[0\]: Código de cementerio inválido/)]);
  });

  it("solo_si_juridica: un rol o null", () => {
    const d = ejemplo25();
    (d.documentos as Objeto[])[0].solo_si_juridica = "titular";
    expect(errores(d)).toEqual([]);
    (d.documentos as Objeto[])[0].solo_si_juridica = "Titular";
    expect(errores(d)).toEqual([expect.stringMatching(/^documentos\[0\]\.solo_si_juridica: Rol inválido/)]);
  });

  it("exige las demás claves", () => {
    const d = ejemplo25();
    delete primerPaso(d).dias_alerta;
    delete primerPaso(d).custodia;
    expect(errores(d)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pasos\[0\]\.dias_alerta: /), expect.stringMatching(/^pasos\[0\]\.custodia: /)]),
    );
  });

  it("rechaza claves de más, con el mensaje en español", () => {
    const d = ejemplo25();
    primerPaso(d).responsable = "LEGAL";
    expect(errores(d)).toEqual(["pasos[0]: Llave desconocida: \"responsable\""]);
  });

  it("exige al menos un paso", () => {
    const d = ejemplo25();
    d.pasos = [];
    expect(errores(d)).toEqual(["pasos: La plantilla tiene que tener al menos un paso"]);
  });

  it("recorta los textos y no los acepta vacíos", () => {
    const d = ejemplo25();
    primerPaso(d).nombre = "  Liquidación  ";
    const r = DefinicionPlantilla.parse(d);
    expect(r.pasos[0].nombre).toBe("Liquidación");
    primerPaso(d).nombre = "   ";
    expect(errores(d)).toEqual(["pasos[0].nombre: No puede quedar vacío"]);
  });
});

describe("DefinicionPlantilla: valores admitidos (tabla de 2.5)", () => {
  const casos: Array<[string, (d: Objeto) => void]> = [
    ["forma_pago", (d) => (d.forma_pago = "cuotas")],
    ["fallecido", (d) => ((d.personas as Objeto[])[0].fallecido = "tal_vez")],
    ["tipo de campo extra", (d) => ((d.campos_extra as Objeto[])[0].tipo = "booleano")],
    ["origen de documento", (d) => ((d.documentos as Objeto[])[0].origen = "cementerio")],
    ["adjunto", (d) => ((d.documentos as Objeto[])[0].adjunto = "si")],
    ["vía del concepto", (d) => ((d.conceptos as Objeto[])[0].via = "efectivo")],
    ["estado del paso", (d) => (primerPaso(d).estado = "concluido")],
    ["dato de subtarea", (d) => ((primerPaso(d).subtareas as Objeto[])[0].dato = "numero")],
  ];

  it.each(casos)("rechaza un valor fuera de la lista: %s", (_, cambiar) => {
    const d = ejemplo25();
    cambiar(d);
    expect(errores(d)).toEqual([expect.stringMatching(/Opción inválida: se esperaba una de/)]);
  });

  it("acepta los cuatro valores de forma_pago", () => {
    for (const forma of ["contado", "plan_pagos", "a_elegir", "no_aplica"]) {
      expect(analizarDefinicion({ ...ejemplo25(), forma_pago: forma }).ok).toBe(true);
    }
  });

  it("rol de persona: minúsculas y _", () => {
    const d = ejemplo25();
    (d.personas as Objeto[])[0].rol = "Titular";
    expect(errores(d)).toEqual([expect.stringMatching(/^personas\[0\]\.rol: Rol inválido/)]);
    (d.personas as Objeto[])[0].rol = "cesionario_2";
    expect(errores(d)).toEqual([expect.stringMatching(/^personas\[0\]\.rol: /)]);
    (d.personas as Objeto[])[0].rol = "cesionario";
    expect(errores(d)).toEqual([]);
  });

  it("claves: mayúsculas en pasos, subtareas, documentos y conceptos; minúsculas en campos extra", () => {
    const d = ejemplo25();
    (d.documentos as Objeto[])[0].clave = "dni";
    (d.campos_extra as Objeto[])[0].clave = "CONCESION_HASTA";
    expect(errores(d)).toEqual([
      expect.stringMatching(/^campos_extra\[0\]\.clave: Clave inválida/),
      expect.stringMatching(/^documentos\[0\]\.clave: Clave inválida/),
    ]);
  });

  it("área del paso: un código, $CEMENTERIO o $CAMPO:<clave>", () => {
    for (const area of ["DIM", "CEM_JARDIN_NORTE", "$CEMENTERIO", "$CAMPO:cementerio_destino"]) {
      const d = ejemplo25();
      primerPaso(d).area = area;
      expect(errores(d)).toEqual([]);
    }
    for (const area of ["dim", "$CAMPO:Destino", "$CAMPO:", "$OTRO", ""]) {
      const d = ejemplo25();
      primerPaso(d).area = area;
      expect(errores(d)).toEqual([expect.stringMatching(/^pasos\[0\]\.area: Área inválida/)]);
    }
  });

  it("tipos de monumento: códigos en mayúsculas; [] vale (todos los del cementerio)", () => {
    expect(analizarDefinicion({ ...ejemplo25(), tipos_monumento: [] }).ok).toBe(true);
    expect(errores({ ...ejemplo25(), tipos_monumento: ["nicho"] })).toEqual([expect.stringMatching(/^tipos_monumento\[0\]: /)]);
  });

  it("dias_alerta: entero, 1 o más", () => {
    for (const [valor, error] of [
      [0, "Tiene que ser 1 o más"],
      [1.5, "Tiene que ser un número entero"],
      ["5", "Tiene que ser un número entero"],
    ] as const) {
      const d = ejemplo25();
      primerPaso(d).dias_alerta = valor;
      expect(errores(d)).toEqual([`pasos[0].dias_alerta: ${error}`]);
    }
  });

  it("personas: min desde 0, max desde 1", () => {
    const d = ejemplo25();
    (d.personas as Objeto[])[1].min = -1;
    (d.personas as Objeto[])[1].max = 0;
    expect(errores(d)).toEqual([
      "personas[1].min: No puede ser negativo",
      "personas[1].max: Tiene que ser 1 o más",
    ]);
  });

  it("opciones: null o una lista no vacía", () => {
    const d = ejemplo25();
    (d.campos_extra as Objeto[])[0].opciones = [];
    expect(errores(d)).toEqual(["campos_extra[0].opciones: Si hay opciones, tiene que haber al menos una"]);
  });

  it("plazo: null o {dias_habiles, desde_subtarea, hasta_subtarea}", () => {
    const d = ejemplo25();
    primerPaso(d).plazo = { dias_habiles: 30, desde_subtarea: "TRIB_NOTIFICADA", hasta_subtarea: "DIM_PLAN_INICIADO" };
    expect(errores(d)).toEqual([]);
    primerPaso(d).plazo = { dias_habiles: 30, desde_subtarea: "TRIB_NOTIFICADA" };
    expect(errores(d)).toEqual([expect.stringMatching(/^pasos\[0\]\.plazo\.hasta_subtarea: /)]);
    primerPaso(d).plazo = { dias_habiles: 0, desde_subtarea: "A", hasta_subtarea: "B" };
    expect(errores(d)).toEqual(["pasos[0].plazo.dias_habiles: Tiene que ser 1 o más"]);
  });

  it("rechaza lo que no es un objeto", () => {
    expect(errores(null)).toEqual([expect.stringMatching(/^: Entrada inválida/)]);
    expect(errores([])).toHaveLength(1);
  });
});

describe("ayudas", () => {
  it("destinoDePaso distingue área, cementerio del expediente y campo extra", () => {
    expect(destinoDePaso("LEGAL")).toEqual({ tipo: "area", codigo: "LEGAL" });
    expect(destinoDePaso("$CEMENTERIO")).toEqual({ tipo: "cementerio" });
    expect(destinoDePaso("$CAMPO:cementerio_destino")).toEqual({ tipo: "campo", clave: "cementerio_destino" });
  });

  it("rutaComoTexto", () => {
    expect(rutaComoTexto(["pasos", 6, "subtareas", 0, "clave"])).toBe("pasos[6].subtareas[0].clave");
    expect(rutaComoTexto([])).toBe("");
  });
});
