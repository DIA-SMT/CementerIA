"use client";

import { useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import { LARGO_MINIMO_MOTIVO } from "@/lib/dominio/expedientes/errores";
import type { EstadoError } from "@/lib/presentacion/errores";

/**
 * Piezas comunes de las pantallas de Administración: el envío de una Server
 * Action con su estado, el aviso de lo que se hizo y el diálogo de
 * confirmación (con motivo, si corresponde).
 */

/** Llama a una Server Action y guarda el error para mostrarlo. */
export function useAccion() {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<EstadoError | null>(null);
  function enviar<R extends { ok: true } | EstadoError>(accion: () => Promise<R>, alTerminar?: (r: Extract<R, { ok: true }>) => void) {
    setError(null);
    iniciar(async () => {
      const r = await accion();
      if (r.ok) alTerminar?.(r as Extract<R, { ok: true }>);
      else setError(r as EstadoError);
    });
  }
  return { pendiente, error, setError, enviar };
}

/** Los mensajes de error de un campo del formulario. */
export function erroresDe(error: EstadoError | null, ruta: string): string[] | undefined {
  const m = error?.errores.filter((e) => e.ruta === ruta).map((e) => e.mensaje) ?? [];
  return m.length > 0 ? m : undefined;
}

/** Lo que se acaba de hacer, anunciado al lector de pantalla (`role="status"`). */
export function AvisoHecho({ mensaje }: { mensaje: string | null }) {
  return (
    <div role="status" aria-live="polite">
      {mensaje ? (
        <p className="flex items-start gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{mensaje}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Confirmación de una acción con consecuencias (retirar, descartar,
 * desactivar, reabrir un año): qué va a pasar y, si `motivo`, el motivo, que
 * queda en la auditoría.
 */
export function DialogoConfirmar({
  titulo,
  children,
  textoBoton,
  motivo = "no",
  pendiente,
  error,
  recargar,
  onConfirmar,
  onCerrar,
}: {
  titulo: string;
  children: React.ReactNode;
  textoBoton: string;
  /** `obligatorio` exige 10 caracteres; `opcional` lo ofrece. */
  motivo?: "no" | "opcional" | "obligatorio";
  pendiente: boolean;
  error: EstadoError | null;
  recargar: string;
  onConfirmar: (motivo: string) => void;
  onCerrar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [local, setLocal] = useState<EstadoError | null>(null);
  const mostrado = local ?? error;
  const errores = erroresDe(mostrado, "motivo");
  return (
    <Dialogo titulo={titulo} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (motivo === "obligatorio" && texto.trim().length < LARGO_MINIMO_MOTIVO) {
            setLocal({ ok: false, codigo: "motivo_requerido", mensaje: "Falta el motivo", errores: [{ ruta: "motivo", mensaje: `Escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` }] });
            return;
          }
          setLocal(null);
          onConfirmar(texto);
        }}
      >
        <div className="text-sm text-slate-800">{children}</div>
        {motivo !== "no" ? (
          <Campo ruta="motivo" etiqueta={motivo === "obligatorio" ? "Motivo" : "Motivo (opcional)"} obligatorio={motivo === "obligatorio"} errores={errores} ayuda="Queda en la auditoría">
            <textarea
              {...atributosCampo("motivo", errores, "campo-motivo-ayuda")}
              rows={3}
              maxLength={2000}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              data-autofocus
              className={CLASE_CONTROL}
            />
          </Campo>
        ) : null}
        {mostrado ? <AvisoError error={mostrado} recargar={recargar} yaMostradas={["motivo"]} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO} data-autofocus={motivo === "no" ? true : undefined}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            {pendiente ? "Un momento…" : textoBoton}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
