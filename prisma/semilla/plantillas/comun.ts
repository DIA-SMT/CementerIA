// Piezas que comparten las 4 plantillas de la carga inicial
// (docs/propuesta-mvp.md, sección 4).
//
// Marcas de la propuesta, que se repiten acá para el taller de validación:
// [I] inferido (no está en el pedido), [C] a confirmar con la Dirección.
// [f] subtarea con fecha obligatoria; [t?] subtarea con texto opcional.
// Los dias_alerta son todos [I].
//
// Las subtareas no tienen dónde decir QUÉ texto se anota (el esquema solo tiene
// `dato: texto`): lo dicen las instrucciones del paso, que la ficha muestra, y
// los nombres quedan como en la propuesta.

import type {
  CampoExtraPlantilla,
  ConceptoPlantilla,
  DocumentoPlantilla,
  PasoPlantilla,
  PersonaPlantilla,
  SubtareaPlantilla,
} from "../../../src/lib/dominio/plantillas/esquema";

export const NOTAS_CARGA_INICIAL = "Carga inicial, a validar";

// ---------------------------------------------------------------------------
// Subtareas
// ---------------------------------------------------------------------------

export const obligatoria = (clave: string, nombre: string): SubtareaPlantilla => ({
  clave,
  nombre,
  obligatoria: true,
  dato: null,
  dato_obligatorio: false,
});

/** [f]: fecha obligatoria al tildar. Con `obligatoriaSub = false`, la subtarea no frena el pase. */
export const conFecha = (clave: string, nombre: string, obligatoriaSub = true): SubtareaPlantilla => ({
  clave,
  nombre,
  obligatoria: obligatoriaSub,
  dato: "fecha",
  dato_obligatorio: true,
});

/** [t?]: se puede anotar un texto (un número) al tildar. Opcional hasta el taller (pregunta G-2). */
export const conTextoOpcional = (clave: string, nombre: string): SubtareaPlantilla => ({
  clave,
  nombre,
  obligatoria: true,
  dato: "texto",
  dato_obligatorio: false,
});

export const SUB = {
  // [I] Mesa de Entradas (pregunta A-2).
  MESA_CARATULA: obligatoria("MESA_CARATULA", "Carátula impresa y agregada al expediente"),
  // [t?: N° de registro, I]
  COMP_GRABADO: conTextoOpcional("COMP_GRABADO", "Trámite grabado en el sistema de Cómputo"),
  LIQ_DEBITOS: obligatoria("LIQ_DEBITOS", "Liquidación practicada y débitos generados"),
  LIQ_PAGO: conFecha("LIQ_PAGO", "Pago verificado: Rapipago, Pago Fácil o Banco Macro"),
  // [t?: N° de dictamen, I]
  LEG_DICTAMEN: conTextoOpcional("LEG_DICTAMEN", "Dictamen emitido"),
  ADM_RES_CONF: obligatoria("ADM_RES_CONF", "Resolución confeccionada"),
  ADM_RES_FIRMA: obligatoria("ADM_RES_FIRMA", "Firma de la resolución por el Director"),
  // [t?: N° de resolución, I]
  ADM_PROTOCOLO: conTextoOpcional("ADM_PROTOCOLO", "Protocolización"),
  // [t?: N° de título, I]
  ADM_TIT_CONF: conTextoOpcional("ADM_TIT_CONF", "Título confeccionado"),
  ADM_TIT_FIRMA: obligatoria("ADM_TIT_FIRMA", "Firma del título"),
  // [I] qué se graba (resolución, título y período) es una suposición (pregunta A-8).
  COMP_FINAL: obligatoria("COMP_FINAL", "Datos faltantes grabados"),
  ADM_ENTREGADO: conFecha("ADM_ENTREGADO", "Título entregado al concesionario"),
} as const;

// ---------------------------------------------------------------------------
// Pasos comunes (la clave y el área son los de la sección 4)
// ---------------------------------------------------------------------------

interface OpcionesPaso {
  clave: string;
  nombre: string;
  area: string;
  dias_alerta: number;
  subtareas: SubtareaPlantilla[];
  custodia?: string;
  estado?: PasoPlantilla["estado"];
  instrucciones?: string;
  plazo?: PasoPlantilla["plazo"];
}

/** Un paso con los valores de siempre: interno, en trámite, no omitible, sin plazo. */
export function paso(o: OpcionesPaso): PasoPlantilla {
  return {
    clave: o.clave,
    nombre: o.nombre,
    area: o.area,
    custodia: o.custodia ?? null,
    estado: o.estado ?? "en_tramite",
    omitible: false,
    dias_alerta: o.dias_alerta,
    instrucciones: o.instrucciones ?? null,
    plazo: o.plazo ?? null,
    subtareas: o.subtareas,
  };
}

export const INSTRUCCIONES_BOLETA = "Al tildar la boleta se puede anotar su número.";
export const INSTRUCCIONES_RESOLUCION = "Al tildar la protocolización se puede anotar el N° de resolución.";
export const INSTRUCCIONES_TITULO = "Al tildar el título confeccionado se puede anotar su número.";

export const pasoMesa = (): PasoPlantilla =>
  paso({ clave: "MESA", nombre: "Mesa de Entradas", area: "MESA_ENTRADAS", dias_alerta: 2, subtareas: [SUB.MESA_CARATULA] });

export const pasoComputoAlta = (): PasoPlantilla =>
  paso({
    clave: "COMPUTO_ALTA",
    nombre: "Cómputo: alta",
    area: "COMPUTO",
    dias_alerta: 5,
    instrucciones: "Al tildar la grabación se puede anotar el N° de registro en Cómputo.",
    subtareas: [SUB.COMP_GRABADO],
  });

/**
 * La boleta cambia según la plantilla: qué conceptos lleva y si se anota su
 * número (en ese caso van las instrucciones que lo dicen).
 */
export const pasoLiquidacion = (boleta: SubtareaPlantilla, instrucciones?: string): PasoPlantilla =>
  paso({
    clave: "LIQUIDACION",
    nombre: "Liquidación y boleta",
    area: "LIQUIDACION",
    dias_alerta: 15,
    instrucciones,
    subtareas: [SUB.LIQ_DEBITOS, boleta, SUB.LIQ_PAGO],
  });

export const pasoLegal = (subtareas: SubtareaPlantilla[] = [SUB.LEG_DICTAMEN]): PasoPlantilla =>
  paso({
    clave: "LEGAL",
    nombre: "Asesoría Legal",
    area: "LEGAL",
    dias_alerta: 10,
    instrucciones: "Al tildar el dictamen se puede anotar su número.",
    subtareas,
  });

/** Resolución y título en el mismo paso, como en (a), (c) y (d). */
export const pasoResolucionYTitulo = (): PasoPlantilla =>
  paso({
    clave: "ADM_RESOLUCION",
    nombre: "Administrativo: resolución y título",
    area: "ADMINISTRATIVO",
    dias_alerta: 15,
    instrucciones: `${INSTRUCCIONES_RESOLUCION} ${INSTRUCCIONES_TITULO}`,
    subtareas: [SUB.ADM_RES_CONF, SUB.ADM_RES_FIRMA, SUB.ADM_PROTOCOLO, SUB.ADM_TIT_CONF, SUB.ADM_TIT_FIRMA],
  });

export const pasoComputoFinal = (comp: SubtareaPlantilla = SUB.COMP_FINAL): PasoPlantilla =>
  paso({ clave: "COMPUTO_FINAL", nombre: "Cómputo: final", area: "COMPUTO", dias_alerta: 5, subtareas: [comp] });

/** Paso final de las 4 plantillas. Después se concluye y se archiva. */
export const pasoEntrega = (): PasoPlantilla =>
  paso({
    clave: "ADM_ENTREGA",
    nombre: "Administrativo: entrega",
    area: "ADMINISTRATIVO",
    dias_alerta: 30,
    subtareas: [SUB.ADM_ENTREGADO],
  });

// ---------------------------------------------------------------------------
// Personas y campos extra
// ---------------------------------------------------------------------------

export const TITULAR_VIVO: PersonaPlantilla = {
  rol: "titular",
  etiqueta: "Titular de la concesión",
  min: 1,
  max: 1,
  fallecido: "no",
  pide_vinculo: false,
};

export const SOLICITANTE_OPCIONAL: PersonaPlantilla = {
  rol: "solicitante",
  etiqueta: "Solicitante",
  min: 0,
  max: 1,
  fallecido: "no",
  pide_vinculo: true,
};

/** [I] El período de 5 años renovado (pregunta 5 de la propuesta, A-9 del taller). */
export const CAMPOS_CONCESION: CampoExtraPlantilla[] = [
  {
    clave: "concesion_desde",
    etiqueta: "Inicio de la concesión",
    tipo: "fecha",
    obligatorio: false,
    exigir_al_salir_de: "COMPUTO_FINAL",
    buscable: false,
    opciones: null,
  },
  {
    clave: "concesion_hasta",
    etiqueta: "Vencimiento de la concesión",
    tipo: "fecha",
    obligatorio: false,
    exigir_al_salir_de: "COMPUTO_FINAL",
    buscable: false,
    opciones: null,
  },
];

// ---------------------------------------------------------------------------
// Documentos y conceptos
// ---------------------------------------------------------------------------

/** Todos los documentos de la carga inicial son obligatorios. */
export const documento = (
  clave: string,
  nombre: string,
  origen: DocumentoPlantilla["origen"],
  exigirAlSalirDe: string | null,
  adjunto: DocumentoPlantilla["adjunto"] = "no",
): DocumentoPlantilla => ({ clave, nombre, origen, obligatorio: true, exigir_al_salir_de: exigirAlSalirDe, adjunto });

export const DOC = {
  // Provistos por la Dirección.
  // [I] en qué paso se exige cada uno (preguntas G-1 y A-3 a A-5 del taller).
  CONST_COMPUTOS: documento("CONST_COMPUTOS", "Constancia de Cómputos (datos personales y catastrales)", "direccion", "COMPUTO_ALTA"),
  ESTADO_CUENTA: documento("ESTADO_CUENTA", "Estado de cuenta", "direccion", "LIQUIDACION"),
  CONST_PERIODOS: documento("CONST_PERIODOS", "Constancia de los períodos que adeuda y cómo los abona", "direccion", "LIQUIDACION"),
  // [C] Se exige al salir de Liquidación, antes de Legal (pregunta A-7).
  INFORME_TECNICO: documento(
    "INFORME_TECNICO",
    "Informe técnico (lo pide el concesionario en el cementerio)",
    "direccion",
    "LIQUIDACION",
    "sugerido",
  ),
  // Los trae el concesionario.
  DNI: documento("DNI", "Fotocopia del DNI", "concesionario", "MESA"),
  BOLETA_SERVICIO: documento(
    "BOLETA_SERVICIO",
    "Fotocopia de una boleta de servicio, para verificar el domicilio",
    "concesionario",
    "MESA",
  ),
  // [I] Figura en los pasos, no en la lista de documentos del pedido (A-6).
  COMPROBANTE_PAGO: documento("COMPROBANTE_PAGO", "Copia del comprobante de pago", "concesionario", "LIQUIDACION", "sugerido"),
} as const;

export const concepto = (
  clave: string,
  nombre: string,
  via: ConceptoPlantilla["via"] = "boleta",
  pasoClave = "LIQUIDACION",
): ConceptoPlantilla => ({ clave, nombre, via, paso: pasoClave });

export const CONCEPTO = {
  DERECHO_OFICINA: concepto("DERECHO_OFICINA", "Derecho de oficina"),
  INSPECCION_TECNICA: concepto("INSPECCION_TECNICA", "Inspección técnica"),
  ARRENDAMIENTO: concepto("ARRENDAMIENTO", "Arrendamiento"),
} as const;
