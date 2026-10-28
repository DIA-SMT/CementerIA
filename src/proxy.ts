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
 * - lo público (28/10/2026), las páginas de src/app/(publico)/ y nada más:
 *   "/" EXACTO, el inicio (con sesión, la página misma redirige al inicio de
 *   cada uno, como antes); /cementerios, /horarios, /recorridos, /tramites y
 *   /contacto, las páginas del sitio público; y la consulta del trámite,
 *   /consulta y /consulta/[numero], también su POST (la Server Action). Son
 *   para quien no tiene sesión: nada que renovar ni a dónde redirigir. "/" va
 *   como `$` al principio del lookahead: lo que sigue a la primera barra está
 *   vacío solo en "/" (la query no es parte de la ruta), así que /x, /bandeja y
 *   cualquier otra siguen pasando por acá. Las demás valen solo como primer
 *   segmento: /admin/recorridos o /expedientes/consulta pasan por acá. Si se
 *   suma una página pública, va también en NAVEGACION_PUBLICA
 *   (src/lib/presentacion/sitio-publico.ts): proxy.test.ts compara las dos;
 * - estáticos (`_next/static`, `_next/image`, favicon y archivos con extensión
 *   de recurso);
 * - el ingreso: /login, /auth/* (ingreso, callback, salida), /dev/login y
 *   /sin-acceso, que son justamente para quien no tiene sesión;
 * - /api/salud, que consultan nginx y el monitoreo sin cookie;
 * - la subida de adjuntos, POST /api/expedientes/[numero]/adjuntos: el proxy no
 *   tiene que tocar ese cuerpo (hasta 10 MB, en streaming) y la ruta se
 *   autentica sola con getUsuarioActual() (sección 6, "Adjuntos"). Lo mismo
 *   …/adjuntos/autorizar y …/adjuntos/confirmar (la subida directa a Supabase
 *   Storage, en Vercel), que el mismo prefijo deja afuera.
 * - las tareas programadas de Vercel Cron, /api/cron/*: no hay sesión (llama
 *   Vercel) y cada ruta exige Authorization: Bearer CRON_SECRET
 *   (src/lib/cron/autorizacion.ts).
 * - el refresco de la campana, GET /api/avisos/resumen: si pasara por acá, la
 *   pregunta automática de cada 60 s renovaría la sesión y los 60 minutos de
 *   inactividad no vencerían nunca. La ruta verifica la sesión sin renovarla.
 *
 * Cada alternativa termina en `/` o fin de ruta (`(?:/|$)`): un prefijo suelto
 * eximiría también /loginx, /dev/loginx, /consultax o /cementeriosx. Va como
 * literal porque Next lo analiza en el build.
 */
export const config = {
  matcher: [
    "/((?!$|(?:cementerios|horarios|recorridos|tramites|consulta|contacto)(?:/|$)|_next/static/|_next/image(?:/|$)|favicon\\.ico$|login(?:/|$)|auth/|dev/login(?:/|$)|sin-acceso(?:/|$)|api/salud(?:/|$)|api/expedientes/[^/]+/adjuntos(?:/|$)|api/avisos/resumen(?:/|$)|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
