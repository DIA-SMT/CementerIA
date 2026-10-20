"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * Diálogo modal accesible con el `<dialog>` nativo y `showModal()`: el resto
 * de la página queda inerte (el foco no sale del diálogo), Escape lo cierra y
 * el lector de pantalla lo anuncia con su título. Al abrirse, el foco va al
 * elemento marcado con `data-autofocus` (o al primero que lo acepte); al
 * cerrarse vuelve a donde estaba.
 *
 * Se monta abierto y se cierra con `onCerrar` (el que lo abrió lo desmonta).
 * Con `ocupado` (una acción en curso) Escape y la X no lo cierran.
 */
export function Dialogo({
  titulo,
  descripcion,
  onCerrar,
  ocupado = false,
  ancho = "normal",
  children,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  onCerrar: () => void;
  ocupado?: boolean;
  ancho?: "normal" | "ancho";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const idDescripcion = useId();
  const ocupadoRef = useRef(ocupado);
  const onCerrarRef = useRef(onCerrar);

  useEffect(() => {
    ocupadoRef.current = ocupado;
    onCerrarRef.current = onCerrar;
  });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (d.open) d.close();
      if (anterior?.isConnected) anterior.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDescripcion : undefined}
      aria-busy={ocupado}
      onCancel={(e) => {
        // Escape: el navegador lo cierra; mientras se guarda, no.
        e.preventDefault();
        if (!ocupadoRef.current) onCerrarRef.current();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${ancho === "ancho" ? "max-w-4xl" : "max-w-lg"} rounded border border-slate-300 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id={idTitulo} className="text-base font-semibold text-slate-900">
            {titulo}
          </h2>
          {descripcion ? (
            <div id={idDescripcion} className="mt-0.5 text-sm text-slate-600">
              {descripcion}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!ocupado) onCerrar();
          }}
          disabled={ocupado}
          className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 disabled:opacity-50"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Cerrar</span>
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-4 py-3">{children}</div>
    </dialog>
  );
}
