/**
 * Errores del dominio de expedientes. Las pantallas los distinguen por
 * `codigo` y muestran `message` tal cual (está escrito para el usuario). Los
 * errores de un formulario vienen además en `errores`, uno por campo, con la
 * ruta del campo (`personas[1].dni`) para mostrarlos al lado.
 *
 * Los permisos tiran `PermisoDenegado` (src/lib/dominio/permisos.ts), que no es
 * un ErrorDominio: lo distingue la pantalla para mostrar "no autorizado".
 */

export type CodigoErrorDominio =
  /** Datos inválidos: el detalle por campo está en `errores`. */
  | "validacion"
  /** No existe un expediente con ese número. */
  | "no_encontrado"
  /** La plantilla elegida no es la versión publicada (se publicó otra o se retiró). */
  | "plantilla_no_publicada"
  /** El cementerio no tiene campos de ubicación activos o tipos de monumento habilitados. */
  | "configuracion_incompleta"
  /** Bloqueo optimista: la versión que vio el usuario ya no es la actual. */
  | "conflicto_version"
  /** El estado del expediente no admite la acción (editar un archivado o anulado). */
  | "estado_no_admite"
  /** La acción exige motivo (10 caracteres o más) y no vino. */
  | "motivo_requerido"
  /** Una edición que no cambia nada. */
  | "sin_cambios"
  /** El pase no puede salir: falta lo que dice `errores` ("Faltan N", 3.3 puntos 4 a 6). */
  | "faltan_requisitos"
  /** El paso elegido no es un destino posible del pase o de la devolución. */
  | "destino_invalido"
  /** La recepción ya estaba confirmada. */
  | "ya_recibido"
  /** El archivo no es PDF, JPG ni PNG (por su contenido, no por el nombre), o está vacío. */
  | "adjunto_invalido"
  /** El archivo supera los 10 MB. */
  | "adjunto_muy_grande";

export interface ErrorCampo {
  /** Dónde: `personas[1].dni`, `ubicacion.lote`. Vacía si es del formulario entero. */
  ruta: string;
  mensaje: string;
}

export class ErrorDominio extends Error {
  constructor(
    readonly codigo: CodigoErrorDominio,
    mensaje: string,
    readonly errores: readonly ErrorCampo[] = [],
  ) {
    super(mensaje);
    this.name = "ErrorDominio";
  }
}

/** Texto fijo de la sección 3.3, punto 3. */
export const MENSAJE_CONFLICTO_VERSION = "Otro usuario modificó el expediente; recargá";

/** Largo mínimo de un motivo: el mismo que exige el CHECK de movimientos (2.8). */
export const LARGO_MINIMO_MOTIVO = 10;

export function errorValidacion(errores: readonly ErrorCampo[], mensaje = "Revisá los datos marcados"): ErrorDominio {
  return new ErrorDominio("validacion", mensaje, errores);
}

export function noEncontrado(numero: string): ErrorDominio {
  return new ErrorDominio("no_encontrado", `No existe el expediente ${numero}`);
}

/** El motivo, sin espacios de más, o `null` si es vacío. */
export function limpiarMotivo(motivo: string | null | undefined): string | null {
  const m = motivo?.replace(/\s+/g, " ").trim() ?? "";
  return m === "" ? null : m;
}

/** Una acción del flujo sobre un expediente en un estado que no la admite (3.1). */
export function estadoNoAdmite(estado: string, accion: string): ErrorDominio {
  const texto = estado === "espera_pago_dim" ? "en espera de pago en la DIM" : estado.replace("_", " ");
  return new ErrorDominio("estado_no_admite", `El expediente está ${texto}: no se puede ${accion}`);
}

/** Exige un motivo de 10 caracteres o más y lo devuelve limpio. */
export function exigirMotivo(motivo: string | null | undefined, para: string): string {
  const m = limpiarMotivo(motivo);
  if (m === null || m.length < LARGO_MINIMO_MOTIVO) {
    throw new ErrorDominio(
      "motivo_requerido",
      `${para} exige un motivo de ${LARGO_MINIMO_MOTIVO} caracteres o más`,
      [{ ruta: "motivo", mensaje: `Escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` }],
    );
  }
  return m;
}
