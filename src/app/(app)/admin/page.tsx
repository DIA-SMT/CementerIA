import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardList, FileCog, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { EncabezadoPagina } from "@/components/encabezado-pagina";
import { CLASE_ENLACE, CLASE_FOCO } from "@/components/formulario";
import { PantallaConRecorrido } from "@/components/recorrido/proveedor";
import { exigirPantalla } from "@/lib/auth/sesion";
import { admin } from "@/lib/dominio/admin/servidor";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { SECCIONES_ADMIN } from "@/lib/dominio/navegacion";

export const metadata: Metadata = { title: "Administración" };

const ICONOS: Record<string, LucideIcon> = {
  "/admin/plantillas": FileCog,
  "/admin/usuarios": Users,
  "/admin/catalogos": ClipboardList,
  "/admin/auditoria": ShieldCheck,
};

/**
 * Inicio de Administración (sección 5): las cuatro secciones y lo que está
 * pendiente (borradores sin publicar, años de feriados sin cerrar).
 */
export default async function PaginaAdmin() {
  const usuario = await exigirPantalla("admin");
  const [plantillas, anios] = await Promise.all([admin.catalogoPlantillas(usuario), expedientes.aniosDeFeriados()]);
  const borradores = plantillas.filter((p) => p.borrador !== null);
  const sinCerrar = anios.filter((a) => !a.cerrado).map((a) => a.anio);

  return (
    <section aria-labelledby="titulo-admin" className="space-y-5">
      <PantallaConRecorrido id="admin-inicio" />
      <EncabezadoPagina id="titulo-admin" titulo="Administración" descripcion="Plantillas de trámite, usuarios, catálogos y auditoría. Los cambios quedan registrados." />
      {borradores.length > 0 || sinCerrar.length > 0 ? (
        <div data-recorrido="admin-pendiente">
          <Aviso tono="advertencia" titulo={<span role="heading" aria-level={2}>Pendiente</span>}>
            <ul className="list-disc space-y-0.5 pl-5">
              {borradores.map((p) => (
                <li key={p.codigo}>
                  Borrador sin publicar:{" "}
                  <Link href={`/admin/plantillas/${p.codigo}/v/${p.borrador?.version}`} className={CLASE_ENLACE}>
                    {p.codigo} v{p.borrador?.version}
                  </Link>
                </li>
              ))}
              {sinCerrar.length > 0 ? (
                <li>
                  Feriados sin cerrar: {sinCerrar.join(", ")} (
                  <Link href="/admin/catalogos?pestana=feriados" className={CLASE_ENLACE}>
                    Catálogos, Feriados
                  </Link>
                  )
                </li>
              ) : null}
            </ul>
          </Aviso>
        </div>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2" data-recorrido="admin-secciones">
        {SECCIONES_ADMIN.map((s) => {
          const Icono = ICONOS[s.href] ?? FileCog;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className={`group tarjeta flex h-full items-start gap-3 px-4 py-3.5 transition duration-150 hover:border-primario hover:shadow-elevada ${CLASE_FOCO}`}
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-superficie-azul text-primario-oscuro">
                  <Icono className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-texto group-hover:text-primario-oscuro">{s.etiqueta}</span>
                  <span className="block text-sm text-texto-secundario">{s.descripcion}</span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-texto-secundario transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
