import type { NodeEnv } from "@/lib/entorno";

/**
 * Opciones de las cookies propias. Sin dependencias de Next: las usan el proxy,
 * los Route Handlers y los tests.
 */

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `Secure` siempre, salvo http://localhost en desarrollo (sección 6, punto 4):
 * sin esa excepción el navegador descartaría la cookie y no se podría ingresar
 * con `next dev`.
 *
 * En producción va `Secure` aunque Next vea el request como http: nginx termina
 * TLS adelante y le pasa http a 127.0.0.1:3010.
 */
export function cookieSegura(url: URL, nodeEnv: NodeEnv): boolean {
  if (nodeEnv === "production") return true;
  return !(url.protocol === "http:" && HOSTS_LOCALES.has(url.hostname));
}

/**
 * El nombre real de una cookie propia. En producción lleva el prefijo
 * `__Host-`: el navegador solo la acepta si es Secure, con Path=/ y SIN
 * Domain. Así otra app municipal bajo *.smt.gob.ar no puede plantarnos una
 * cookie con `Domain=.smt.gob.ar` y el mismo nombre (una sesión propia, o un
 * `state` suyo para forzar un ingreso con su cuenta).
 *
 * Fuera de producción va sin prefijo: en http://localhost la cookie no es
 * Secure y el navegador descartaría una `__Host-`.
 *
 * cem_sin_acceso no lo lleva: está firmada (no se puede fabricar) y solo
 * muestra un aviso, así que conserva su path acotado a /sin-acceso.
 */
export function nombreCookie(base: string, nodeEnv: NodeEnv): string {
  return nodeEnv === "production" ? `__Host-${base}` : base;
}

export interface OpcionesCookie {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/**
 * httpOnly + SameSite=Lax: Lax deja que la cookie viaje en la navegación de
 * vuelta desde el derivador (otro sitio, GET de primer nivel) y la frena en un
 * POST que venga de otro sitio.
 */
export function opcionesCookie(segura: boolean, maxAge: number, path = "/"): OpcionesCookie {
  return { httpOnly: true, secure: segura, sameSite: "lax", path, maxAge };
}

/** Para borrar una cookie hay que repetir su path: si no, el navegador crea otra. */
export function opcionesBorrado(segura: boolean, path = "/"): OpcionesCookie {
  return opcionesCookie(segura, 0, path);
}
