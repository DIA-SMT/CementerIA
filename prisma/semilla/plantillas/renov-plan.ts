// b) RENOV_PLAN: Renovación, solicitud de forma de pago (docs/propuesta-mvp.md, 4(b)).
//
// Igual que (a) hasta Legal. El arrendamiento se paga en un plan ante la DIM:
// Tributario notifica la resolución y remite el expediente, y el título se hace
// cuando la DIM informa la deuda cancelada.

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import {
  CAMPOS_CONCESION,
  CONCEPTO,
  INSTRUCCIONES_BOLETA,
  INSTRUCCIONES_RESOLUCION,
  INSTRUCCIONES_TITULO,
  SOLICITANTE_OPCIONAL,
  SUB,
  TITULAR_VIVO,
  conFecha,
  conTextoOpcional,
  concepto,
  documento,
  obligatoria,
  paso,
  pasoComputoAlta,
  pasoComputoFinal,
  pasoEntrega,
  pasoLegal,
  pasoLiquidacion,
  pasoMesa,
} from "./comun";
import { FORM_INICIO_RENOV, documentosRenovacion } from "./renov-contado";

// [t?: N° de boleta, I]. Sin arrendamiento: va por el plan de la DIM.
const BOLETA_SIN_ARRENDAMIENTO = conTextoOpcional("LIQ_BOLETA", "Boleta emitida: oficina e inspección técnica");

// La misma documentación que (a); el comprobante es el de la boleta inicial.
const documentos = documentosRenovacion(FORM_INICIO_RENOV).map((d) =>
  d.clave === "COMPROBANTE_PAGO"
    ? documento(d.clave, "Copia del comprobante de pago de la boleta inicial", d.origen, d.exigir_al_salir_de, d.adjunto)
    : d,
);

export const RENOV_PLAN: DefinicionPlantilla = {
  forma_pago: "plan_pagos",
  tipos_monumento: ["SOTANITO", "CAPILLA", "MAUSOLEO", "SEPULTURA"],
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
    pasoLiquidacion(BOLETA_SIN_ARRENDAMIENTO, INSTRUCCIONES_BOLETA),
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
    // hábiles corre desde la notificación (sección 3.6).
    paso({
      clave: "DIM",
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
