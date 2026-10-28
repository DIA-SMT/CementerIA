import type { Metadata } from "next";
import { connection } from "next/server";
import { canonizarNumeroInterno } from "@/lib/dominio/expedientes/numero";
import { PAGINAS_PUBLICAS } from "@/lib/presentacion/sitio-publico";
import { PaginaConsulta } from "../pagina-consulta";

/**
 * /consulta/[numero] (28/10/2026): a donde lleva el QR del comprobante,
 * `/consulta/CEM-2026-00042#K7QM3XZP`. El número viene en la ruta y completa el
 * formulario; el código viene en el fragmento, que el navegador no manda al
 * servidor: lo lee el formulario, lo saca de la barra de direcciones y
 * consulta por POST. Un número que no tiene forma de número se muestra como
 * vino (recortado): la página no dice si existe. Es la misma página que
 * /consulta (el `noindex` lo pone el layout de (publico)).
 */
export const metadata: Metadata = {
  title: PAGINAS_PUBLICAS["/consulta"].titulo,
  description: "Seguimiento del trámite de la Dirección de Cementerios con el número de expediente y el código de consulta.",
  referrer: "no-referrer",
};

export default async function PaginaConsultaConNumero(props: PageProps<"/consulta/[numero]">) {
  await connection();
  const { numero } = await props.params;
  let crudo = numero;
  try {
    crudo = decodeURIComponent(numero);
  } catch {
    // Se queda como vino.
  }
  const numeroInicial = canonizarNumeroInterno(crudo) ?? crudo.slice(0, 40);
  return <PaginaConsulta numeroInicial={numeroInicial} leerFragmento />;
}
