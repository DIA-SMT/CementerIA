"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, FileCog, Globe, LayoutGrid, ShieldCheck, Users, type LucideIcon } from "lucide-react";

const ICONOS: Record<string, LucideIcon> = {
  "/admin": LayoutGrid,
  "/admin/plantillas": FileCog,
  "/admin/usuarios": Users,
  "/admin/catalogos": ClipboardList,
  "/admin/auditoria": ShieldCheck,
  "/admin/sitio-publico": Globe,
};

/**
 * El menú de Administración, dentro de la banda azul del encabezado de la
 * sección (ver layout.tsx). De cliente solo para marcar la sección actual.
 * Sobre el azul: la actual en blanco con texto institucional (13,25:1), las
 * demás en blanco sobre el velo (≥ 7:1) y el foco en blanco. `conInicio`:
 * Dirección, que entra solo al Sitio público, no tiene el Inicio del admin.
 */
export function NavegacionAdmin({ secciones, conInicio = true }: { secciones: ReadonlyArray<{ href: string; etiqueta: string }>; conInicio?: boolean }) {
  const ruta = usePathname();
  const items = conInicio ? [{ href: "/admin", etiqueta: "Inicio" }, ...secciones] : secciones;
  return (
    <nav aria-label="Administración" data-recorrido="admin-menu" className="print:hidden">
      <ul className="flex flex-wrap gap-1.5">
        {items.map((s) => {
          const actual = s.href === "/admin" ? ruta === "/admin" : ruta === s.href || ruta.startsWith(`${s.href}/`);
          const Icono = ICONOS[s.href] ?? FileCog;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={actual ? "page" : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  actual ? "bg-white text-institucional shadow-xs" : "text-white hover:bg-white/15"
                }`}
              >
                <Icono className={`h-4 w-4 ${actual ? "text-primario-oscuro" : ""}`} aria-hidden="true" />
                {s.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
