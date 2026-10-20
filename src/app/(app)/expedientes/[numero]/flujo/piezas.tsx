"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { atributosCampo, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL, MensajeError } from "@/components/formulario";
import { limitesFecha, valorFechaEfectiva, type ItemFaltante, type ModoFecha } from "@/lib/presentacion/flujo";
import type { EstadoError } from "@/lib/presentacion/errores";

/**
 * Piezas comunes de los diálogos del flujo: la fecha efectiva con su
 * precisión, el envío de una acción con su estado y la lista de "Faltan N".
 */

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

/** Llama a una Server Action del flujo y guarda el error para mostrarlo. */
export function useEnvio() {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<EstadoError | null>(null);
  function enviar<R extends { ok: true } | EstadoError>(accion: () => Promise<R>, alTerminar: (r: Extract<R, { ok: true }>) => void) {
    setError(null);
    iniciar(async () => {
      const r = await accion();
      if (r.ok) alTerminar(r as Extract<R, { ok: true }>);
      else setError(r as EstadoError);
    });
  }
  return { pendiente, error, setError, enviar };
}

/** Los mensajes de error de una ruta del formulario (`motivo`, `dato`, `fechaEfectiva`…). */
export function erroresDe(error: EstadoError | null, ruta: string): string[] | undefined {
  const m = error?.errores.filter((e) => e.ruta === ruta).map((e) => e.mensaje) ?? [];
  return m.length > 0 ? m : undefined;
}

// ---------------------------------------------------------------------------
// Fecha efectiva (12.1)
// ---------------------------------------------------------------------------

export interface EstadoFecha {
  modo: ModoFecha;
  momento: string;
  dia: string;
  limites: ReturnType<typeof limitesFecha>;
  valor: string;
  poner: (cambios: Partial<{ modo: ModoFecha; momento: string; dia: string }>) => void;
}

export function useFechaEfectiva(): EstadoFecha {
  // Los límites se toman al abrir el diálogo (el diálogo se monta al abrirse).
  const [limites] = useState(() => limitesFecha(new Date()));
  const [estado, setEstado] = useState<{ modo: ModoFecha; momento: string; dia: string }>(() => ({
    modo: "ahora",
    momento: limites.maxMomento,
    dia: limites.maxDia,
  }));
  return {
    ...estado,
    limites,
    valor: valorFechaEfectiva(estado.modo, estado.momento, estado.dia),
    poner: (cambios) => setEstado((e) => ({ ...e, ...cambios })),
  };
}

/**
 * "¿Cuándo?": ahora (por defecto), una fecha y hora, o solo el día (precisión
 * de día). De hoy a 30 días atrás; el servidor vuelve a controlar.
 */
export function CampoFecha({ fecha, error, ayuda }: { fecha: EstadoFecha; error: EstadoError | null; ayuda?: string }) {
  const id = useId();
  const errores = erroresDe(error, "fechaEfectiva");
  const opciones: Array<{ modo: ModoFecha; etiqueta: string }> = [
    { modo: "ahora", etiqueta: "Ahora" },
    { modo: "momento", etiqueta: "Otro día y hora" },
    { modo: "dia", etiqueta: "Solo el día (sin hora)" },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-slate-800">¿Cuándo?</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {opciones.map((o) => (
          <label key={o.modo} className="inline-flex items-center gap-1.5 text-sm text-slate-800">
            <input
              type="radio"
              name={`${id}-modo`}
              value={o.modo}
              checked={fecha.modo === o.modo}
              onChange={() => fecha.poner({ modo: o.modo })}
              className="h-4 w-4 accent-slate-800"
            />
            {o.etiqueta}
          </label>
        ))}
      </div>
      {fecha.modo === "momento" ? (
        <div>
          <label htmlFor={`${id}-momento`} className="sr-only">
            Día y hora
          </label>
          <input
            {...atributosCampo("fechaEfectiva", errores)}
            id={`${id}-momento`}
            type="datetime-local"
            value={fecha.momento}
            min={fecha.limites.minMomento}
            max={fecha.limites.maxMomento}
            onChange={(e) => fecha.poner({ momento: e.target.value })}
            className={`${CLASE_CONTROL} max-w-60`}
          />
        </div>
      ) : null}
      {fecha.modo === "dia" ? (
        <div>
          <label htmlFor={`${id}-dia`} className="sr-only">
            Día
          </label>
          <input
            {...atributosCampo("fechaEfectiva", errores)}
            id={`${id}-dia`}
            type="date"
            value={fecha.dia}
            min={fecha.limites.minDia}
            max={fecha.limites.maxDia}
            onChange={(e) => fecha.poner({ dia: e.target.value })}
            className={`${CLASE_CONTROL} max-w-48`}
          />
        </div>
      ) : null}
      <p className="text-xs text-slate-600">{ayuda ?? "Si se registra después de que pasó, indicá cuándo fue: hasta 30 días atrás."}</p>
      <MensajeError ruta="fechaEfectiva" errores={errores} />
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// "Faltan N" (3.3)
// ---------------------------------------------------------------------------

/** La lista exacta de lo que falta, con el acceso directo para resolver cada cosa. */
export function ListaFaltan({ items, onAcceso }: { items: readonly ItemFaltante[]; onAcceso: (item: ItemFaltante) => void }) {
  return (
    <ul className="divide-y divide-amber-200 text-sm">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span className="text-slate-900">{item.texto}</span>
          {item.accion ? (
            item.accion.acceso.tipo === "campo" ? (
              <Link href={item.accion.acceso.href} prefetch={false} className={`${CLASE_BOTON_SECUNDARIO} py-1`}>
                {item.accion.etiqueta}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <button type="button" onClick={() => onAcceso(item)} aria-haspopup="dialog" className={`${CLASE_BOTON_SECUNDARIO} py-1`}>
                {item.accion.etiqueta}
                <span className="sr-only">: {item.texto}</span>
              </button>
            )
          ) : (
            <span className="text-xs text-slate-600">{item.aviso}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
