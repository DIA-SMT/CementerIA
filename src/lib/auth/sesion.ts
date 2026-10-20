import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { inicioPara, puedeVerPantalla, type Pantalla } from "@/lib/dominio/navegacion";
import { entorno } from "@/lib/entorno";
import { nombreCookie } from "./cookies";
import type { DependenciasIngreso } from "./ingreso";
import { COOKIE_SESION, verificarSesion } from "./sesion-token";
import { SELECCION_USUARIO, usuarioDeSesion, type UsuarioActual } from "./usuario";

export type { UsuarioActual };
export {
  COOKIE_SESION,
  DURACION_MAXIMA_SEG,
  INACTIVIDAD_MAXIMA_SEG,
  emitirSesion,
  verificarSesion,
} from "./sesion-token";

/**
 * La sesión de verdad (sección 6, "Autorización").
 *
 * La cookie `cem_sesion` solo dice "soy el usuario N, versión V, desde tal
 * hora". Quién es, si sigue activo, su área y su rol se leen de la base en cada
 * request: así desactivar a alguien o cambiarle el rol rige en el request
 * siguiente, sin esperar a que venza la cookie.
 *
 * El proxy renueva la cookie sin tocar la base y NO es la barrera: cada página,
 * Server Action y Route Handler llama a `getUsuarioActual()` (o
 * `exigirUsuario()`) y después a `exigirPermiso()`.
 */

/** Verifica un token y carga su usuario. Para Route Handlers, que ya tienen la cookie. */
export async function usuarioDesdeToken(token: string | undefined): Promise<UsuarioActual | null> {
  if (!token) return null;
  const verificacion = await verificarSesion(token, entorno().secretoSesion);
  if (!verificacion.ok) return null;
  const fila = await prisma.usuario.findUnique({
    where: { id: verificacion.sesion.usuarioId },
    select: SELECCION_USUARIO,
  });
  return usuarioDeSesion(fila, verificacion.sesion);
}

/**
 * El usuario de este request, o `null`. Con `cache()` de React la base se
 * consulta una vez por render aunque la llamen el layout y cada página. En
 * Server Actions y Route Handlers `cache()` no memoriza (no hay render), y está
 * bien: ahí se llama una vez.
 */
export const getUsuarioActual = cache(async (): Promise<UsuarioActual | null> => {
  const almacen = await cookies();
  return usuarioDesdeToken(almacen.get(nombreCookie(COOKIE_SESION, entorno().nodeEnv))?.value);
});

/**
 * Como `getUsuarioActual()`, pero sin usuario redirige a /login. Si había
 * cookie, avisa que la sesión ya no vale (salió en otra PC, lo desactivaron).
 */
export async function exigirUsuario(): Promise<UsuarioActual> {
  const usuario = await getUsuarioActual();
  if (usuario) return usuario;
  const almacen = await cookies();
  redirect(almacen.has(nombreCookie(COOKIE_SESION, entorno().nodeEnv)) ? "/login?error=sesion_invalida" : "/login");
}

/**
 * Para las páginas: el usuario, si la pantalla es para él (columna "Roles" de
 * la sección 5). Si no, lo manda a su inicio en vez de mostrarle un error: el
 * menú no le ofrece esa pantalla, así que llegó por un enlace viejo o tipeando.
 */
export async function exigirPantalla(pantalla: Pantalla): Promise<UsuarioActual> {
  const usuario = await exigirUsuario();
  if (!puedeVerPantalla(usuario, pantalla)) redirect(inicioPara(usuario));
  return usuario;
}

/** Lecturas con el cliente global; escrituras con conActor(). */
export const dependenciasIngreso: DependenciasIngreso = { leer: prisma, escribir: conActor };
