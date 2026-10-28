"use client";

import { Moon, Sun } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * El modo claro u oscuro del sitio público (28/10/2026; docs/diseno.md,
 * "Página pública", "Modo oscuro"). Lo único con JavaScript de la barra.
 *
 * Por defecto, el del sistema (`prefers-color-scheme`): sin nada elegido, el
 * contenedor `[data-sitio-publico]` no lleva `data-tema` y lo resuelve el CSS.
 * El botón alterna y lo recuerda en localStorage; si lo elegido coincide con el
 * sistema, se borra y se vuelve a "sistema". Sin localStorage (navegación
 * privada estricta, almacenamiento bloqueado), alterna igual mientras dure la
 * página.
 *
 * ScriptTema va primero en el contenedor y pone el `data-tema` guardado antes
 * de pintar, mientras el navegador lee el HTML: sin parpadeo. El patrón es el
 * de la guía de Next ("Preventing flash before hydration"): un <script> en
 * línea, `text/plain` en el cliente (React no lo ejecuta ni avisa) y
 * `suppressHydrationWarning` en el contenedor. Sin CSP con script-src (ni
 * nginx ni next.config la ponen), no hace falta nonce.
 */

export const CLAVE_TEMA = "cementeria.sitio-publico.tema";
type Tema = "claro" | "oscuro";

const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem(${JSON.stringify(CLAVE_TEMA)});if(t==="claro"||t==="oscuro")document.currentScript.parentElement.setAttribute("data-tema",t)}catch(e){}})()`;

/** Pone el modo guardado antes de la primera pintura (solo en la carga completa). */
export function ScriptTema() {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />;
}

function contenedor(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-sitio-publico]");
}

function guardado(): Tema | null {
  try {
    const t = window.localStorage.getItem(CLAVE_TEMA);
    return t === "claro" || t === "oscuro" ? t : null;
  } catch {
    return null;
  }
}

function delSistema(): Tema {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

function temaActual(): Tema {
  const t = contenedor()?.getAttribute("data-tema");
  return t === "claro" || t === "oscuro" ? t : delSistema();
}

// El modo vive en el DOM (el atributo del contenedor) y en el sistema; React solo lo lee.
const oyentes = new Set<() => void>();
function avisar() {
  for (const o of oyentes) o();
}
function suscribir(oyente: () => void): () => void {
  const consulta = window.matchMedia("(prefers-color-scheme: dark)");
  oyentes.add(oyente);
  consulta.addEventListener("change", oyente);
  return () => {
    oyentes.delete(oyente);
    consulta.removeEventListener("change", oyente);
  };
}

function aplicar(tema: Tema | null) {
  const c = contenedor();
  if (!c) return;
  if (tema) c.setAttribute("data-tema", tema);
  else c.removeAttribute("data-tema");
  avisar();
}

/**
 * El botón de la barra: la luna en claro y el sol en oscuro (por CSS, así sale
 * bien desde la primera pintura); `aria-pressed` dice si está en oscuro.
 */
export function BotonTema({ className }: { className: string }) {
  // En el servidor no se sabe: sin aria-pressed hasta hidratar.
  const tema = useSyncExternalStore(suscribir, temaActual, () => null);

  // Lo guardado, también al llegar al sitio desde otra página de la app (el
  // script solo corre en la carga completa) y tras el remontaje de desarrollo.
  useLayoutEffect(() => {
    const t = guardado();
    if (t && contenedor()?.getAttribute("data-tema") !== t) aplicar(t);
  }, []);

  function alternar() {
    const siguiente: Tema = temaActual() === "oscuro" ? "claro" : "oscuro";
    const vuelveAlSistema = siguiente === delSistema();
    try {
      if (vuelveAlSistema) window.localStorage.removeItem(CLAVE_TEMA);
      else window.localStorage.setItem(CLAVE_TEMA, siguiente);
    } catch {
      // Sin almacenamiento: vale para esta página.
    }
    aplicar(vuelveAlSistema ? null : siguiente);
  }

  return (
    <button type="button" onClick={alternar} aria-label="Modo oscuro" aria-pressed={tema === null ? undefined : tema === "oscuro"} title="Modo oscuro" className={className}>
      <Moon className="h-[18px] w-[18px] pub-oscuro:hidden" aria-hidden="true" />
      <Sun className="hidden h-[18px] w-[18px] pub-oscuro:block" aria-hidden="true" />
    </button>
  );
}
