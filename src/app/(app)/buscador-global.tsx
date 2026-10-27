"use client";

import Form from "next/form";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { CLASE_CONTROL, CLASE_FOCO } from "@/components/formulario";

/**
 * La búsqueda global del encabezado (lleva a /expedientes?q=).
 *
 * En tablet y escritorio (sm+) el formulario se ve siempre. En el celular queda
 * detrás del botón "Buscador" para que el encabezado ocupe una sola fila
 * (patrón disclosure, como el menú: `aria-expanded`/`aria-controls`; al
 * abrirse el foco va a la caja; Escape la cierra y devuelve el foco al botón;
 * se cierra sola al cambiar de pantalla). El formulario sigue después del
 * botón en el DOM, así que el orden de tabulación es el visual.
 */
export function BuscadorGlobal() {
  const ruta = usePathname();
  const idFormulario = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const caja = useRef<HTMLInputElement>(null);
  // Abierto "en" una ruta: al navegar (por ejemplo, al buscar) se cierra solo.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn === ruta;

  useEffect(() => {
    if (abierto) caja.current?.focus();
  }, [abierto]);

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-expanded={abierto}
        aria-controls={idFormulario}
        data-recorrido="buscador-global"
        onClick={() => setAbiertoEn(abierto ? null : ruta)}
        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control border transition-colors duration-150 sm:hidden ${CLASE_FOCO} ${
          abierto
            ? "border-primario bg-superficie-azul text-primario-oscuro"
            : "border-borde-control bg-white text-texto hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro"
        }`}
      >
        {abierto ? <X className="h-4 w-4" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
        <span className="sr-only">Buscador</span>
      </button>
      <Form
        id={idFormulario}
        action="/expedientes"
        role="search"
        aria-label="Búsqueda global"
        data-recorrido="buscador-global"
        onKeyDown={(e) => {
          if (e.key === "Escape" && abierto) {
            e.preventDefault();
            setAbiertoEn(null);
            boton.current?.focus();
          }
        }}
        className={`${abierto ? "flex" : "hidden"} order-last w-full items-center sm:order-none sm:flex sm:w-auto sm:max-w-md sm:flex-1`}
      >
        <label htmlFor="busqueda-global" className="sr-only">
          Buscar expediente
        </label>
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-secundario" aria-hidden="true" />
          <input
            ref={caja}
            id="busqueda-global"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="N°, DNI, CUIT, padrón o nombre"
            className={`${CLASE_CONTROL} rounded-r-none pl-9`}
          />
        </div>
        <button
          type="submit"
          className={`inline-flex min-h-10 shrink-0 items-center rounded-r-control border border-l-0 border-borde-control bg-white px-3 text-sm font-medium text-texto transition-colors duration-150 hover:bg-superficie-azul hover:text-primario-oscuro ${CLASE_FOCO}`}
        >
          Buscar
        </button>
      </Form>
    </>
  );
}
