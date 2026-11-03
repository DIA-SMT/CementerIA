"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";

/**
 * La burbuja de Migue, que se puede arrastrar. Copiada de El Sanmiguelino
 * (DiarioDigital, src/lib/burbuja-movible.ts), donde la pidió la redacción
 * porque tapaba el botón de Guardar: se la arrastra con el mouse o el dedo a
 * donde moleste menos, y se queda ahí.
 *
 * **Dónde queda se guarda en el navegador** de quien la movió (localStorage):
 * es una comodidad de cada uno. Si el navegador no deja guardar, la burbuja
 * anda igual y vuelve a su lugar al recargar.
 *
 * **Arrastrar no es tocar.** Un toque abre a Migue; si el puntero se movió más
 * de unos píxeles, fue un arrastre y el click que llega al soltar se descarta.
 *
 * **Nunca debajo de una barra fija.** Quien tenga una barra fija al pie
 * publica su altura en `--alto-barra-inferior` (en `<html>`); en el sistema lo
 * hace el Migue interno con la barra de acciones del formulario del
 * expediente. La burbuja se apoya siempre por encima.
 */

interface Posicion {
  /** Distancia al borde derecho de la ventana, en px. */
  right: number;
  /** Distancia al borde de abajo, en px. */
  bottom: number;
}

const MARGEN = 8;
const UMBRAL_ARRASTRE = 6;

function leer(clave: string): Posicion | null {
  try {
    const crudo = window.localStorage.getItem(clave);
    if (!crudo) return null;
    const p = JSON.parse(crudo) as Partial<Posicion>;
    return typeof p.right === "number" && typeof p.bottom === "number" ? { right: p.right, bottom: p.bottom } : null;
  } catch {
    return null;
  }
}

function guardar(clave: string, p: Posicion) {
  try {
    window.localStorage.setItem(clave, JSON.stringify(p));
  } catch {
    // Sin almacenamiento la burbuja se mueve igual; solo no lo recuerda.
  }
}

/** Que la burbuja entera quede adentro de la ventana. */
function acotar(p: Posicion, ancho: number, alto: number): Posicion {
  return {
    right: Math.min(Math.max(p.right, MARGEN), window.innerWidth - ancho - MARGEN),
    bottom: Math.min(Math.max(p.bottom, MARGEN), window.innerHeight - alto - MARGEN),
  };
}

export function useBurbujaMovible(clave: string) {
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const arrastre = useRef<{ x: number; y: number; inicio: Posicion; ancho: number; alto: number; movio: boolean } | null>(null);
  const recienArrastrada = useRef(false);

  // Lo guardado se lee después de montar: en el servidor no hay navegador, y
  // leerlo antes haría que la primera pintura no coincida con la del servidor.
  useEffect(() => {
    // Un timeout y no requestAnimationFrame: una pestaña en segundo plano no
    // pinta, y la burbuja aparecería en el lugar de siempre hasta mirarla.
    const id = window.setTimeout(() => setPosicion(leer(clave)), 0);
    return () => window.clearTimeout(id);
  }, [clave]);

  // Si la ventana se achica, la burbuja no puede quedar afuera.
  useEffect(() => {
    if (!posicion) return;
    const alCambiar = () => setPosicion((p) => (p ? acotar(p, 56, 56) : p));
    window.addEventListener("resize", alCambiar);
    return () => window.removeEventListener("resize", alCambiar);
  }, [posicion]);

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const caja = e.currentTarget.getBoundingClientRect();
    arrastre.current = {
      x: e.clientX,
      y: e.clientY,
      inicio: { right: window.innerWidth - caja.right, bottom: window.innerHeight - caja.bottom },
      ancho: caja.width,
      alto: caja.height,
      movio: false,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const a = arrastre.current;
    if (!a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (!a.movio) {
      if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE) return;
      a.movio = true;
      // Recién ahora se captura el puntero: un toque quieto tiene que seguir siendo un click normal.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Un puntero que ya no existe: se sigue moviendo igual.
      }
    }
    setPosicion(acotar({ right: a.inicio.right - dx, bottom: a.inicio.bottom - dy }, a.ancho, a.alto));
  }

  function onPointerUp(e: PointerEvent<HTMLElement>) {
    const a = arrastre.current;
    arrastre.current = null;
    if (!a?.movio) return;
    recienArrastrada.current = true;
    const caja = e.currentTarget.getBoundingClientRect();
    guardar(clave, { right: window.innerWidth - caja.right, bottom: window.innerHeight - caja.bottom });
  }

  /** El click que llega al soltar un arrastre no abre a Migue. */
  function onClick(e: MouseEvent<HTMLElement>) {
    if (recienArrastrada.current) {
      recienArrastrada.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const piso = "var(--alto-barra-inferior, 0px)";
  const style: CSSProperties = posicion
    ? { right: posicion.right, bottom: `max(${posicion.bottom}px, calc(${MARGEN}px + ${piso}))`, touchAction: "none" }
    : { bottom: `calc(1rem + ${piso})`, touchAction: "none" };

  return {
    style,
    /** Si la persona la movió (para no pisar su lugar con el de siempre). */
    movida: posicion !== null,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClick },
  };
}

/** Para la ventana de Migue abierta: también por encima de la barra fija. */
export const ESTILO_SOBRE_LA_BARRA: CSSProperties = {
  bottom: "calc(1rem + var(--alto-barra-inferior, 0px))",
  maxHeight: "calc(100dvh - 2rem - var(--alto-barra-inferior, 0px))",
};
