"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle, LogIn, TriangleAlert } from "lucide-react";
import { CLASE_BOTON_PRIMARIO, CLASE_CONTROL, CLASE_FOCO } from "@/components/formulario";
import { accionIngresar, type EstadoIngreso } from "./acciones";

/**
 * El formulario del login propio: CUIL o correo, contraseña con "Mostrar" y
 * "Ingresar". Funciona también sin JavaScript (la Server Action recibe el
 * formulario común); con JavaScript, el error aparece sin recargar y el foco
 * vuelve a la contraseña.
 *
 * Los `name` y `autocomplete` (username, current-password) son los que
 * esperan los gestores de contraseñas.
 */
export function FormularioIngreso({ volver }: { volver: string | null }) {
  const [estado, enviar, pendiente] = useActionState<EstadoIngreso, FormData>(accionIngresar, { error: null, identificador: "" });
  const [visible, setVisible] = useState(false);
  const clave = useRef<HTMLInputElement>(null);

  // Después de un rechazo, la contraseña se borra (no se devuelve nunca) y el
  // foco va ahí para volver a escribirla.
  useEffect(() => {
    if (estado.error && clave.current) {
      clave.current.value = "";
      clave.current.focus();
    }
  }, [estado]);

  return (
    <form action={enviar} className="space-y-4">
      {volver ? <input type="hidden" name="volver" value={volver} /> : null}

      <div role="alert">
        {estado.error ? (
          <p className="flex gap-2 rounded-control border border-error-borde bg-error-fondo px-3 py-2.5 text-sm text-error">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span id="ingreso-error">{estado.error}</span>
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="ingreso-identificador" className="mb-1.5 block text-sm font-medium text-texto">
          CUIL o correo
        </label>
        <input
          id="ingreso-identificador"
          name="identificador"
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={200}
          defaultValue={estado.identificador}
          // Una key nueva con cada respuesta: así el valor por defecto vuelve
          // al que escribió (React no repone defaultValue en un input montado).
          key={`id-${estado.identificador}`}
          aria-describedby={estado.error ? "ingreso-error ingreso-identificador-ayuda" : "ingreso-identificador-ayuda"}
          aria-invalid={estado.error ? true : undefined}
          autoFocus
          className={CLASE_CONTROL}
        />
        <p id="ingreso-identificador-ayuda" className="mt-1 text-xs text-texto-secundario">
          El CUIL con o sin guiones (20-12345678-6), o tu correo.
        </p>
      </div>

      <div>
        <label htmlFor="ingreso-clave" className="mb-1.5 block text-sm font-medium text-texto">
          Contraseña
        </label>
        <div className="relative">
          <input
            ref={clave}
            id="ingreso-clave"
            name="clave"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={1024}
            aria-describedby={estado.error ? "ingreso-error" : undefined}
            aria-invalid={estado.error ? true : undefined}
            className={`${CLASE_CONTROL} pr-24`}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-controls="ingreso-clave"
            className={`absolute inset-y-1 right-1 inline-flex items-center gap-1 rounded-[6px] px-2 text-xs font-medium text-primario-oscuro hover:bg-superficie-azul ${CLASE_FOCO}`}
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {visible ? "Ocultar" : "Mostrar"}
            <span className="sr-only"> la contraseña</span>
          </button>
        </div>
      </div>

      {/* Mientras se envía: deshabilitado, "Ingresando…" y un ícono que gira (con
          prefers-reduced-motion la regla global lo deja quieto). */}
      <button type="submit" disabled={pendiente} className={`${CLASE_BOTON_PRIMARIO} min-h-11 w-full text-[0.9375rem]`}>
        {pendiente ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
        {pendiente ? "Ingresando…" : "Ingresar"}
      </button>

      <p className="text-xs leading-relaxed text-texto-secundario">
        Después de 5 intentos fallidos seguidos, el usuario se bloquea 15 minutos. Si no recordás tu contraseña, pedile a un
        administrador de CementerIA que la blanquee.
      </p>
    </form>
  );
}
