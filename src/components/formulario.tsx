import { CircleAlert } from "lucide-react";
import { idDeCampo, idDeError } from "@/lib/presentacion/errores";

/**
 * Piezas de los formularios. Sin estado ni efectos: sirven igual en Server y
 * Client Components. Todo control tiene su `<label>`, y si tiene error,
 * `aria-invalid` y `aria-describedby` apuntando al mensaje.
 */

export const CLASE_CONTROL =
  "w-full rounded border border-slate-400 bg-white px-2 py-1.5 text-sm text-slate-900 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 " +
  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600 " +
  "aria-invalid:border-red-700 aria-invalid:bg-red-50";

export const CLASE_CASILLA = "h-4 w-4 rounded border-slate-500 accent-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800";

export const CLASE_BOTON_PRIMARIO =
  "inline-flex items-center justify-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white " +
  "hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 " +
  "disabled:cursor-wait disabled:opacity-60";

export const CLASE_BOTON_SECUNDARIO =
  "inline-flex items-center justify-center gap-1.5 rounded border border-slate-400 bg-white px-3 py-1.5 text-sm text-slate-800 " +
  "hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const CLASE_ENLACE = "text-slate-900 underline underline-offset-2 hover:text-slate-600";

/** Los atributos de accesibilidad de un control según tenga o no error. */
export function atributosCampo(ruta: string, errores: readonly string[] | undefined, ayuda?: string) {
  const describe = [errores && errores.length > 0 ? idDeError(ruta) : null, ayuda ?? null].filter(Boolean).join(" ");
  return {
    id: idDeCampo(ruta),
    "aria-invalid": errores && errores.length > 0 ? (true as const) : undefined,
    "aria-describedby": describe === "" ? undefined : describe,
  };
}

export function MensajeError({ ruta, errores }: { ruta: string; errores: readonly string[] | undefined }) {
  if (!errores || errores.length === 0) return null;
  return (
    <p id={idDeError(ruta)} className="mt-1 flex items-start gap-1 text-sm text-red-800">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{errores.join(" · ")}</span>
    </p>
  );
}

/**
 * Etiqueta, control y error. `children` es el control, que tiene que llevar
 * `{...atributosCampo(ruta, errores)}` para quedar enlazado.
 */
export function Campo({
  ruta,
  etiqueta,
  errores,
  obligatorio = false,
  ayuda,
  className,
  children,
}: {
  ruta: string;
  etiqueta: string;
  errores?: readonly string[];
  obligatorio?: boolean;
  ayuda?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={idDeCampo(ruta)} className="mb-1 block text-sm font-medium text-slate-800">
        {etiqueta}
        {obligatorio ? (
          <span className="text-red-800" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {ayuda ? (
        <p id={`${idDeCampo(ruta)}-ayuda`} className="mt-1 text-xs text-slate-600">
          {ayuda}
        </p>
      ) : null}
      <MensajeError ruta={ruta} errores={errores} />
    </div>
  );
}

/** Una sección del formulario, con su título como `legend`. */
export function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded border border-slate-300 bg-white px-4 pb-4 pt-2">
      <legend className="px-1 text-base font-semibold text-slate-900">{titulo}</legend>
      {descripcion ? <p className="mb-3 text-sm text-slate-600">{descripcion}</p> : null}
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}
