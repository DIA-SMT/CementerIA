"use client";

import { useState } from "react";
import { CircleHelp, RotateCcw } from "lucide-react";
import { CLASE_BOTON_SECUNDARIO, CLASE_FOCO } from "@/components/formulario";
import { useRecorridos } from "./proveedor";

/**
 * El botón "?" del encabezado (y de /cambiar-clave): inicia el recorrido de la
 * pantalla a la vista. Siempre visible; en el celular, un ícono de 40 × 40 en
 * la fila del encabezado. El nombre accesible es "Recorrido de esta pantalla".
 */
export function BotonRecorrido({ className = "" }: { className?: string }) {
  const { iniciarPantalla } = useRecorridos();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      title="Recorrido de esta pantalla"
      data-boton-recorrido=""
      data-recorrido="boton-recorrido"
      onClick={(e) => iniciarPantalla(e.currentTarget)}
      className={`inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-control border border-borde-control bg-white px-2.5 text-texto shadow-xs transition-colors duration-150 hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro print:hidden ${CLASE_FOCO} ${className}`}
    >
      <CircleHelp className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Recorrido de esta pantalla</span>
    </button>
  );
}

/**
 * "Reiniciar los recorridos": olvida lo contestado en este navegador (todas
 * las pantallas y la bienvenida), así cada pantalla vuelve a invitar. El
 * resultado se anuncia en una región viva.
 */
export function ReiniciarRecorridos() {
  const { reiniciar } = useRecorridos();
  const [mensaje, setMensaje] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={() => {
          const cuantos = reiniciar();
          setMensaje(
            cuantos === null
              ? "Este navegador no guarda las preferencias: cada pantalla te va a seguir ofreciendo su recorrido."
              : "Listo: cada pantalla te va a volver a ofrecer su recorrido.",
          );
        }}
        className={CLASE_BOTON_SECUNDARIO}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Reiniciar los recorridos
      </button>
      <p aria-live="polite" className="text-sm text-texto-secundario empty:hidden">
        {mensaje}
      </p>
    </div>
  );
}
