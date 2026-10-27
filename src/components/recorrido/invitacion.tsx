"use client";

import { useEffect, useId, useRef } from "react";
import { CircleHelp, Compass } from "lucide-react";
import { CLASE_BOTON_COMPACTO, CLASE_BOTON_COMPACTO_PRIMARIO, CLASE_FOCO } from "@/components/formulario";
import { useRecorridos } from "./proveedor";

/**
 * La invitación a un recorrido: una tarjeta chica, abajo a la derecha (en el
 * celular, abajo y a lo ancho), que NO es un diálogo, no bloquea nada y no
 * toma el foco. Se lee como una región complementaria (`aside`) al final de la
 * página. Mientras está, globals.css reserva lugar al pie del contenido
 * (`main`) y en el `scroll-padding`, así nada queda tapado para siempre: al
 * desplazarse o al tabular, lo de abajo sube por encima de la tarjeta. En las
 * pantallas con la barra de acciones fija (alta), se apoya arriba de la barra.
 *
 * Con `enLinea` va en el flujo de la página (en /cambiar-clave, debajo del
 * formulario) en lugar de flotar.
 */
export function InvitacionRecorrido({ enLinea = false }: { enLinea?: boolean }) {
  const { invitacion, responder } = useRecorridos();
  const id = useId();
  const tarjeta = useRef<HTMLElement>(null);

  // Arriba de la barra de acciones fija del formulario, si la hay (su alto
  // cambia con el ancho: en el celular los botones van en dos renglones).
  useEffect(() => {
    const el = tarjeta.current;
    if (enLinea || !el) return;
    const barra = document.querySelector<HTMLElement>(".barra-acciones");
    if (!barra) return;
    const ubicar = () => {
      el.style.bottom = `${barra.getBoundingClientRect().height + 12}px`;
    };
    ubicar();
    const observador = new ResizeObserver(ubicar);
    observador.observe(barra);
    return () => observador.disconnect();
  }, [enLinea, invitacion]);

  if (!invitacion) return null;
  const { recorrido, bienvenida } = invitacion;

  return (
    <aside
      ref={tarjeta}
      aria-labelledby={`${id}-titulo`}
      data-invitacion-recorrido={enLinea ? undefined : ""}
      className={`rounded-tarjeta border border-info-borde bg-white p-4 text-texto shadow-elevada print:hidden ${
        enLinea ? "w-full" : "fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[22rem]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-superficie-azul text-primario-oscuro">
          <Compass className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p id={`${id}-titulo`} className="text-sm font-semibold text-texto">
            {bienvenida ? "¿Es tu primera vez en CementerIA?" : "¿Querés un recorrido de esta pantalla?"}
          </p>
          <p className="mt-0.5 text-sm text-texto-secundario">
            {bienvenida ? "En un minuto te mostramos dónde está cada cosa." : `${recorrido.nombre}: te mostramos para qué sirve cada parte.`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        <button type="button" onClick={(e) => responder("empezado", e.currentTarget)} className={CLASE_BOTON_COMPACTO_PRIMARIO}>
          Empezar
        </button>
        <button type="button" onClick={() => responder("ahora_no")} className={CLASE_BOTON_COMPACTO}>
          Ahora no
        </button>
        {bienvenida ? null : (
          <button
            type="button"
            onClick={() => responder("no_mostrar")}
            className={`inline-flex min-h-8 items-center rounded-control px-1 text-[0.8125rem] font-medium text-primario-oscuro underline underline-offset-2 hover:text-institucional ${CLASE_FOCO}`}
          >
            No volver a mostrar
          </button>
        )}
      </div>
      {bienvenida ? (
        <p className="mt-2 pl-12 text-xs text-texto-secundario">
          Después, cada pantalla tiene su recorrido en el botón{" "}
          <CircleHelp className="inline h-3.5 w-3.5 align-[-0.15em] text-primario-oscuro" aria-hidden="true" />
          <span className="sr-only">Recorrido de esta pantalla</span> del encabezado.
        </p>
      ) : null}
    </aside>
  );
}
