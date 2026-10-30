import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccesosYNovedades, BandaConsulta, CementeriosInicio, Cierre, Hero, Patrimonio, TramitesInicio } from "@/components/landing";
import { BarraPublica } from "@/components/publico";
import { getSesionActual, RUTA_CAMBIAR_CLAVE } from "@/lib/auth/sesion";
import { inicioPara } from "@/lib/dominio/navegacion";
import { log, resumenError } from "@/lib/log";
import { contenidoDelSitio, tramitesPublicados } from "./datos";

export const metadata: Metadata = {
  title: { absolute: "Cementerios de San Miguel de Tucumán · CementerIA · Dirección de Cementerios" },
  description:
    "Horarios de visita, recorridos por el patrimonio, trámites y seguimiento de expedientes de la Dirección de Cementerios de la Municipalidad de San Miguel de Tucumán.",
};

/**
 * `/` (28/10/2026): sin sesión, el inicio del sitio público (docs/diseno.md,
 * "Página pública"; desde el 30/10/2026, como el moodboard del kit
 * institucional): el hero, los accesos a cada página (cementerios, horarios
 * de visita, recorridos, trámites, la consulta y el contacto), las novedades
 * vigentes, el patrimonio con hasta tres próximas fechas de recorridos, los
 * trámites publicados, la banda del seguimiento en tres pasos, los
 * cementerios y el cierre con el contacto de Mesa de Entradas. Cada sección es su propia página, en esta misma
 * carpeta. Con sesión, como siempre, cada uno a su inicio (operadores a la
 * bandeja; Dirección y el admin al panel) o a cambiar la contraseña temporal;
 * salvo `?vista=publica`, la vista previa del enlace "Ver la página pública"
 * de /admin/sitio-publico.
 *
 * Server Component, sin JavaScript. El contenido es el que carga la Dirección
 * en /admin/sitio-publico; si la base no responde, la página sale igual sin
 * esos datos.
 */
export default async function Inicio(props: PageProps<"/">) {
  // La cookie, el entorno y la base: nada que prerenderizar.
  await connection();
  const { vista } = await props.searchParams;
  if (vista !== "publica") {
    const usuario = await getSesionActual().catch((error: unknown) => {
      log.error("inicio.sin_base", resumenError(error));
      return null;
    });
    if (usuario) redirect(usuario.debeCambiarClave ? RUTA_CAMBIAR_CLAVE : inicioPara(usuario));
  }

  const [contenido, tramites] = await Promise.all([contenidoDelSitio("/"), tramitesPublicados()]);

  return (
    <>
      <BarraPublica actual="/" />
      <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
        <Hero />
        <AccesosYNovedades novedades={contenido.novedades} />
        <Patrimonio fechas={contenido.fechas} />
        <TramitesInicio datos={tramites} />
        <BandaConsulta />
        <CementeriosInicio cementerios={contenido.cementerios} />
        <Cierre contacto={contenido.contacto} />
      </main>
    </>
  );
}
