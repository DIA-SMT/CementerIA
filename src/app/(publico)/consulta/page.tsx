import type { Metadata } from "next";
import { connection } from "next/server";
import { PAGINAS_PUBLICAS } from "@/lib/presentacion/sitio-publico";
import { PaginaConsulta } from "./pagina-consulta";

/**
 * /consulta (28/10/2026): la consulta pública del trámite, sin sesión (el
 * proxy no corre acá), con el layout de las páginas públicas. Número y código
 * por POST (Server Action). `Cache-Control: no-store` y `Referrer-Policy:
 * no-referrer` salen de next.config.ts; el `<meta name="referrer">` lo repite
 * en la página por si delante hay un nginx que agrega el suyo.
 */
export const metadata: Metadata = {
  // "Consultá tu trámite · Cementerios de San Miguel de Tucumán" (el layout de (publico) pone el resto y el noindex).
  title: PAGINAS_PUBLICAS["/consulta"].titulo,
  description: "Seguimiento del trámite de la Dirección de Cementerios con el número de expediente y el código de consulta.",
  referrer: "no-referrer",
};

export default async function PaginaConsultaSinNumero() {
  // Dinámica: nada de esto se guarda en un caché compartido.
  await connection();
  return <PaginaConsulta numeroInicial="" leerFragmento={false} />;
}
