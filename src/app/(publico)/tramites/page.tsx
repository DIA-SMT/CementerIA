import type { Metadata } from "next";
import { ContenidoTramites } from "@/components/landing";
import { PaginaInterna } from "@/components/publico";
import { PAGINAS_PUBLICAS } from "@/lib/presentacion/sitio-publico";
import { tramitesPublicados } from "../datos";

const PAGINA = PAGINAS_PUBLICAS["/tramites"];

export const metadata: Metadata = { title: PAGINA.titulo, description: PAGINA.resumen };

/**
 * `/tramites` (28/10/2026): los tipos de trámite con una plantilla publicada
 * y, de cada uno, "Qué tenés que traer" (docs/api-dominio.md, 24.5). Al pie,
 * la invitación a consultar el que ya se inició.
 */
export default async function PaginaTramites() {
  const datos = await tramitesPublicados();
  return (
    <PaginaInterna ruta="/tramites">
      <ContenidoTramites datos={datos} />
    </PaginaInterna>
  );
}
