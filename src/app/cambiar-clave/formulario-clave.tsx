"use client";

import { useActionState, useState } from "react";
import { KeyRound } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_CASILLA, CLASE_CONTROL } from "@/components/formulario";
import { accionCambiarClave, type EstadoCambioClave } from "./acciones";

/**
 * El formulario de /cambiar-clave: la actual (o la temporal) y la nueva dos
 * veces, con una casilla para mostrar las tres. Las reglas están a la vista
 * (las recibe en `reglas`) y la nueva las referencia con aria-describedby.
 */
export function FormularioClave({
  cuil,
  obligatorio,
  volver,
  reglas,
  largoMinimo,
}: {
  cuil: string;
  obligatorio: boolean;
  volver: string | null;
  reglas: readonly string[];
  /** El mínimo que pide el navegador antes de enviar (12 con la política estricta, 1 con la libre). */
  largoMinimo: number;
}) {
  const [estado, enviar, pendiente] = useActionState<EstadoCambioClave, FormData>(accionCambiarClave, { mensaje: null, errores: {} });
  const [visibles, setVisibles] = useState(false);
  const tipo = visibles ? "text" : "password";
  const e = estado.errores;

  return (
    <form action={enviar} className="space-y-4">
      {volver ? <input type="hidden" name="volver" value={volver} /> : null}
      {/* Para los gestores de contraseñas: de quién es la contraseña nueva (no se envía). */}
      <input type="text" autoComplete="username" value={cuil} readOnly hidden aria-hidden="true" tabIndex={-1} />

      <div role="alert">
        {estado.mensaje ? (
          <Aviso tono="error">
            <p>{estado.mensaje}</p>
          </Aviso>
        ) : null}
      </div>

      <Campo ruta="actual" etiqueta={obligatorio ? "Contraseña temporal" : "Contraseña actual"} obligatorio errores={e.actual}>
        <input
          {...atributosCampo("actual", e.actual)}
          name="actual"
          data-recorrido="clave-actual"
          type={tipo}
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={1024}
          className={CLASE_CONTROL}
        />
      </Campo>

      <Campo ruta="nueva" etiqueta="Contraseña nueva" obligatorio errores={e.nueva}>
        <input
          {...atributosCampo("nueva", e.nueva, "reglas-clave")}
          name="nueva"
          data-recorrido="clave-nueva"
          type={tipo}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={largoMinimo}
          maxLength={128}
          className={CLASE_CONTROL}
        />
      </Campo>

      <Campo ruta="repetida" etiqueta="Repetí la contraseña nueva" obligatorio errores={e.repetida}>
        <input
          {...atributosCampo("repetida", e.repetida)}
          name="repetida"
          type={tipo}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={128}
          className={CLASE_CONTROL}
        />
      </Campo>

      <label className="flex items-center gap-2 text-sm text-texto" data-recorrido="clave-mostrar">
        <input type="checkbox" checked={visibles} onChange={(ev) => setVisibles(ev.target.checked)} className={CLASE_CASILLA} />
        Mostrar las contraseñas
      </label>

      <div id="reglas-clave" data-recorrido="clave-reglas" className="rounded-control border border-borde bg-fondo px-3.5 py-3 text-sm text-texto">
        <p className="font-medium">La contraseña nueva tiene que cumplir:</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-texto-secundario">
          {reglas.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <button type="submit" disabled={pendiente} data-recorrido="clave-guardar" className={`${CLASE_BOTON_PRIMARIO} min-h-11 w-full text-[0.9375rem]`}>
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {pendiente ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
