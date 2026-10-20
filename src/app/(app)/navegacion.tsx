"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ItemNavegacion } from "@/lib/dominio/navegacion";

/**
 * El menú del encabezado. Es de cliente solo para marcar la pantalla actual:
 * qué ítems ve cada uno lo decide el servidor (navegacionPara) y llega armado.
 */
export function NavegacionPrincipal({ items }: { items: readonly ItemNavegacion[] }) {
  const ruta = usePathname();

  // Gana el prefijo más largo: en /expedientes/nuevo se marca "Nuevo
  // expediente" y no también "Buscar".
  const actual = items
    .filter((item) => ruta === item.href || ruta.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Principal">
      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item) => {
          const activo = item.href === actual;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={activo ? "page" : undefined}
                className={
                  activo
                    ? "rounded px-3 py-1.5 text-sm font-medium text-slate-900 bg-slate-200"
                    : "rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }
              >
                {item.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
