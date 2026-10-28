import { ArrowRight, Clock3, FileText, Landmark, LogIn, Map as IconoMapa, Menu, Phone, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { BotonTema } from "@/components/tema-publico";
import { INVITACIONES, NAVEGACION_PUBLICA, PAGINAS_PUBLICAS, type RutaInterna, type RutaPublica } from "@/lib/presentacion/sitio-publico";

/**
 * Las piezas de las páginas públicas (28/10/2026; docs/diseno.md, "Página
 * pública"): el fondo fijo, la barra, el encabezado de las páginas internas
 * con las migas de pan, el panel de lectura, las invitaciones al pie de cada
 * una, el pie y "Saltar al contenido". Sin sesión, sin barra lateral; el único
 * JavaScript es el botón del modo (src/components/tema-publico.tsx).
 *
 * Claro y oscuro con los tokens `pub-*` (src/app/globals.css): cada clase
 * sirve para los dos modos.
 *
 * No hay logo oficial (docs/diseno.md, "Marca"): la marca es un wordmark de
 * texto, "CementerIA", con el filete amarillo municipal. Cuando Comunicación
 * entregue el logo, va en MarcaMunicipal (src/components/marca-municipal.tsx),
 * y esto puede usarlo.
 */

/** Foco sobre el azul institucional: celeste (5,59:1), como la barra lateral. */
const FOCO_OSCURO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-celeste";
/** Foco sobre las superficies del sitio: azul en claro, celeste en oscuro. */
export const FOCO_PUBLICO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-foco";
/** Foco de lo que va directo sobre la foto (velo azul en claro, azul noche en oscuro): blanco en claro, celeste en oscuro. */
export const FOCO_SOBRE_FOTO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-sobre-foto-foco";
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

/**
 * El fondo de todo el sitio: la panorámica fija detrás del contenido, con el
 * velo y la trama (`.fondo-publico`, src/app/globals.css). Una sola imagen,
 * la misma en todas las páginas: el contenido se desplaza por encima y la
 * foto queda quieta. Sin parallax ni animación.
 */
export function FondoPublico() {
  return (
    <div aria-hidden="true" className="fondo-publico">
      {/* eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/imagenes. */}
      <img
        src="/imagenes/landing-panoramica-960.webp"
        srcSet="/imagenes/landing-panoramica-960.webp 960w, /imagenes/landing-panoramica-1916.webp 1916w"
        sizes="100vw"
        width={1916}
        height={821}
        alt=""
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      <div className="velo-publico" />
      <div className="trama-publica" />
    </div>
  );
}

/**
 * El antetítulo de una sección sobre la foto: una pastilla de vidrio azul
 * (`.vidrio-foto`) con el texto claro, el punto celeste y mayúsculas
 * espaciadas. Así se lee igual con cualquier parte de la foto detrás (dentro
 * del panel alcanza con `.antetitulo-publico`).
 */
export function ChipPublico({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      className={`vidrio-foto inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-pub-sobre-foto-titulo sm:text-xs sm:tracking-[0.16em] ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-celeste shadow-[0_0_0_3px_rgb(56_178_246/0.25)]" />
      {children}
    </p>
  );
}

/** El wordmark: "CementerIA" con el filete amarillo; sobre fondo oscuro o claro. */
export function Wordmark({ variante = "oscura", bajada = null }: { variante?: "oscura" | "clara"; bajada?: string | null }) {
  const oscura = variante === "oscura";
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={`text-xl font-extrabold tracking-tight ${oscura ? "text-white" : "text-pub-titulo"}`}>CementerIA</span>
      <span aria-hidden="true" className="mt-1 block h-[3px] w-9 rounded-full bg-amarillo" />
      {bajada ? <span className={`mt-1 text-[0.6875rem] ${oscura ? "text-institucional-texto" : "text-pub-texto-secundario"}`}>{bajada}</span> : null}
    </span>
  );
}

const CLASE_ENLACE_BARRA = `whitespace-nowrap rounded-control px-2.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-white/10 hover:text-white ${FOCO_OSCURO}`;
/** La página actual: blanca, en negrita, con fondo y el subrayado amarillo. */
const ENLACE_ACTUAL = "rounded-b-none bg-white/12 font-semibold text-white shadow-[inset_0_-2px_0_var(--color-amarillo)]";
/** Los botones chicos de la barra (el modo, el menú, el ingreso): borde claro sobre el vidrio azul. */
const BOTON_BARRA = `min-h-10 items-center gap-2 rounded-control border border-white/35 text-sm font-semibold text-white transition-colors duration-150 hover:bg-white/10 ${FOCO_OSCURO}`;

function claseEnlaceBarra(actual: boolean, destacada: boolean): string {
  if (actual) return `${CLASE_ENLACE_BARRA} ${ENLACE_ACTUAL}`;
  // "Consultá tu trámite", destacada en cualquier página: blanca, en negrita y con fondo.
  return `${CLASE_ENLACE_BARRA} ${destacada ? "bg-white/10 font-semibold text-white" : "text-institucional-texto"}`;
}

/**
 * La barra de las páginas públicas: fija arriba, de vidrio azul institucional
 * (más profundo en oscuro), con la marca (al inicio), un enlace por página
 * ("Consultá tu trámite" destacada), el botón del modo e "Ingreso del
 * personal". La página actual (`actual`, la ruta que pasa cada página) lleva
 * `aria-current="page"`, fondo y el subrayado amarillo. En celular y tablet,
 * un menú con `<details>`/`<summary>`: se abre sin JavaScript (y se cierra al
 * cambiar de página: la barra es de cada página).
 */
export function BarraPublica({ actual }: { actual: RutaPublica }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-pub-barra text-white shadow-[0_2px_16px_rgb(0_0_0/0.18)] backdrop-blur-md backdrop-saturate-150 print:static">
      <div className="relative mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          aria-current={actual === "/" ? "page" : undefined}
          className={`shrink-0 rounded-control py-1 ${FOCO_OSCURO}`}
          aria-label="CementerIA, Dirección de Cementerios de San Miguel de Tucumán: inicio"
        >
          <Wordmark bajada="Dirección de Cementerios · SMT" />
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
          <Link href="/login" prefetch={false} className={`${BOTON_BARRA} hidden px-3 text-[0.8125rem] hover:bg-white hover:text-institucional xl:inline-flex`}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Ingreso del personal
          </Link>
          <details className="group xl:hidden">
            <summary className={`${BOTON_BARRA} inline-flex cursor-pointer list-none px-3 [&::-webkit-details-marker]:hidden`}>
              <Menu className="h-4 w-4" aria-hidden="true" />
              Menú
            </summary>
            <nav aria-label="Secciones" className="absolute inset-x-0 top-full border-t border-white/10 bg-pub-barra-solida px-4 pb-4 pt-2 shadow-[0_8px_16px_rgb(0_0_0/0.25)] sm:px-6">
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

/** "Inicio › Recorridos": la última, la página actual (sin enlace). En una pastilla de vidrio azul, sobre la foto. */
function MigasDePan({ etiqueta }: { etiqueta: string }) {
  return (
    <nav aria-label="Migas de pan" className="flex justify-center">
      <ol className="vidrio-foto inline-flex flex-wrap items-center gap-x-1.5 rounded-full px-3.5 py-1 text-sm text-pub-sobre-foto-secundario">
        <li>
          <Link href="/" className={`rounded-sm font-medium text-pub-sobre-foto-enlace underline underline-offset-2 hover:text-pub-sobre-foto-titulo ${FOCO_SOBRE_FOTO}`}>
            Inicio
          </Link>
        </li>
        <li className="flex items-center gap-x-1.5">
          <span aria-hidden="true">›</span>
          <span aria-current="page" className="font-semibold text-pub-sobre-foto-texto">
            {etiqueta}
          </span>
        </li>
      </ol>
    </nav>
  );
}

/**
 * El encabezado de una página interna, directo sobre el fondo fijo: las
 * migas, el `h1` (el único de la página) con el filete amarillo y la bajada,
 * en los colores claros de `pub-sobre-foto-*` y centrados sobre un halo (el
 * del hero) que asegura el contraste con cualquier parte de la foto detrás.
 * Medido en docs/diseno.md.
 */
function EncabezadoInterno({ titulo, etiqueta, bajada }: { titulo: string; etiqueta: string; bajada: string }) {
  return (
    <div className={`${CONTENEDOR_PUBLICO} pb-8 pt-8 text-center sm:pb-10 sm:pt-12`}>
      <div className="relative isolate mx-auto max-w-3xl">
        <span aria-hidden="true" className="halo-publico absolute -inset-x-6 -inset-y-6 -z-10 rounded-[48px] sm:-inset-x-12" />
        <MigasDePan etiqueta={etiqueta} />
        <h1 className="mt-4 text-balance text-[1.75rem] font-extrabold leading-tight tracking-tight text-pub-sobre-foto-titulo sm:text-[2.5rem]">{titulo}</h1>
        <span aria-hidden="true" className="mx-auto mt-3 block h-1 w-14 rounded-full bg-amarillo" />
        <p className="mx-auto mt-3 max-w-[62ch] text-pretty text-[0.9375rem] font-medium text-pub-sobre-foto-texto sm:text-base">{bajada}</p>
      </div>
    </div>
  );
}

/** Al pie de cada página interna: dos secciones más, distintas en cada página (INVITACIONES), en vidrio. */
function Invitaciones({ desde }: { desde: RutaInterna }) {
  return (
    <nav aria-labelledby="titulo-invitaciones" className={`${CONTENEDOR_PUBLICO} py-10 sm:py-14`}>
      <div className="text-center">
        <ChipPublico id="titulo-invitaciones">También te puede servir</ChipPublico>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4">
        {INVITACIONES[desde].map((ruta) => {
          const p = PAGINAS_PUBLICAS[ruta];
          const Icono = ICONOS_PAGINAS[ruta];
          return (
            <li key={ruta}>
              <Link
                href={ruta}
                className={`vidrio group flex h-full items-center gap-3.5 rounded-[14px] p-4 transition-[translate,border-color] duration-150 hover:-translate-y-0.5 hover:border-pub-enlace ${FOCO_PUBLICO}`}
              >
                <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-pub-chip text-pub-enlace">
                  <Icono className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-tight text-pub-titulo">{p.invitacion ?? p.titulo}</span>
                  <span className="mt-0.5 block text-[0.875rem] leading-snug text-pub-texto-secundario">{p.resumen}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-pub-enlace transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Una página interna completa, salvo el pie (del layout): la barra con esta
 * página marcada y, en `<main>`, el encabezado sobre el fondo (migas, `h1` y
 * bajada), el contenido en el panel de lectura (casi opaco: listas y tablas
 * se leen cómodas en los dos modos) y las invitaciones. `bajada` reemplaza la
 * de PAGINAS_PUBLICAS cuando la página la arma con sus datos.
 */
export function PaginaInterna({ ruta, bajada, children }: { ruta: RutaInterna; bajada?: string; children: React.ReactNode }) {
  const pagina = PAGINAS_PUBLICAS[ruta];
  return (
    <>
      <BarraPublica actual={ruta} />
      <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
        <EncabezadoInterno titulo={pagina.titulo} etiqueta={pagina.etiqueta} bajada={bajada ?? pagina.bajada} />
        <div className={CONTENEDOR_PUBLICO}>
          <div className="panel-lectura p-4 sm:p-8 lg:p-10">{children}</div>
        </div>
        <Invitaciones desde={ruta} />
      </main>
    </>
  );
}

/** El pie: la Dirección, la Municipalidad, la Dirección de Inteligencia Artificial y el ingreso del personal. */
export function PiePublico() {
  return (
    <footer className="border-t border-white/10 bg-pub-pie text-sm text-institucional-texto">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-4 py-10 sm:px-6">
        <div>
          <p className="text-lg font-bold text-white">CementerIA</p>
          <p>Dirección de Cementerios · Municipalidad de San Miguel de Tucumán</p>
        </div>
        <p>
          Desarrollado por la Dirección de Inteligencia Artificial ·{" "}
          <Link href="/login" prefetch={false} className={`rounded-sm text-white underline underline-offset-2 ${FOCO_OSCURO}`}>
            Ingreso del personal
          </Link>
        </p>
      </div>
    </footer>
  );
}
