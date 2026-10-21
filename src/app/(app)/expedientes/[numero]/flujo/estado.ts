"use client";

import { createContext, useContext } from "react";
import type { ItemFaltante } from "@/lib/presentacion/flujo";
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

/** El diálogo al que se vuelve después de resolver un faltante. */
export function dialogoDeVuelta(volverA: "pase" | "concluir" | null): DialogoFlujo | null {
  return volverA === "pase" ? { tipo: "pase" } : volverA === "concluir" ? { tipo: "estado", accion: "concluir" } : null;
}

/** El acceso directo de un faltante: cierra la lista y abre el diálogo que lo resuelve; al terminar, vuelve al pase (o a concluir). */
export function useAccesoFaltante(volverA: "pase" | "concluir" = "pase"): (item: ItemFaltante) => void {
  const { abrir } = useFlujo();
  return (item) => {
    const a = item.accion?.acceso;
    if (!a) return;
    if (a.tipo === "tildar") abrir({ tipo: "tildar", clave: a.clave, volverA });
    else if (a.tipo === "documento") abrir({ tipo: "documento", clave: a.clave, volverA });
    else if (a.tipo === "adjuntar") abrir({ tipo: "adjuntar", documento: a.documento, volverA });
  };
}
