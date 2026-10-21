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
//
// Semana 4 (docs/fuentes/README.md, "Cambios que esto implica", 1 a 6): como
// todavía no hay producción, los cambios van en la v1 de la semilla en lugar
// de publicar versiones nuevas (lo dicen las notas de cambio). Las marcas [F]
// son lo que sale de las fuentes de la Dirección.

import type {
  CampoExtraPlantilla,
  ConceptoPlantilla,
  DocumentoPlantilla,
  FiltroCementerios,
  PasoPlantilla,
  PersonaPlantilla,
  SubtareaPlantilla,
} from "../../../src/lib/dominio/plantillas/esquema";

export const NOTAS_CARGA_INICIAL =
  "Carga inicial, a validar. Actualizada el 20/10/2026 según docs/fuentes (monumentos, conceptos y documentos por cementerio, " +
  "personas jurídicas, Conservación pagada, DIM omitible): sin expedientes reales todavía, se editó la v1 en lugar de publicar una v2.";

// ---------------------------------------------------------------------------
// Cementerios (para los filtros de conceptos, documentos y subtareas)
// ---------------------------------------------------------------------------

export const JARDIN = "JARDIN_NORTE";
export const OESTE = "OESTE";

/** Sin filtro: vale en los tres cementerios. */
export const EN_TODOS: FiltroCementerios = { solo_cementerios: null, excepto_cementerios: null };

/** La misma pieza, solo en esos cementerios. */
export const soloEn = <T extends FiltroCementerios>(pieza: T, ...cementerios: string[]): T => ({
  ...pieza,
  solo_cementerios: cementerios,
  excepto_cementerios: null,
});

/** La misma pieza, en todos menos esos cementerios. */
export const exceptoEn = <T extends FiltroCementerios>(pieza: T, ...cementerios: string[]): T => ({
  ...pieza,
  solo_cementerios: null,
  excepto_cementerios: cementerios,
});

// ---------------------------------------------------------------------------
// Subtareas
// ---------------------------------------------------------------------------

export const obligatoria = (clave: string, nombre: string): SubtareaPlantilla => ({
  clave,
  nombre,
  obligatoria: true,
  dato: null,
  dato_obligatorio: false,
  ...EN_TODOS,
});

/** [f]: fecha obligatoria al tildar. Con `obligatoriaSub = false`, la subtarea no frena el pase. */
export const conFecha = (clave: string, nombre: string, obligatoriaSub = true): SubtareaPlantilla => ({
  clave,
  nombre,
  obligatoria: obligatoriaSub,
  dato: "fecha",
  dato_obligatorio: true,
  ...EN_TODOS,
});

/** [t?]: se puede anotar un texto (un número) al tildar. Opcional hasta el taller (pregunta G-2). */
export const conTextoOpcional = (clave: string, nombre: string): SubtareaPlantilla => ({
  clave,
  nombre,
  obligatoria: true,
  dato: "texto",
  dato_obligatorio: false,
  ...EN_TODOS,
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
  omitible?: boolean;
}

/** Un paso con los valores de siempre (si no se dice otra cosa): interno, en trámite, no omitible, sin plazo. */
export function paso(o: OpcionesPaso): PasoPlantilla {
  return {
    clave: o.clave,
    nombre: o.nombre,
    area: o.area,
    custodia: o.custodia ?? null,
    estado: o.estado ?? "en_tramite",
    omitible: o.omitible ?? false,
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
 * número (en ese caso van las instrucciones que lo dicen). Puede ser más de
 * una subtarea, cada una con su filtro por cementerio (`boletas()`).
 */
export const pasoLiquidacion = (boleta: readonly SubtareaPlantilla[], instrucciones?: string): PasoPlantilla =>
  paso({
    clave: "LIQUIDACION",
    nombre: "Liquidación y boleta",
    area: "LIQUIDACION",
    dias_alerta: 15,
    instrucciones,
    subtareas: [SUB.LIQ_DEBITOS, ...boleta, SUB.LIQ_PAGO],
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

/**
 * El titular de una renovación: una persona o, [F], una asociación o sociedad
 * con panteón (persona jurídica, con razón social y CUIT). Si es jurídica, se
 * le piden la personería y la designación de asamblea (DOC_JURIDICA).
 */
export const TITULAR_VIVO: PersonaPlantilla = {
  rol: "titular",
  etiqueta: "Titular de la concesión",
  min: 1,
  max: 1,
  fallecido: "no",
  pide_vinculo: false,
  admite_juridica: true,
};

// Quien hace el trámite en persona: siempre física (por una asociación, quien la representa).
export const SOLICITANTE_OPCIONAL: PersonaPlantilla = {
  rol: "solicitante",
  etiqueta: "Solicitante",
  min: 0,
  max: 1,
  fallecido: "no",
  pide_vinculo: true,
  admite_juridica: false,
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

/** Todos los documentos de la carga inicial son obligatorios (donde corresponden). */
export const documento = (
  clave: string,
  nombre: string,
  origen: DocumentoPlantilla["origen"],
  exigirAlSalirDe: string | null,
  adjunto: DocumentoPlantilla["adjunto"] = "no",
): DocumentoPlantilla => ({
  clave,
  nombre,
  origen,
  obligatorio: true,
  exigir_al_salir_de: exigirAlSalirDe,
  adjunto,
  ...EN_TODOS,
  solo_si_juridica: null,
});

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
  // [F] Requisito de las renovaciones del Oeste y de Jardín: "Tener abonado
  // Conservación los últimos 5 (cinco) años" (procedimientos, páginas 5 y 6).
  // Va como documento provisto por la Dirección y no como subtarea porque los
  // procedimientos lo listan entre los requisitos que se presentan, junto con
  // el título, el DNI y el informe técnico, y lo acredita un papel de la
  // Dirección (el estado de cuenta). [I] Se exige al salir de Liquidación, como
  // el estado de cuenta, que es donde se ve la deuda. [C] El Norte: los
  // procedimientos no lo dicen; queda sin pedir hasta que la Dirección confirme.
  CONSERVACION: soloEn(
    documento("CONSERVACION", "Conservación abonada de los últimos 5 años (surge del estado de cuenta)", "direccion", "LIQUIDACION"),
    OESTE,
    JARDIN,
  ),
} as const;

/**
 * [F] Las asociaciones con panteón presentan la designación de asamblea y la
 * personería (procedimientos, página 1). Se piden solo si el titular es una
 * persona jurídica. [I] Los trae el concesionario y se exigen al salir de Mesa
 * de Entradas, como el DNI.
 */
export const DOC_JURIDICA: readonly DocumentoPlantilla[] = [
  {
    ...documento("PERSONERIA", "Personería jurídica de la asociación o sociedad", "concesionario", "MESA"),
    solo_si_juridica: "titular",
  },
  {
    ...documento("DESIGNACION_ASAMBLEA", "Acta de asamblea con la designación de autoridades", "concesionario", "MESA"),
    solo_si_juridica: "titular",
  },
];

export const concepto = (
  clave: string,
  nombre: string,
  via: ConceptoPlantilla["via"] = "boleta",
  pasoClave = "LIQUIDACION",
): ConceptoPlantilla => ({ clave, nombre, via, paso: pasoClave, ...EN_TODOS });

export const CONCEPTO = {
  DERECHO_OFICINA: concepto("DERECHO_OFICINA", "Derecho de oficina"),
  // [F] Jardín no cobra inspección técnica (procedimientos, página 6).
  INSPECCION_TECNICA: exceptoEn(concepto("INSPECCION_TECNICA", "Inspección técnica"), JARDIN),
  ARRENDAMIENTO: concepto("ARRENDAMIENTO", "Arrendamiento"),
} as const;

/**
 * La subtarea de la boleta nombra los conceptos que lleva, y en Jardín no va la
 * inspección técnica: dos subtareas con su filtro, una para Jardín y otra para
 * los demás. Claves distintas, porque una clave es única en la definición.
 */
export const boletas = (conInspeccion: string, sinInspeccion: string): SubtareaPlantilla[] => [
  exceptoEn(conTextoOpcional("LIQ_BOLETA", conInspeccion), JARDIN),
  soloEn(conTextoOpcional("LIQ_BOLETA_JARDIN", sinInspeccion), JARDIN),
];
