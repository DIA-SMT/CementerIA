import type { Metadata } from "next";
import { EnConstruccion } from "@/components/en-construccion";
import { exigirPantalla } from "@/lib/auth/sesion";

export const metadata: Metadata = { title: "Nuevo expediente" };

/** El menú de Mesa de Entradas ya ofrece el alta: sin esto, el enlace daría 404. */
export default async function PaginaNuevoExpediente() {
  await exigirPantalla("expedientes_nuevo");
  return (
    <EnConstruccion titulo="Nuevo expediente" semana={2}>
      <p>Acá va a estar el alta, con la carátula para abrochar al expediente de papel.</p>
    </EnConstruccion>
  );
}
