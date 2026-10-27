// Las plantillas de la semilla: las 4 de la carga inicial (docs/propuesta-mvp.md,
// sección 4) y, desde el 27/10/2026, las 2 de inhumación (procedimiento de la
// Dirección, docs/fuentes). Se publican como versión 1 con notas_cambio
// "Carga inicial, a validar": el taller de validación
// (docs/taller-plantillas.md) las corrige publicando una versión 2, nunca
// editando la 1.

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import { INHUMACION_DIRECCION, INHUMACION_EMPRESA, NOTAS_INHUMACION } from "./inhumacion";
import { NUEVA_CONC_CONTADO } from "./nueva-conc-contado";
import { RENOV_CONTADO } from "./renov-contado";
import { RENOV_PLAN } from "./renov-plan";
import { RENOV_SPT_CONTADO } from "./renov-spt-contado";

export { NOTAS_CARGA_INICIAL } from "./comun";

export interface PlantillaSemilla {
  codigo: string;
  nombre: string;
  /** Código de tipos_tramite. */
  tipoTramite: string;
  definicion: DefinicionPlantilla;
  /** Las notas de cambio de la v1. Por defecto, NOTAS_CARGA_INICIAL. */
  notasCambio?: string;
}

export const PLANTILLAS: readonly PlantillaSemilla[] = [
  { codigo: "RENOV_CONTADO", nombre: "Renovación, pago de contado", tipoTramite: "RENOVACION", definicion: RENOV_CONTADO },
  {
    codigo: "RENOV_PLAN",
    nombre: "Renovación, solicitud de forma de pago",
    tipoTramite: "RENOVACION",
    definicion: RENOV_PLAN,
  },
  {
    codigo: "RENOV_SPT_CONTADO",
    nombre: "Renovación sin perjuicio de tercero, contado",
    tipoTramite: "RENOVACION_SPT",
    definicion: RENOV_SPT_CONTADO,
  },
  {
    codigo: "NUEVA_CONC_CONTADO",
    nombre: "Nueva concesión de un monumento caducado, contado",
    tipoTramite: "NUEVA_CONCESION",
    definicion: NUEVA_CONC_CONTADO,
  },
  // Al final: las de antes conservan sus ids en una base ya sembrada (y en el
  // paquete SQL de Supabase, supabase/sql/31_inhumacion.sql).
  {
    codigo: "INHUMACION_DIRECCION",
    nombre: "Inhumación, pago en la Dirección",
    tipoTramite: "INHUMACION",
    definicion: INHUMACION_DIRECCION,
    notasCambio: NOTAS_INHUMACION,
  },
  {
    codigo: "INHUMACION_EMPRESA",
    nombre: "Inhumación, pago en la empresa fúnebre",
    tipoTramite: "INHUMACION",
    definicion: INHUMACION_EMPRESA,
    notasCambio: NOTAS_INHUMACION,
  },
];
