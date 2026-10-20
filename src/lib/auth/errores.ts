import type { ErrorValidacion } from "./cidituc/validar";

/**
 * Por qué alguien no entró, y qué se le dice en /login.
 *
 * Se distinguen a propósito: un "no se pudo ingresar" genérico no deja pista de
 * qué arreglar, y cada uno se arregla en un lugar distinto: el entorno, el
 * derivador, el backend municipal, el firewall, el navegador de la persona o el
 * alta en CementerIA. El código viaja en `?error=` y es lo que se lee en el
 * `Location` al diagnosticar el flujo con curl (ver la guía de Cidituc).
 */
export type ErrorIngreso =
  | ErrorValidacion
  /** La cookie del state no llegó: pasaron los diez minutos o el navegador no la mandó. */
  | "state_vencido"
  /** El derivador no devolvió el `state`. Es del lado de ellos. */
  | "state_ausente"
  /** Cookie y `state` no coinciden: dos ingresos pisándose (dos pestañas). */
  | "state_distinto"
  /** El callback llegó sin `?auth=`. */
  | "sin_token"
  /** El CUIL tiene otra cuenta de Cidituc vinculada que la que ingresó. */
  | "cidituc_distinto"
  /** La sesión venció (inactividad o 10 h) o la firma no valida. */
  | "sesion_vencida"
  /** La firma valida pero la sesión se cerró en otro lado o el usuario se desactivó. */
  | "sesion_invalida"
  /** Falló algo nuestro (la base, casi siempre). El detalle va al log. */
  | "error_interno";

const TEXTO: Record<ErrorIngreso, string> = {
  sin_configurar: "El ingreso con Cidituc todavía no está habilitado en este entorno.",
  token_invalido:
    "Cidituc no reconoció la credencial. Si ingresaste con una cuenta de vecino, usá tu cuenta de agente municipal.",
  sin_conexion: "No pudimos comunicarnos con Cidituc. Volvé a intentar en unos minutos.",
  no_disponible: "Cidituc no está respondiendo bien. Volvé a intentar en unos minutos.",
  respuesta_inesperada: "Cidituc respondió algo que no pudimos leer. Avisale al administrador.",
  cuenta_inactiva: "Tu cuenta de Cidituc figura dada de baja. Consultá en Ciudadano Digital.",
  state_vencido: "La solicitud de ingreso venció. Volvé a empezar desde el botón.",
  state_ausente: "El ingreso volvió incompleto. Probá de nuevo.",
  state_distinto: "Había otro ingreso en curso. Cerrá las demás pestañas y probá de nuevo.",
  sin_token: "El ingreso volvió sin credencial. Probá de nuevo.",
  cidituc_distinto:
    "Tu CUIL está vinculado a otra cuenta de Cidituc. Pedile al administrador que revise tu usuario.",
  sesion_vencida: "Tu sesión venció. Ingresá de nuevo.",
  sesion_invalida: "Tu sesión ya no es válida. Ingresá de nuevo.",
  error_interno: "No pudimos completar el ingreso. Volvé a intentar; si se repite, avisale al administrador.",
};

/**
 * El mensaje para lo que venga en `?error=`, o `null`. Solo códigos conocidos:
 * el valor sale de la barra de direcciones y devolverlo tal cual dejaría que un
 * enlace preparado escriba lo que quiera en la pantalla de ingreso.
 */
export function textoDeError(valor: unknown): string | null {
  if (typeof valor !== "string" || !Object.hasOwn(TEXTO, valor)) return null;
  return TEXTO[valor as ErrorIngreso];
}
