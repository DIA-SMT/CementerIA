import type { Metadata } from "next";
import { ContenidoCementerios } from "@/components/landing";
import { PaginaInterna } from "@/components/publico";
import { PAGINAS_PUBLICAS, tituloCementerios } from "@/lib/presentacion/sitio-publico";
import { contenidoDelSitio } from "../datos";

const PAGINA = PAGINAS_PUBLICAS["/cementerios"];

export const metadata: Metadata = { title: PAGINA.titulo, description: PAGINA.bajada };

/**
 * `/cementerios` (28/10/2026): una tarjeta por cementerio del catálogo, con lo
 * que cargó la Dirección (foto, descripción, domicilio, "Cómo llegar"). Sin
 * nada cargado, cada uno con su nombre y "Para saber más, consultá en Mesa de
 * Entradas.".
 */
export default async function PaginaCementerios() {
  const sitio = await contenidoDelSitio("/cementerios");
  const conFoto = sitio.cementerios.some((c) => c.foto);
  // "Tres cementerios municipales: dónde están, qué tienen y cómo llegar."
  const bajada = `${tituloCementerios(sitio.cementerios.length)}: dónde están, qué tienen y cómo llegar.${conFoto ? " Las fotos son ilustrativas." : ""}`;
  return (
    <PaginaInterna ruta="/cementerios" bajada={bajada}>
      <ContenidoCementerios sitio={sitio} />
    </PaginaInterna>
  );
}
