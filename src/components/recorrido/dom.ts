/**
 * Lo que el motor de recorridos necesita del DOM: encontrar el elemento de un
 * paso (`data-recorrido`) y saber si se ve. Sin React.
 */

/** ¿El elemento ocupa lugar en la pantalla? (no `display: none`, ni `hidden`, ni dentro de un `<details>` cerrado, ni de 0 × 0). */
export function seVeElemento(el: Element): boolean {
  if (!el.isConnected) return false;
  const conCheck = el as Element & { checkVisibility?: (o?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean };
  if (typeof conCheck.checkVisibility === "function" && !conCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** El primer elemento visible con ese `data-recorrido` (la bandeja tiene tabla y tarjetas: solo una se ve). */
export function buscarAncla(ancla: string): HTMLElement | null {
  const candidatos = document.querySelectorAll<HTMLElement>(`[data-recorrido="${CSS.escape(ancla)}"]`);
  for (const el of candidatos) if (seVeElemento(el)) return el;
  return null;
}

const ENFOCABLES =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/** ¿Se le puede devolver el foco? */
export function esEnfocable(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.matches(ENFOCABLES) && seVeElemento(el);
}

/** Los controles enfocables dentro de un contenedor, en orden (para que Tab no salga del globo). */
export function enfocablesDentro(contenedor: HTMLElement): HTMLElement[] {
  return [...contenedor.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((el) => seVeElemento(el));
}

/** El botón "?" del encabezado (o el de /cambiar-clave): adonde vuelve el foco si no hay otro lugar. */
export function botonDeAyuda(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>("[data-boton-recorrido]");
  return el && seVeElemento(el) ? el : null;
}

/** Celular: el globo va como hoja inferior (por debajo de `sm`, 40rem). */
export function esCelular(): boolean {
  return window.matchMedia("(width < 40rem)").matches;
}
