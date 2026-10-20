import type { AdjuntoFicha, DevolucionFicha, DocumentoFicha, PaseFicha, SubtareaFicha } from "@/lib/dominio/expedientes/ficha";

/**
 * Lo que los diálogos del flujo necesitan de la ficha. Lo arma la página (un
 * Server Component) a partir de `Ficha` y viaja al navegador: no lleva datos
 * personales (los adjuntos van en null si la ficha los enmascara).
 */
export interface DatosFlujo {
  numero: string;
  /** Para el bloqueo optimista (`versionVista`). */
  version: number;
  rutaFicha: string;
  rutaEditar: string;
  paso: { orden: number; nombre: string; esFinal: boolean; externo: boolean };
  areaActual: string;
  sinConfirmar: boolean;
  /** Las subtareas del paso actual. */
  subtareas: SubtareaFicha[];
  /** Los documentos de las dos columnas. */
  documentos: DocumentoFicha[];
  pase: PaseFicha;
  devolucion: DevolucionFicha;
  /** clave → nombre de cada paso de la plantilla. */
  nombresPasos: Record<string, string>;
  permisos: {
    confirmarRecepcion: boolean;
    tildarSubtarea: boolean;
    marcarDocumento: boolean;
    adjuntar: boolean;
    darPase: boolean;
    devolver: boolean;
    completarCamposExtra: boolean;
  };
  /** Vigentes; null si están enmascarados (quien no trabaja el expediente los pide con motivo). */
  adjuntos: AdjuntoFicha[] | null;
  cantidadAdjuntos: number;
}

/** El diálogo abierto. */
export type DialogoFlujo =
  | { tipo: "recepcion" }
  | { tipo: "pase" }
  | { tipo: "devolver" }
  | { tipo: "tildar"; clave: string; volverAlPase?: boolean }
  | { tipo: "destildar"; clave: string }
  | { tipo: "documento"; clave: string; volverAlPase?: boolean }
  | { tipo: "adjuntar"; documento: string | null; volverAlPase?: boolean }
  | { tipo: "visor"; adjunto: { movimientoId: string; nombre: string; mime: string }; motivo: string | null }
  | { tipo: "motivoAdjuntos" };
