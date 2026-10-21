import { CircleAlert, RotateCw } from "lucide-react";
import type { EstadoError } from "@/lib/presentacion/errores";
import { CLASE_ENLACE } from "./formulario";

/**
 * El error de una acción del flujo, legible: el mensaje del dominio tal cual
 * y los errores que no van junto a un campo (`yaMostradas`). Si otro usuario
 * cambió el expediente (`conflicto_version`) o lo que se ve quedó viejo
 * (`ya_recibido`, `destino_invalido`), ofrece recargar.
 *
 * Es un `role="alert"`: el lector de pantalla lo lee al aparecer.
 */
export function AvisoError({
  error,
  recargar,
  yaMostradas = [],
}: {
  error: EstadoError;
  /** A dónde recargar (la ficha o la bandeja). */
  recargar: string;
  /** Rutas de errores que el diálogo ya muestra junto a su campo. */
  yaMostradas?: readonly string[];
}) {
  const sueltos = error.errores.filter((e) => !yaMostradas.includes(e.ruta) && e.mensaje !== error.mensaje);
  const ofrecerRecarga = ["conflicto_version", "ya_recibido", "destino_invalido", "plantilla_no_publicada"].includes(error.codigo);
  return (
    <div role="alert" className="rounded-control border border-error-borde bg-error-fondo px-3 py-2.5 text-sm text-error">
      <p className="flex items-start gap-1.5 font-medium">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{error.mensaje}</span>
      </p>
      {sueltos.length > 0 ? (
        <ul className="mt-1 list-disc pl-6">
          {sueltos.map((e, i) => (
            <li key={`${e.ruta}-${i}`}>{e.mensaje}</li>
          ))}
        </ul>
      ) : null}
      {ofrecerRecarga ? (
        <p className="mt-1">
          {/* Un <a> y no un Link: recarga la página entera, con la versión nueva. */}
          <a href={recargar} className={`${CLASE_ENLACE} inline-flex items-center gap-1 font-medium`}>
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            Recargar la página
          </a>
        </p>
      ) : null}
    </div>
  );
}
