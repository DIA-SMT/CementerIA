// c) RENOV_SPT_CONTADO: Renovación sin perjuicio de tercero, contado
// (docs/propuesta-mvp.md, 4(c)).
//
// Pasos, monumentos, campos extra, conceptos y dias_alerta iguales que (a). La
// pide alguien distinto del titular, que supusimos fallecido [I]; [F] los
// procedimientos lo confirman: "cuando el titular está fallecido".
//
// Sin persona jurídica: el trámite existe porque el titular falleció, y una
// asociación no fallece (la renovación de un panteón de una asociación va por
// (a) o (b)). Por eso tampoco lleva la personería ni la designación de asamblea.

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import { CAMPOS_CONCESION, CONCEPTO, SUB, documento, obligatoria, pasoLegal } from "./comun";
import { MONUMENTOS_RENOVACION, documentosRenovacion, pasosRenovacionContado } from "./renov-contado";

const FORM_INICIO_RENOV_SPT = documento(
  "FORM_INICIO_RENOV_SPT",
  "Formulario de inicio de trámite de renovación sin perjuicio de tercero",
  "direccion",
  "MESA",
);

export const RENOV_SPT_CONTADO: DefinicionPlantilla = {
  forma_pago: "contado",
  tipos_monumento: MONUMENTOS_RENOVACION,
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: [
    // [I] Fallecido; la fecha de defunción es optativa (pregunta C-2).
    {
      rol: "titular",
      etiqueta: "Titular de la concesión (fallecido)",
      min: 1,
      max: 1,
      fallecido: "si",
      pide_vinculo: false,
      admite_juridica: false,
    },
    // Obligatorio y, en la práctica, el contacto: el titular está fallecido.
    // La definición no tiene "contacto por defecto"; lo resuelve el alta.
    { rol: "solicitante", etiqueta: "Solicitante", min: 1, max: 1, fallecido: "no", pide_vinculo: true, admite_juridica: false },
  ],
  campos_extra: CAMPOS_CONCESION,
  documentos: [
    ...documentosRenovacion(FORM_INICIO_RENOV_SPT),
    // [I] En Mesa. No se escanea por defecto: puede incluir la causa de muerte (C-4).
    // [F] Si no se consigue, la reemplaza un informe del cementerio de
    // inhumación: se marca "no corresponde" con esa observación.
    documento("ACTA_DEFUNCION", "Acta de defunción del titular", "concesionario", "MESA", "no"),
    // [I] En Mesa, sin escanear (C-5). [F] El hijo de crianza no tiene acta:
    // "no corresponde" con observación, y Legal acredita el vínculo.
    documento("ACTAS_VINCULO", "Actas que acrediten el vínculo con el titular", "concesionario", "MESA", "no"),
  ],
  conceptos: [CONCEPTO.DERECHO_OFICINA, CONCEPTO.INSPECCION_TECNICA, CONCEPTO.ARRENDAMIENTO],
  // [I] Legal acredita el vínculo (pregunta C-3). Va antes del dictamen, que es
  // el resultado de esa revisión.
  pasos: pasosRenovacionContado(
    pasoLegal([obligatoria("LEG_VINCULO", "Vínculo con el titular acreditado"), SUB.LEG_DICTAMEN]),
  ),
};
