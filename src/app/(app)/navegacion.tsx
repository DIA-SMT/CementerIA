"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { ICONO_PANTALLA } from "@/components/iconos-modulos";
import { MarcaMunicipal } from "@/components/marca-municipal";
import type { ItemNavegacion } from "@/lib/dominio/navegacion";

/** Foco sobre el azul institucional: celeste (5,59:1), el primario no llega a 3:1 ahí. */
const FOCO_OSCURO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-celeste";

/**
 * La barra lateral: marca y menú principal. Es de cliente para marcar la
 * pantalla actual y para el menú colapsable: qué ítems ve cada uno lo decide
 * el servidor (navegacionPara) y llega armado.
 *
 * En escritorio (lg) es una columna fija a la izquierda. En tablet y celular es
 * una franja arriba con la marca y el botón "Menú", que despliega la lista
 * debajo (patrón disclosure: `aria-expanded`/`aria-controls`, Escape cierra y
 * devuelve el foco al botón, y se cierra solo al cambiar de pantalla).
 */
export function BarraLateral({ items, inicio }: { items: readonly ItemNavegacion[]; inicio: string }) {
  const ruta = usePathname();
  const idMenu = useId();
  const boton = useRef<HTMLButtonElement>(null);
  // El menú queda abierto "en" una ruta: al navegar a otra se cierra solo, sin un efecto.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn === ruta;

  // Gana el prefijo más largo: en /expedientes/nuevo se marca "Nuevo
  // expediente" y no también "Buscar".
  const actual = items
    .filter((item) => ruta === item.href || ruta.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside
      className="bg-institucional text-white print:hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && abierto) {
          e.preventDefault();
          setAbiertoEn(null);
          boton.current?.focus();
        }
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 lg:px-5 lg:pb-5 lg:pt-6">
        <Link href={inicio} className={`-m-1 rounded-control p-1 ${FOCO_OSCURO}`}>
          <MarcaMunicipal variante="oscura" />
        </Link>
        <button
          ref={boton}
          type="button"
          aria-expanded={abierto}
          aria-controls={idMenu}
          onClick={() => setAbiertoEn(abierto ? null : ruta)}
          className={`inline-flex min-h-10 items-center gap-2 rounded-control border border-white/25 px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-institucional-hover lg:hidden ${FOCO_OSCURO}`}
        >
          {abierto ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          Menú
        </button>
      </div>

      <nav
        id={idMenu}
        aria-label="Principal"
        className={`${abierto ? "block" : "hidden"} border-t border-white/10 px-3 pb-4 pt-3 lg:block lg:flex-1 lg:overflow-y-auto lg:border-t-0 lg:pt-1`}
      >
        <p className="px-3 pb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-institucional-texto" aria-hidden="true">
          Módulos
        </p>
        <ul className="space-y-1">
          {items.map((item) => {
            const activo = item.href === actual;
            const Icono = ICONO_PANTALLA[item.pantalla];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={activo ? "page" : undefined}
                  onClick={() => setAbiertoEn(null)}
                  className={`relative flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors duration-150 ${FOCO_OSCURO} ${
                    activo
                      ? "bg-institucional-activo font-semibold text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-amarillo"
                      : "font-medium text-institucional-texto hover:bg-institucional-hover hover:text-white"
                  }`}
                >
                  <Icono className={`h-[1.125rem] w-[1.125rem] shrink-0 ${activo ? "text-celeste" : ""}`} aria-hidden="true" />
                  {item.etiqueta}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="hidden border-t border-white/10 px-5 py-4 text-[0.6875rem] leading-relaxed text-institucional-texto lg:block">
        Uso interno · Datos protegidos por la Ley 25.326
      </p>
    </aside>
  );
}
