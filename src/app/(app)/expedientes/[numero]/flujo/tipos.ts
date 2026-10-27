import type { AdjuntoFicha, DevolucionFicha, DocumentoFicha, PaseFicha, SubtareaFicha } from "@/lib/dominio/expedientes/ficha";
import type { Faltante } from "@/lib/dominio/expedientes/flujo";
import type { EstadoExpediente } from "@/lib/dominio/permisos";
import type { AccionEstado, MovimientoCorregible, OpcionMenuCorreccion } from "@/lib/presentacion/estados";

/**
 * Lo que los diálogos del flujo necesitan de la ficha. Lo arma la página (un
 * Server Component) a partir de `Ficha` y viaja al navegador: no lleva
 * contacto (los adjuntos van en null si la ficha los enmascara).
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
    // Semana 4 (3.1 y 2.13)
    concluir: boolean;
    archivar: boolean;
    archivarSinConcluir: boolean;
    desarchivar: boolean;
    anular: boolean;
    reabrir: boolean;
    reiniciar: boolean;
    cambiarUbicacionArchivo: boolean;
    nota: boolean;
    suprimirPersona: boolean;
  };
  /**
   * Cómo sube el navegador un adjunto (src/lib/adjuntos/config.ts): `app`, al
   * Route Handler en streaming (disco); `directa`, a Supabase Storage con una
   * URL firmada (Vercel).
   */
  subidaAdjuntos: "app" | "directa";
  /** Vigentes; null si están enmascarados (quien no trabaja el expediente los pide con motivo). */
  adjuntos: AdjuntoFicha[] | null;
  cantidadAdjuntos: number;
  // --- Semana 4 ---
  estado: EstadoExpediente;
  ubicacionArchivo: string | null;
  /** Quien lo sigue (la custodia en un paso externo): a dónde vuelve el papel al archivar sin concluir. */
  areaResponsable: string;
  /** "Faltan N" de Concluir. */
  concluir: { faltan: Faltante[] };
  /** Las plantillas publicadas, para Reiniciar y "Archivar y abrir vinculado" (vacío si no las puede usar). */
  plantillas: Array<{ id: number; nombre: string; version: number; tipoTramite: string }>;
}

export type { MovimientoCorregible };

/** El diálogo abierto. */
export type DialogoFlujo =
  | { tipo: "recepcion" }
  | { tipo: "pase" }
  | { tipo: "devolver" }
  | { tipo: "tildar"; clave: string; volverA?: "pase" | "concluir" }
  | { tipo: "destildar"; clave: string }
  | { tipo: "documento"; clave: string; volverA?: "pase" | "concluir" }
  | { tipo: "adjuntar"; documento: string | null; volverA?: "pase" | "concluir" }
  | { tipo: "visor"; adjunto: { movimientoId: string; nombre: string; mime: string }; motivo: string | null }
  | { tipo: "motivoAdjuntos" }
  // Semana 4
  | { tipo: "estado"; accion: AccionEstado }
  | { tipo: "corregir"; opcion: OpcionMenuCorreccion; movimiento: MovimientoCorregible }
  | { tipo: "suprimir"; persona: { id: string; texto: string } };
