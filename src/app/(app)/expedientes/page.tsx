import type { Metadata } from "next";
import { EnConstruccion } from "@/components/en-construccion";
import { exigirPantalla } from "@/lib/auth/sesion";

export const metadata: Metadata = { title: "Buscar expedientes" };

export default async function PaginaExpedientes() {
  await exigirPantalla("expedientes");
  return (
    <EnConstruccion titulo="Buscar expedientes" semana={2}>
      <p>
        Acá va a estar el buscador: por número interno o municipal, titular, DNI, padrón o ubicación, con filtros por
        estado, trámite, cementerio y área.
      </p>
    </EnConstruccion>
  );
}
