import type { Metadata } from "next";
import { EnConstruccion } from "@/components/en-construccion";
import { exigirPantalla } from "@/lib/auth/sesion";

export const metadata: Metadata = { title: "Administración" };

export default async function PaginaAdmin() {
  await exigirPantalla("admin");
  return (
    <EnConstruccion titulo="Administración" semana={5}>
      <p>Acá van a estar las plantillas de trámite, los usuarios, los catálogos y la auditoría.</p>
    </EnConstruccion>
  );
}
