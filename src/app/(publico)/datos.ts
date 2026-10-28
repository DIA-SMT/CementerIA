import "server-only";
import { connection } from "next/server";
import { publico, type DatosLanding } from "@/lib/dominio/publico/servidor";
import type { ContenidoSitioPublico } from "@/lib/dominio/sitio";
import { sitio } from "@/lib/dominio/sitio/servidor";
import { log, resumenError } from "@/lib/log";

/**
 * Lo que leen las páginas públicas (28/10/2026), cada una lo suyo. Si la base
 * no responde, la página sale igual sin esos datos: cada sección dice lo que
 * dice cuando no hay nada (docs/api-dominio.md, 25.4), y el log lo anota con
 * la página (`publico.sitio_sin_datos`, `publico.tramites_sin_datos`).
 *
 * `connection()`: la base, en cada pedido; nada que prerenderizar ni guardar
 * en un caché compartido.
 */

/** Sin datos del sitio (la base no respondió). */
const SITIO_VACIO: ContenidoSitioPublico = { cementerios: [], hayHorarios: false, recorridos: [], fechas: [], novedades: [], contacto: null, preguntas: [] };

export async function contenidoDelSitio(pagina: string): Promise<ContenidoSitioPublico> {
  await connection();
  return sitio.contenidoPublico().catch((error: unknown) => {
    log.error("publico.sitio_sin_datos", { pagina, ...resumenError(error) });
    return SITIO_VACIO;
  });
}

/** Los trámites de las plantillas publicadas; `null` si la base no respondió ("No pudimos cargar esta información ahora"). */
export async function tramitesPublicados(): Promise<DatosLanding | null> {
  await connection();
  return publico.datosLanding().catch((error: unknown) => {
    log.error("publico.tramites_sin_datos", resumenError(error));
    return null;
  });
}
