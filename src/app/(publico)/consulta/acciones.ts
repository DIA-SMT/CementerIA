"use server";

import { headers } from "next/headers";
import { envioDelMismoSitio, ipDeSolicitud } from "@/lib/auth/red";
import { publico, type TramitePublico } from "@/lib/dominio/publico/servidor";
import { log, resumenError } from "@/lib/log";

/**
 * La consulta pública del trámite (28/10/2026): el formulario de
 * `/consulta` y `/consulta/[numero]`. Es un POST (Server Action): el número y
 * el código nunca van en la URL. La lógica está en
 * src/lib/dominio/publico/consulta.ts (límite de intentos, comparación en
 * tiempo constante, constancia).
 *
 * Lo que vuelve al navegador es solo `TramitePublico` (sin datos personales) o
 * un mensaje. El código no se devuelve nunca, ni en un error.
 */

export type EstadoConsulta =
  | { tipo: "inicial"; numero: string }
  | { tipo: "error"; numero: string; mensaje: string }
  | { tipo: "ok"; numero: string; tramite: TramitePublico };

function texto(datos: FormData, campo: string, maximo: number): string {
  const v = datos.get(campo);
  return typeof v === "string" ? v.slice(0, maximo).trim() : "";
}

export async function accionConsultar(_anterior: EstadoConsulta, datos: FormData): Promise<EstadoConsulta> {
  const numero = texto(datos, "numero", 40);
  const codigo = texto(datos, "codigo", 40);
  const h = await headers();

  // CSRF: como el login (Next ya compara Origin con Host; esto cierra lo que deja pasar).
  if (!envioDelMismoSitio(h)) {
    log.warn("consulta_publica.envio_ajeno", {});
    return { tipo: "error", numero, mensaje: "No pudimos validar el envío del formulario. Recargá la página y volvé a probar." };
  }
  if (!numero || !codigo) {
    return { tipo: "error", numero, mensaje: "Escribí el número de expediente y el código de consulta." };
  }

  try {
    const r = await publico.consultar({ numero, codigo }, ipDeSolicitud(h));
    if (!r.ok) {
      // Sin el número ni el código en el log: el motivo alcanza (el detalle queda en la base).
      log.info("consulta_publica.rechazada", { motivo: r.motivo });
      return { tipo: "error", numero, mensaje: r.mensaje };
    }
    return { tipo: "ok", numero: r.tramite.numero, tramite: r.tramite };
  } catch (error) {
    log.error("consulta_publica.error_interno", resumenError(error));
    return { tipo: "error", numero, mensaje: "No pudimos hacer la consulta. Probá de nuevo en unos minutos." };
  }
}
