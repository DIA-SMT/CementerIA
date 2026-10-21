import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, FileCog, ShieldCheck, Users, type LucideIcon } from "lucide-react";
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
      <h1 id="titulo-admin" className="text-xl font-semibold text-slate-900">
        Administración
      </h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECCIONES_ADMIN.map((s) => {
          const Icono = ICONOS[s.href] ?? FileCog;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className="flex h-full items-start gap-3 rounded border border-slate-300 bg-white px-4 py-3 hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800"
              >
                <Icono className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />
                <span>
                  <span className="block font-medium text-slate-900">{s.etiqueta}</span>
                  <span className="block text-sm text-slate-600">{s.descripcion}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {borradores.length > 0 || sinCerrar.length > 0 ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <h2 className="font-medium">Pendiente</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {borradores.map((p) => (
              <li key={p.codigo}>
                Borrador sin publicar:{" "}
                <Link href={`/admin/plantillas/${p.codigo}/v/${p.borrador?.version}`} className="underline underline-offset-2">
                  {p.codigo} v{p.borrador?.version}
                </Link>
              </li>
            ))}
            {sinCerrar.length > 0 ? (
              <li>
                Feriados sin cerrar: {sinCerrar.join(", ")} (
                <Link href="/admin/catalogos?pestana=feriados" className="underline underline-offset-2">
                  Catálogos, Feriados
                </Link>
                )
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
