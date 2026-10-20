import type { Metadata } from "next";
import { EnConstruccion } from "@/components/en-construccion";
import { exigirPantalla } from "@/lib/auth/sesion";

export const metadata: Metadata = { title: "Panel" };

export default async function PaginaPanel() {
  await exigirPantalla("panel");
  return (
    <EnConstruccion titulo="Panel" semana={4}>
      <p>
        Acá va a estar la vista general: conteos por estado, expedientes por área y trámite, demorados, plazos de la DIM
        y envíos sin confirmar.
      </p>
    </EnConstruccion>
  );
}
