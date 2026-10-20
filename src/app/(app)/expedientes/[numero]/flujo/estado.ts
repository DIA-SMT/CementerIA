"use client";

import { createContext, useContext } from "react";
import type { DialogoFlujo, DatosFlujo } from "./tipos";

/** Los adjuntos que quien no trabaja el expediente pidió con un motivo ("Ver datos completos"). */
export interface AdjuntosConMotivo {
  motivo: string;
  lista: Array<{ movimientoId: string; documento: string | null; nombre: string; mime: string; bytes: number }>;
}

export interface ContextoFlujo {
  datos: DatosFlujo;
  /** La que se manda como `versionVista`. */
  version: number;
  abrir: (d: DialogoFlujo) => void;
  cerrar: () => void;
  /** Después de una acción que salió bien: la versión nueva, el aviso y, si hace falta, el diálogo que sigue. */
  hecho: (r: { version?: number; mensaje: string }, siguiente?: DialogoFlujo | null) => void;
  adjuntosConMotivo: AdjuntosConMotivo | null;
  setAdjuntosConMotivo: (a: AdjuntosConMotivo) => void;
}

export const Contexto = createContext<ContextoFlujo | null>(null);

export function useFlujo(): ContextoFlujo {
  const c = useContext(Contexto);
  if (!c) throw new Error("useFlujo fuera de <ProveedorFlujo>");
  return c;
}
