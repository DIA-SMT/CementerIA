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
  | "sin_cambios";

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
