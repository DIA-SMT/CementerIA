import type { Metadata } from "next";
import { ContenidoRecorridos } from "@/components/landing";
import { PaginaInterna } from "@/components/publico";
import { PAGINAS_PUBLICAS } from "@/lib/presentacion/sitio-publico";
import { contenidoDelSitio } from "../datos";

const PAGINA = PAGINAS_PUBLICAS["/recorridos"];

export const metadata: Metadata = { title: PAGINA.titulo, description: PAGINA.bajada };

/**
 * `/recorridos` (28/10/2026): el primer recorrido como ficha destacada, los
 * demás debajo, las próximas fechas y "Grupos, escuelas e instituciones". Sin
 * recorridos, "Por ahora no hay recorridos programados…" con el contacto.
 */
export default async function PaginaRecorridos() {
  const sitio = await contenidoDelSitio("/recorridos");
  return (
    <PaginaInterna ruta="/recorridos">
      <ContenidoRecorridos sitio={sitio} />
    </PaginaInterna>
  );
}
