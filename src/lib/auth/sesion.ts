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
import type { DependenciasClave } from "./ingreso-clave";
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

/** A donde va quien tiene una contraseña temporal: es lo único que puede usar (y Salir). */
export const RUTA_CAMBIAR_CLAVE = "/cambiar-clave";

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
 *
 * Contraseña temporal (login propio, 27/10/2026): con `debe_cambiar_clave` la
 * sesión vale, pero solo para cambiarla. `getUsuarioActual()` y
 * `exigirUsuario()` no la aceptan (la segunda lleva a /cambiar-clave), así que
 * todas las pantallas, acciones y Route Handlers que ya los usan quedan
 * cerrados sin tocarlos; /cambiar-clave y la salida usan `getSesionActual()`.
 */

/** Verifica un token y carga su usuario, aunque tenga que cambiar la contraseña. Para la salida. */
export async function sesionDesdeToken(token: string | undefined): Promise<UsuarioActual | null> {
  if (!token) return null;
  const verificacion = await verificarSesion(token, entorno().secretoSesion);
  if (!verificacion.ok) return null;
  const fila = await prisma.usuario.findUnique({
    where: { id: verificacion.sesion.usuarioId },
    select: SELECCION_USUARIO,
  });
  return usuarioDeSesion(fila, verificacion.sesion);
}

/** Como sesionDesdeToken(), pero sin el usuario que todavía tiene que cambiar la contraseña. */
export async function usuarioDesdeToken(token: string | undefined): Promise<UsuarioActual | null> {
  const usuario = await sesionDesdeToken(token);
  return usuario && !usuario.debeCambiarClave ? usuario : null;
}

/**
 * El usuario de la cookie de este request, también si tiene que cambiar la
 * contraseña. Solo para /cambiar-clave, /login y lo que tiene que funcionar
 * igual (la salida); el resto usa getUsuarioActual().
 */
export const getSesionActual = cache(async (): Promise<UsuarioActual | null> => {
  const almacen = await cookies();
  return sesionDesdeToken(almacen.get(nombreCookie(COOKIE_SESION, entorno().nodeEnv))?.value);
});

/**
 * El usuario de este request, o `null` (sin sesión, o con una contraseña
 * temporal que todavía no cambió). Con `cache()` de React la base se consulta
 * una vez por render aunque la llamen el layout y cada página. En Server
 * Actions y Route Handlers `cache()` no memoriza (no hay render), y está bien:
 * ahí se llama una vez.
 */
export const getUsuarioActual = cache(async (): Promise<UsuarioActual | null> => {
  const usuario = await getSesionActual();
  return usuario && !usuario.debeCambiarClave ? usuario : null;
});

/**
 * Como `getUsuarioActual()`, pero sin usuario redirige a /login. Si había
 * cookie, avisa que la sesión ya no vale (salió en otra PC, lo desactivaron).
 * Con una contraseña temporal, a /cambiar-clave.
 */
export async function exigirUsuario(): Promise<UsuarioActual> {
  const usuario = await getSesionActual();
  if (usuario && !usuario.debeCambiarClave) return usuario;
  if (usuario) redirect(RUTA_CAMBIAR_CLAVE);
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

/** Lo mismo para el login propio (el límite por IP es el del proceso). */
export const dependenciasClave: DependenciasClave = { leer: prisma, escribir: conActor };
