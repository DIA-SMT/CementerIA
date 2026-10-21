import { NextResponse, type NextRequest } from "next/server";
import { cookieSegura, nombreCookie, opcionesBorrado } from "@/lib/auth/cookies";
import { cerrarSesion } from "@/lib/auth/ingreso";
import { ipDeSolicitud, mismoOrigen } from "@/lib/auth/red";
import { dependenciasIngreso, usuarioDesdeToken } from "@/lib/auth/sesion";
import { COOKIE_SESION, COOKIE_SIN_ACCESO } from "@/lib/auth/sesion-token";
import { entorno } from "@/lib/entorno";
import { log, resumenError } from "@/lib/log";
import { redirigirA } from "@/lib/auth/redireccion";

/**
 * POST /auth/salir (sección 6, "Autenticación", punto 6): borra la cookie,
 * incrementa `sesion_version` —lo que cierra TODAS las sesiones del usuario,
 * también las de otras PC— y registra la `salida`.
 *
 * Solo POST: un GET lo dispararía cualquier `<img src>` o un prefetch. También
 * lo usa /sin-acceso, donde no hay sesión: ahí solo borra cookies.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!mismoOrigen(request.headers)) return new NextResponse(null, { status: 403 });

  const e = entorno();
  const segura = cookieSegura(request.nextUrl, e.nodeEnv);
  const cookieSesion = nombreCookie(COOKIE_SESION, e.nodeEnv);
  const token = request.cookies.get(cookieSesion)?.value;

  if (token) {
    try {
      const usuario = await usuarioDesdeToken(token);
      if (usuario) {
        await cerrarSesion(dependenciasIngreso, usuario.id, usuario.sesionVersion, ipDeSolicitud(request.headers));
        log.info("salida.ok", { usuarioId: usuario.id });
      }
    } catch (error) {
      // La cookie se borra igual: quien apretó "Salir" tiene que quedar afuera
      // en esta PC aunque la base no responda.
      log.error("salida.error", resumenError(error));
    }
  }

  const respuesta = redirigirA("/login?salida=1");
  respuesta.cookies.set(cookieSesion, "", opcionesBorrado(segura));
  respuesta.cookies.set(COOKIE_SIN_ACCESO, "", opcionesBorrado(segura, "/sin-acceso"));
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
}
