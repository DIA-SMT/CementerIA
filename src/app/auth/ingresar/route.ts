import { NextResponse, type NextRequest } from "next/server";
import {
  codificarFlujo,
  COOKIE_STATE,
  PATH_COOKIE_STATE,
  urlDelDerivador,
  VIDA_STATE_SEG,
} from "@/lib/auth/cidituc/derivador";
import { cookieSegura, nombreCookie, opcionesCookie } from "@/lib/auth/cookies";
import { destinoSeguro, rutaDeLogin } from "@/lib/auth/destino";
import { entorno } from "@/lib/entorno";

/**
 * GET /auth/ingresar: el botón "Ingresar con Cidituc" de /login apunta acá.
 *
 * Genera el `state`, lo guarda en la cookie `cem_cidituc_state` (httpOnly, diez
 * minutos) y manda al derivador con `next=<clave>&state=<state>`. Es un Route
 * Handler y no la página /login porque una página no puede escribir cookies.
 * El `state` es protección CSRF: sin él, cualquiera podría empujarle a otro un
 * token propio en el callback y dejarlo trabajando con una cuenta ajena.
 *
 * Es GET a propósito: se prueba con `curl -i -c cookies.txt` sin navegador
 * (guía de Cidituc, diagnóstico 3).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const e = entorno();
  const volver = destinoSeguro(request.nextUrl.searchParams.get("volver"));

  if (!e.cidituc.habilitado) {
    return NextResponse.redirect(new URL(rutaDeLogin(volver, "sin_configurar"), request.url), 303);
  }

  const state = crypto.randomUUID();
  const respuesta = NextResponse.redirect(urlDelDerivador(e.cidituc.derivadorUrl, e.cidituc.clave, state), 303);
  respuesta.cookies.set(
    nombreCookie(COOKIE_STATE, e.nodeEnv),
    codificarFlujo(state, volver),
    opcionesCookie(cookieSegura(request.nextUrl, e.nodeEnv), VIDA_STATE_SEG, PATH_COOKIE_STATE),
  );
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
}
