import { CircleAlert } from "lucide-react";
import { idDeCampo, idDeError } from "@/lib/presentacion/errores";

/**
 * Piezas de los formularios. Sin estado ni efectos: sirven igual en Server y
 * Client Components. Todo control tiene su `<label>`, y si tiene error,
 * `aria-invalid` y `aria-describedby` apuntando al mensaje.
 */

/*
 * Clases compartidas del sistema visual (docs/diseno.md): controles y botones
 * de 40 px de alto, radio de 8 px, foco con anillo azul de 2 px separado del
 * borde, hover suave y transiciones breves (globals.css las apaga con
 * prefers-reduced-motion).
 *
 * Ojo al sumarles clases: Tailwind ordena las utilidades por nombre, no por el
 * orden en el string, así que una clase agregada que choca con una de la base
 * (otro `py-`, otro `bg-`) no siempre la pisa.
 */

/** Foco visible común: anillo azul de 2 px con separación. */
export const CLASE_FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario";

export const CLASE_CONTROL =
  "w-full min-h-10 rounded-control border border-borde-control bg-white px-3 py-2 text-sm text-texto shadow-xs " +
  "placeholder:text-texto-secundario transition-colors duration-150 hover:border-texto-secundario " +
  "focus-visible:border-primario focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-not-allowed disabled:bg-fondo disabled:text-texto-secundario " +
  "aria-invalid:border-error aria-invalid:bg-error-fondo";

export const CLASE_CASILLA =
  "h-4 w-4 rounded border-borde-control accent-primario focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario";

export const CLASE_BOTON_PRIMARIO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-transparent bg-primario px-4 py-2 " +
  "text-sm font-medium text-white shadow-xs transition-colors duration-150 hover:bg-primario-oscuro " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-wait disabled:opacity-60";

export const CLASE_BOTON_SECUNDARIO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-borde-control bg-white px-4 py-2 " +
  "text-sm font-medium text-texto shadow-xs transition-colors duration-150 " +
  "hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Botón compacto (32 px) para acciones dentro de tablas, listas y filas
 * (Abrir, Confirmar, Tildar, Subir/Bajar…). Es una clase entera y no
 * `${CLASE_BOTON_SECUNDARIO} px-2 py-1`: en Tailwind 4 esas sumas no achican
 * el botón (ver la nota de arriba y docs/diseno.md). 32 px sigue por encima
 * del mínimo de 24 px de WCAG 2.5.8.
 */
export const CLASE_BOTON_COMPACTO =
  "inline-flex min-h-8 items-center justify-center gap-1 whitespace-nowrap rounded-control border border-borde-control bg-white px-2.5 py-1 " +
  "text-[0.8125rem] leading-5 font-medium text-texto shadow-xs transition-colors duration-150 " +
  "hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Compacto primario: la acción principal de una fila (Confirmar en la bandeja). Blanco sobre `primario`: 4,73:1. */
export const CLASE_BOTON_COMPACTO_PRIMARIO =
  "inline-flex min-h-8 items-center justify-center gap-1 whitespace-nowrap rounded-control border border-transparent bg-primario px-2.5 py-1 " +
  "text-[0.8125rem] leading-5 font-medium text-white shadow-xs transition-colors duration-150 hover:bg-primario-oscuro " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-wait disabled:opacity-60";

/** Compacto para lo que borra o quita: texto y borde rojos (6,57:1 sobre blanco), fondo rojo claro al pasar. */
export const CLASE_BOTON_COMPACTO_PELIGRO =
  "inline-flex min-h-8 items-center justify-center gap-1 whitespace-nowrap rounded-control border border-error bg-white px-2.5 py-1 " +
  "text-[0.8125rem] leading-5 font-medium text-error shadow-xs transition-colors duration-150 hover:bg-error-fondo " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 40 px en ámbar: una acción que todavía no se puede completar ("Dar pase ·
 * Faltan 4", "Concluir · Faltan 2"); abre la lista de lo que falta. Borde
 * `advertencia` (el amarillo no llega a 3:1 como borde sobre blanco); texto
 * `advertencia` sobre su fondo, 6,21:1 (5,95:1 en hover).
 */
export const CLASE_BOTON_ADVERTENCIA =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-advertencia bg-advertencia-fondo px-4 py-2 " +
  "text-sm font-medium text-advertencia shadow-xs transition-colors duration-150 hover:bg-amarillo/25 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Secundario de 40 px para lo que borra, anula o descarta (abre una confirmación). */
export const CLASE_BOTON_SECUNDARIO_PELIGRO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-error bg-white px-4 py-2 " +
  "text-sm font-medium text-error shadow-xs transition-colors duration-150 hover:bg-error-fondo " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Primario rojo: el botón que confirma algo irreversible (anular, purgar, descartar). Blanco sobre `error`: 6,57:1. */
export const CLASE_BOTON_PELIGRO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-transparent bg-error px-4 py-2 " +
  "text-sm font-medium text-white shadow-xs transition-colors duration-150 hover:bg-error-hover " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario " +
  "disabled:cursor-wait disabled:opacity-60";

export const CLASE_ENLACE =
  "rounded-sm text-primario-oscuro underline decoration-primario-oscuro/40 underline-offset-2 transition-colors duration-150 " +
  "hover:text-institucional hover:decoration-institucional " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario";

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
    <p id={idDeError(ruta)} className="mt-1 flex items-start gap-1 text-sm text-error">
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
      <label htmlFor={idDeCampo(ruta)} className="mb-1.5 block text-sm font-medium text-texto">
        {etiqueta}
        {obligatorio ? (
          <span className="text-error" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {ayuda ? (
        <p id={`${idDeCampo(ruta)}-ayuda`} className="mt-1 text-xs text-texto-secundario">
          {ayuda}
        </p>
      ) : null}
      <MensajeError ruta={ruta} errores={errores} />
    </div>
  );
}

/**
 * Una sección del formulario, con su título como `legend`, en una tarjeta.
 * La `legend` flota a todo el ancho para quedar adentro de la tarjeta (y no
 * cortando el borde, como la dibuja el navegador); el resto va con clear.
 *
 * `numero` muestra el orden del bloque en un círculo. Es decorativo
 * (`aria-hidden`): el nombre del grupo sigue siendo solo el título, que es como
 * lo anuncia el lector de pantalla y como lo buscan las pruebas.
 */
export function Seccion({
  titulo,
  descripcion,
  numero,
  recorrido,
  children,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  numero?: number;
  /** El ancla del paso del recorrido guiado que resalta este bloque (`data-recorrido`). */
  recorrido?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset data-recorrido={recorrido} className="tarjeta min-w-0 px-4 pb-5 pt-3.5 sm:px-5">
      <legend className="float-left mb-4 flex w-full items-center gap-2.5 border-b border-borde pb-3 text-base font-semibold text-texto">
        {numero !== undefined ? (
          <span
            aria-hidden="true"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-superficie-azul text-xs font-semibold text-primario-oscuro tabular-nums"
          >
            {numero}
          </span>
        ) : null}
        {titulo}
      </legend>
      <div className="clear-both">
        {descripcion ? <p className="-mt-1 mb-4 text-sm text-texto-secundario">{descripcion}</p> : null}
        <div className="space-y-4">{children}</div>
      </div>
    </fieldset>
  );
}
