import type { Metadata } from "next";
import { EnConstruccion } from "@/components/en-construccion";
import { exigirPantalla } from "@/lib/auth/sesion";

export const metadata: Metadata = { title: "Bandeja" };

export default async function PaginaBandeja() {
  const usuario = await exigirPantalla("bandeja");
  return (
    <EnConstruccion titulo="Bandeja" semana={3}>
      <p>
        Acá va a estar el trabajo diario de {usuario.area?.nombre ?? "tu área"}: los expedientes por confirmar, los que
        están en el área y los que están afuera, con los días hábiles en el área de cada uno.
      </p>
    </EnConstruccion>
  );
}
