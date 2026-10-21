// b) RENOV_PLAN: Renovación, solicitud de forma de pago (docs/propuesta-mvp.md, 4(b)).
//
// Igual que (a) hasta Legal. El arrendamiento se paga en un plan ante la DIM:
// Tributario notifica la resolución y remite el expediente, y el título se hace
// cuando la DIM informa la deuda cancelada.
//
// [F] Vuelta de la DIM (lo que informó la Dirección el 20/10/2026): si el
// concesionario no abonó, el expediente vuelve a Tributario para que lo
// notifique; si se presenta y paga, sigue al título sin volver a la DIM. Por
// eso el paso DIM es omitible: Tributario da el pase a ADM_TITULO salteándolo,
// con motivo. Si no paga, Legal tramita la caducidad (archivar sin concluir y
// abrir un expediente de caducidad vinculado): es de la próxima etapa.

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import {
  CAMPOS_CONCESION,
  CONCEPTO,
  DOC_JURIDICA,
  INSTRUCCIONES_BOLETA,
  INSTRUCCIONES_RESOLUCION,
  INSTRUCCIONES_TITULO,
  SOLICITANTE_OPCIONAL,
  SUB,
  TITULAR_VIVO,
  boletas,
  conFecha,
  concepto,
  obligatoria,
  paso,
  pasoComputoAlta,
  pasoComputoFinal,
  pasoEntrega,
  pasoLegal,
  pasoLiquidacion,
  pasoMesa,
} from "./comun";
import { FORM_INICIO_RENOV, MONUMENTOS_RENOVACION, documentosRenovacion } from "./renov-contado";

// [t?: N° de boleta, I]. Sin arrendamiento: va por el plan de la DIM. [F] En
// Jardín, tampoco inspección técnica: solo el derecho de oficina.
const BOLETAS_SIN_ARRENDAMIENTO = boletas("Boleta emitida: oficina e inspección técnica", "Boleta emitida: derecho de oficina");

// La misma documentación que (a); el comprobante es el de la boleta inicial.
const documentos = documentosRenovacion(FORM_INICIO_RENOV, DOC_JURIDICA).map((d) =>
  d.clave === "COMPROBANTE_PAGO"
    ? { ...d, nombre: "Copia del comprobante de pago de la boleta inicial" }
    : d,
);

export const RENOV_PLAN: DefinicionPlantilla = {
  forma_pago: "plan_pagos",
  tipos_monumento: MONUMENTOS_RENOVACION,
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: [TITULAR_VIVO, SOLICITANTE_OPCIONAL],
  campos_extra: CAMPOS_CONCESION,
  documentos,
  conceptos: [
    CONCEPTO.DERECHO_OFICINA,
    CONCEPTO.INSPECCION_TECNICA,
    // [C] ¿Lo liquida Tributario o Liquidación? (pregunta B-4)
    concepto("ARRENDAMIENTO", "Arrendamiento", "plan_dim", "TRIBUTARIO"),
  ],
  pasos: [
    pasoMesa(),
    pasoComputoAlta(),
    pasoLiquidacion(BOLETAS_SIN_ARRENDAMIENTO, INSTRUCCIONES_BOLETA),
    pasoLegal(),
    // Sin título: el título se hace después de la DIM (paso ADM_TITULO).
    paso({
      clave: "ADM_RESOLUCION",
      nombre: "Administrativo: resolución",
      area: "ADMINISTRATIVO",
      dias_alerta: 15,
      instrucciones: INSTRUCCIONES_RESOLUCION,
      subtareas: [SUB.ADM_RES_CONF, SUB.ADM_RES_FIRMA, SUB.ADM_PROTOCOLO],
    }),
    // [I] Las tres subtareas (pregunta B-3).
    paso({
      clave: "TRIBUTARIO",
      nombre: "Tributario / Notificación",
      area: "TRIBUTARIO",
      dias_alerta: 10,
      subtareas: [
        conFecha("TRIB_NOTIFICADA", "Resolución notificada al concesionario"),
        obligatoria("TRIB_DEBITOS", "Débitos de arrendamiento generados"),
        conFecha("TRIB_REMITIDO", "Expediente remitido a la DIM"),
      ],
    }),
    // La DIM no usa la herramienta: el expediente queda "en espera de pago
    // DIM" y lo sigue Tributario [C] (pregunta B-6). El plazo de 30 días
    // hábiles corre desde la notificación (sección 3.6). [F] Omitible: ver arriba.
    paso({
      clave: "DIM",
      omitible: true,
      nombre: "DIM (afuera)",
      area: "DIM",
      custodia: "TRIBUTARIO",
      estado: "espera_pago_dim",
      dias_alerta: 60,
      plazo: { dias_habiles: 30, desde_subtarea: "TRIB_NOTIFICADA", hasta_subtarea: "DIM_PLAN_INICIADO" },
      subtareas: [
        // [I] No obligatoria: si se anota, cierra el plazo (pregunta B-7).
        conFecha("DIM_PLAN_INICIADO", "Concesionario inició la forma de pago", false),
        conFecha("DIM_DEUDA_CANCELADA", "DIM informa la deuda cancelada y devuelve el expediente"),
      ],
    }),
    paso({
      clave: "ADM_TITULO",
      nombre: "Administrativo: título",
      area: "ADMINISTRATIVO",
      dias_alerta: 15,
      instrucciones: INSTRUCCIONES_TITULO,
      subtareas: [SUB.ADM_TIT_CONF, SUB.ADM_TIT_FIRMA],
    }),
    pasoComputoFinal(obligatoria("COMP_FINAL", "Finalización grabada")),
    pasoEntrega(),
  ],
};
