import { describe, expect, it } from "vitest";
import type { DefinicionPlantilla, PasoPlantilla } from "./esquema";
import { validarIntegridad, validarPublicacion, type CatalogosPlantilla, type ReglaIntegridad } from "./validar";

const CATALOGOS: CatalogosPlantilla = {
  areas: [
    { codigo: "MESA_ENTRADAS", tipo: "interna", activa: true, recibePases: true },
    { codigo: "TRIBUTARIO", tipo: "interna", activa: true, recibePases: true },
    { codigo: "LIQUIDACION", tipo: "interna", activa: true, recibePases: true },
    { codigo: "DIRECCION", tipo: "interna", activa: true, recibePases: false },
    { codigo: "VIEJA", tipo: "interna", activa: false, recibePases: true },
    { codigo: "DIM", tipo: "externa", activa: true, recibePases: true },
    { codigo: "DIM_VIEJA", tipo: "externa", activa: false, recibePases: true },
  ],
  tiposMonumento: [
    { codigo: "SEPULTURA", activo: true },
    { codigo: "NICHO", activo: true },
    { codigo: "BOVEDA", activo: false },
  ],
  cementerios: [
    { codigo: "OESTE", activo: true },
    { codigo: "JARDIN_NORTE", activo: true },
    { codigo: "VIEJO", activo: false },
  ],
};

/** Sin filtro por cementerio (semana 4). */
const SIN_FILTRO = { solo_cementerios: null, excepto_cementerios: null };

function paso(clave: string, area: string, extra: Partial<PasoPlantilla> = {}): PasoPlantilla {
  return {
    clave,
    nombre: `Paso ${clave}`,
    area,
    custodia: null,
    estado: "en_tramite",
    omitible: false,
    dias_alerta: 5,
    instrucciones: null,
    plazo: null,
    subtareas: [],
    ...extra,
  };
}

/**
 * Válida, y con un caso de cada cosa: paso externo con custodia y plazo,
 * $CEMENTERIO, $CAMPO, campo de opción, documentos y conceptos con referencias.
 */
function valida(): DefinicionPlantilla {
  return {
    forma_pago: "a_elegir",
    tipos_monumento: ["SEPULTURA", "NICHO"],
    ubicacion_obligatoria: true,
    requiere_contacto: true,
    personas: [
      { rol: "titular", etiqueta: "Titular", min: 1, max: 1, fallecido: "opcional", pide_vinculo: false, admite_juridica: false },
      { rol: "difunto", etiqueta: "Difunto", min: 0, max: 3, fallecido: "si", pide_vinculo: true, admite_juridica: false },
    ],
    campos_extra: [
      { clave: "cementerio_destino", etiqueta: "Cementerio de destino", tipo: "cementerio", obligatorio: true, exigir_al_salir_de: "MESA", buscable: false, opciones: null },
      { clave: "operacion", etiqueta: "Operación", tipo: "opcion", obligatorio: true, exigir_al_salir_de: null, buscable: true, opciones: ["Inhumación", "Exhumación"] },
    ],
    documentos: [
      { clave: "DNI", nombre: "DNI", origen: "concesionario", obligatorio: true, exigir_al_salir_de: "MESA", adjunto: "no", ...SIN_FILTRO, solo_si_juridica: null },
      { clave: "ACTA", nombre: "Acta", origen: "concesionario", obligatorio: true, exigir_al_salir_de: null, adjunto: "obligatorio", ...SIN_FILTRO, solo_si_juridica: null },
    ],
    conceptos: [
      { clave: "DERECHO_OFICINA", nombre: "Derecho de oficina", via: "boleta", paso: "MESA", ...SIN_FILTRO },
      { clave: "ARRENDAMIENTO", nombre: "Arrendamiento", via: "plan_dim", paso: "NOTIF", ...SIN_FILTRO },
    ],
    pasos: [
      paso("MESA", "MESA_ENTRADAS", {
        subtareas: [{ clave: "MESA_CARATULA", nombre: "Carátula", obligatoria: true, dato: null, dato_obligatorio: false, ...SIN_FILTRO }],
      }),
      paso("NOTIF", "TRIBUTARIO", {
        subtareas: [{ clave: "NOTIF_FECHA", nombre: "Notificado", obligatoria: true, dato: "fecha", dato_obligatorio: true, ...SIN_FILTRO }],
      }),
      paso("DIM", "DIM", {
        custodia: "TRIBUTARIO",
        estado: "espera_pago_dim",
        plazo: { dias_habiles: 30, desde_subtarea: "NOTIF_FECHA", hasta_subtarea: "DIM_INICIADO" },
        subtareas: [
          { clave: "DIM_INICIADO", nombre: "Plan iniciado", obligatoria: false, dato: "fecha", dato_obligatorio: true, ...SIN_FILTRO },
          { clave: "DIM_CANCELADA", nombre: "Deuda cancelada", obligatoria: true, dato: "fecha", dato_obligatorio: true, ...SIN_FILTRO },
        ],
      }),
      paso("CEMENTERIO", "$CEMENTERIO", { custodia: "MESA_ENTRADAS" }),
      paso("DESTINO", "$CAMPO:cementerio_destino", { custodia: "MESA_ENTRADAS", omitible: true }),
      paso("FIN", "MESA_ENTRADAS", {
        subtareas: [{ clave: "FIN_ENTREGA", nombre: "Entregado", obligatoria: true, dato: "texto", dato_obligatorio: false, ...SIN_FILTRO }],
      }),
    ],
  };
}

const pasoDe = (d: DefinicionPlantilla, clave: string): PasoPlantilla => {
  const p = d.pasos.find((x) => x.clave === clave);
  if (!p) throw new Error(`No hay paso ${clave}`);
  return p;
};

function errores(d: DefinicionPlantilla) {
  return validarIntegridad(d, CATALOGOS);
}

/** Afirma que falla exactamente esa regla, en esa ruta, y que el mensaje dice algo. */
function fallaSolo(d: DefinicionPlantilla, regla: ReglaIntegridad, ruta: string, mensaje: RegExp): void {
  expect(errores(d)).toEqual([{ regla, ruta, mensaje: expect.stringMatching(mensaje) }]);
}

describe("validarIntegridad", () => {
  it("una definición válida no tiene errores", () => {
    expect(errores(valida())).toEqual([]);
  });

  describe("claves_unicas", () => {
    it("una subtarea no puede repetir la clave de un paso", () => {
      const d = valida();
      pasoDe(d, "FIN").subtareas[0].clave = "MESA";
      fallaSolo(d, "claves_unicas", "pasos[5].subtareas[0]", /"MESA" está repetida \(ya se usa en pasos\[0\]\)/);
    });

    it("un documento no puede repetir la clave de un concepto (es una sola tabla de claves)", () => {
      const d = valida();
      d.conceptos[0].clave = "DNI";
      fallaSolo(d, "claves_unicas", "conceptos[0]", /"DNI" está repetida/);
    });

    it("dos campos extra no pueden tener la misma clave", () => {
      const d = valida();
      d.campos_extra[1] = { ...d.campos_extra[0], etiqueta: "Otro cementerio" };
      fallaSolo(d, "claves_unicas", "campos_extra[1]", /"cementerio_destino" está repetida/);
    });

    it("dos roles de persona no pueden repetirse", () => {
      const d = valida();
      d.personas[1].rol = "titular";
      fallaSolo(d, "claves_unicas", "personas[1].rol", /rol "titular" está repetido/);
    });

    it("lo que se compara es la clave: dos subtareas con el mismo nombre y claves distintas son válidas", () => {
      const d = valida();
      const fin = pasoDe(d, "FIN");
      fin.subtareas.push({ ...fin.subtareas[0], clave: "FIN_ENTREGA_2" });
      expect(errores(d)).toEqual([]);
    });
  });

  describe("areas", () => {
    it("el área tiene que existir", () => {
      const d = valida();
      pasoDe(d, "NOTIF").area = "NOTIFICACIONES";
      fallaSolo(d, "areas", "pasos[1].area", /NOTIFICACIONES, que no existe/);
    });

    it("el área tiene que estar activa", () => {
      const d = valida();
      pasoDe(d, "NOTIF").area = "VIEJA";
      fallaSolo(d, "areas", "pasos[1].area", /VIEJA, que está inactiva/);
    });

    it("el área tiene que recibir pases (Dirección no)", () => {
      const d = valida();
      pasoDe(d, "NOTIF").area = "DIRECCION";
      fallaSolo(d, "areas", "pasos[1].area", /DIRECCION, que no recibe pases/);
    });

    it("un área externa inactiva también falla", () => {
      const d = valida();
      pasoDe(d, "DIM").area = "DIM_VIEJA";
      fallaSolo(d, "areas", "pasos[2].area", /DIM_VIEJA, que está inactiva/);
    });

    it("dos pasos pueden ir a la misma área activa", () => {
      const d = valida();
      pasoDe(d, "NOTIF").area = "MESA_ENTRADAS";
      expect(errores(d)).toEqual([]);
    });
  });

  describe("custodia", () => {
    it("un paso a un área externa exige custodia", () => {
      const d = valida();
      pasoDe(d, "DIM").custodia = null;
      fallaSolo(d, "custodia", "pasos[2].custodia", /va a un área externa \(DIM\) y no tiene custodia/);
    });

    it("$CEMENTERIO exige custodia", () => {
      const d = valida();
      pasoDe(d, "CEMENTERIO").custodia = null;
      fallaSolo(d, "custodia", "pasos[3].custodia", /\$CEMENTERIO\) y no tiene custodia/);
    });

    it("$CAMPO exige custodia", () => {
      const d = valida();
      pasoDe(d, "DESTINO").custodia = null;
      fallaSolo(d, "custodia", "pasos[4].custodia", /\$CAMPO:cementerio_destino\) y no tiene custodia/);
    });

    it("un paso interno no lleva custodia", () => {
      const d = valida();
      pasoDe(d, "NOTIF").custodia = "MESA_ENTRADAS";
      fallaSolo(d, "custodia", "pasos[1].custodia", /área interna: la custodia tiene que quedar vacía/);
    });

    it("la custodia es un área interna", () => {
      const d = valida();
      pasoDe(d, "CEMENTERIO").custodia = "DIM";
      fallaSolo(d, "custodia", "pasos[3].custodia", /DIM, que no es un área interna/);
    });

    it("la custodia existe, está activa y recibe pases", () => {
      const d = valida();
      pasoDe(d, "DIM").custodia = "TESORERIA";
      fallaSolo(d, "custodia", "pasos[2].custodia", /TESORERIA, que no existe/);
      pasoDe(d, "DIM").custodia = "VIEJA";
      fallaSolo(d, "custodia", "pasos[2].custodia", /VIEJA, que está inactiva/);
      pasoDe(d, "DIM").custodia = "DIRECCION";
      fallaSolo(d, "custodia", "pasos[2].custodia", /DIRECCION, que no recibe pases/);
    });

    it("cualquier área interna activa que recibe pases puede ser la custodia", () => {
      const d = valida();
      pasoDe(d, "CEMENTERIO").custodia = "TRIBUTARIO";
      pasoDe(d, "DIM").custodia = "LIQUIDACION";
      expect(errores(d)).toEqual([]);
    });
  });

  describe("referencias", () => {
    it("exigir_al_salir_de de un documento apunta a un paso", () => {
      const d = valida();
      d.documentos[0].exigir_al_salir_de = "MESA_CARATULA";
      fallaSolo(d, "referencias", "documentos[0].exigir_al_salir_de", /"DNI" se exige al salir de "MESA_CARATULA", que no es un paso/);
    });

    it("exigir_al_salir_de de un campo extra apunta a un paso", () => {
      const d = valida();
      d.campos_extra[0].exigir_al_salir_de = "COMPUTO_FINAL";
      fallaSolo(d, "referencias", "campos_extra[0].exigir_al_salir_de", /"COMPUTO_FINAL", que no es un paso/);
    });

    it("conceptos[].paso apunta a un paso", () => {
      const d = valida();
      d.conceptos[1].paso = "TRIBUTARIO";
      fallaSolo(d, "referencias", "conceptos[1].paso", /"ARRENDAMIENTO" se liquida en "TRIBUTARIO", que no es un paso/);
    });

    it("null (se exige al concluir) es válido", () => {
      const d = valida();
      d.documentos[0].exigir_al_salir_de = null;
      d.campos_extra[0].exigir_al_salir_de = null;
      expect(errores(d)).toEqual([]);
    });
  });

  describe("plazo", () => {
    it("desde_subtarea puede ser del mismo paso", () => {
      const d = valida();
      const dim = pasoDe(d, "DIM");
      if (!dim.plazo) throw new Error("falta el plazo");
      dim.plazo.desde_subtarea = "DIM_CANCELADA";
      expect(errores(d)).toEqual([]);
    });

    it("desde_subtarea tiene que existir", () => {
      const d = valida();
      pasoDe(d, "DIM").plazo = { dias_habiles: 30, desde_subtarea: "NOTIF_NOTIFICADA", hasta_subtarea: "DIM_INICIADO" };
      fallaSolo(d, "plazo", "pasos[2].plazo.desde_subtarea", /"NOTIF_NOTIFICADA", que no es una subtarea/);
    });

    it("desde_subtarea no puede ser de un paso posterior", () => {
      const d = valida();
      pasoDe(d, "DIM").plazo = { dias_habiles: 30, desde_subtarea: "FIN_ENTREGA", hasta_subtarea: "DIM_INICIADO" };
      fallaSolo(d, "plazo", "pasos[2].plazo.desde_subtarea", /"FIN_ENTREGA", que es de un paso posterior/);
    });

    it("desde_subtarea tiene que pedir una fecha", () => {
      const d = valida();
      pasoDe(d, "DIM").plazo = { dias_habiles: 30, desde_subtarea: "MESA_CARATULA", hasta_subtarea: "DIM_INICIADO" };
      fallaSolo(d, "plazo", "pasos[2].plazo.desde_subtarea", /"MESA_CARATULA", que no pide una fecha/);
    });

    it("hasta_subtarea tiene que existir", () => {
      const d = valida();
      pasoDe(d, "DIM").plazo = { dias_habiles: 30, desde_subtarea: "NOTIF_FECHA", hasta_subtarea: "DIM_PLAN" };
      fallaSolo(d, "plazo", "pasos[2].plazo.hasta_subtarea", /"DIM_PLAN", que no es una subtarea de la plantilla/);
    });

    it("hasta_subtarea tiene que ser del mismo paso", () => {
      const d = valida();
      pasoDe(d, "DIM").plazo = { dias_habiles: 30, desde_subtarea: "NOTIF_FECHA", hasta_subtarea: "FIN_ENTREGA" };
      fallaSolo(d, "plazo", "pasos[2].plazo.hasta_subtarea", /"FIN_ENTREGA", que es de otro paso/);
    });

    it("no empieza y termina con la misma subtarea", () => {
      const d = valida();
      pasoDe(d, "DIM").plazo = { dias_habiles: 30, desde_subtarea: "DIM_INICIADO", hasta_subtarea: "DIM_INICIADO" };
      fallaSolo(d, "plazo", "pasos[2].plazo", /empieza y se cumple con la misma subtarea/);
    });
  });

  describe("campo_cementerio", () => {
    it("$CAMPO:x necesita un campo extra x", () => {
      const d = valida();
      pasoDe(d, "DESTINO").area = "$CAMPO:destino";
      fallaSolo(d, "campo_cementerio", "pasos[4].area", /no hay un campo extra "destino"/);
    });

    it("el campo tiene que ser de tipo cementerio", () => {
      const d = valida();
      d.campos_extra[0].tipo = "texto";
      fallaSolo(d, "campo_cementerio", "pasos[4].area", /ese campo es de tipo texto y no cementerio/);
    });

    it("el campo de tipo cementerio puede ser opcional", () => {
      const d = valida();
      d.campos_extra[0].obligatorio = false;
      d.campos_extra[0].exigir_al_salir_de = null;
      expect(errores(d)).toEqual([]);
    });
  });

  describe("opciones", () => {
    it("un campo opción tiene opciones", () => {
      const d = valida();
      d.campos_extra[1].opciones = null;
      fallaSolo(d, "opciones", "campos_extra[1].opciones", /"operacion" es de tipo opción y no tiene opciones/);
    });

    it("los demás tipos no llevan opciones", () => {
      const d = valida();
      d.campos_extra[0].opciones = ["Oeste"];
      fallaSolo(d, "opciones", "campos_extra[0].opciones", /es de tipo cementerio: no lleva opciones/);
    });

    it("las opciones no se repiten", () => {
      const d = valida();
      d.campos_extra[1].opciones = ["Inhumación", "Exhumación", "Inhumación"];
      fallaSolo(d, "opciones", "campos_extra[1].opciones", /repite opciones: Inhumación/);
    });

    it("una sola opción es válida", () => {
      const d = valida();
      d.campos_extra[1].opciones = ["Inhumación"];
      expect(errores(d)).toEqual([]);
    });
  });

  describe("dias_alerta", () => {
    it("todo paso tiene dias_alerta de 1 o más", () => {
      const d = valida();
      pasoDe(d, "NOTIF").dias_alerta = 0;
      fallaSolo(d, "dias_alerta", "pasos[1].dias_alerta", /"NOTIF" no tiene días de alerta válidos/);
    });

    it("también si la definición vino sin pasar por el esquema", () => {
      const d = valida();
      // Un borrador viejo leído de la base: el tipo dice number, el JSON no.
      Object.assign(pasoDe(d, "NOTIF"), { dias_alerta: undefined });
      fallaSolo(d, "dias_alerta", "pasos[1].dias_alerta", /no tiene días de alerta válidos/);
    });

    it("1 es válido", () => {
      const d = valida();
      pasoDe(d, "NOTIF").dias_alerta = 1;
      expect(errores(d)).toEqual([]);
    });
  });

  describe("ultimo_paso", () => {
    it("el último paso no puede ser externo", () => {
      const d = valida();
      d.pasos = d.pasos.slice(0, 3);
      fallaSolo(d, "ultimo_paso", "pasos[2].area", /último paso \("DIM"\) tiene que ser de un área interna/);
    });

    it("ni un comodín", () => {
      const d = valida();
      d.pasos = d.pasos.slice(0, 4);
      fallaSolo(d, "ultimo_paso", "pasos[3].area", /no de \$CEMENTERIO/);
    });

    it("una plantilla de un solo paso interno es válida", () => {
      const d = valida();
      d.pasos = [pasoDe(d, "MESA")];
      d.documentos.forEach((x) => (x.exigir_al_salir_de = null));
      d.campos_extra = [d.campos_extra[1]];
      d.conceptos = d.conceptos.map((c) => ({ ...c, paso: "MESA" }));
      expect(errores(d)).toEqual([]);
    });

    it("sin pasos tampoco hay último paso", () => {
      const d = valida();
      d.pasos = [];
      d.documentos = [];
      d.conceptos = [];
      d.campos_extra = [];
      fallaSolo(d, "ultimo_paso", "pasos", /no tiene pasos/);
    });
  });

  describe("tipos_monumento", () => {
    it("tienen que existir", () => {
      const d = valida();
      d.tipos_monumento = ["SEPULTURA", "PANTEON"];
      fallaSolo(d, "tipos_monumento", "tipos_monumento[1]", /No existe el tipo de monumento PANTEON/);
    });

    it("tienen que estar activos", () => {
      const d = valida();
      d.tipos_monumento = ["BOVEDA"];
      fallaSolo(d, "tipos_monumento", "tipos_monumento[0]", /BOVEDA está inactivo/);
    });

    it("no se repiten", () => {
      const d = valida();
      d.tipos_monumento = ["NICHO", "NICHO"];
      fallaSolo(d, "tipos_monumento", "tipos_monumento[1]", /NICHO está repetido/);
    });

    it("[] es válido: todos los del cementerio", () => {
      const d = valida();
      d.tipos_monumento = [];
      expect(errores(d)).toEqual([]);
    });
  });

  describe("personas", () => {
    it("min no puede superar a max", () => {
      const d = valida();
      d.personas[1].min = 4;
      fallaSolo(d, "personas", "personas[1]", /"difunto" tiene mínimo 4 y máximo 3/);
    });

    it("si exige contacto, algún rol puede ser una persona viva", () => {
      const d = valida();
      d.personas = [d.personas[1]];
      fallaSolo(d, "personas", "personas", /exige un contacto/);
    });

    it("sin contacto (trámite de oficio) no hace falta", () => {
      const d = valida();
      d.personas = [d.personas[1]];
      d.requiere_contacto = false;
      expect(errores(d)).toEqual([]);
    });
  });

  describe("subtareas", () => {
    it("dato_obligatorio exige que la subtarea pida un dato", () => {
      const d = valida();
      pasoDe(d, "MESA").subtareas[0].dato_obligatorio = true;
      fallaSolo(d, "subtareas", "pasos[0].subtareas[0]", /"MESA_CARATULA" exige un dato pero no dice cuál/);
    });

    it("dato_obligatorio con dato texto o fecha es válido", () => {
      const d = valida();
      pasoDe(d, "MESA").subtareas[0] = { ...pasoDe(d, "MESA").subtareas[0], dato: "texto", dato_obligatorio: true };
      pasoDe(d, "FIN").subtareas[0] = { ...pasoDe(d, "FIN").subtareas[0], dato: "fecha", dato_obligatorio: true };
      expect(errores(d)).toEqual([]);
    });
  });

  describe("cementerios (filtros de la semana 4)", () => {
    it("un concepto, un documento y una subtarea pueden filtrarse por cementerio", () => {
      const d = valida();
      d.conceptos[0] = { ...d.conceptos[0], excepto_cementerios: ["JARDIN_NORTE"] };
      d.documentos[0] = { ...d.documentos[0], solo_cementerios: ["OESTE", "JARDIN_NORTE"] };
      pasoDe(d, "MESA").subtareas[0] = { ...pasoDe(d, "MESA").subtareas[0], solo_cementerios: ["OESTE"] };
      expect(errores(d)).toEqual([]);
    });

    it("los cementerios tienen que existir", () => {
      const d = valida();
      d.conceptos[1] = { ...d.conceptos[1], solo_cementerios: ["SUR"] };
      fallaSolo(d, "cementerios", "conceptos[1].solo_cementerios[0]", /"ARRENDAMIENTO": no existe el cementerio SUR/);
    });

    it("y estar activos, sin repetirse", () => {
      const d = valida();
      d.documentos[1] = { ...d.documentos[1], excepto_cementerios: ["VIEJO"] };
      fallaSolo(d, "cementerios", "documentos[1].excepto_cementerios[0]", /el cementerio VIEJO está inactivo/);
      const e = valida();
      e.documentos[0] = { ...e.documentos[0], solo_cementerios: ["OESTE", "OESTE"] };
      fallaSolo(e, "cementerios", "documentos[0].solo_cementerios[1]", /OESTE está repetido/);
    });

    it("solo_cementerios y excepto_cementerios no van juntos", () => {
      const d = valida();
      pasoDe(d, "FIN").subtareas[0] = { ...pasoDe(d, "FIN").subtareas[0], solo_cementerios: ["OESTE"], excepto_cementerios: ["JARDIN_NORTE"] };
      fallaSolo(d, "cementerios", "pasos[5].subtareas[0]", /no los dos/);
    });

    it("las subtareas de un plazo no se filtran", () => {
      const d = valida();
      pasoDe(d, "DIM").subtareas[0] = { ...pasoDe(d, "DIM").subtareas[0], excepto_cementerios: ["JARDIN_NORTE"] };
      fallaSolo(d, "cementerios", "pasos[2].plazo.hasta_subtarea", /"DIM_INICIADO", que no está en todos los cementerios/);
    });
  });

  describe("juridica", () => {
    it("un documento puede depender de que un rol que la admite sea persona jurídica", () => {
      const d = valida();
      d.personas[0].admite_juridica = true;
      d.documentos[0].solo_si_juridica = "titular";
      expect(errores(d)).toEqual([]);
    });

    it("el rol tiene que existir y admitir persona jurídica", () => {
      const d = valida();
      d.documentos[0].solo_si_juridica = "titular";
      fallaSolo(d, "juridica", "documentos[0].solo_si_juridica", /"titular" sea persona jurídica, pero ese rol no la admite/);
      const e = valida();
      e.documentos[1].solo_si_juridica = "cesionario";
      fallaSolo(e, "juridica", "documentos[1].solo_si_juridica", /rol "cesionario", que la plantilla no tiene/);
    });

    it("un rol siempre fallecido no admite persona jurídica", () => {
      const d = valida();
      d.personas[1].admite_juridica = true;
      fallaSolo(d, "personas", "personas[1].admite_juridica", /"difunto" es siempre fallecido/);
    });
  });

  it("devuelve todos los errores juntos, no solo el primero", () => {
    const d = valida();
    pasoDe(d, "DIM").custodia = null;
    pasoDe(d, "NOTIF").dias_alerta = 0;
    d.tipos_monumento = ["PANTEON"];
    expect(errores(d).map((e) => e.regla).sort()).toEqual(["custodia", "dias_alerta", "tipos_monumento"]);
  });
});

describe("validarPublicacion", () => {
  it("con forma válida e integridad válida devuelve la definición", () => {
    const r = validarPublicacion(valida(), CATALOGOS);
    expect(r).toEqual({ ok: true, definicion: valida() });
  });

  it("con errores de forma no corre la integridad", () => {
    const d: Record<string, unknown> = { ...valida(), forma_pago: "cuotas", tipos_monumento: ["PANTEON"] };
    const r = validarPublicacion(d, CATALOGOS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.map((e) => e.regla)).toEqual(["esquema"]);
  });

  it("con la forma bien devuelve los errores de integridad", () => {
    const d = valida();
    pasoDe(d, "DIM").custodia = null;
    const r = validarPublicacion(d, CATALOGOS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores).toEqual([expect.objectContaining({ regla: "custodia", ruta: "pasos[2].custodia" })]);
  });
});
