/**
 * Preferencia de la barra lateral en escritorio: expandida (íconos y nombres)
 * o colapsada (franja de íconos). Se guarda en una cookie, no en
 * localStorage, para que el layout la lea en el servidor y la primera pintura
 * ya salga como la dejó la persona (sin parpadeo). Sin "server-only": la usan
 * el layout (servidor) y la barra (cliente).
 *
 * Sin cookie (nunca eligió) vale "auto": colapsada entre 1024 y 1279 px de
 * ancho (notebooks) y expandida desde 1280 px. Eso lo resuelve el CSS (la
 * variante `barra-colapsada` de globals.css), así que tampoco parpadea.
 */

export const COOKIE_BARRA = "cementeria_barra";

export type PreferenciaBarra = "expandida" | "colapsada";

/** Lo que se pone en `data-barra`: la preferencia o "auto". */
export type EstadoBarra = PreferenciaBarra | "auto";

/** Un año: es una preferencia de presentación, no un dato de la sesión. */
export const DURACION_COOKIE_BARRA = 60 * 60 * 24 * 365;

/** La consulta del ancho donde "auto" colapsa la barra (la misma que la variante de globals.css). */
export const CONSULTA_BARRA_AUTO_COLAPSADA = "(width >= 64rem) and (width < 80rem)";

/** El valor de la cookie, validado: cualquier otra cosa es "nunca eligió". */
export function leerPreferenciaBarra(valor: string | undefined): PreferenciaBarra | null {
  return valor === "expandida" || valor === "colapsada" ? valor : null;
}

/** La cookie que guarda la preferencia (para `document.cookie`). */
export function cookiePreferenciaBarra(preferencia: PreferenciaBarra, segura: boolean): string {
  return `${COOKIE_BARRA}=${preferencia}; Path=/; Max-Age=${DURACION_COOKIE_BARRA}; SameSite=Lax${segura ? "; Secure" : ""}`;
}
