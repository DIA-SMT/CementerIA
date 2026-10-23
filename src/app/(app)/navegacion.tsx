"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { ICONO_PANTALLA } from "@/components/iconos-modulos";
import { MarcaMunicipal } from "@/components/marca-municipal";
import {
  CONSULTA_BARRA_AUTO_COLAPSADA,
  cookiePreferenciaBarra,
  type PreferenciaBarra,
} from "@/lib/presentacion/barra-lateral";
import type { ItemNavegacion } from "@/lib/dominio/navegacion";

/** Foco sobre el azul institucional: celeste (5,59:1), el primario no llega a 3:1 ahí. */
const FOCO_OSCURO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-celeste";

/** Si "auto" colapsa la barra en este ancho (entre 1024 y 1279 px). En el servidor no se sabe: el CSS ya lo resolvió. */
function suscribirAncho(avisar: () => void) {
  const consulta = window.matchMedia(CONSULTA_BARRA_AUTO_COLAPSADA);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
}
const anchoQueColapsa = () => window.matchMedia(CONSULTA_BARRA_AUTO_COLAPSADA).matches;
const anchoEnServidor = () => false;

/**
 * La barra lateral: marca y menú principal. Es de cliente para marcar la
 * pantalla actual, para el menú colapsable y para la barra desplegable: qué
 * ítems ve cada uno lo decide el servidor (navegacionPara) y llega armado.
 *
 * En escritorio (lg) es una columna fija a la izquierda que se puede contraer a
 * una franja de íconos con "Contraer menú" / "Expandir menú"
 * (`aria-expanded`, `aria-controls`). Colapsada, cada ícono conserva su nombre
 * (el texto queda `sr-only`) y muestra un globo con el nombre al pasar el
 * mouse o al enfocarlo con el teclado (Escape lo oculta); el ítem activo sigue
 * marcado y la marca queda en el monograma. La preferencia va en una cookie
 * (src/lib/presentacion/barra-lateral.ts) que el layout lee en el servidor:
 * `preferencia` llega ya resuelta y la primera pintura sale como la dejó la
 * persona. Sin preferencia, el CSS la colapsa entre 1024 y 1279 px.
 *
 * En tablet y celular es una franja arriba con la marca y el botón "Menú", que
 * despliega la lista debajo (patrón disclosure: `aria-expanded`/`aria-controls`,
 * Escape cierra y devuelve el foco al botón, y se cierra solo al cambiar de
 * pantalla). Ahí la preferencia de escritorio no se aplica: la lista siempre
 * muestra los nombres.
 */
export function BarraLateral({
  items,
  inicio,
  preferencia: preferenciaInicial,
}: {
  items: readonly ItemNavegacion[];
  inicio: string;
  preferencia: PreferenciaBarra | null;
}) {
  const ruta = usePathname();
  const idBarra = useId();
  const idMenu = useId();
  const boton = useRef<HTMLButtonElement>(null);
  // El menú queda abierto "en" una ruta: al navegar a otra se cierra solo, sin un efecto.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn === ruta;
  const [preferencia, setPreferencia] = useState(preferenciaInicial);
  // Escape oculta el globo del ítem con foco o bajo el mouse hasta que se pasa a otro (WCAG 1.4.13).
  const [sinGlobo, setSinGlobo] = useState(false);
  const enAnchoQueColapsa = useSyncExternalStore(suscribirAncho, anchoQueColapsa, anchoEnServidor);
  const colapsada = preferencia === "colapsada" || (preferencia === null && enAnchoQueColapsa);

  function alternarBarra() {
    const nueva: PreferenciaBarra = colapsada ? "expandida" : "colapsada";
    setPreferencia(nueva);
    setSinGlobo(false);
    document.cookie = cookiePreferenciaBarra(nueva, window.location.protocol === "https:");
  }

  // Gana el prefijo más largo: en /expedientes/nuevo se marca "Nuevo
  // expediente" y no también "Buscar".
  const actual = items
    .filter((item) => ruta === item.href || ruta.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside
      id={idBarra}
      data-barra={preferencia ?? "auto"}
      data-sin-globo={sinGlobo ? "" : undefined}
      className="group/barra relative bg-institucional text-white print:hidden lg:sticky lg:top-0 lg:z-30 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:transition-[width] lg:duration-200 lg:ease-out barra-colapsada:w-18"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (abierto) {
          e.preventDefault();
          setAbiertoEn(null);
          boton.current?.focus();
        } else {
          setSinGlobo(true);
        }
      }}
      onFocus={() => setSinGlobo(false)}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 lg:px-5 lg:pb-4 lg:pt-6 barra-colapsada:justify-center barra-colapsada:px-0">
        <Link
          href={inicio}
          onPointerEnter={() => setSinGlobo(false)}
          className={`group/item relative -m-1 rounded-control p-1 ${FOCO_OSCURO}`}
        >
          <MarcaMunicipal variante="oscura" claseTexto="barra-colapsada:sr-only" />
          <Globo>CementerIA · inicio</Globo>
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

      {/* Solo en escritorio: contraer o expandir la barra. Arriba, junto al
          rótulo "Módulos", para que se vea sin buscarlo. */}
      <div className="hidden items-center justify-between gap-2 px-3 pb-2 lg:flex barra-colapsada:mx-3 barra-colapsada:mb-2 barra-colapsada:justify-center barra-colapsada:border-b barra-colapsada:border-white/15 barra-colapsada:px-0">
        <p
          className="px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-institucional-texto barra-colapsada:hidden"
          aria-hidden="true"
        >
          Módulos
        </p>
        <button
          type="button"
          aria-expanded={!colapsada}
          aria-controls={idBarra}
          onClick={alternarBarra}
          onPointerEnter={() => setSinGlobo(false)}
          className={`group/item relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-institucional-texto transition-colors duration-150 hover:bg-institucional-hover hover:text-white ${FOCO_OSCURO}`}
        >
          {colapsada ? <PanelLeftOpen className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" /> : <PanelLeftClose className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />}
          <span className="sr-only">{colapsada ? "Expandir menú" : "Contraer menú"}</span>
          <Globo siempre>{colapsada ? "Expandir menú" : "Contraer menú"}</Globo>
        </button>
      </div>

      <nav
        id={idMenu}
        aria-label="Principal"
        className={`${abierto ? "block" : "hidden"} border-t border-white/10 px-3 pb-4 pt-3 lg:block lg:flex-1 lg:overflow-y-auto lg:border-t-0 lg:pt-0 barra-colapsada:overflow-visible`}
      >
        <p className="px-3 pb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-institucional-texto lg:hidden" aria-hidden="true">
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
                  onPointerEnter={() => setSinGlobo(false)}
                  className={`group/item relative flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors duration-150 barra-colapsada:justify-center barra-colapsada:px-0 ${FOCO_OSCURO} ${
                    activo
                      ? "bg-institucional-activo font-semibold text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-amarillo"
                      : "font-medium text-institucional-texto hover:bg-institucional-hover hover:text-white"
                  }`}
                >
                  <Icono className={`h-[1.125rem] w-[1.125rem] shrink-0 ${activo ? "text-celeste" : ""}`} aria-hidden="true" />
                  <span className="whitespace-nowrap barra-colapsada:sr-only">{item.etiqueta}</span>
                  <Globo>{item.etiqueta}</Globo>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="hidden border-t border-white/10 px-5 py-4 text-[0.6875rem] leading-relaxed text-institucional-texto lg:block barra-colapsada:hidden">
        Uso interno · Datos protegidos por la Ley 25.326
      </p>
    </aside>
  );
}

/**
 * El globo con el nombre, a la derecha del ícono, al pasar el mouse o al
 * enfocar con el teclado. Va adentro del enlace o botón (que ya tiene ese
 * nombre: el globo es `aria-hidden`) para que se pueda pasar el mouse por
 * encima sin que desaparezca. Por defecto solo con la barra colapsada;
 * `siempre`, también expandida (el botón de contraer es solo un ícono).
 * Blanco sobre `texto` (#172B4D): 14,10:1.
 */
function Globo({ children, siempre = false }: { children: React.ReactNode; siempre?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute left-full top-1/2 z-40 hidden -translate-y-1/2 pl-3 group-data-sin-globo/barra:hidden! ${
        siempre ? "lg:group-hover/item:block lg:group-focus-visible/item:block" : "barra-colapsada:group-hover/item:block barra-colapsada:group-focus-visible/item:block"
      }`}
    >
      <span className="block whitespace-nowrap rounded-control bg-texto px-2.5 py-1.5 text-xs font-medium text-white shadow-elevada">{children}</span>
    </span>
  );
}
