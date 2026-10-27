"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { destinoSeguro } from "@/lib/auth/destino";
import { dejarSesion, ipDelRequest } from "@/lib/auth/emitir";
import { ingresarConClave, mensajeDeRechazo } from "@/lib/auth/ingreso-clave";
import { envioDelMismoSitio } from "@/lib/auth/red";
import { dependenciasClave, RUTA_CAMBIAR_CLAVE } from "@/lib/auth/sesion";
import { inicioPara } from "@/lib/dominio/navegacion";
import { log, resumenError } from "@/lib/log";

/**
 * El formulario de /login (login propio, 27/10/2026): CUIL o correo y
 * contraseña. Ver src/lib/auth/ingreso-clave.ts.
 *
 * Lo que devuelve vuelve al navegador: nunca la contraseña, y el error es
 * siempre el mismo para usuario inexistente, inactivo, bloqueado o contraseña
 * incorrecta (solo el tope por IP, que no dice nada de nadie, tiene el suyo).
 */

export interface EstadoIngreso {
  error: string | null;
  /** Lo que escribió en "CUIL o correo", para no hacérselo escribir de nuevo. */
  identificador: string;
}

function texto(datos: FormData, campo: string, maximo: number): string {
  const v = datos.get(campo);
  return typeof v === "string" ? v.slice(0, maximo) : "";
}

export async function accionIngresar(_anterior: EstadoIngreso, datos: FormData): Promise<EstadoIngreso> {
  const identificador = texto(datos, "identificador", 200).trim();
  // Hasta 1024: lo que pase de 128 ya no es una contraseña y se rechaza igual.
  const clave = texto(datos, "clave", 1024);
  const volver = destinoSeguro(texto(datos, "volver", 512));

  // CSRF: Next ya compara Origin con Host; esto cierra lo que Next deja pasar
  // (ver envioDelMismoSitio()).
  if (!envioDelMismoSitio(await headers())) {
    log.warn("ingreso_clave.envio_ajeno", {});
    return { error: "No pudimos validar el envío del formulario. Recargá la página y volvé a probar.", identificador };
  }
  if (!identificador || !clave) {
    return { error: "Escribí tu CUIL o correo y tu contraseña.", identificador };
  }

  let destino: string;
  try {
    const resultado = await ingresarConClave(dependenciasClave, { identificador, clave }, await ipDelRequest());
    if (!resultado.ok) {
      log.info("ingreso_clave.rechazado", { motivo: resultado.motivo, usuarioId: resultado.usuarioId, bloqueo: resultado.bloqueo });
      return { error: mensajeDeRechazo(resultado.motivo), identificador };
    }
    const { usuario } = resultado;
    if (!(await dejarSesion({ usuarioId: usuario.id, sesionVersion: usuario.sesionVersion }))) {
      throw new Error("No se pudo emitir una sesión recién iniciada");
    }
    log.info("ingreso_clave.ok", { usuarioId: usuario.id, debeCambiarClave: usuario.debeCambiarClave });
    destino = usuario.debeCambiarClave
      ? volver
        ? `${RUTA_CAMBIAR_CLAVE}?${new URLSearchParams({ volver })}`
        : RUTA_CAMBIAR_CLAVE
      : (volver ?? inicioPara(usuario));
  } catch (error) {
    log.error("ingreso_clave.error_interno", resumenError(error));
    return { error: "No pudimos completar el ingreso. Volvé a intentar; si se repite, avisale al administrador.", identificador };
  }
  // Fuera del try: redirect() tira una excepción propia de Next.
  redirect(destino);
}
