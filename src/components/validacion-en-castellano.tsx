"use client";

import { useEffect } from "react";
import { mensajeDeValidez } from "@/lib/presentacion/validez";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Marca los controles a los que les pusimos el mensaje, para no pisar uno propio de la página. */
const MARCA = "validezCastellano";

function esControl(el: EventTarget | null): el is Control {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

/**
 * Pone en castellano los carteles de validación del navegador en toda la
 * aplicación (ver src/lib/presentacion/validez.ts). Va una vez, en el layout
 * raíz; no dibuja nada.
 */
export function ValidacionEnCastellano() {
  useEffect(() => {
    const alInvalidar = (ev: Event) => {
      const el = ev.target;
      if (!esControl(el)) return;
      // Un mensaje propio de la página (setCustomValidity) se respeta.
      if (el.validity.customError && el.dataset[MARCA] === undefined) return;
      el.setCustomValidity("");
      const mensaje = mensajeDeValidez(el);
      if (mensaje === null) return;
      el.setCustomValidity(mensaje);
      el.dataset[MARCA] = "";
    };
    // Al corregir, se borra para que el navegador vuelva a evaluar el campo.
    const alCambiar = (ev: Event) => {
      const el = ev.target;
      if (!esControl(el) || el.dataset[MARCA] === undefined) return;
      el.setCustomValidity("");
      delete el.dataset[MARCA];
    };
    // `invalid` no burbujea: se escucha en la captura.
    document.addEventListener("invalid", alInvalidar, true);
    document.addEventListener("input", alCambiar, true);
    document.addEventListener("change", alCambiar, true);
    return () => {
      document.removeEventListener("invalid", alInvalidar, true);
      document.removeEventListener("input", alCambiar, true);
      document.removeEventListener("change", alCambiar, true);
    };
  }, []);
  return null;
}
