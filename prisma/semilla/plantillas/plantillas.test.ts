import { describe, expect, it } from "vitest";
import type { DefinicionPlantilla, FiltroCementerios } from "../../../src/lib/dominio/plantillas/esquema";
import { validarPublicacion } from "../../../src/lib/dominio/plantillas/validar";
import { AREAS } from "../areas";
import { TIPOS_MONUMENTO } from "../catalogos";
import { CEMENTERIOS } from "../cementerios";
import { PLANTILLAS } from "./index";

// La transcripción de la sección 4 de docs/propuesta-mvp.md, en una forma
// compacta escrita a mano mirando las tablas de la propuesta y no el código:
// si alguien cambia una plantilla de la semilla sin querer, este test lo marca.
//
//   paso:      "CLAVE área dias_alerta [custodia:X] [estado] [omitible] [plazo:N desde→hasta]: subtareas"
//   subtarea:  "*" obligatoria; [f] fecha obligatoria; [t?] texto opcional
//   documento: "CLAVE origen exigir_al_salir_de adjunto"
//   persona:   "rol min..max fallecido [vinculo] [juridica]"
//   campo:     "clave tipo obligatorio|opcional exigir [buscable]"
//   filtros (semana 4, docs/fuentes): "@OESTE,JARDIN_NORTE" solo en esos
//   cementerios, "@-JARDIN_NORTE" en todos menos esos; "si_juridica:titular".

function filtro(f: FiltroCementerios): string {
  if (f.solo_cementerios !== null) return `@${f.solo_cementerios.join(",")}`;
  if (f.excepto_cementerios !== null) return `@-${f.excepto_cementerios.join(",")}`;
  return "";
}

function subtarea(s: DefinicionPlantilla["pasos"][number]["subtareas"][number]): string {
  const dato = s.dato === null ? "" : s.dato === "fecha" ? (s.dato_obligatorio ? "[f]" : "[f?]") : s.dato_obligatorio ? "[t]" : "[t?]";
  return `${s.obligatoria ? "*" : ""}${s.clave}${dato}${filtro(s)}`;
}

function resumir(d: DefinicionPlantilla) {
  return {
    forma_pago: d.forma_pago,
    tipos_monumento: d.tipos_monumento,
    ubicacion_obligatoria: d.ubicacion_obligatoria,
    requiere_contacto: d.requiere_contacto,
    personas: d.personas.map((p) => `${p.rol} ${p.min}..${p.max} ${p.fallecido}${p.pide_vinculo ? " vinculo" : ""}${p.admite_juridica ? " juridica" : ""}`),
    campos_extra: d.campos_extra.map(
      (c) => `${c.clave} ${c.tipo} ${c.obligatorio ? "obligatorio" : "opcional"} ${c.exigir_al_salir_de ?? "-"}${c.buscable ? " buscable" : ""}`,
    ),
    documentos: d.documentos.map(
      (x) =>
        `${x.clave} ${x.origen} ${x.exigir_al_salir_de ?? "-"} ${x.adjunto}${x.obligatorio ? "" : " opcional"}` +
        `${filtro(x) ? ` ${filtro(x)}` : ""}${x.solo_si_juridica ? ` si_juridica:${x.solo_si_juridica}` : ""}`,
    ),
    conceptos: d.conceptos.map((c) => `${c.clave} ${c.via} ${c.paso}${filtro(c) ? ` ${filtro(c)}` : ""}`),
    pasos: d.pasos.map((p) =>
      [
        `${p.clave} ${p.area} ${p.dias_alerta}`,
        p.custodia ? ` custodia:${p.custodia}` : "",
        p.estado !== "en_tramite" ? ` ${p.estado}` : "",
        p.omitible ? " omitible" : "",
        p.plazo ? ` plazo:${p.plazo.dias_habiles} ${p.plazo.desde_subtarea}→${p.plazo.hasta_subtarea}` : "",
        `: ${p.subtareas.map(subtarea).join(" ")}`,
      ].join(""),
    ),
  };
}

// [F] Más el panteón (docs/fuentes); cada cementerio habilita los suyos.
const MONUMENTOS_RENOVACION = ["SEPULTURA", "SOTANITO", "CAPILLA", "MAUSOLEO", "PANTEON"];
const CAMPOS_CONCESION = [
  "concesion_desde fecha opcional COMPUTO_FINAL",
  "concesion_hasta fecha opcional COMPUTO_FINAL",
];
const DOCUMENTOS_RENOVACION = [
  "CONST_COMPUTOS direccion COMPUTO_ALTA no",
  "ESTADO_CUENTA direccion LIQUIDACION no",
  "CONST_PERIODOS direccion LIQUIDACION no",
  // [F] Conservación de los últimos 5 años: Oeste y Jardín.
  "CONSERVACION direccion LIQUIDACION no @OESTE,JARDIN_NORTE",
  "INFORME_TECNICO direccion LIQUIDACION sugerido",
  "DNI concesionario MESA no",
  "BOLETA_SERVICIO concesionario MESA no",
];
// [F] Las asociaciones con panteón: solo si el titular es persona jurídica.
const DOCUMENTOS_JURIDICA = [
  "PERSONERIA concesionario MESA no si_juridica:titular",
  "DESIGNACION_ASAMBLEA concesionario MESA no si_juridica:titular",
];
const COMPROBANTE = "COMPROBANTE_PAGO concesionario LIQUIDACION sugerido";
// [F] Jardín no cobra inspección técnica: su boleta no la nombra.
const LIQUIDACION_RENOVACION =
  "LIQUIDACION LIQUIDACION 15: *LIQ_DEBITOS *LIQ_BOLETA[t?]@-JARDIN_NORTE *LIQ_BOLETA_JARDIN[t?]@JARDIN_NORTE *LIQ_PAGO[f]";
const INSPECCION = "INSPECCION_TECNICA boleta LIQUIDACION @-JARDIN_NORTE";
const MESA = "MESA MESA_ENTRADAS 2: *MESA_CARATULA";
const COMPUTO_ALTA = "COMPUTO_ALTA COMPUTO 5: *COMP_GRABADO[t?]";
const LEGAL = "LEGAL LEGAL 10: *LEG_DICTAMEN[t?]";
const RESOLUCION_Y_TITULO =
  "ADM_RESOLUCION ADMINISTRATIVO 15: *ADM_RES_CONF *ADM_RES_FIRMA *ADM_PROTOCOLO[t?] *ADM_TIT_CONF[t?] *ADM_TIT_FIRMA";
const COMPUTO_FINAL = "COMPUTO_FINAL COMPUTO 5: *COMP_FINAL";
const ENTREGA = "ADM_ENTREGA ADMINISTRATIVO 30: *ADM_ENTREGADO[f]";

const ESPERADAS: Record<string, { nombre: string; tipoTramite: string; resumen: ReturnType<typeof resumir> }> = {
  // 4(a)
  RENOV_CONTADO: {
    nombre: "Renovación, pago de contado",
    tipoTramite: "RENOVACION",
    resumen: {
      forma_pago: "contado",
      tipos_monumento: MONUMENTOS_RENOVACION,
      ubicacion_obligatoria: true,
      requiere_contacto: true,
      personas: ["titular 1..1 no juridica", "solicitante 0..1 no vinculo"],
      campos_extra: CAMPOS_CONCESION,
      documentos: ["FORM_INICIO_RENOV direccion MESA no", ...DOCUMENTOS_RENOVACION, ...DOCUMENTOS_JURIDICA, COMPROBANTE],
      conceptos: ["DERECHO_OFICINA boleta LIQUIDACION", INSPECCION, "ARRENDAMIENTO boleta LIQUIDACION"],
      pasos: [
        MESA,
        COMPUTO_ALTA,
        LIQUIDACION_RENOVACION,
        LEGAL,
        RESOLUCION_Y_TITULO,
        COMPUTO_FINAL,
        ENTREGA,
      ],
    },
  },
  // 4(b)
  RENOV_PLAN: {
    nombre: "Renovación, solicitud de forma de pago",
    tipoTramite: "RENOVACION",
    resumen: {
      forma_pago: "plan_pagos",
      tipos_monumento: MONUMENTOS_RENOVACION,
      ubicacion_obligatoria: true,
      requiere_contacto: true,
      personas: ["titular 1..1 no juridica", "solicitante 0..1 no vinculo"],
      campos_extra: CAMPOS_CONCESION,
      documentos: ["FORM_INICIO_RENOV direccion MESA no", ...DOCUMENTOS_RENOVACION, ...DOCUMENTOS_JURIDICA, COMPROBANTE],
      conceptos: ["DERECHO_OFICINA boleta LIQUIDACION", INSPECCION, "ARRENDAMIENTO plan_dim TRIBUTARIO"],
      pasos: [
        MESA,
        COMPUTO_ALTA,
        LIQUIDACION_RENOVACION,
        LEGAL,
        "ADM_RESOLUCION ADMINISTRATIVO 15: *ADM_RES_CONF *ADM_RES_FIRMA *ADM_PROTOCOLO[t?]",
        "TRIBUTARIO TRIBUTARIO 10: *TRIB_NOTIFICADA[f] *TRIB_DEBITOS *TRIB_REMITIDO[f]",
        // [F] Omitible: Tributario manda directo al título si el concesionario paga después de la notificación.
        "DIM DIM 60 custodia:TRIBUTARIO espera_pago_dim omitible plazo:30 TRIB_NOTIFICADA→DIM_PLAN_INICIADO: DIM_PLAN_INICIADO[f] *DIM_DEUDA_CANCELADA[f]",
        "ADM_TITULO ADMINISTRATIVO 15: *ADM_TIT_CONF[t?] *ADM_TIT_FIRMA",
        COMPUTO_FINAL,
        ENTREGA,
      ],
    },
  },
  // 4(c)
  RENOV_SPT_CONTADO: {
    nombre: "Renovación sin perjuicio de tercero, contado",
    tipoTramite: "RENOVACION_SPT",
    resumen: {
      forma_pago: "contado",
      tipos_monumento: MONUMENTOS_RENOVACION,
      ubicacion_obligatoria: true,
      requiere_contacto: true,
      personas: ["titular 1..1 si", "solicitante 1..1 no vinculo"],
      campos_extra: CAMPOS_CONCESION,
      documentos: [
        "FORM_INICIO_RENOV_SPT direccion MESA no",
        ...DOCUMENTOS_RENOVACION,
        COMPROBANTE,
        "ACTA_DEFUNCION concesionario MESA no",
        "ACTAS_VINCULO concesionario MESA no",
      ],
      conceptos: ["DERECHO_OFICINA boleta LIQUIDACION", INSPECCION, "ARRENDAMIENTO boleta LIQUIDACION"],
      pasos: [
        MESA,
        COMPUTO_ALTA,
        LIQUIDACION_RENOVACION,
        "LEGAL LEGAL 10: *LEG_VINCULO *LEG_DICTAMEN[t?]",
        RESOLUCION_Y_TITULO,
        COMPUTO_FINAL,
        ENTREGA,
      ],
    },
  },
  // 4(d)
  NUEVA_CONC_CONTADO: {
    nombre: "Nueva concesión de un monumento caducado, contado",
    tipoTramite: "NUEVA_CONCESION",
    resumen: {
      forma_pago: "contado",
      tipos_monumento: [],
      ubicacion_obligatoria: true,
      requiere_contacto: true,
      personas: ["titular 1..1 no", "solicitante 0..1 no vinculo", "difunto 0..5 si"],
      campos_extra: [
        "resolucion_caducidad texto opcional - buscable",
        "expediente_caducidad texto opcional - buscable",
        ...CAMPOS_CONCESION,
      ],
      documentos: [
        "FORM_INICIO_NUEVA direccion MESA no",
        "CONST_COMPUTOS direccion COMPUTO_ALTA no",
        "ESTADO_CUENTA direccion LIQUIDACION no",
        "COPIA_RES_CADUCIDAD direccion MESA no",
        "CONST_ANTECEDENTES direccion MESA no",
        "DNI concesionario MESA no",
        "CONST_INHUMAR concesionario LIQUIDACION no",
        "BOLETA_SERVICIO concesionario MESA no",
        "COMPROBANTE_PAGO concesionario LIQUIDACION sugerido",
      ],
      conceptos: [
        "DERECHO_OFICINA boleta LIQUIDACION",
        "ARRENDAMIENTO boleta LIQUIDACION",
        "APERTURA boleta LIQUIDACION",
        "INHUMACION boleta LIQUIDACION",
        "CONDUCCION boleta LIQUIDACION",
      ],
      pasos: [
        MESA,
        COMPUTO_ALTA,
        "LIQUIDACION LIQUIDACION 15: *LIQ_DEBITOS *LIQ_BOLETA *LIQ_PAGO[f]",
        "CEMENTERIO $CEMENTERIO 15 custodia:MESA_ENTRADAS: *CEM_CONOCIMIENTO[f] *CEM_REGISTRADO CEM_INHUMACION[f]",
        LEGAL,
        RESOLUCION_Y_TITULO,
        COMPUTO_FINAL,
        ENTREGA,
      ],
    },
  },
};

const CATALOGOS = {
  areas: AREAS.map((a) => ({ ...a, activa: true })),
  tiposMonumento: TIPOS_MONUMENTO.map((t) => ({ ...t, activo: true })),
  cementerios: CEMENTERIOS.map((c) => ({ codigo: c.codigo, activo: true })),
};

describe("plantillas de la semilla (sección 4)", () => {
  it("son las 4, con códigos únicos", () => {
    expect(PLANTILLAS.map((p) => p.codigo)).toEqual(Object.keys(ESPERADAS));
  });

  it.each(PLANTILLAS.map((p) => [p.codigo, p] as const))("%s coincide con la propuesta", (codigo, p) => {
    const esperada = ESPERADAS[codigo];
    expect({ nombre: p.nombre, tipoTramite: p.tipoTramite }).toEqual({ nombre: esperada.nombre, tipoTramite: esperada.tipoTramite });
    expect(resumir(p.definicion)).toEqual(esperada.resumen);
  });

  it.each(PLANTILLAS.map((p) => [p.codigo, p] as const))(
    "%s pasa la validación de Publicar con los catálogos de la semilla",
    (_, p) => {
      const r = validarPublicacion(p.definicion, CATALOGOS);
      expect(r.ok ? [] : r.errores).toEqual([]);
      // La definición ya está en la forma final: el esquema no le cambia nada.
      if (r.ok) expect(r.definicion).toEqual(p.definicion);
    },
  );
});

// Los nombres que se leen en la ficha, copiados de los textos de la sección 4.
// El resumen de arriba compara solo claves: un renombre (o la diferencia de
// LIQ_BOLETA entre (a) y (b), con o sin arrendamiento) tiene que verse acá.
const NOMBRES_SUBTAREA: Record<string, string> = {
  MESA_CARATULA: "Carátula impresa y agregada al expediente",
  COMP_GRABADO: "Trámite grabado en el sistema de Cómputo",
  LIQ_DEBITOS: "Liquidación practicada y débitos generados",
  LIQ_BOLETA: "Boleta emitida: oficina, inspección técnica y arrendamiento",
  LIQ_BOLETA_JARDIN: "Boleta emitida: oficina y arrendamiento",
  LIQ_PAGO: "Pago verificado: Rapipago, Pago Fácil o Banco Macro",
  LEG_DICTAMEN: "Dictamen emitido",
  LEG_VINCULO: "Vínculo con el titular acreditado",
  ADM_RES_CONF: "Resolución confeccionada",
  ADM_RES_FIRMA: "Firma de la resolución por el Director",
  ADM_PROTOCOLO: "Protocolización",
  ADM_TIT_CONF: "Título confeccionado",
  ADM_TIT_FIRMA: "Firma del título",
  COMP_FINAL: "Datos faltantes grabados",
  ADM_ENTREGADO: "Título entregado al concesionario",
  TRIB_NOTIFICADA: "Resolución notificada al concesionario",
  TRIB_DEBITOS: "Débitos de arrendamiento generados",
  TRIB_REMITIDO: "Expediente remitido a la DIM",
  DIM_PLAN_INICIADO: "Concesionario inició la forma de pago",
  DIM_DEUDA_CANCELADA: "DIM informa la deuda cancelada y devuelve el expediente",
  CEM_CONOCIMIENTO: "El cementerio tomó conocimiento",
  CEM_REGISTRADO: "Trámite registrado en el cementerio",
  CEM_INHUMACION: "Inhumación informada",
};

const NOMBRES_DOCUMENTO: Record<string, string> = {
  FORM_INICIO_RENOV: "Formulario de inicio de trámite de renovación",
  FORM_INICIO_RENOV_SPT: "Formulario de inicio de trámite de renovación sin perjuicio de tercero",
  FORM_INICIO_NUEVA: "Formulario de inicio de trámite de nueva concesión",
  CONST_COMPUTOS: "Constancia de Cómputos (datos personales y catastrales)",
  ESTADO_CUENTA: "Estado de cuenta",
  CONST_PERIODOS: "Constancia de los períodos que adeuda y cómo los abona",
  INFORME_TECNICO: "Informe técnico (lo pide el concesionario en el cementerio)",
  DNI: "Fotocopia del DNI",
  BOLETA_SERVICIO: "Fotocopia de una boleta de servicio, para verificar el domicilio",
  COMPROBANTE_PAGO: "Copia del comprobante de pago",
  ACTA_DEFUNCION: "Acta de defunción del titular",
  ACTAS_VINCULO: "Actas que acrediten el vínculo con el titular",
  COPIA_RES_CADUCIDAD: "Fotocopia de la resolución de caducidad",
  CONST_ANTECEDENTES: "Constancia de antecedentes y requisitos",
  CONST_INHUMAR: "Constancia para inhumar",
  CONSERVACION: "Conservación abonada de los últimos 5 años (surge del estado de cuenta)",
  PERSONERIA: "Personería jurídica de la asociación o sociedad",
  DESIGNACION_ASAMBLEA: "Acta de asamblea con la designación de autoridades",
};

/** Lo que cambia en cada plantilla respecto de los nombres comunes. */
const NOMBRES_PROPIOS: Record<string, { subtareas?: Record<string, string>; documentos?: Record<string, string> }> = {
  RENOV_CONTADO: {},
  // 4(b): la boleta inicial no lleva el arrendamiento (va por plan en la DIM).
  RENOV_PLAN: {
    subtareas: {
      LIQ_BOLETA: "Boleta emitida: oficina e inspección técnica",
      LIQ_BOLETA_JARDIN: "Boleta emitida: derecho de oficina",
      COMP_FINAL: "Finalización grabada",
    },
    documentos: { COMPROBANTE_PAGO: "Copia del comprobante de pago de la boleta inicial" },
  },
  RENOV_SPT_CONTADO: {},
  // 4(d): cinco conceptos en una boleta.
  NUEVA_CONC_CONTADO: { subtareas: { LIQ_BOLETA: "Boleta emitida con los 5 conceptos" } },
};

describe("plantillas de la semilla: nombres (sección 4)", () => {
  it.each(PLANTILLAS.map((p) => [p.codigo, p] as const))("%s: subtareas y documentos con el nombre de la propuesta", (codigo, p) => {
    const propios = NOMBRES_PROPIOS[codigo];
    const subtareas = p.definicion.pasos.flatMap((paso) => paso.subtareas.map((s) => [s.clave, s.nombre]));
    const documentos = p.definicion.documentos.map((d) => [d.clave, d.nombre]);
    expect(subtareas).toEqual(subtareas.map(([clave]) => [clave, propios.subtareas?.[clave] ?? NOMBRES_SUBTAREA[clave]]));
    expect(documentos).toEqual(documentos.map(([clave]) => [clave, propios.documentos?.[clave] ?? NOMBRES_DOCUMENTO[clave]]));
  });

  it("LIQ_BOLETA_JARDIN no nombra la inspección técnica: Jardín no la cobra (docs/fuentes)", () => {
    const boleta = Object.fromEntries(
      PLANTILLAS.map((p) => [p.codigo, p.definicion.pasos.flatMap((x) => x.subtareas).find((s) => s.clave === "LIQ_BOLETA_JARDIN")?.nombre ?? null]),
    );
    expect(boleta).toEqual({
      RENOV_CONTADO: "Boleta emitida: oficina y arrendamiento",
      RENOV_PLAN: "Boleta emitida: derecho de oficina",
      RENOV_SPT_CONTADO: "Boleta emitida: oficina y arrendamiento",
      NUEVA_CONC_CONTADO: null,
    });
  });

  it("LIQ_BOLETA dice qué conceptos lleva la boleta en cada plantilla", () => {
    const boleta = Object.fromEntries(
      PLANTILLAS.map((p) => [p.codigo, p.definicion.pasos.flatMap((x) => x.subtareas).find((s) => s.clave === "LIQ_BOLETA")?.nombre]),
    );
    expect(boleta).toEqual({
      RENOV_CONTADO: "Boleta emitida: oficina, inspección técnica y arrendamiento",
      RENOV_PLAN: "Boleta emitida: oficina e inspección técnica",
      RENOV_SPT_CONTADO: "Boleta emitida: oficina, inspección técnica y arrendamiento",
      NUEVA_CONC_CONTADO: "Boleta emitida con los 5 conceptos",
    });
  });
});
