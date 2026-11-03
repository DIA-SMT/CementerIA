import type { EstadoExpediente } from "@/lib/dominio/permisos";
import { COLOR_ESTADO, ETIQUETA_SITUACION, etiquetaEstado } from "@/lib/presentacion/textos";

/** El estado del expediente como etiqueta de color (con el texto: el color no es la única señal). */
export function EtiquetaEstado({ estado }: { estado: EstadoExpediente }) {
  return (
    <span className={`insignia ring-1 ring-inset ${COLOR_ESTADO[estado]}`}>
      {etiquetaEstado(estado)}
    </span>
  );
}

/** Una situación calculada (sin confirmar, devuelto, carga histórica…). */
export function EtiquetaSituacion({ situacion }: { situacion: string }) {
  const alerta = situacion === "plazo_vencido" || situacion === "devuelto";
  return (
    <span
      className={`insignia ring-1 ring-inset ${alerta ? "bg-error-fondo text-error ring-error-borde" : "bg-fondo text-texto ring-borde"}`}
    >
      {ETIQUETA_SITUACION[situacion] ?? situacion}
    </span>
  );
}

/**
 * "Del papel": el expediente se dio de alta como iniciado antes del sistema y
 * su ficha de papel se transcribió (expedientes/origen.ts). Es el origen: no
 * se va al terminar la carga histórica. Neutra, como las situaciones que no
 * son alertas (los mismos colores que `EtiquetaSituacion`).
 */
export function EtiquetaDelPapel() {
  return (
    <span title="Iniciado antes del sistema: su historia se cargó de la ficha de papel" className="insignia bg-fondo text-texto ring-1 ring-inset ring-borde">
      Del papel
    </span>
  );
}
