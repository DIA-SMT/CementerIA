// a) RENOV_CONTADO: Renovación, pago de contado (docs/propuesta-mvp.md, 4(a)).

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import {
  CAMPOS_CONCESION,
  CONCEPTO,
  DOC,
  INSTRUCCIONES_BOLETA,
  SOLICITANTE_OPCIONAL,
  TITULAR_VIVO,
  conTextoOpcional,
  documento,
  pasoComputoAlta,
  pasoComputoFinal,
  pasoEntrega,
  pasoLegal,
  pasoLiquidacion,
  pasoMesa,
  pasoResolucionYTitulo,
} from "./comun";

// [t?: N° de boleta, I]
const BOLETA_CON_ARRENDAMIENTO = conTextoOpcional("LIQ_BOLETA", "Boleta emitida: oficina, inspección técnica y arrendamiento");

/** Lo que (c) cambia: el formulario de inicio. */
export const documentosRenovacion = (formularioInicio: DefinicionPlantilla["documentos"][number]) => [
  formularioInicio,
  DOC.CONST_COMPUTOS,
  DOC.ESTADO_CUENTA,
  DOC.CONST_PERIODOS,
  DOC.INFORME_TECNICO,
  DOC.DNI,
  DOC.BOLETA_SERVICIO,
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
  pasoLiquidacion(BOLETA_CON_ARRENDAMIENTO, INSTRUCCIONES_BOLETA),
  legal,
  pasoResolucionYTitulo(),
  pasoComputoFinal(),
  pasoEntrega(),
];

export const RENOV_CONTADO: DefinicionPlantilla = {
  forma_pago: "contado",
  tipos_monumento: ["SOTANITO", "CAPILLA", "MAUSOLEO", "SEPULTURA"],
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: [TITULAR_VIVO, SOLICITANTE_OPCIONAL],
  campos_extra: CAMPOS_CONCESION,
  documentos: documentosRenovacion(FORM_INICIO_RENOV),
  conceptos: [CONCEPTO.DERECHO_OFICINA, CONCEPTO.INSPECCION_TECNICA, CONCEPTO.ARRENDAMIENTO],
  pasos: pasosRenovacionContado(),
};
