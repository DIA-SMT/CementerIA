/**
 * Los carteles de validación del navegador ("Please fill out this field"),
 * en castellano. El idioma del cartel nativo es el del navegador, no el de la
 * página: con esto todos los formularios dicen lo mismo en cualquier equipo.
 * Lo usa `ValidacionEnCastellano` (src/components) con `setCustomValidity`.
 */

/** Lo que hace falta de un `<input>`, `<select>` o `<textarea>`. */
export interface ControlValidable {
  tagName: string;
  type: string;
  validity: Pick<
    ValidityState,
    "valueMissing" | "typeMismatch" | "patternMismatch" | "tooShort" | "tooLong" | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput"
  >;
  value: string;
  min?: string;
  max?: string;
  minLength?: number;
  maxLength?: number;
  title?: string;
}

/** `2026-11-03` → `03/11/2026`; `2026-11-03T09:30` → `03/11/2026 09:30`; lo demás, igual. */
function legible(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(valor);
  if (!m) return valor;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}` : ""}`;
}

const ES_FECHA = new Set(["date", "datetime-local", "month", "week", "time"]);

/** El mensaje para el primer problema del control, o `null` si no tiene ninguno conocido. */
export function mensajeDeValidez(c: ControlValidable): string | null {
  const v = c.validity;
  const tipo = c.tagName.toLowerCase() === "select" ? "select" : c.type;
  const fecha = ES_FECHA.has(tipo);

  if (v.valueMissing) {
    if (tipo === "checkbox") return "Marcá esta casilla para seguir.";
    if (tipo === "radio" || tipo === "select") return "Elegí una opción.";
    if (tipo === "file") return "Elegí un archivo.";
    return fecha ? "Completá la fecha." : "Completá este campo.";
  }
  if (v.badInput) {
    if (fecha) return "La fecha está incompleta o no existe.";
    if (tipo === "number") return "Escribí un número.";
    return "El valor no es válido.";
  }
  if (v.typeMismatch) {
    if (tipo === "email") return "Escribí un correo válido, por ejemplo nombre@dominio.com.";
    if (tipo === "url") return "Escribí una dirección web completa, que empiece con https://.";
    return "El formato no es válido.";
  }
  if (v.patternMismatch) return c.title ? `Revisá el formato: ${c.title}` : "Revisá el formato de este campo.";
  if (v.tooShort) return `Escribí al menos ${c.minLength} caracteres (ahora hay ${c.value.length}).`;
  if (v.tooLong) return `Escribí como máximo ${c.maxLength} caracteres.`;
  if (v.rangeUnderflow) return fecha ? `La fecha tiene que ser del ${legible(c.min ?? "")} en adelante.` : `El valor mínimo es ${c.min}.`;
  if (v.rangeOverflow) return fecha ? `La fecha no puede ser posterior al ${legible(c.max ?? "")}.` : `El valor máximo es ${c.max}.`;
  if (v.stepMismatch) return fecha ? "Revisá la fecha o la hora." : "El valor no es válido para este campo.";
  return null;
}
