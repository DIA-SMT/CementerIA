import { ArrowRight, Clock3, FileText, Landmark, LogIn, Map as IconoMapa, Menu, Phone, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { LogoMunicipal, Wordmark } from "@/components/marca-municipal";
import { BotonTema } from "@/components/tema-publico";
import { INVITACIONES, NAVEGACION_PUBLICA, PAGINAS_PUBLICAS, type RutaInterna, type RutaPublica } from "@/lib/presentacion/sitio-publico";

/**
 * Las piezas de las páginas públicas (docs/diseno.md, "Página pública"): la
 * barra, el encabezado de las páginas internas (una banda con foto, las migas
 * y el `h1`), las invitaciones al pie de cada una, el pie y "Saltar al
 * contenido". Sin sesión, sin barra lateral; el único JavaScript es el botón
 * del modo (src/components/tema-publico.tsx).
 *
 * Desde el kit institucional (30/10/2026) siguen el moodboard aprobado: la
 * barra y el pie en azul institucional con el logo oficial (que va solo sobre
 * azul: src/components/marca-municipal.tsx), y el contenido sobre superficies
 * lisas (`pub-fondo`, `pub-seccion`). Claro y oscuro con los tokens `pub-*`
 * (src/app/globals.css): cada clase sirve para los dos modos.
 */

/** Foco sobre el azul institucional y sobre las fotos con velo: blanco (más de 6:1 contra el velo). */
export const FOCO_OSCURO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
/** Foco sobre las superficies del sitio: azul en claro, celeste en oscuro. */
export const FOCO_PUBLICO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-foco";
/** El ancho de todas las páginas públicas. */
export const CONTENEDOR_PUBLICO = "mx-auto w-full max-w-6xl px-4 sm:px-6";

/** El ícono de cada página: en la barra no, en los accesos del inicio y en las invitaciones. */
export const ICONOS_PAGINAS: Readonly<Record<RutaInterna, LucideIcon>> = {
  "/cementerios": Landmark,
  "/horarios": Clock3,
  "/recorridos": IconoMapa,
  "/tramites": FileText,
  "/consulta": Search,
  "/contacto": Phone,
};

/** Una foto del kit (public/assets/cementeria): el original y, si hay, su versión de 960 px. */
export interface FotoKit {
  src: string;
  chica?: string;
  ancho: number;
  alto: number;
  /** `object-position`, para que el velo no tape lo que importa de la foto. */
  posicion: string;
}

const FOTO = (nombre: string, conChica: boolean, ancho = 1672, alto = 941, posicion = "50% 50%"): FotoKit => ({
  src: `/assets/cementeria/${nombre}.webp`,
  chica: conChica ? `/assets/cementeria/${nombre}-960.webp` : undefined,
  ancho,
  alto,
  posicion,
});

/**
 * La foto de la banda de cada página interna: imágenes conceptuales del kit
 * (generadas con IA, no de un cementerio real), decorativas (`alt=""`) y bajo
 * el velo. Ninguna de las que traen interfaces o mapas dibujados.
 */
const FOTO_BANDA: Readonly<Record<RutaInterna, FotoKit>> = {
  "/cementerios": FOTO("banner-patrimonio", true, 1672, 941, "50% 45%"),
  "/horarios": FOTO("feature-ambiental", true, 1672, 941, "50% 60%"),
  "/recorridos": FOTO("feature-recorridos", false, 1672, 941, "40% 70%"),
  "/tramites": FOTO("hero-dashboard", true, 1672, 941, "50% 55%"),
  "/consulta": FOTO("hero-landing", true, 1916, 821, "70% 60%"),
  "/contacto": FOTO("login-patrimonio", true, 1672, 941, "50% 50%"),
};

/**
 * Una foto decorativa que cubre su contenedor (que tiene que ser `relative`).
 * `prioridad`: es la imagen principal de la página (LCP): carga ya y con
 * prioridad alta; si no, perezosa.
 */
export function FotoDeFondo({ foto, sizes, prioridad = false, className = "" }: { foto: FotoKit; sizes: string; prioridad?: boolean; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/assets.
    <img
      src={foto.chica ?? foto.src}
      srcSet={foto.chica ? `${foto.chica} 960w, ${foto.src} ${foto.ancho}w` : undefined}
      sizes={foto.chica ? sizes : undefined}
      width={foto.ancho}
      height={foto.alto}
      alt=""
      loading={prioridad ? "eager" : "lazy"}
      fetchPriority={prioridad ? "high" : undefined}
      decoding="async"
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
      style={{ objectPosition: foto.posicion }}
    />
  );
}

/** "Saltar al contenido": el primer foco de la página, visible solo con el teclado. */
export function SaltarAlContenido() {
  return (
    <a
      href="#contenido"
      className="sr-only rounded-control bg-white px-3 py-2 text-sm font-medium text-institucional focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario"
    >
      Saltar al contenido
    </a>
  );
}

const CLASE_ENLACE_BARRA = `whitespace-nowrap rounded-control px-2.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-white/10 hover:text-white ${FOCO_OSCURO}`;
/** La página actual: blanca, en negrita, con fondo y el subrayado amarillo. */
const ENLACE_ACTUAL = "rounded-b-none bg-white/12 font-semibold text-white shadow-[inset_0_-2px_0_var(--color-amarillo)]";
/** Los botones chicos de la barra (el modo, el menú): borde claro sobre el azul. */
const BOTON_BARRA = `min-h-10 items-center gap-2 rounded-control border border-white/35 text-sm font-semibold text-white transition-colors duration-150 hover:bg-white/10 ${FOCO_OSCURO}`;

function claseEnlaceBarra(actual: boolean, destacada: boolean): string {
  if (actual) return `${CLASE_ENLACE_BARRA} ${ENLACE_ACTUAL}`;
  // "Consultá tu trámite", destacada en cualquier página: blanca, en negrita y con fondo.
  return `${CLASE_ENLACE_BARRA} ${destacada ? "bg-white/10 font-semibold text-white" : "text-institucional-texto"}`;
}

/**
 * La barra de las páginas públicas: fija arriba, azul institucional (más
 * profundo en oscuro), con el logo oficial y el wordmark (al inicio), un
 * enlace por página ("Consultá tu trámite" destacada), el botón del modo e
 * "Ingreso del personal" (blanco, como el "Ingresar" del moodboard). La página
 * actual (`actual`, la ruta que pasa cada página) lleva `aria-current="page"`,
 * fondo y el subrayado amarillo. En celular y tablet, un menú con
 * `<details>`/`<summary>`: se abre sin JavaScript (y se cierra al cambiar de
 * página: la barra es de cada página).
 */
export function BarraPublica({ actual }: { actual: RutaPublica }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-pub-barra text-white shadow-[0_2px_16px_rgb(0_0_0/0.18)] print:static">
      <div className="relative mx-auto flex min-h-[4.5rem] max-w-6xl items-center gap-4 px-4 sm:px-6">
        {/* El nombre del enlace sale del alt del logo y del wordmark: "Ciudad San Miguel de Tucumán CementerIA…". */}
        <Link href="/" aria-current={actual === "/" ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-control py-1 ${FOCO_OSCURO}`}>
          <LogoMunicipal alto={34} className="w-[94px]! sm:w-[104px]!" />
          <span aria-hidden="true" className="hidden h-8 w-px bg-white/25 sm:block xl:max-2xl:hidden" />
          <span className="flex flex-col leading-tight max-sm:sr-only xl:max-2xl:sr-only">
            <Wordmark className="text-lg" />
            <span className="text-[0.6875rem] text-institucional-texto">Dirección de Cementerios</span>
          </span>
        </Link>
        <nav aria-label="Secciones" className="ml-auto hidden xl:block">
          <ul className="flex items-center gap-0.5">
            {NAVEGACION_PUBLICA.map((s) => (
              <li key={s.ruta}>
                <Link href={s.ruta} aria-current={s.ruta === actual ? "page" : undefined} className={claseEnlaceBarra(s.ruta === actual, Boolean(s.destacada))}>
                  {s.etiqueta}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 xl:ml-0">
          <BotonTema className={`${BOTON_BARRA} inline-flex w-10 justify-center`} />
          <Link
            href="/login"
            prefetch={false}
            className={`hidden min-h-10 items-center gap-2 rounded-control bg-white px-3.5 text-[0.8125rem] font-semibold text-institucional shadow-xs transition-colors duration-150 hover:bg-superficie-azul xl:inline-flex ${FOCO_OSCURO}`}
          >
            <LogIn className="h-4 w-4 text-primario" aria-hidden="true" />
            Ingreso del personal
          </Link>
          <details className="group xl:hidden">
            <summary className={`${BOTON_BARRA} inline-flex cursor-pointer list-none px-3 [&::-webkit-details-marker]:hidden`}>
              <Menu className="h-4 w-4" aria-hidden="true" />
              Menú
            </summary>
            <nav aria-label="Secciones" className="absolute inset-x-0 top-full border-t border-white/10 bg-pub-barra px-4 pb-4 pt-2 shadow-[0_8px_16px_rgb(0_0_0/0.25)] sm:px-6">
              <ul className="flex flex-col">
                {[{ ruta: "/" as const, etiqueta: "Inicio" }, ...NAVEGACION_PUBLICA].map((s) => (
                  <li key={s.ruta} className="border-b border-white/10">
                    <Link
                      href={s.ruta}
                      aria-current={s.ruta === actual ? "page" : undefined}
                      className={`block rounded-control py-3 pl-3 pr-1 text-white ${s.ruta === actual ? "bg-white/10 font-semibold shadow-[inset_3px_0_0_var(--color-amarillo)]" : ""} ${FOCO_OSCURO}`}
                    >
                      {s.etiqueta}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/login" prefetch={false} className={`flex items-center gap-2 rounded-control py-3 pl-3 pr-1 font-semibold text-white ${FOCO_OSCURO}`}>
                    <LogIn className="h-4 w-4" aria-hidden="true" />
                    Ingreso del personal
                  </Link>
                </li>
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

/** "Inicio › Recorridos": la última, la página actual (sin enlace). Sobre la banda con velo. */
function MigasDePan({ etiqueta }: { etiqueta: string }) {
  return (
    <nav aria-label="Migas de pan">
      <ol className="flex flex-wrap items-center gap-x-1.5 text-sm text-institucional-texto">
        <li>
          <Link href="/" className={`rounded-sm font-medium text-white underline underline-offset-2 hover:decoration-2 ${FOCO_OSCURO}`}>
            Inicio
          </Link>
        </li>
        <li className="flex items-center gap-x-1.5">
          <span aria-hidden="true">›</span>
          <span aria-current="page" className="font-semibold text-white">
            {etiqueta}
          </span>
        </li>
      </ol>
    </nav>
  );
}

/**
 * El encabezado de una página interna: una banda con la foto de la página
 * (decorativa, la imagen principal de la página) bajo el velo parejo, las
 * migas, el `h1` (el único de la página) con el filete amarillo y la bajada,
 * en blanco. El velo asegura el contraste con cualquier foto (medido en
 * docs/diseno.md).
 */
function EncabezadoInterno({ ruta, titulo, etiqueta, bajada }: { ruta: RutaInterna; titulo: string; etiqueta: string; bajada: string }) {
  return (
    <div className="relative isolate overflow-hidden bg-institucional">
      <FotoDeFondo foto={FOTO_BANDA[ruta]} sizes="100vw" prioridad className="-z-10" />
      <div aria-hidden="true" className="velo-banda -z-10" />
      <div className={`${CONTENEDOR_PUBLICO} py-10 sm:py-14 lg:py-16`}>
        <div className="max-w-3xl motion-safe:animate-aparecer">
          <MigasDePan etiqueta={etiqueta} />
          <h1 className="mt-4 text-balance text-[1.875rem] font-extrabold leading-tight tracking-tight text-white sm:text-[2.5rem]">{titulo}</h1>
          <span aria-hidden="true" className="mt-3 block h-1 w-14 rounded-full bg-amarillo" />
          <p className="mt-3 max-w-[62ch] text-pretty text-[0.9375rem] font-medium text-[#e6eef9] sm:text-base">{bajada}</p>
        </div>
      </div>
      <span aria-hidden="true" className="filete-celeste" />
    </div>
  );
}

/** Al pie de cada página interna: dos secciones más, distintas en cada página (INVITACIONES). */
function Invitaciones({ desde }: { desde: RutaInterna }) {
  return (
    <nav aria-labelledby="titulo-invitaciones" className="border-t border-pub-borde bg-pub-seccion">
      <div className={`${CONTENEDOR_PUBLICO} py-10 sm:py-14`}>
        <p id="titulo-invitaciones" className="antetitulo-publico">
          También te puede servir
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {INVITACIONES[desde].map((ruta) => {
            const p = PAGINAS_PUBLICAS[ruta];
            const Icono = ICONOS_PAGINAS[ruta];
            return (
              <li key={ruta}>
                <Link
                  href={ruta}
                  className={`tarjeta-enlace group flex h-full items-center gap-3.5 rounded-2xl border border-pub-borde bg-pub-superficie p-4 shadow-pub hover:border-pub-enlace ${FOCO_PUBLICO}`}
                >
                  <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primario text-white">
                    <Icono className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold leading-tight text-pub-titulo">{p.invitacion ?? p.titulo}</span>
                    <span className="mt-0.5 block text-[0.875rem] leading-snug text-pub-texto-secundario">{p.resumen}</span>
                  </span>
                  <ArrowRight className="flecha h-5 w-5 shrink-0 text-pub-enlace" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Una página interna completa, salvo el pie (del layout): la barra con esta
 * página marcada y, en `<main>`, la banda con la foto (migas, `h1` y bajada),
 * el contenido sobre `pub-fondo` y las invitaciones. `bajada` reemplaza la de
 * PAGINAS_PUBLICAS cuando la página la arma con sus datos.
 */
export function PaginaInterna({ ruta, bajada, children }: { ruta: RutaInterna; bajada?: string; children: React.ReactNode }) {
  const pagina = PAGINAS_PUBLICAS[ruta];
  return (
    <>
      <BarraPublica actual={ruta} />
      <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
        <EncabezadoInterno ruta={ruta} titulo={pagina.titulo} etiqueta={pagina.etiqueta} bajada={bajada ?? pagina.bajada} />
        <div className={`${CONTENEDOR_PUBLICO} py-8 sm:py-12`}>{children}</div>
        <Invitaciones desde={ruta} />
      </main>
    </>
  );
}

/**
 * El pie: el logo y la marca, las páginas del sitio, la Dirección de
 * Inteligencia Artificial y el ingreso del personal. Azul (el logo va sobre
 * azul).
 */
export function PiePublico() {
  return (
    <footer className="bg-pub-pie text-sm text-institucional-texto">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[auto_1fr] md:gap-16">
        <div className="space-y-3">
          <LogoMunicipal alto={40} />
          <p>
            <Wordmark className="text-lg" />
            <span className="block">Dirección de Cementerios · Municipalidad de San Miguel de Tucumán</span>
          </p>
        </div>
        <nav aria-label="El sitio">
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
            {NAVEGACION_PUBLICA.map((s) => (
              <li key={s.ruta}>
                <Link href={s.ruta} className={`rounded-sm text-white underline-offset-2 hover:underline ${FOCO_OSCURO}`}>
                  {s.etiqueta}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          Desarrollado por la Dirección de Inteligencia Artificial ·{" "}
          <Link href="/login" prefetch={false} className={`rounded-sm text-white underline underline-offset-2 ${FOCO_OSCURO}`}>
            Ingreso del personal
          </Link>
        </p>
      </div>
    </footer>
  );
}
