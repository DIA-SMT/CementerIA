"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { destinoSeguro } from "@/lib/auth/destino";
import { dejarSesion, ipDelRequest, sesionDeLaCookie } from "@/lib/auth/emitir";
import { cambiarClave, type CampoCambioClave } from "@/lib/auth/ingreso-clave";
import { envioDelMismoSitio } from "@/lib/auth/red";
import { dependenciasClave, getSesionActual } from "@/lib/auth/sesion";
import { inicioPara } from "@/lib/dominio/navegacion";
import { log, resumenError } from "@/lib/log";

/**
 * "Cambiar contraseña" (/cambiar-clave): obligatorio después de ingresar con
 * una contraseña temporal, y disponible siempre desde el encabezado. Ver
 * cambiarClave() en src/lib/auth/ingreso-clave.ts.
 *
 * Si sale bien, se cerraron todas las sesiones del usuario (sesion_version +
 * 1) y esta PC recibe una nueva con la versión nueva, con el mismo inicio (no
 * estira las 10 horas).
 */

export interface EstadoCambioClave {
  mensaje: string | null;
  errores: Partial<Record<CampoCambioClave, string[]>>;
}

function texto(datos: FormData, campo: string): string {
  const v = datos.get(campo);
  return typeof v === "string" ? v.slice(0, 1024) : "";
}

export async function accionCambiarClave(_anterior: EstadoCambioClave, datos: FormData): Promise<EstadoCambioClave> {
  if (!envioDelMismoSitio(await headers())) {
    log.warn("cambio_clave.envio_ajeno", {});
    return { mensaje: "No pudimos validar el envío del formulario. Recargá la página y volvé a probar.", errores: {} };
  }
  const usuario = await getSesionActual();
  const sesion = await sesionDeLaCookie();
  if (!usuario || !sesion || sesion.usuarioId !== usuario.id) redirect("/login?error=sesion_invalida");

  const volver = destinoSeguro(texto(datos, "volver"));
  // redirect() tira una excepción propia de Next: se decide adentro del try y
  // se redirige afuera.
  let destino: string;
  try {
    const r = await cambiarClave(
      dependenciasClave,
      { usuarioId: usuario.id, sesionVersion: usuario.sesionVersion },
      { actual: texto(datos, "actual"), nueva: texto(datos, "nueva"), repetida: texto(datos, "repetida") },
      await ipDelRequest(),
    );
    if (!r.ok && !r.sesionCerrada) {
      const errores: EstadoCambioClave["errores"] = {};
      for (const e of r.errores) (errores[e.ruta] ??= []).push(e.mensaje);
      return { mensaje: r.mensaje, errores };
    }
    if (!r.ok) {
      destino = "/login?error=sesion_invalida";
    } else if (!(await dejarSesion({ usuarioId: usuario.id, sesionVersion: r.sesionVersion, inicio: sesion.inicio }))) {
      // La sesión ya había llegado a sus 10 horas: la contraseña quedó cambiada y se ingresa de nuevo.
      destino = "/login?error=sesion_vencida";
    } else {
      log.info("cambio_clave.ok", { usuarioId: usuario.id, obligatorio: usuario.debeCambiarClave });
      destino = volver ?? inicioPara(usuario);
    }
  } catch (error) {
    log.error("cambio_clave.error_interno", resumenError(error));
    return { mensaje: "No pudimos cambiar la contraseña. Volvé a intentar; si se repite, avisale al administrador.", errores: {} };
  }
  redirect(destino);
}
