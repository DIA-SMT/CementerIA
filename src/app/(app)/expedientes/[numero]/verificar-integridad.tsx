"use client";

import { useState, useTransition } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { CLASE_BOTON_COMPACTO } from "@/components/formulario";
import type { ResultadoIntegridad } from "@/lib/dominio/expedientes/integridad";
import type { EstadoError } from "@/lib/presentacion/errores";
import { textoIntegridad } from "@/lib/presentacion/historial";
import { verificarIntegridad } from "../acciones";

/**
 * "Verificar integridad" del historial (26/10/2026): recalcula en la base la
 * cadena de hash del expediente (`f_verificar_cadena`) y muestra el
 * resultado: íntegro, con la cantidad de movimientos y el hash final (los 16
 * primeros caracteres son la huella que va impresa en la carátula y el
 * historial), o roto, con el movimiento donde se corta. Queda registrado.
 *
 * Devuelve dos piezas hermanas (el botón y el resultado) para ir en la fila
 * del título del bloque: el resultado ocupa toda la fila de abajo.
 */
export function VerificarIntegridad({ numero }: { numero: string }) {
  const [resultado, setResultado] = useState<ResultadoIntegridad | null>(null);
  const [error, setError] = useState<EstadoError | null>(null);
  const [pendiente, iniciar] = useTransition();

  function verificar() {
    iniciar(async () => {
      const r = await verificarIntegridad(numero);
      if (r.ok) {
        setResultado(r.resultado);
        setError(null);
      } else {
        setResultado(null);
        setError(r);
      }
    });
  }

  return (
    <>
      <button type="button" onClick={verificar} disabled={pendiente} aria-busy={pendiente} className={`${CLASE_BOTON_COMPACTO} print:hidden`}>
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        {pendiente ? "Verificando…" : "Verificar integridad"}
      </button>
      {/* Región viva sin role="status": el `status` de la página es el aviso de la última acción de la ficha. */}
      <div aria-live="polite" className="basis-full empty:hidden print:hidden">
        {resultado ? (
          <div
            className={`flex items-start gap-2 rounded-control border p-3 text-sm ${
              resultado.integra ? "border-exito-borde bg-exito-fondo text-exito" : "border-error-borde bg-error-fondo text-error"
            }`}
          >
            {resultado.integra ? (
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{textoIntegridad(resultado)}</p>
              {resultado.hashFinal ? (
                <p className="text-xs text-texto">
                  Hash del último movimiento:{" "}
                  <code className="break-all font-mono">
                    <strong>{resultado.huella}</strong>
                    {resultado.hashFinal.slice(resultado.huella?.length ?? 0)}
                  </code>
                </p>
              ) : null}
              <p className="text-xs text-texto-secundario">
                {resultado.integra
                  ? "Lo resaltado es la huella que llevan la carátula y el historial impresos. Si un papel con la misma cantidad de movimientos trae otra huella, el historial cambió después de imprimirlo."
                  : "Avisá al administrador: alguien modificó el historial por fuera de la aplicación."}
              </p>
            </div>
          </div>
        ) : error ? (
          <p className="rounded-control border border-error-borde bg-error-fondo p-3 text-sm text-error">{error.mensaje}</p>
        ) : null}
      </div>
    </>
  );
}
