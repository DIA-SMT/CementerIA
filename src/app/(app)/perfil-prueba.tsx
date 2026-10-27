"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, FlaskConical, Undo2 } from "lucide-react";
import { CLASE_BOTON_COMPACTO, CLASE_FOCO } from "@/components/formulario";
import { CLAVE_PERFIL_ADMIN, descripcionPerfil, nombrePerfilEnFranja, nombreSelector, type PerfilVista } from "@/lib/presentacion/perfil-prueba";
import { accionCambiarPerfilPrueba } from "./perfil-prueba-acciones";

/**
 * El modo prueba en la cáscara (docs/diseno.md, "Modo prueba"): el selector
 * "Ver como…" del encabezado y la franja de arriba del contenido. Solo los
 * dibuja el layout para un usuario cuyo CUIL está en PERFILES_PRUEBA_CUILS; la
 * Server Action lo vuelve a comprobar contra la base.
 *
 * Después de cambiar, una carga COMPLETA del inicio del perfil
 * (`window.location.assign`), no `router.push`: el layout entero (menú,
 * contador "Por confirmar", campana, recorridos) se vuelve a pedir con el
 * perfil nuevo y no queda nada del anterior en el Router Cache.
 */

/** Cambiar de perfil: la acción, lo pendiente y el error, compartido por el selector y la franja. */
function useCambioPerfil() {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cambiar = useCallback((clave: string) => {
    setError(null);
    iniciar(async () => {
      try {
        const r = await accionCambiarPerfilPrueba(clave);
        if (r.ok) {
          window.location.assign(r.destino);
          return;
        }
        setError(r.mensaje);
      } catch {
        setError("No se pudo cambiar de perfil. Recargá la página y probá de nuevo.");
      }
    });
  }, []);
  return { cambiar, pendiente, error };
}

/**
 * "Ver como…": botón con un menú (patrón menu button). El botón tiene
 * `aria-haspopup="menu"`, `aria-expanded` y `aria-controls`; el menú, una
 * opción por perfil (`menuitemradio`, con `aria-checked` en el actual y una
 * tilde). Al abrir, el foco va al perfil actual; ↑ ↓ Inicio y Fin recorren,
 * Enter o Espacio eligen, Escape cierra y devuelve el foco al botón, Tab y un
 * clic afuera lo cierran. En el celular, solo el ícono (con su nombre
 * accesible) y el menú a lo ancho del encabezado, como la campana.
 */
export function SelectorPerfilPrueba({ perfiles, actual }: { perfiles: PerfilVista[]; actual: string | null }) {
  const idMenu = useId();
  const idTitulo = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const opciones = useRef<Array<HTMLButtonElement | null>>([]);
  const [abierto, setAbierto] = useState(false);
  const indiceActual = Math.max(0, perfiles.findIndex((p) => p.clave === actual));
  const [activo, setActivo] = useState(indiceActual);
  const { cambiar, pendiente, error } = useCambioPerfil();
  const perfilActual = perfiles.find((p) => p.clave === actual) ?? null;

  // Abierto: el foco a la opción activa, y un clic afuera lo cierra.
  useEffect(() => {
    if (!abierto) return;
    opciones.current[activo]?.focus();
  }, [abierto, activo]);
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (e.target instanceof Node && !contenedor.current?.contains(e.target)) setAbierto(false);
    };
    document.addEventListener("pointerdown", afuera);
    return () => document.removeEventListener("pointerdown", afuera);
  }, [abierto]);

  function abrir(indice = indiceActual) {
    setActivo(indice);
    setAbierto(true);
  }

  function cerrar(devolverFoco: boolean) {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  }

  function teclaBoton(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      abrir(e.key === "ArrowUp" ? perfiles.length - 1 : indiceActual);
    }
  }

  function teclaMenu(e: React.KeyboardEvent<HTMLDivElement>) {
    const ultimo = perfiles.length - 1;
    const mover: Record<string, number> = {
      ArrowDown: activo >= ultimo ? 0 : activo + 1,
      ArrowUp: activo <= 0 ? ultimo : activo - 1,
      Home: 0,
      End: ultimo,
    };
    if (e.key in mover) {
      e.preventDefault();
      setActivo(mover[e.key]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cerrar(true);
    } else if (e.key === "Tab") {
      setAbierto(false);
    }
  }

  function elegir(p: PerfilVista) {
    if (p.clave === actual) {
      cerrar(true);
      return;
    }
    cambiar(p.clave);
  }

  return (
    <div ref={contenedor} className="shrink-0 sm:relative">
      <button
        ref={boton}
        type="button"
        data-recorrido="perfil-prueba"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={idMenu}
        onClick={() => (abierto ? cerrar(false) : abrir())}
        onKeyDown={teclaBoton}
        title="Ver como… (modo prueba)"
        className={`inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-control border px-2.5 text-sm font-medium transition-colors duration-150 ${CLASE_FOCO} ${
          abierto
            ? "border-primario bg-superficie-azul text-primario-oscuro"
            : "border-advertencia bg-advertencia-fondo text-advertencia hover:bg-amarillo/25"
        }`}
      >
        <FlaskConical className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{nombreSelector(perfilActual)}</span>
        {/* Sin texto visible, también en escritorio: con "Por confirmar" y la
            campana, "Ver como…" escrito no entraba sin empujar el nombre. El
            nombre accesible y el `title` lo dicen; la flecha, que abre un menú. */}
        <ChevronDown className="hidden h-3.5 w-3.5 lg:inline" aria-hidden="true" />
      </button>

      {/* La tarjeta lleva el título y la explicación; adentro, el menú (solo
          con sus opciones, como pide el rol `menu`). */}
      <div
        hidden={!abierto}
        onBlur={(e) => {
          // El foco salió del menú (y no volvió al botón): se cierra.
          if (abierto && e.relatedTarget instanceof Node && !contenedor.current?.contains(e.relatedTarget)) setAbierto(false);
        }}
        className="absolute inset-x-2 top-full z-40 mt-1 overflow-hidden rounded-tarjeta border border-borde bg-white text-left shadow-elevada sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-80"
      >
        <div className="border-b border-borde px-4 py-3">
          <p id={idTitulo} className="text-sm font-semibold text-texto">
            Ver como…
          </p>
          <p className="mt-0.5 text-xs text-texto-secundario">Modo prueba: cambia el área y el rol de tu propio usuario. Queda en la auditoría.</p>
        </div>
        <div
          id={idMenu}
          role="menu"
          aria-labelledby={idTitulo}
          aria-busy={pendiente}
          onKeyDown={teclaMenu}
          className="max-h-[min(26rem,65vh)] overflow-y-auto py-1"
        >
          {perfiles.map((p, i) => {
            const marcado = p.clave === actual;
            return (
              <button
                key={p.clave}
                ref={(el) => {
                  opciones.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={marcado}
                tabIndex={i === activo ? 0 : -1}
                disabled={pendiente}
                onClick={() => elegir(p)}
                onFocus={() => setActivo(i)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-superficie-azul focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primario disabled:cursor-wait ${
                  marcado ? "bg-superficie-azul/60" : "bg-white"
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-primario-oscuro" aria-hidden="true">
                  {marcado ? <Check className="h-4 w-4" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${marcado ? "font-semibold text-texto" : "font-medium text-texto"}`}>{p.etiqueta}</span>
                  <span className="block text-xs text-texto-secundario">
                    {descripcionPerfil(p)}
                    {marcado ? " · el de ahora" : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {pendiente || error ? (
          <p role={error ? "alert" : "status"} className={`border-t border-borde px-4 py-2.5 text-xs ${error ? "bg-error-fondo text-error" : "text-texto-secundario"}`}>
            {error ?? "Cambiando de perfil…"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * La franja de arriba del contenido mientras el perfil no es Administrador:
 * "Modo prueba: estás viendo como Liquidación · Volver a Administrador".
 * Ámbar como el aviso de "Por confirmar" (texto `advertencia` sobre
 * `advertencia-fondo`, 6,21:1), sin tomar el foco ni anunciarse: es una
 * región con nombre. No sale al imprimir.
 */
export function FranjaPerfilPrueba({ perfil }: { perfil: PerfilVista | null }) {
  const { cambiar, pendiente, error } = useCambioPerfil();
  return (
    <section aria-label="Modo prueba" className="border-b border-advertencia-borde bg-advertencia-fondo print:hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 text-sm text-advertencia lg:px-8">
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0">
          <span className="font-semibold">Modo prueba:</span> estás viendo como <span className="font-semibold">{nombrePerfilEnFranja(perfil)}</span>
        </p>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => cambiar(CLAVE_PERFIL_ADMIN)} disabled={pendiente} className={CLASE_BOTON_COMPACTO}>
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          {pendiente ? "Volviendo…" : "Volver a Administrador"}
        </button>
        {error ? (
          <p role="alert" className="w-full text-xs text-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
