/**
 * A dónde se vuelve después de ingresar.
 *
 * La carátula lleva un QR a `/expedientes/[numero]`: quien lo escanea sin
 * sesión pasa por el login y tiene que terminar en ESE expediente, no en su
 * bandeja. El destino viaja de la redirección del proxy a /login, de ahí a la
 * cookie del `state` y vuelve en el callback; en cada paso se vuelve a sanear.
 *
 * Sin dependencias: lo usan el proxy, páginas y Route Handlers.
 */

/** Un origen que no existe, para resolver rutas relativas y comparar. */
const ORIGEN = "https://cementeria.invalid";

/** Volver a estas rutas relanza el ingreso o da una vuelta en círculo. */
const NO_VOLVER = /^\/(?:auth|api|login|dev|sin-acceso)(?:\/|$)/;

/**
 * La ruta, si es de este sitio y tiene sentido volver a ella; si no, `null`.
 *
 * Se resuelve con `URL` y se exige el mismo origen: `//otro.sitio`,
 * `/\otro.sitio` o una barra seguida de un tabulador son direcciones absolutas
 * para el navegador aunque empiecen con barra, y aceptarlas haría del ingreso un
 * redirector abierto desde el dominio municipal. Después se resuelve OTRA vez
 * el resultado normalizado, porque `/.//evil.com` o `/%2e//evil.com` quedan en
 * este origen la primera vez pero su ruta normalizada es `//evil.com`.
 */
export function destinoSeguro(valor: string | null | undefined): string | null {
  if (!valor || !valor.startsWith("/") || valor.length > 512) return null;
  let url: URL;
  try {
    url = new URL(valor, ORIGEN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGEN || NO_VOLVER.test(url.pathname)) return null;
  const destino = url.pathname + url.search;
  if (destino.startsWith("//") || new URL(destino, ORIGEN).origin !== ORIGEN) return null;
  return destino === "/" ? null : destino;
}

/** `/login` con el destino, si hay uno que valga la pena. */
export function rutaDeLogin(volver: string | null | undefined, error?: string): string {
  const parametros = new URLSearchParams();
  if (error) parametros.set("error", error);
  const destino = destinoSeguro(volver);
  if (destino) parametros.set("volver", destino);
  const consulta = parametros.toString();
  return consulta ? `/login?${consulta}` : "/login";
}
