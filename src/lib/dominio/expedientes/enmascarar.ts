/**
 * Enmascarado del contacto (docs/propuesta-mvp.md, decisión 13 y 3.2).
 *
 * Teléfono, correo, domicilio y adjuntos se ven completos solo para quien
 * "trabaja el expediente" (área responsable, áreas por las que pasó, Mesa de
 * Entradas, Dirección y admin). El resto ve esto, que alcanza para reconocer
 * que el dato existe y para comparar con lo que dice el papel, pero no para
 * llamar ni escribir. El nombre y el DNI no se enmascaran: identifican el
 * trámite y están en la carátula.
 */

export const MASCARA = "•";

/** "0381 456-7890" → "•••• •••-••90": se ven los dos últimos dígitos y el formato. */
export function enmascararTelefono(telefono: string): string {
  const total = telefono.replace(/\D/g, "").length;
  let vistos = 0;
  return telefono.replace(/\d/g, (d) => {
    vistos += 1;
    return vistos > total - 2 ? d : MASCARA;
  });
}

/** "maria.perez@correo.com.ar" → "m•••@c•••": la inicial del usuario y del dominio. */
export function enmascararEmail(email: string): string {
  const arroba = email.indexOf("@");
  if (arroba <= 0) return MASCARA.repeat(3);
  const dominio = email.slice(arroba + 1);
  return `${email[0]}${MASCARA.repeat(3)}@${dominio[0] ?? ""}${MASCARA.repeat(3)}`;
}

/** El domicilio no se muestra en absoluto: una parte de la calle ya ubica a la persona. */
export function enmascararDomicilio(domicilio: string): string {
  return domicilio === "" ? "" : MASCARA.repeat(3);
}

export interface Contacto {
  telefono: string | null;
  telefonoWhatsapp: boolean;
  email: string | null;
  domicilio: string | null;
}

export interface ContactoMostrado extends Contacto {
  /** true si los valores están enmascarados (hace falta "Ver datos completos"). */
  enmascarado: boolean;
}

export function mostrarContacto(c: Contacto, completo: boolean): ContactoMostrado {
  if (completo) return { ...c, enmascarado: false };
  return {
    telefono: c.telefono === null ? null : enmascararTelefono(c.telefono),
    telefonoWhatsapp: c.telefonoWhatsapp,
    email: c.email === null ? null : enmascararEmail(c.email),
    domicilio: c.domicilio === null ? null : enmascararDomicilio(c.domicilio),
    enmascarado: true,
  };
}
