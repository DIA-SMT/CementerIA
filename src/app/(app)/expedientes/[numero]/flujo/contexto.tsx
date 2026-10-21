"use client";

import { useCallback, useMemo, useState } from "react";
import { CircleCheck } from "lucide-react";
import { DialogoActivo } from "./dialogos";
import { Contexto, useFlujo, type AdjuntosConMotivo } from "./estado";
import type { DialogoFlujo, DatosFlujo } from "./tipos";

/**
 * El estado de las acciones de la ficha: qué diálogo está abierto, la versión
 * que se manda como `versionVista` y el aviso de lo último que se hizo.
 *
 * La versión es la mayor entre la que trae la ficha y la que devolvió la
 * última acción: las Server Actions recargan la ficha en la misma respuesta
 * (`refresh()`), pero si se encadenan dos acciones antes de que llegue, la
 * segunda ya usa la versión nueva. Si otro usuario cambió el expediente, el
 * dominio responde "Otro usuario modificó el expediente; recargá".
 */

export function ProveedorFlujo({ datos, children }: { datos: DatosFlujo; children: React.ReactNode }) {
  const [dialogo, setDialogo] = useState<DialogoFlujo | null>(null);
  const [ultimaVersion, setUltimaVersion] = useState(-1);
  const [aviso, setAviso] = useState<string | null>(null);
  const [adjuntosConMotivo, setAdjuntosConMotivo] = useState<AdjuntosConMotivo | null>(null);
  const version = Math.max(datos.version, ultimaVersion);

  const abrir = useCallback((d: DialogoFlujo) => {
    setAviso(null);
    setDialogo(d);
  }, []);
  const cerrar = useCallback(() => setDialogo(null), []);
  const hecho = useCallback((r: { version?: number; mensaje: string }, siguiente: DialogoFlujo | null = null) => {
    if (r.version !== undefined) setUltimaVersion((v) => Math.max(v, r.version ?? -1));
    setAviso(r.mensaje);
    setDialogo(siguiente);
  }, []);

  const valor = useMemo(
    () => ({ datos, version, abrir, cerrar, hecho, adjuntosConMotivo, setAdjuntosConMotivo }),
    [datos, version, abrir, cerrar, hecho, adjuntosConMotivo],
  );

  return (
    <Contexto.Provider value={valor}>
      {/* Región viva siempre presente: el lector de pantalla anuncia el aviso cuando cambia. */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {aviso ? (
          <p className="mb-4 flex items-center gap-2 rounded-control border border-exito-borde bg-exito-fondo px-3 py-2 text-sm text-exito print:hidden">
            <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            {aviso}
          </p>
        ) : null}
      </div>
      {children}
      {dialogo ? <DialogoActivo dialogo={dialogo} /> : null}
    </Contexto.Provider>
  );
}

/** Un botón que abre un diálogo del flujo (para usar dentro de Server Components). */
export function BotonFlujo({
  dialogo,
  className,
  children,
  etiqueta,
}: {
  dialogo: DialogoFlujo;
  className: string;
  children: React.ReactNode;
  /** `aria-label` cuando el texto visible solo no alcanza ("Tildar: Carátula impresa"). */
  etiqueta?: string;
}) {
  const { abrir } = useFlujo();
  return (
    <button type="button" onClick={() => abrir(dialogo)} className={className} aria-label={etiqueta} aria-haspopup="dialog">
      {children}
    </button>
  );
}
