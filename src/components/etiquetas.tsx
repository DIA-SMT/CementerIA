import type { EstadoExpediente } from "@/lib/dominio/permisos";
import { COLOR_ESTADO, ETIQUETA_SITUACION, etiquetaEstado } from "@/lib/presentacion/textos";

/** El estado del expediente como etiqueta de color (con el texto: el color no es la única señal). */
export function EtiquetaEstado({ estado }: { estado: EstadoExpediente }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${COLOR_ESTADO[estado]}`}>
      {etiquetaEstado(estado)}
    </span>
  );
}

/** Una situación calculada (sin confirmar, devuelto, carga histórica…). */
export function EtiquetaSituacion({ situacion }: { situacion: string }) {
  const alerta = situacion === "plazo_vencido" || situacion === "devuelto";
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs ring-1 ring-inset ${
        alerta ? "bg-red-50 text-red-900 ring-red-300" : "bg-slate-50 text-slate-800 ring-slate-300"
      }`}
    >
      {ETIQUETA_SITUACION[situacion] ?? situacion}
    </span>
  );
}
