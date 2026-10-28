import type { Metadata } from "next";
import { ContenidoHorarios } from "@/components/landing";
import { PaginaInterna } from "@/components/publico";
import { PAGINAS_PUBLICAS } from "@/lib/presentacion/sitio-publico";
import { contenidoDelSitio } from "../datos";

const PAGINA = PAGINAS_PUBLICAS["/horarios"];

export const metadata: Metadata = { title: PAGINA.titulo, description: PAGINA.bajada };

/**
 * `/horarios` (28/10/2026): los horarios de visita de cada cementerio (tabla
 * en escritorio, tarjetas en celular) y, arriba, las novedades vigentes. Sin
 * horarios cargados, "Consultá los horarios en Mesa de Entradas." con el
 * contacto.
 */
export default async function PaginaHorarios() {
  const sitio = await contenidoDelSitio("/horarios");
  return (
    <PaginaInterna ruta="/horarios">
      <ContenidoHorarios sitio={sitio} />
    </PaginaInterna>
  );
}
