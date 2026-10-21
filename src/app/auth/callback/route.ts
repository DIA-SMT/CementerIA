import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_STATE, leerFlujo, PATH_COOKIE_STATE } from "@/lib/auth/cidituc/derivador";
import { validarTokenCidituc } from "@/lib/auth/cidituc/validar";
import { cookieSegura, nombreCookie, opcionesBorrado, opcionesCookie } from "@/lib/auth/cookies";
import { destinoSeguro, rutaDeLogin } from "@/lib/auth/destino";
import type { ErrorIngreso } from "@/lib/auth/errores";
import { ingresarConCidituc } from "@/lib/auth/ingreso";
import { ipDeSolicitud } from "@/lib/auth/red";
import { dependenciasIngreso } from "@/lib/auth/sesion";
import {
  COOKIE_SESION,
  COOKIE_SIN_ACCESO,
  emitirSesion,
  firmarSinAcceso,
  segundosAhora,
  VIDA_SIN_ACCESO_SEG,
} from "@/lib/auth/sesion-token";
import { inicioPara } from "@/lib/dominio/navegacion";
import { entorno } from "@/lib/entorno";
import { log, resumenError } from "@/lib/log";
import { redirigirA } from "@/lib/auth/redireccion";

/**
 * GET /auth/callback?auth=<token>&state=<state>: la vuelta desde el derivador
 * (sección 6, "Autenticación", puntos 2 a 4).
 *
 * Todas las salidas son redirecciones 303 a una URL limpia: el token no queda
 * en la barra de direcciones, ni en el historial, ni en un Referer. El token no
 * se guarda ni se loguea en ningún paso (y next.config.ts saca esta ruta del
 * log de requests de `next dev`).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const e = entorno();
  const segura = cookieSegura(request.nextUrl, e.nodeEnv);
  const cookieState = nombreCookie(COOKIE_STATE, e.nodeEnv);
  const cookieSesion = nombreCookie(COOKIE_SESION, e.nodeEnv);
  const parametros = request.nextUrl.searchParams;
  const token = parametros.get("auth") ?? "";
  const stateDevuelto = parametros.get("state") ?? "";
  const flujo = leerFlujo(request.cookies.get(cookieState)?.value);
  const volver = destinoSeguro(flujo?.volver);

  /** Redirige y, pase lo que pase, borra la cookie del state: es de un solo uso. */
  const redirigir = (ruta: string): NextResponse => {
    const respuesta = redirigirA(ruta);
    respuesta.cookies.set(cookieState, "", opcionesBorrado(segura, PATH_COOKIE_STATE));
    respuesta.headers.set("Cache-Control", "no-store");
    respuesta.headers.set("Referrer-Policy", "no-referrer");
    return respuesta;
  };
  const fallar = (error: ErrorIngreso): NextResponse => redirigir(rutaDeLogin(volver, error));

  if (!e.cidituc.habilitado) return fallar("sin_configurar");

  /*
   * Las tres formas de fallar el state no son la misma y no se arreglan igual:
   * sin `state` en la URL, el derivador no lo devolvió (viaja en el fragmento,
   * que no llega a ningún servidor); sin cookie, pasaron los diez minutos o el
   * navegador no la mandó (un RESPALDO_CALLBACK con un dominio viejo da esto en
   * el primer intento); distintos, dos ingresos se pisaron.
   */
  if (!stateDevuelto || !flujo || flujo.state !== stateDevuelto) {
    const causa: ErrorIngreso = !stateDevuelto ? "state_ausente" : !flujo ? "state_vencido" : "state_distinto";
    // Presencias, nunca valores: identifica el caso sin registrar el nonce ni el token.
    log.warn("ingreso.state_rechazado", {
      causa,
      cookiePresente: Boolean(flujo),
      statePresente: Boolean(stateDevuelto),
      tokenPresente: Boolean(token),
    });
    return fallar(causa);
  }
  if (!token) return fallar("sin_token");

  const validacion = await validarTokenCidituc(token, { apiUrl: e.cidituc.apiUrl });
  if (!validacion.ok) return fallar(validacion.error);
  const { persona } = validacion;

  try {
    const resultado = await ingresarConCidituc(dependenciasIngreso, persona, ipDeSolicitud(request.headers));

    if (!resultado.ok) {
      log.info("ingreso.rechazado", { motivo: resultado.motivo, usuarioId: resultado.usuarioId });
      if (resultado.motivo === "cidituc_distinto") return fallar("cidituc_distinto");
      // Sin alta o inactivo: /sin-acceso le muestra su nombre y CUIL según
      // Cidituc para que pida el alta. Van firmados en una cookie, no en la URL.
      const respuesta = redirigir("/sin-acceso");
      respuesta.cookies.set(
        COOKIE_SIN_ACCESO,
        await firmarSinAcceso(
          { cuil: persona.cuil, nombre: persona.nombre, apellido: persona.apellido, motivo: resultado.motivo },
          e.secretoSesion,
        ),
        opcionesCookie(segura, VIDA_SIN_ACCESO_SEG, "/sin-acceso"),
      );
      respuesta.cookies.set(cookieSesion, "", opcionesBorrado(segura));
      return respuesta;
    }

    const { usuario } = resultado;
    const ahora = segundosAhora();
    const sesion = await emitirSesion(
      { usuarioId: usuario.id, sesionVersion: usuario.sesionVersion, inicio: ahora },
      e.secretoSesion,
      ahora,
    );
    if (!sesion) throw new Error("No se pudo emitir una sesión recién iniciada");

    log.info("ingreso.ok", { usuarioId: usuario.id, primerIngreso: resultado.primerIngreso });
    const respuesta = redirigir(volver ?? inicioPara(usuario));
    respuesta.cookies.set(cookieSesion, sesion.token, opcionesCookie(segura, sesion.maxAge));
    respuesta.cookies.set(COOKIE_SIN_ACCESO, "", opcionesBorrado(segura, "/sin-acceso"));
    return respuesta;
  } catch (error) {
    // La base caída o una carrera rara. Cidituc ya validó a la persona, así que
    // el mensaje no puede ser "Cidituc no está disponible".
    log.error("ingreso.error_interno", resumenError(error));
    return fallar("error_interno");
  }
}
