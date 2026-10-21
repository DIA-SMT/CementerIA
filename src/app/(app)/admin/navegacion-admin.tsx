"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** El menú de Administración. De cliente solo para marcar la sección actual. */
export function NavegacionAdmin({ secciones }: { secciones: ReadonlyArray<{ href: string; etiqueta: string }> }) {
  const ruta = usePathname();
  return (
    <nav aria-label="Administración" className="print:hidden">
      <ul className="flex flex-wrap gap-1 border-b border-slate-300">
        <li>
          <Link
            href="/admin"
            aria-current={ruta === "/admin" ? "page" : undefined}
            className={`-mb-px inline-flex rounded-t border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 ${
              ruta === "/admin" ? "border-slate-300 border-b-white bg-white font-medium text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            Inicio
          </Link>
        </li>
        {secciones.map((s) => {
          const actual = ruta === s.href || ruta.startsWith(`${s.href}/`);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={actual ? "page" : undefined}
                className={`-mb-px inline-flex rounded-t border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 ${
                  actual ? "border-slate-300 border-b-white bg-white font-medium text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {s.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
