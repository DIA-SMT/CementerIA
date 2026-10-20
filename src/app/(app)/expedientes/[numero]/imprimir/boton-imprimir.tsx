"use client";

import { Printer } from "lucide-react";
import { CLASE_BOTON_PRIMARIO } from "@/components/formulario";

/** Abre el diálogo de impresión del navegador. No sale en el papel. */
export function BotonImprimir() {
  return (
    <button type="button" onClick={() => window.print()} className={`${CLASE_BOTON_PRIMARIO} print:hidden`}>
      <Printer className="h-4 w-4" aria-hidden="true" />
      Imprimir
    </button>
  );
}
