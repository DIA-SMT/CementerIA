"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { CLASE_BOTON_COMPACTO, CLASE_BOTON_COMPACTO_PRIMARIO, CLASE_FOCO } from "@/components/formulario";
import { textoProgreso, type PasoResuelto, type Recorrido } from "@/lib/presentacion/recorridos/motor";
import { botonDeAyuda, buscarAncla, enfocablesDentro, esCelular, esEnfocable } from "./dom";

/**
 * El recorrido en curso (docs/diseno.md, "Recorridos guiados"): un velo suave
 * sobre la página con un recorte alrededor del elemento del paso (con un anillo
 * blanco y azul) y el globo con el título, el texto, "Paso N de M" y los
 * botones. En el celular el globo es una hoja inferior.
 *
 * - El globo es un diálogo modal (`role="dialog"`, `aria-modal`, título y
 *   descripción). El foco entra al globo y no sale (Tab da la vuelta); la
 *   página queda tapada por una capa transparente que no deja hacer clic.
 * - Teclado: → y Enter avanzan, ← retrocede, Escape sale. Al terminar o salir,
 *   el foco vuelve al botón que lo abrió o, si ya no está, al elemento
 *   resaltado o al "?".
 * - Cada paso nuevo se anuncia en una región `aria-live`.
 * - Se reubica al desplazarse o cambiar el tamaño (sin estado de React: escribe
 *   la posición directo en el estilo) y desplaza la página hasta el elemento.
 *   El recorte se desliza; con movimiento reducido, sin transiciones.
 * - No sale en el papel.
 */

/** Margen contra los bordes de la ventana y separación entre el elemento y el globo. */
const MARGEN = 16;
const SEPARACION = 12;
/** Lo que el anillo sobresale del elemento. */
const RELLENO = 6;

interface Caja {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function GloboRecorrido({
  recorrido,
  pasos,
  origen,
  onCerrar,
  onReiniciarTodos,
}: {
  recorrido: Recorrido;
  pasos: readonly PasoResuelto[];
  origen: HTMLElement | null;
  onCerrar: () => void;
  onReiniciarTodos: () => void;
}) {
  const [indice, setIndice] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  const [reiniciados, setReiniciados] = useState(false);
  const globo = useRef<HTMLDivElement>(null);
  const recorte = useRef<HTMLDivElement>(null);
  const capa = useRef<HTMLDivElement>(null);
  const resaltado = useRef<HTMLElement | null>(null);
  // Al salir, el foco se va del globo a propósito: que no lo traiga de vuelta.
  const cerrado = useRef(false);
  const raiz = useRef<HTMLDivElement>(null);
  // Devuelve la página a la normal (le saca el `inert`); se llama al salir, antes de mover el foco.
  const liberar = useRef<(() => void) | null>(null);
  const idTitulo = useId();
  const idTexto = useId();

  const total = pasos.length;
  const paso = pasos[Math.min(indice, total - 1)];
  const ultimo = indice >= total - 1;

  /** Dibuja el recorte y ubica el globo según dónde está hoy el elemento. */
  const ubicar = useCallback(() => {
    const g = globo.current;
    const r = recorte.current;
    const c = capa.current;
    if (!g || !r || !c) return;
    const el = paso.ancla ? buscarAncla(paso.ancla) : null;
    if (el) resaltado.current = el;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const celular = esCelular();
    const altoGlobo = g.offsetHeight;
    const anchoGlobo = g.offsetWidth;

    if (celular) {
      // Hoja inferior: la ubica el CSS (abajo y a lo ancho).
      g.style.top = "";
      g.style.left = "";
    }

    if (!el) {
      // Sin elemento (una presentación, o ya no se ve): todo velado y el globo al centro.
      r.style.display = "none";
      c.dataset.velada = "";
      if (!celular) {
        g.style.top = `${Math.max(MARGEN, (vh - altoGlobo) / 2)}px`;
        g.style.left = `${Math.max(MARGEN, (vw - anchoGlobo) / 2)}px`;
      }
      return;
    }

    delete c.dataset.velada;
    const rect = el.getBoundingClientRect();
    // El recorte, dentro de la ventana (y arriba de la hoja en el celular).
    const techo = 4;
    const piso = celular ? vh - altoGlobo - 8 : vh - 4;
    const hueco: Caja = { top: rect.top - RELLENO, left: rect.left - RELLENO, width: rect.width + 2 * RELLENO, height: rect.height + 2 * RELLENO };
    const arriba = Math.max(hueco.top, techo);
    let abajo = Math.min(hueco.top + hueco.height, piso);
    const izquierda = Math.max(hueco.left, 4);
    const derecha = Math.min(hueco.left + hueco.width, vw - 4);

    if (!celular) {
      const libreAbajo = vh - MARGEN - (abajo + SEPARACION);
      const libreArriba = arriba - SEPARACION - MARGEN;
      const centrado = (izquierda + derecha) / 2 - anchoGlobo / 2;
      const horizontal = Math.min(Math.max(MARGEN, centrado), vw - anchoGlobo - MARGEN);
      const vertical = (y: number) => Math.min(Math.max(MARGEN, y), vh - altoGlobo - MARGEN);
      let top: number;
      let left: number;
      if (libreAbajo >= altoGlobo) {
        top = abajo + SEPARACION;
        left = horizontal;
      } else if (libreArriba >= altoGlobo) {
        top = arriba - SEPARACION - altoGlobo;
        left = horizontal;
      } else if (vw - derecha - SEPARACION - MARGEN >= anchoGlobo) {
        top = vertical(arriba);
        left = derecha + SEPARACION;
      } else if (izquierda - SEPARACION - MARGEN >= anchoGlobo) {
        top = vertical(arriba);
        left = izquierda - SEPARACION - anchoGlobo;
      } else {
        // Un elemento alto (una sección entera): se resalta su parte de arriba y el globo va debajo.
        top = vh - MARGEN - altoGlobo;
        left = horizontal;
        abajo = Math.max(Math.min(abajo, top - SEPARACION), arriba + 24);
      }
      g.style.top = `${top}px`;
      g.style.left = `${left}px`;
    }

    r.style.display = "block";
    r.style.top = `${arriba}px`;
    r.style.left = `${izquierda}px`;
    r.style.width = `${Math.max(0, derecha - izquierda)}px`;
    r.style.height = `${Math.max(0, abajo - arriba)}px`;
  }, [paso]);

  /**
   * Desplaza la página para que el elemento quede a la vista (centrado si
   * entra; si es más alto que la ventana, desde arriba) y, en el celular,
   * arriba de la hoja. Sin animación: con pasos cambiados rápido, un
   * desplazamiento suave a medio camino dejaba el elemento fuera de lugar. Lo
   * que se anima es el recorte (y no, con movimiento reducido).
   */
  const llevarALaVista = useCallback(() => {
    const el = paso.ancla ? buscarAncla(paso.ancla) : null;
    const g = globo.current;
    if (!el || !g) return;
    // Primero los contenedores con desplazamiento propio (las pestañas de la bandeja en el celular).
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const vh = window.innerHeight;
    const zonaArriba = MARGEN;
    const zonaAbajo = esCelular() ? vh - g.offsetHeight - MARGEN : vh - MARGEN;
    const alto = zonaAbajo - zonaArriba;
    const rect = el.getBoundingClientRect();
    const entra = rect.height <= alto;
    const aLaVista = entra ? rect.top >= zonaArriba && rect.bottom <= zonaAbajo : Math.abs(rect.top - zonaArriba) <= 2;
    if (aLaVista) return;
    const destino = entra ? zonaArriba + (alto - rect.height) / 2 : zonaArriba;
    window.scrollBy({ top: rect.top - destino, behavior: "instant" });
  }, [paso]);

  // Cada paso: desplazar hasta el elemento y ubicar todo antes de pintar.
  useLayoutEffect(() => {
    llevarALaVista();
    ubicar();
  }, [llevarALaVista, ubicar]);

  // Al desplazarse (también dentro de contenedores) o cambiar el tamaño, se reubica en el cuadro siguiente.
  useEffect(() => {
    let cuadro = 0;
    const pedir = () => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(ubicar);
    };
    window.addEventListener("scroll", pedir, { capture: true, passive: true });
    window.addEventListener("resize", pedir);
    const observador = new ResizeObserver(pedir);
    if (globo.current) observador.observe(globo.current);
    if (resaltado.current) observador.observe(resaltado.current);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener("scroll", pedir, { capture: true });
      window.removeEventListener("resize", pedir);
      observador.disconnect();
    };
  }, [ubicar]);

  // Mientras dura, el resto de la página es `inert`: ni el foco ni el lector de
  // pantalla salen del globo (aria-modal solo no alcanza en todos los lectores).
  useEffect(() => {
    const propio = raiz.current;
    const tocados: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === propio || !(el instanceof HTMLElement) || el.inert) continue;
      el.inert = true;
      tocados.push(el);
    }
    const devolver = () => {
      for (const el of tocados.splice(0)) el.inert = false;
    };
    liberar.current = devolver;
    return devolver;
  }, []);

  const cerrar = useCallback(() => {
    cerrado.current = true;
    liberar.current?.();
    // Adonde vuelve el foco: el botón que lo abrió, el elemento resaltado o el "?".
    const destino = [origen, resaltado.current].find((el) => esEnfocable(el ?? null)) ?? botonDeAyuda();
    onCerrar();
    destino?.focus();
  }, [origen, onCerrar]);

  const ir = useCallback(
    (nuevo: number) => {
      if (nuevo < 0) return;
      if (nuevo >= total) {
        cerrar();
        return;
      }
      setIndice(nuevo);
      setAnuncio(`${textoProgreso(nuevo, total)}. ${pasos[nuevo].titulo}. ${pasos[nuevo].texto}`);
    },
    [total, pasos, cerrar],
  );

  // El foco entra al globo al abrirse (sin desplazar la página: ya se ubicó) y
  // vuelve a él si el botón que lo tenía desapareció (Anterior en el primer paso).
  useEffect(() => {
    const g = globo.current;
    if (g && !g.contains(document.activeElement)) g.focus({ preventScroll: true });
  }, [indice]);

  // Teclado y foco atrapado, mientras dure el recorrido. En captura: Escape
  // sale del recorrido y no llega a la página (no cierra otra cosa).
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const g = globo.current;
      if (!g) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cerrar();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        ir(indice + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        ir(indice - 1);
      } else if (e.key === "Enter") {
        // En un botón, Enter es ese botón; en el globo (o fuera), avanza.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        ir(indice + 1);
      } else if (e.key === "Tab") {
        const controles = enfocablesDentro(g);
        if (controles.length === 0) {
          e.preventDefault();
          return;
        }
        const primero = controles[0];
        const final = controles[controles.length - 1];
        const actual = document.activeElement;
        if (e.shiftKey && (actual === primero || actual === g || !g.contains(actual))) {
          e.preventDefault();
          final.focus();
        } else if (!e.shiftKey && (actual === final || !g.contains(actual))) {
          e.preventDefault();
          primero.focus();
        }
      }
    }
    function foco(e: FocusEvent) {
      const g = globo.current;
      if (cerrado.current) return;
      if (g && e.target instanceof Node && !g.contains(e.target)) g.focus({ preventScroll: true });
    }
    document.addEventListener("keydown", tecla, true);
    document.addEventListener("focusin", foco);
    return () => {
      document.removeEventListener("keydown", tecla, true);
      document.removeEventListener("focusin", foco);
    };
  }, [indice, ir, cerrar]);

  return (
    <div ref={raiz} className="print:hidden" data-recorrido-activo={recorrido.id}>
      {/* La capa que tapa la página: transparente cuando hay recorte (el velo lo
          pone su sombra), velada cuando el paso no resalta nada. No deja hacer
          clic en la página; un clic devuelve el foco al globo. */}
      <div
        ref={capa}
        aria-hidden="true"
        onMouseDown={(e) => {
          e.preventDefault();
          globo.current?.focus({ preventScroll: true });
        }}
        className="fixed inset-0 z-[60] data-velada:bg-institucional/45"
      />
      <div
        ref={recorte}
        aria-hidden="true"
        className="pointer-events-none fixed z-[61] rounded-[10px] transition-[top,left,width,height] duration-200 ease-out"
        // Anillo blanco y azul (primario: 4,73:1 contra el blanco) y, alrededor, el velo institucional al 45 %.
        style={{ boxShadow: "0 0 0 3px #fff, 0 0 0 5px var(--color-primario), 0 0 0 200vmax rgb(15 47 93 / 0.45)" }}
      />
      <div
        ref={globo}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idTexto}
        tabIndex={-1}
        className={`fixed z-[62] border border-borde bg-white text-texto shadow-elevada outline-none max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-t-panel max-sm:px-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:pt-4 sm:w-[22rem] sm:rounded-panel sm:p-5 focus-visible:ring-2 focus-visible:ring-primario focus-visible:ring-offset-2`}
      >
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-texto-secundario">
          <span className="font-semibold uppercase tracking-[0.08em]">
            <span className="sr-only">Recorrido: </span>
            {recorrido.nombre}
          </span>
          <span className="font-medium tabular-nums">{textoProgreso(indice, total)}</span>
        </p>
        {/* Avance (decorativo: el texto "Paso N de M" ya lo dice). */}
        <div aria-hidden="true" className="mt-2 h-1 overflow-hidden rounded-full bg-fondo">
          <div className="h-full rounded-full bg-primario transition-[width] duration-200" style={{ width: `${((indice + 1) / total) * 100}%` }} />
        </div>
        <h2 id={idTitulo} className="mt-3 text-base font-semibold text-texto">
          {paso.titulo}
        </h2>
        <p id={idTexto} className="mt-1 text-sm leading-relaxed text-texto">
          {paso.texto}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={cerrar} className={`inline-flex min-h-8 items-center rounded-control px-1 text-[0.8125rem] font-medium text-primario-oscuro underline underline-offset-2 hover:text-institucional ${CLASE_FOCO}`}>
            Salir del recorrido
          </button>
          <div className="ml-auto flex gap-2">
            {indice > 0 ? (
              <button type="button" onClick={() => ir(indice - 1)} className={CLASE_BOTON_COMPACTO}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Anterior
              </button>
            ) : null}
            <button type="button" onClick={() => ir(indice + 1)} className={CLASE_BOTON_COMPACTO_PRIMARIO}>
              {ultimo ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Terminar
                </>
              ) : (
                <>
                  Siguiente
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>

        {ultimo ? (
          <div className="mt-3 border-t border-borde pt-3 text-xs text-texto-secundario">
            {reiniciados ? (
              <p>Listo: cada pantalla te va a volver a ofrecer su recorrido.</p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onReiniciarTodos();
                  // El botón desaparece: el foco queda en el globo.
                  globo.current?.focus({ preventScroll: true });
                  setReiniciados(true);
                  setAnuncio("Listo: cada pantalla te va a volver a ofrecer su recorrido.");
                }}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-control px-1 font-medium text-primario-oscuro underline underline-offset-2 hover:text-institucional ${CLASE_FOCO}`}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reiniciar los recorridos de todas las pantallas
              </button>
            )}
          </div>
        ) : null}

        <p aria-live="polite" className="sr-only">
          {anuncio}
        </p>
      </div>
    </div>
  );
}
