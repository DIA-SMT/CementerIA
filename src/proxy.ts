import { NextResponse, type NextRequest } from "next/server";
import { cookieSegura, nombreCookie, opcionesBorrado, opcionesCookie } from "@/lib/auth/cookies";
import { rutaDeLogin } from "@/lib/auth/destino";
import { COOKIE_SESION, renovarSesion, segundosAhora, verificarSesion } from "@/lib/auth/sesion-token";
import { entorno } from "@/lib/entorno";

/**
 * Proxy (el middleware de Next 16): renovación deslizante de la sesión y
 * redirección a /login sin sesión válida (sección 6, "Autenticación", punto 5).
 *
 * NO es la barrera de autorización. Solo mira la firma y los vencimientos de la
 * cookie, sin tocar la base: un usuario desactivado conserva una cookie que
 * acá "vale". La barrera es `getUsuarioActual()`, que cada página, acción y
 * Route Handler vuelve a llamar. Esto existe para que la cookie se corra con la
 * actividad (60 min de inactividad, 10 h como máximo) y para no renderizar
 * páginas protegidas a quien no tiene sesión.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { nodeEnv, secretoSesion } = entorno();
  const segura = cookieSegura(request.nextUrl, nodeEnv);
  const cookieSesion = nombreCookie(COOKIE_SESION, nodeEnv);
  const token = request.cookies.get(cookieSesion)?.value;
  const ahora = segundosAhora();

  if (token) {
    const verificacion = await verificarSesion(token, secretoSesion, ahora);
    if (verificacion.ok) {
      const renovada = await renovarSesion(verificacion.sesion, secretoSesion, ahora);
      if (renovada) {
        const respuesta = NextResponse.next();
        respuesta.cookies.set(cookieSesion, renovada.token, opcionesCookie(segura, renovada.maxAge));
        return respuesta;
      }
    }
  }

  const { pathname, search } = request.nextUrl;
  // Las API responden 401: una redirección a una página HTML no le sirve a un fetch.
  const respuesta = pathname.startsWith("/api/")
    ? NextResponse.json({ error: "Sin sesión" }, { status: 401 })
    : NextResponse.redirect(
        new URL(rutaDeLogin(pathname + search, token ? "sesion_vencida" : undefined), request.url),
        // 303: si lo que llegó es un POST (una Server Action), el navegador
        // pide /login con GET en vez de repetir el POST.
        303,
      );
  // Una cookie vencida se borra: si no, el navegador la manda para siempre.
  if (token) respuesta.cookies.set(cookieSesion, "", opcionesBorrado(segura));
  return respuesta;
}

/**
 * Corre en todo salvo:
 * - estáticos (`_next/static`, `_next/image`, favicon y archivos con extensión
 *   de recurso);
 * - el ingreso: /login, /auth/* (ingreso, callback, salida), /dev/login y
 *   /sin-acceso, que son justamente para quien no tiene sesión;
 * - /api/salud, que consultan nginx y el monitoreo sin cookie;
 * - la subida de adjuntos, POST /api/expedientes/[numero]/adjuntos: el proxy no
 *   tiene que tocar ese cuerpo (hasta 10 MB, en streaming) y la ruta se
 *   autentica sola con getUsuarioActual() (sección 6, "Adjuntos").
 * - el refresco de la campana, GET /api/avisos/resumen: si pasara por acá, la
 *   pregunta automática de cada 60 s renovaría la sesión y los 60 minutos de
 *   inactividad no vencerían nunca. La ruta verifica la sesión sin renovarla.
 *
 * Cada alternativa termina en `/` o fin de ruta (`(?:/|$)`): un prefijo suelto
 * eximiría también /loginx o /dev/loginx. Va como literal porque Next lo analiza
 * en el build.
 */
export const config = {
  matcher: [
    "/((?!_next/static/|_next/image(?:/|$)|favicon\\.ico$|login(?:/|$)|auth/|dev/login(?:/|$)|sin-acceso(?:/|$)|api/salud(?:/|$)|api/expedientes/[^/]+/adjuntos(?:/|$)|api/avisos/resumen(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
