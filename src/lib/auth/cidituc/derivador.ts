/**
 * La ida al derivador (la pantalla de login municipal) y la cookie que guarda
 * el `state` mientras la persona está allá.
 *
 * Sin dependencias a propósito: lo usan el Route Handler de ingreso, el
 * callback y los tests.
 */

/**
 * Cookie del flujo: `state` + a dónde volver. httpOnly, diez minutos. En
 * producción se llama `__Host-cem_cidituc_state` (ver nombreCookie()).
 */
export const COOKIE_STATE = "cem_cidituc_state";
export const VIDA_STATE_SEG = 10 * 60;
/**
 * Solo la necesita el callback, pero va con Path=/ porque el prefijo
 * `__Host-` lo exige. Se prefirió el prefijo: un path acotado no impide que
 * otro subdominio de smt.gob.ar plante un `state` propio, y el prefijo sí.
 */
export const PATH_COOKIE_STATE = "/";

/**
 * La URL del derivador con `next` (nuestra clave) y `state`.
 *
 * El `#` no es decorativo: el derivador usa HashRouter y sin él expulsa a
 * ciudaddigital.smt.gob.ar. Por eso el fragmento lo arma el código y no la
 * variable de entorno: en un .env sin comillas el `#` abre comentario y se come
 * `/login`. Si la variable trae un fragmento, se reemplaza.
 */
export function urlDelDerivador(base: string, clave: string, state: string): string {
  const url = new URL(base);
  url.hash = `/login?${new URLSearchParams({ next: clave, state })}`;
  return url.toString();
}

const FORMA_STATE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Valor de la cookie: `<state>` o `<state>.<destino en base64url>`.
 *
 * El destino viaja en la cookie y no en la URL porque el derivador solo nos
 * devuelve `auth` y `state`. Se codifica para que `;`, `,` o espacios de una
 * ruta con búsqueda no rompan la cookie.
 */
export function codificarFlujo(state: string, volver: string | null): string {
  return volver ? `${state}.${Buffer.from(volver, "utf8").toString("base64url")}` : state;
}

export function leerFlujo(valor: string | undefined): { state: string; volver: string | null } | null {
  if (!valor) return null;
  const [state = "", destino] = valor.split(".", 2);
  if (!FORMA_STATE.test(state)) return null;
  if (!destino) return { state, volver: null };
  try {
    return { state, volver: Buffer.from(destino, "base64url").toString("utf8") };
  } catch {
    return { state, volver: null };
  }
}
