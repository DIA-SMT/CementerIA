// a) RENOV_CONTADO: Renovación, pago de contado (docs/propuesta-mvp.md, 4(a)).

import type { DefinicionPlantilla, DocumentoPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import {
  CAMPOS_CONCESION,
  CONCEPTO,
  DOC,
  DOC_JURIDICA,
  INSTRUCCIONES_BOLETA,
  SOLICITANTE_OPCIONAL,
  TITULAR_VIVO,
  boletas,
  documento,
  pasoComputoAlta,
  pasoComputoFinal,
  pasoEntrega,
  pasoLegal,
  pasoLiquidacion,
  pasoMesa,
  pasoResolucionYTitulo,
} from "./comun";

// [t?: N° de boleta, I]. [F] En Jardín, sin inspección técnica.
const BOLETAS_CON_ARRENDAMIENTO = boletas(
  "Boleta emitida: oficina, inspección técnica y arrendamiento",
  "Boleta emitida: oficina y arrendamiento",
);

/**
 * [F] Los monumentos que se renuevan: "cualquier tipo de monumento (sotanito,
 * capilla, mausoleo o sepultura)" de los procedimientos, más el panteón, que
 * paga arrendamiento por zona y m² como el sotanito, la capilla y el mausoleo
 * (página 5) y es el de las asociaciones. Cada cementerio habilita los suyos:
 * en Jardín queda solo la sepultura.
 */
export const MONUMENTOS_RENOVACION = ["SEPULTURA", "SOTANITO", "CAPILLA", "MAUSOLEO", "PANTEON"];

/**
 * Lo que (c) cambia: el formulario de inicio. Con la Conservación pagada [F] y,
 * si se pide, la documentación de una persona jurídica.
 */
export const documentosRenovacion = (
  formularioInicio: DocumentoPlantilla,
  juridica: readonly DocumentoPlantilla[] = [],
): DocumentoPlantilla[] => [
  formularioInicio,
  DOC.CONST_COMPUTOS,
  DOC.ESTADO_CUENTA,
  DOC.CONST_PERIODOS,
  DOC.CONSERVACION,
  DOC.INFORME_TECNICO,
  DOC.DNI,
  DOC.BOLETA_SERVICIO,
  ...juridica,
  DOC.COMPROBANTE_PAGO,
];

// [I] Se exige al salir de Mesa.
export const FORM_INICIO_RENOV = documento(
  "FORM_INICIO_RENOV",
  "Formulario de inicio de trámite de renovación",
  "direccion",
  "MESA",
);

/** Los 7 pasos de (a); (c) los reusa con una subtarea más en Legal. */
export const pasosRenovacionContado = (legal = pasoLegal()) => [
  pasoMesa(),
  pasoComputoAlta(),
  pasoLiquidacion(BOLETAS_CON_ARRENDAMIENTO, INSTRUCCIONES_BOLETA),
  legal,
  pasoResolucionYTitulo(),
  pasoComputoFinal(),
  pasoEntrega(),
];

export const RENOV_CONTADO: DefinicionPlantilla = {
  forma_pago: "contado",
  tipos_monumento: MONUMENTOS_RENOVACION,
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: [TITULAR_VIVO, SOLICITANTE_OPCIONAL],
  campos_extra: CAMPOS_CONCESION,
  documentos: documentosRenovacion(FORM_INICIO_RENOV, DOC_JURIDICA),
  conceptos: [CONCEPTO.DERECHO_OFICINA, CONCEPTO.INSPECCION_TECNICA, CONCEPTO.ARRENDAMIENTO],
  pasos: pasosRenovacionContado(),
};

