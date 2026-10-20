// c) RENOV_SPT_CONTADO: Renovación sin perjuicio de tercero, contado
// (docs/propuesta-mvp.md, 4(c)).
//
// Pasos, monumentos, campos extra, conceptos y dias_alerta iguales que (a). La
// pide alguien distinto del titular, que supusimos fallecido [I].

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import { CAMPOS_CONCESION, CONCEPTO, SUB, documento, obligatoria, pasoLegal } from "./comun";
import { documentosRenovacion, pasosRenovacionContado } from "./renov-contado";

const FORM_INICIO_RENOV_SPT = documento(
  "FORM_INICIO_RENOV_SPT",
  "Formulario de inicio de trámite de renovación sin perjuicio de tercero",
  "direccion",
  "MESA",
);

export const RENOV_SPT_CONTADO: DefinicionPlantilla = {
  forma_pago: "contado",
  tipos_monumento: ["SOTANITO", "CAPILLA", "MAUSOLEO", "SEPULTURA"],
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: [
    // [I] Fallecido; la fecha de defunción es optativa (pregunta C-2).
    { rol: "titular", etiqueta: "Titular de la concesión (fallecido)", min: 1, max: 1, fallecido: "si", pide_vinculo: false },
    // Obligatorio y, en la práctica, el contacto: el titular está fallecido.
    // La definición no tiene "contacto por defecto"; lo resuelve el alta.
    { rol: "solicitante", etiqueta: "Solicitante", min: 1, max: 1, fallecido: "no", pide_vinculo: true },
  ],
  campos_extra: CAMPOS_CONCESION,
  documentos: [
    ...documentosRenovacion(FORM_INICIO_RENOV_SPT),
    // [I] En Mesa. No se escanea por defecto: puede incluir la causa de muerte (C-4).
    documento("ACTA_DEFUNCION", "Acta de defunción del titular", "concesionario", "MESA", "no"),
    // [I] En Mesa, sin escanear (C-5).
    documento("ACTAS_VINCULO", "Actas que acrediten el vínculo con el titular", "concesionario", "MESA", "no"),
  ],
  conceptos: [CONCEPTO.DERECHO_OFICINA, CONCEPTO.INSPECCION_TECNICA, CONCEPTO.ARRENDAMIENTO],
  // [I] Legal acredita el vínculo (pregunta C-3). Va antes del dictamen, que es
  // el resultado de esa revisión.
  pasos: pasosRenovacionContado(
    pasoLegal([obligatoria("LEG_VINCULO", "Vínculo con el titular acreditado"), SUB.LEG_DICTAMEN]),
  ),
};
