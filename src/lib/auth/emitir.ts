import "server-only";
import { cookies, headers } from "next/headers";
import { entorno } from "@/lib/entorno";
import { cookieSegura, nombreCookie, opcionesBorrado, opcionesCookie } from "./cookies";
import { ipDeSolicitud } from "./red";
import { COOKIE_SESION, COOKIE_SIN_ACCESO, emitirSesion, segundosAhora, verificarSesion, type Sesion } from "./sesion-token";

/**
 * La sesión desde una Server Action (el login propio y el cambio de
 * contraseña): la MISMA cookie `cem_sesion` que emiten el callback de Cidituc
 * y /dev/login (./sesion-token.ts), con las mismas opciones (./cookies.ts).
 */

/** El origen del request, para decidir si la cookie va `Secure` (cookieSegura()). */
async function urlDelRequest(): Promise<URL> {
  const host = (await headers()).get("host")?.trim() || "localhost";
  try {
    return new URL(`http://${host}`);
  } catch {
    return new URL("http://localhost");
  }
}

/** La IP del request, para la auditoría. */
export async function ipDelRequest(): Promise<string | null> {
  return ipDeSolicitud(await headers());
}

/**
 * Emite la sesión y deja la cookie. `inicio` es el del ingreso: un ingreso
 * nuevo empieza ahora; el cambio de contraseña conserva el original (no
 * estira las 10 horas).
 */
export async function dejarSesion(datos: { usuarioId: number; sesionVersion: number; inicio?: number }): Promise<boolean> {
  const e = entorno();
  const ahora = segundosAhora();
  const sesion = await emitirSesion({ usuarioId: datos.usuarioId, sesionVersion: datos.sesionVersion, inicio: datos.inicio ?? ahora }, e.secretoSesion, ahora);
  if (!sesion) return false;
  const segura = cookieSegura(await urlDelRequest(), e.nodeEnv);
  const almacen = await cookies();
  almacen.set(nombreCookie(COOKIE_SESION, e.nodeEnv), sesion.token, opcionesCookie(segura, sesion.maxAge));
  almacen.set(COOKIE_SIN_ACCESO, "", opcionesBorrado(segura, "/sin-acceso"));
  return true;
}

/** La sesión de la cookie de este request (firma y vencimientos), sin tocar la base. */
export async function sesionDeLaCookie(): Promise<Sesion | null> {
  const e = entorno();
  const token = (await cookies()).get(nombreCookie(COOKIE_SESION, e.nodeEnv))?.value;
  if (!token) return null;
  const verificacion = await verificarSesion(token, e.secretoSesion);
  return verificacion.ok ? verificacion.sesion : null;
}
