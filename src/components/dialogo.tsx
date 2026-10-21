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
      className={`m-auto w-[calc(100%-2rem)] ${ancho === "ancho" ? "max-w-4xl" : "max-w-lg"} rounded-panel border border-borde bg-white p-0 text-texto shadow-elevada backdrop:bg-institucional/55`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-borde px-5 py-3.5">
        <div>
          <h2 id={idTitulo} className="text-base font-semibold text-texto">
            {titulo}
          </h2>
          {descripcion ? (
            <div id={idDescripcion} className="mt-0.5 text-sm text-texto-secundario">
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
          className="-mr-1 rounded-control p-1.5 text-texto-secundario transition-colors duration-150 hover:bg-fondo hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario disabled:opacity-50"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          {/* Nombre propio: varios diálogos tienen además un botón "Cerrar" en el pie, y dos botones con el mismo nombre confunden al lector de pantalla. */}
          <span className="sr-only">Cerrar ventana</span>
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
