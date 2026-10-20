// Las 4 plantillas de la carga inicial (docs/propuesta-mvp.md, sección 4). Se
// publican como versión 1 con notas_cambio "Carga inicial, a validar": el
// taller de validación (docs/taller-plantillas.md) las corrige publicando una
// versión 2, nunca editando la 1.

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
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
];
