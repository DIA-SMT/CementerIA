import type { Metadata } from "next";
import { ContenidoContacto } from "@/components/landing";
import { PaginaInterna } from "@/components/publico";
import { PAGINAS_PUBLICAS } from "@/lib/presentacion/sitio-publico";
import { contenidoDelSitio } from "../datos";

const PAGINA = PAGINAS_PUBLICAS["/contacto"];

export const metadata: Metadata = { title: PAGINA.titulo, description: PAGINA.bajada };

/**
 * `/contacto` (28/10/2026): Mesa de Entradas (lo que cargó la Dirección:
 * domicilio, horario, teléfono, correo y "Cómo llegar") y las preguntas
 * frecuentes en un acordeón. Sin datos, la tarjeta con su texto; sin
 * preguntas, sin acordeón.
 */
export default async function PaginaContacto() {
  const sitio = await contenidoDelSitio("/contacto");
  const bajada = sitio.preguntas.length > 0 ? "Dónde y cuándo atiende Mesa de Entradas de la Dirección de Cementerios, y las respuestas a las preguntas más frecuentes." : undefined;
  return (
    <PaginaInterna ruta="/contacto" bajada={bajada}>
      <ContenidoContacto sitio={sitio} />
    </PaginaInterna>
  );
}
