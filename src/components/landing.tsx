import Link from "next/link";
import { ArrowRight, CalendarDays, Clock3, ExternalLink, FileText, MapPin, Megaphone, Phone, Search, Users } from "lucide-react";
import { Wordmark } from "@/components/marca-municipal";
import { CONTENEDOR_PUBLICO as CONTENEDOR, FOCO_OSCURO, FOCO_PUBLICO as FOCO, FotoDeFondo, ICONOS_PAGINAS, type FotoKit } from "@/components/publico";
import type { DatosLanding } from "@/lib/dominio/publico/landing";
import type { CementerioPublico, ContactoSitio, ContenidoSitioPublico, FechaRecorridoPublica, FotoSitio, RecorridoPublico } from "@/lib/dominio/sitio";
import {
  hrefComoLlegar,
  hrefCorreo,
  hrefTelefono,
  NAVEGACION_PUBLICA,
  PAGINAS_PUBLICAS,
  parrafosDe,
  partesFechaRecorrido,
  PASOS_CONSULTA,
} from "@/lib/presentacion/sitio-publico";

/**
 * El contenido de las páginas públicas (docs/diseno.md, "Página pública").
 * El inicio (`/`), como el moodboard aprobado del kit institucional
 * (30/10/2026): el hero con la foto y el velo, los seis accesos que se apoyan
 * en su borde, las novedades, el patrimonio (con los próximos recorridos), los
 * trámites, la banda del seguimiento en tres pasos, los cementerios y el
 * cierre con el contacto. Las páginas internas: los cementerios, los horarios
 * de visita, los recorridos, los trámites y el contacto con las preguntas
 * frecuentes (la consulta está en src/app/(publico)/consulta/). Server
 * Components, sin JavaScript.
 *
 * Claro y oscuro: solo tokens `pub-*` (src/app/globals.css). Sobre las fotos
 * (con velo) y la banda azul, texto blanco.
 *
 * En las internas el `h1` es el del encabezado (PaginaInterna, en
 * ./publico.tsx): acá los títulos empiezan en `h2`.
 *
 * El contenido lo carga la Dirección (/admin/sitio-publico) y en producción
 * arranca vacío: cada sección muestra solo lo cargado y, si no hay nada, no
 * sale o dice a dónde ir. Nada de cifras, beneficios ni datos de ejemplo: lo
 * que no está en la base no se dice. Todo el texto de la base va como texto
 * (React lo escapa): nada de HTML ni Markdown.
 */

const BOTON_BASE = "inline-flex min-h-10 items-center gap-1.5 rounded-control border px-3.5 py-2 text-sm font-semibold transition-colors duration-150";
const BOTON = `${BOTON_BASE} ${FOCO}`;
const BOTON_PRIMARIO = `${BOTON} border-primario bg-primario text-white hover:border-primario-oscuro hover:bg-primario-oscuro`;
const BOTON_SECUNDARIO = `${BOTON} border-pub-borde-control bg-pub-superficie text-pub-titulo hover:border-pub-enlace hover:bg-pub-chip`;
const TITULO_TARJETA = "text-[1.1875rem] font-bold text-pub-titulo";
/** Una tarjeta: opaca, con borde y sombra suave. */
const TARJETA = "rounded-2xl border border-pub-borde bg-pub-superficie";
/** Un enlace dentro del texto. */
const ENLACE = `rounded-sm text-pub-enlace underline underline-offset-2 ${FOCO}`;
/** El `h2` de cada sección del inicio. */
const TITULO_SECCION = "mt-2 text-balance text-[1.625rem] font-extrabold leading-tight tracking-tight text-pub-titulo sm:text-[2rem]";
/** El ritmo vertical de las secciones del inicio. */
const SECCION = "py-14 sm:py-20";

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function Foto({ foto, className }: { foto: FotoSitio; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/assets.
    <img
      src={foto.chica}
      srcSet={`${foto.chica} 960w, ${foto.grande} ${foto.anchoGrande}w`}
      sizes="(min-width: 1160px) 560px, (min-width: 760px) 50vw, 100vw"
      width={foto.anchoGrande}
      height={foto.altoGrande}
      alt={foto.alt}
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}

/** Un dato de una ficha: la etiqueta a la izquierda y el valor. Si no hay valor, no se muestra. */
function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex gap-2.5 text-[0.9375rem] leading-snug">
      <dt className="w-24 shrink-0 font-semibold text-pub-texto">{etiqueta}</dt>
      <dd className="min-w-0 text-pub-texto-secundario [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Parrafos({ texto, className }: { texto: string | null; className: string }) {
  return parrafosDe(texto).map((p, i) => (
    <p key={i} className={`whitespace-pre-line ${className}`}>
      {p}
    </p>
  ));
}

/**
 * El encabezado de una sección del inicio: el antetítulo (con su filete), el
 * `h2` y, a la derecha, un enlace (si hay). Mismo ritmo en todas.
 */
function EncabezadoSeccion({ id, antetitulo, titulo, children }: { id: string; antetitulo: string; titulo: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="max-w-[60ch]">
        <p className="antetitulo-publico">{antetitulo}</p>
        <h2 id={id} className={TITULO_SECCION}>
          {titulo}
        </h2>
      </div>
      {children}
    </div>
  );
}

/** "Ver todos…": el enlace de una sección, con la flecha. */
function EnlaceSeccion({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`group inline-flex min-h-10 items-center gap-1.5 rounded-control px-1 text-sm font-semibold text-pub-enlace hover:underline ${FOCO}`}>
      {children}
      <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-salida group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

/** Teléfono, correo y domicilio de Mesa de Entradas, lo que esté (para remitir a ellos desde otras páginas). */
function ContactoBreve({ contacto }: { contacto: ContactoSitio | null }) {
  if (!contacto) return null;
  const telefono = hrefTelefono(contacto.telefono);
  const correo = hrefCorreo(contacto.correo);
  return (
    <dl className="mt-3 space-y-1.5">
      <Dato etiqueta="Teléfono">
        {contacto.telefono ? (
          telefono ? (
            <a href={telefono} className={ENLACE}>
              {contacto.telefono}
            </a>
          ) : (
            contacto.telefono
          )
        ) : null}
      </Dato>
      <Dato etiqueta="Correo">
        {contacto.correo && correo ? (
          <a href={correo} className={ENLACE}>
            {contacto.correo}
          </a>
        ) : null}
      </Dato>
      <Dato etiqueta="Horario">{contacto.horario}</Dato>
      <Dato etiqueta="Domicilio">{contacto.domicilio}</Dato>
    </dl>
  );
}

function EnlaceComoLlegar({ domicilio, mapaUrl, nombre }: { domicilio: string | null; mapaUrl: string | null; nombre: string }) {
  const href = hrefComoLlegar(domicilio, mapaUrl);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={BOTON_PRIMARIO}>
      <MapPin className="h-4 w-4" aria-hidden="true" />
      Cómo llegar<span className="sr-only"> a {nombre} (se abre el mapa en otra pestaña)</span>
    </a>
  );
}

/** "Ver contacto": a la página de contacto. */
function EnlaceContacto({ children = "Ver contacto" }: { children?: React.ReactNode }) {
  return (
    <Link href="/contacto" className={BOTON_SECUNDARIO}>
      {children}
    </Link>
  );
}

/**
 * Las próximas fechas de los recorridos: la cajita con el día (monoespaciada)
 * y el mes, el recorrido, el día completo y la hora.
 */
function ListaFechas({ fechas, className }: { fechas: FechaRecorridoPublica[]; className: string }) {
  return (
    <ul className={className} data-proximas-fechas="">
      {fechas.map((f) => {
        const p = partesFechaRecorrido(f.fecha);
        return (
          <li key={f.id} className={`flex items-center gap-3.5 px-3.5 py-3 ${TARJETA}`}>
            <span aria-hidden="true" className="w-14 shrink-0 rounded-[10px] bg-institucional py-1.5 text-center leading-tight text-white">
              <span className="block font-mono text-xl font-bold tabular-nums">{p.dia}</span>
              <span className="text-[0.6875rem] uppercase tracking-[0.1em] text-amarillo">{p.mes}</span>
            </span>
            <span className="min-w-0 text-[0.90625rem] text-pub-texto-secundario">
              <strong className="block text-pub-texto">{f.recorrido}</strong>
              <time dateTime={f.fecha.toISOString()} className="first-letter:uppercase">
                {p.texto}
              </time>
              {f.cementerio ? ` · ${f.cementerio}` : ""}
              {f.nota ? <span className="block">{f.nota}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Las novedades vigentes: una franja por novedad, con el borde amarillo. En
 * el inicio con su título visible; en /horarios, con el título solo para
 * lectores.
 */
function Novedades({ novedades, className, enInicio = false }: { novedades: ContenidoSitioPublico["novedades"]; className: string; enInicio?: boolean }) {
  if (novedades.length === 0) return null;
  return (
    <section aria-labelledby="titulo-novedades" className={className} data-novedades="">
      {enInicio ? (
        <EncabezadoSeccion id="titulo-novedades" antetitulo="Avisos vigentes" titulo="Novedades" />
      ) : (
        <h2 id="titulo-novedades" className="sr-only">
          Novedades
        </h2>
      )}
      <div className="space-y-2.5">
        {novedades.map((n) => (
          <div key={n.id} className={`flex items-start gap-3 border-l-4 border-l-amarillo px-4 py-3.5 shadow-pub ${TARJETA}`}>
            <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-pub-advertencia" aria-hidden="true" />
            <div className="min-w-0 max-w-[75ch] text-[0.9375rem] text-pub-texto">
              <p className="font-bold text-pub-titulo">{n.titulo}</p>
              <Parrafos texto={n.texto} className="mt-0.5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

/** Las fotos del inicio: conceptuales, del kit (decorativas, o con "imagen ilustrativa"). */
const FOTO_HERO: FotoKit = {
  src: "/assets/cementeria/hero-landing.webp",
  chica: "/assets/cementeria/hero-landing-960.webp",
  ancho: 1916,
  alto: 821,
  posicion: "68% 60%",
};
const FOTO_PATRIMONIO: FotoKit = {
  src: "/assets/cementeria/banner-patrimonio.webp",
  chica: "/assets/cementeria/banner-patrimonio-960.webp",
  ancho: 1672,
  alto: 941,
  posicion: "50% 45%",
};
const FOTO_CIERRE: FotoKit = { src: "/assets/cementeria/fondo-suave.webp", ancho: 1672, alto: 941, posicion: "50% 50%" };

/**
 * El hero: la panorámica (la imagen principal de la página: carga con
 * prioridad alta) bajo el velo, 16:9 en escritorio (hasta el alto de la
 * ventana) y del alto de su contenido en celular. El `h1` es el wordmark
 * "CementerIA" y "Dirección de Cementerios" (texto HTML, no imagen), con la
 * bajada, los dos llamados ("Consultá tu trámite" y "Ver trámites": las dos
 * rutas existen) y la aclaración de que la imagen es ilustrativa. El texto
 * entra con `aparecer` (opacidad y 8 px de desplazamiento, escalonado; nada
 * con prefers-reduced-motion). Abajo queda lugar para los accesos, que se
 * apoyan en el borde.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="titulo-inicio"
      // Alto 16:9 del ancho, topado por la pantalla. No `aspect-video` + `max-h`: con el alto topado, el navegador
      // achica el ancho para sostener la proporción y en pantallas anchas la foto no llega al borde derecho.
      className="relative isolate flex w-full flex-col overflow-hidden bg-institucional lg:h-[min(56.25vw,calc(100svh-4.5rem))] lg:min-h-[38rem]"
    >
      <FotoDeFondo foto={FOTO_HERO} sizes="100vw" prioridad className="-z-10" />
      <div aria-hidden="true" className="velo-hero -z-10" />
      <div
        className={`${CONTENEDOR} flex flex-1 flex-col justify-center pb-28 pt-14 sm:pb-32 sm:pt-20 lg:pb-36 lg:pt-12`}
      >
        <div className="max-w-[36rem]">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white motion-safe:animate-aparecer">Municipalidad de San Miguel de Tucumán</p>
          <h1 id="titulo-inicio" className="mt-4 text-white motion-safe:animate-aparecer motion-safe:[animation-delay:60ms]">
            <Wordmark className="block text-[3.25rem] leading-[0.95] sm:text-7xl lg:text-[5.25rem]" />{" "}
            <span className="mt-2 block text-[1.625rem] font-semibold leading-tight tracking-tight sm:text-[2.25rem] lg:text-[2.5rem]">Dirección de Cementerios</span>
          </h1>
          <span aria-hidden="true" className="mt-5 block h-1 w-16 rounded-full bg-amarillo" />
          <p className="mt-5 max-w-[46ch] text-pretty text-base font-medium text-[#e6eef9] motion-safe:animate-aparecer motion-safe:[animation-delay:120ms] sm:text-lg">
            Horarios de visita, recorridos por el patrimonio, trámites y seguimiento de expedientes, en un solo lugar.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 motion-safe:animate-aparecer motion-safe:[animation-delay:180ms]">
            <Link
              href="/consulta"
              className={`inline-flex min-h-12 items-center gap-2 rounded-full bg-primario px-6 text-[0.9375rem] font-semibold text-white shadow-[0_8px_24px_rgb(0_107_255/0.35)] transition-colors duration-150 hover:bg-primario-oscuro ${FOCO_OSCURO}`}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Consultá tu trámite
            </Link>
            <Link
              href="/tramites"
              className={`inline-flex min-h-12 items-center gap-2 rounded-full border border-white/70 px-6 text-[0.9375rem] font-semibold text-white transition-colors duration-150 hover:bg-white/10 ${FOCO_OSCURO}`}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Ver trámites
            </Link>
          </div>
          <p className="mt-6 text-xs text-institucional-texto">Imagen ilustrativa generada con IA.</p>
        </div>
      </div>
      <span aria-hidden="true" className="filete-celeste" />
    </section>
  );
}

/**
 * Los seis accesos (uno por página, en el orden de la barra): tarjetas
 * opacas que se apoyan en el borde del hero, con el ícono en un círculo
 * `primario` (blanco encima, 4,62:1). "Consultá tu trámite", destacada en la
 * banda azul con el ícono amarillo. Debajo, las novedades vigentes.
 */
export function AccesosYNovedades({ novedades }: { novedades: ContenidoSitioPublico["novedades"] }) {
  return (
    <div className={`${CONTENEDOR} relative z-10 -mt-20 sm:-mt-24`}>
      <nav id="accesos" aria-label="Accesos rápidos" className="scroll-mt-24">
        <ul className="grid gap-3 min-[560px]:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {NAVEGACION_PUBLICA.map(({ ruta, destacada }) => {
            const { titulo, resumen } = PAGINAS_PUBLICAS[ruta];
            const Icono = ICONOS_PAGINAS[ruta];
            return (
              <li key={ruta}>
                <Link
                  href={ruta}
                  className={`tarjeta-enlace group flex h-full items-start gap-4 rounded-2xl border p-5 shadow-pub-elevada ${
                    destacada ? `border-white/10 bg-pub-banda ${FOCO_OSCURO}` : `border-pub-borde bg-pub-superficie hover:border-pub-enlace ${FOCO}`
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${destacada ? "bg-amarillo text-institucional" : "bg-primario text-white"}`}
                  >
                    <Icono className="h-[22px] w-[22px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-base font-bold leading-tight ${destacada ? "text-white" : "text-pub-titulo"}`}>{titulo}</span>
                    <span className={`mt-1 block text-[0.875rem] leading-snug ${destacada ? "text-institucional-texto" : "text-pub-texto-secundario"}`}>
                      {resumen}
                    </span>
                  </span>
                  <ArrowRight className={`flecha mt-0.5 h-4 w-4 shrink-0 ${destacada ? "text-amarillo" : "text-pub-enlace"}`} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Novedades novedades={novedades} className="pt-14 sm:pt-20" enInicio />
    </div>
  );
}

/**
 * El patrimonio: a la izquierda el texto (genérico y verdadero: qué hay en el
 * sitio, sin afirmar nada que no esté en la base) y, si hay, los próximos
 * recorridos (hasta tres); a la derecha, `banner-patrimonio` con "Imagen
 * ilustrativa" (no es un cementerio de Tucumán).
 */
export function Patrimonio({ fechas }: { fechas: FechaRecorridoPublica[] }) {
  return (
    <section aria-labelledby="titulo-patrimonio" className={`mt-14 bg-pub-seccion sm:mt-20 ${SECCION}`}>
      <div className={`${CONTENEDOR} grid items-start gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14`}>
        <div>
          <p className="antetitulo-publico">Patrimonio</p>
          <h2 id="titulo-patrimonio" className={TITULO_SECCION}>
            Espacios de memoria e historia
          </h2>
          <p className="mt-4 max-w-[58ch] text-pretty text-[1.0625rem] leading-relaxed text-pub-texto-secundario">
            Los cementerios municipales son parte de la historia de San Miguel de Tucumán. En este sitio encontrás cuándo visitarlos, los
            recorridos guiados que publica la Dirección y cómo hacer cada trámite.
          </p>
          {fechas.length > 0 ? (
            <section aria-labelledby="titulo-proximos" className="mt-8">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 id="titulo-proximos" className="flex items-center gap-2 text-lg font-bold text-pub-titulo">
                  <CalendarDays className="h-5 w-5 text-pub-enlace" aria-hidden="true" />
                  Próximos recorridos
                </h3>
                <EnlaceSeccion href="/recorridos">Ver todos los recorridos</EnlaceSeccion>
              </div>
              <ListaFechas fechas={fechas.slice(0, 3)} className="grid gap-2.5" />
            </section>
          ) : (
            <p className="mt-6">
              <Link href="/recorridos" className={BOTON_PRIMARIO}>
                Recorridos históricos
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
          )}
        </div>
        <figure>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[20px] bg-institucional shadow-pub-elevada">
            <FotoDeFondo foto={FOTO_PATRIMONIO} sizes="(min-width: 1024px) 560px, 100vw" />
            <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1.5 bg-linear-to-r from-amarillo via-celeste to-primario" />
          </div>
          <figcaption className="mt-3 text-xs text-pub-texto-secundario">Imagen ilustrativa generada con IA: no corresponde a un cementerio en particular.</figcaption>
        </figure>
      </div>
    </section>
  );
}

/**
 * Los trámites del inicio: hasta cuatro de las plantillas publicadas (los de
 * siempre, de la base) y "Ver todos los trámites". Sin datos (la base no
 * respondió o no hay publicados), no sale.
 */
export function TramitesInicio({ datos }: { datos: DatosLanding | null }) {
  if (!datos || datos.tramites.length === 0) return null;
  return (
    <section aria-labelledby="titulo-tramites" className={SECCION}>
      <div className={CONTENEDOR}>
        <EncabezadoSeccion id="titulo-tramites" antetitulo="Trámites" titulo="Qué trámites se inician en Mesa de Entradas">
          <EnlaceSeccion href="/tramites">Ver todos los trámites</EnlaceSeccion>
        </EncabezadoSeccion>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {datos.tramites.slice(0, 4).map((t) => (
            <li key={t.codigo}>
              <Link href="/tramites" className={`tarjeta-enlace group flex h-full items-start gap-3.5 p-4 shadow-pub hover:border-pub-enlace ${TARJETA} ${FOCO}`}>
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pub-chip text-pub-enlace">
                  <FileText className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-tight text-pub-titulo">{t.nombre}</span>
                  <span className="mt-1 block text-[0.8125rem] leading-snug text-pub-texto-secundario">Requisitos y qué traer</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * La banda del seguimiento: azul institucional, los tres pasos de la consulta
 * (los mismos de /consulta) y "Consultar mi trámite" en amarillo (texto
 * institucional encima). El `h2` es "Consultá tu trámite" (la región la
 * nombra).
 */
export function BandaConsulta() {
  return (
    <section aria-labelledby="titulo-banda-consulta" className="relative isolate overflow-hidden bg-pub-banda text-white">
      <span aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 -z-10 hidden h-[26rem] w-[26rem] rounded-full border border-celeste/20 sm:block" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 -z-10 hidden h-[17rem] w-[17rem] rounded-full border border-celeste/10 sm:block" />
      <div className={`${CONTENEDOR} py-14 sm:py-16`}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div className="max-w-[44ch]">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8fd6fb]">Seguimiento de expedientes</p>
            <h2 id="titulo-banda-consulta" className="mt-2 text-[1.75rem] font-extrabold leading-tight tracking-tight sm:text-[2rem]">
              Consultá tu trámite
            </h2>
            <p className="mt-3 text-institucional-texto">Con el número de expediente y el código de consulta del comprobante, o escaneando su QR.</p>
          </div>
          <Link
            href="/consulta"
            className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-amarillo px-5 py-2.5 text-[0.9375rem] font-bold text-institucional transition-colors duration-150 hover:bg-white ${FOCO_OSCURO}`}
          >
            Consultar mi trámite
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {PASOS_CONSULTA.map((p, i) => (
            <li key={p.titulo} className="flex items-start gap-3.5 rounded-2xl border border-white/12 bg-white/[0.06] p-4">
              <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primario font-mono text-lg font-extrabold text-white ring-4 ring-primario/25">
                {i + 1}
              </span>
              <span className="min-w-0">
                <strong className="block leading-snug text-white">{p.titulo}</strong>
                <span className="mt-1 block text-[0.9375rem] text-institucional-texto">{p.texto}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Los cementerios del inicio: hasta tres, con la foto que eligió la Dirección
 * (ilustrativa, y lo dice) o la franja institucional, el nombre y el
 * domicilio, y "Ver todos los cementerios". Sin cementerios (la base no
 * respondió), no sale.
 */
export function CementeriosInicio({ cementerios }: { cementerios: CementerioPublico[] }) {
  if (cementerios.length === 0) return null;
  const tres = cementerios.slice(0, 3);
  return (
    <section aria-labelledby="titulo-cementerios-inicio" className={`bg-pub-seccion ${SECCION}`}>
      <div className={CONTENEDOR}>
        <EncabezadoSeccion id="titulo-cementerios-inicio" antetitulo="Nuestros cementerios" titulo="Cementerios municipales">
          <EnlaceSeccion href="/cementerios">Ver todos los cementerios</EnlaceSeccion>
        </EncabezadoSeccion>
        <ul className="grid gap-5 md:grid-cols-3">
          {tres.map((c) => (
            <li key={c.id}>
              <Link href="/cementerios" className={`tarjeta-enlace group flex h-full flex-col overflow-hidden shadow-pub hover:border-pub-enlace ${TARJETA} ${FOCO}`}>
                {c.foto ? (
                  <Foto foto={c.foto} className="aspect-video w-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex h-3 w-full bg-institucional">
                    <span className="ml-5 h-full w-12 bg-amarillo" />
                  </span>
                )}
                <span className="flex flex-1 items-start justify-between gap-3 p-5">
                  <span className="min-w-0">
                    <span className="block text-lg font-bold leading-tight text-pub-titulo">{c.nombre}</span>
                    {c.domicilio ? <span className="mt-1 block text-[0.875rem] text-pub-texto-secundario">{c.domicilio}</span> : null}
                  </span>
                  <ArrowRight className="flecha mt-1 h-4 w-4 shrink-0 text-pub-enlace" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {tres.some((c) => c.foto) ? <p className="mt-4 text-xs text-pub-texto-secundario">Las fotos son ilustrativas.</p> : null}
      </div>
    </section>
  );
}

/**
 * El cierre: sobre `fondo-suave` (decorativa) con un velo claro (oscuro en
 * modo oscuro) casi opaco, dónde y cuándo atiende Mesa de Entradas (solo lo
 * cargado) y el enlace al contacto y las preguntas frecuentes.
 */
export function Cierre({ contacto }: { contacto: ContactoSitio | null }) {
  const telefono = hrefTelefono(contacto?.telefono ?? null);
  return (
    <section aria-labelledby="titulo-cierre" className="relative isolate overflow-hidden border-t border-pub-borde">
      <FotoDeFondo foto={FOTO_CIERRE} sizes="100vw" className="-z-10" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-pub-velo-cierre" />
      <div className={`${CONTENEDOR} grid gap-8 py-14 sm:py-16 md:grid-cols-[1fr_auto] md:items-center`}>
        <div className="max-w-[60ch]">
          <p className="antetitulo-publico">Atención al público</p>
          <h2 id="titulo-cierre" className={TITULO_SECCION}>
            Mesa de Entradas de la Dirección de Cementerios
          </h2>
          <p className="mt-3 text-pub-texto-secundario">Ahí se inician los trámites, se entrega el comprobante y se atienden las consultas.</p>
          {contacto && (contacto.domicilio || contacto.horario || contacto.telefono) ? (
            <ul className="mt-5 grid gap-2 text-[0.9375rem] text-pub-texto">
              {contacto.domicilio ? (
                <li className="flex gap-2.5">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-pub-enlace" aria-hidden="true" />
                  <span>{contacto.domicilio}</span>
                </li>
              ) : null}
              {contacto.horario ? (
                <li className="flex gap-2.5">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-pub-enlace" aria-hidden="true" />
                  <span>{contacto.horario}</span>
                </li>
              ) : null}
              {contacto.telefono ? (
                <li className="flex gap-2.5">
                  <Phone className="mt-0.5 h-5 w-5 shrink-0 text-pub-enlace" aria-hidden="true" />
                  {telefono ? (
                    <a href={telefono} className={ENLACE}>
                      {contacto.telefono}
                    </a>
                  ) : (
                    <span>{contacto.telefono}</span>
                  )}
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/contacto" className={`${BOTON_PRIMARIO} min-h-11 rounded-full px-5`}>
            <Users className="h-4 w-4" aria-hidden="true" />
            Contacto y preguntas frecuentes
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// /cementerios
// ---------------------------------------------------------------------------

function TarjetaCementerio({ c, hayHorarios }: { c: CementerioPublico; hayHorarios: boolean }) {
  const tieneHorario = Boolean(c.horarioSemana || c.horarioFinDeSemana || c.horarioEspecial);
  return (
    <article aria-labelledby={`cementerio-${c.id}`} className={`flex flex-col overflow-hidden shadow-pub ${TARJETA}`}>
      {c.foto ? (
        <Foto foto={c.foto} className="aspect-video w-full object-cover" />
      ) : (
        <div aria-hidden="true" className="flex h-3 w-full bg-institucional">
          <span className="ml-5 h-full w-12 bg-amarillo" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <h2 id={`cementerio-${c.id}`} className={TITULO_TARJETA}>
          {c.nombre}
        </h2>
        <Parrafos texto={c.descripcion} className="text-[0.9375rem] text-pub-texto-secundario" />
        <dl className="space-y-2">
          <Dato etiqueta="Domicilio">{c.domicilio}</Dato>
          <Dato etiqueta="Visitas">{c.horarioSemana ? `Lunes a viernes: ${c.horarioSemana}` : null}</Dato>
          <Dato etiqueta="Tiene">{c.queTiene}</Dato>
        </dl>
        {!c.domicilio && !c.descripcion && !c.queTiene && !tieneHorario ? (
          <p className="text-[0.9375rem] text-pub-texto-secundario">Para saber más, consultá en Mesa de Entradas.</p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2 pt-1.5">
          <EnlaceComoLlegar domicilio={c.domicilio} mapaUrl={c.mapaUrl} nombre={c.nombre} />
          {tieneHorario && hayHorarios ? (
            <Link href="/horarios" className={BOTON_SECUNDARIO}>
              Horarios<span className="sr-only"> de visita de {c.nombre}</span>
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ContenidoCementerios({ sitio }: { sitio: ContenidoSitioPublico }) {
  return sitio.cementerios.length === 0 ? (
    <div className={`max-w-2xl p-5 ${TARJETA}`}>
      <p className="text-pub-texto">Consultá en Mesa de Entradas.</p>
      <ContactoBreve contacto={sitio.contacto} />
    </div>
  ) : (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {sitio.cementerios.map((c) => (
        <TarjetaCementerio key={c.id} c={c} hayHorarios={sitio.hayHorarios} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// /horarios
// ---------------------------------------------------------------------------

const COLUMNAS_HORARIO = [
  { clave: "horarioSemana", titulo: "Lunes a viernes" },
  { clave: "horarioFinDeSemana", titulo: "Sábados, domingos y feriados" },
  { clave: "horarioEspecial", titulo: "Fechas especiales" },
] as const;

function SinDato() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Sin informar</span>
    </>
  );
}

/**
 * Los horarios: desde `md`, la tabla; en celular, una tarjeta por cementerio
 * (nunca desplazamiento lateral). Arriba, las novedades vigentes: suelen ser
 * justamente un horario especial.
 */
export function ContenidoHorarios({ sitio }: { sitio: ContenidoSitioPublico }) {
  const conHorario = sitio.cementerios.filter((c) => c.horarioSemana || c.horarioFinDeSemana || c.horarioEspecial);
  return (
    <>
      <Novedades novedades={sitio.novedades} className="mb-7" />
      {conHorario.length === 0 ? (
        <div className={`max-w-2xl p-5 ${TARJETA}`} data-sin-horarios="">
          <p className="flex items-center gap-2 font-semibold text-pub-texto">
            <Clock3 className="h-5 w-5 shrink-0 text-pub-enlace" aria-hidden="true" />
            Consultá los horarios en Mesa de Entradas.
          </p>
          <ContactoBreve contacto={sitio.contacto} />
        </div>
      ) : (
        <>
          {/* Escritorio y tablet: la tabla. */}
          <div className={`hidden overflow-hidden md:block ${TARJETA}`}>
            <table className="w-full border-collapse text-left text-[0.9375rem]">
              <caption className="sr-only">Horarios de visita de cada cementerio</caption>
              <thead>
                <tr className="bg-pub-tinte">
                  <th scope="col" className="px-[18px] py-3.5 text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-pub-titulo">
                    Cementerio
                  </th>
                  {COLUMNAS_HORARIO.map((col) => (
                    <th key={col.clave} scope="col" className="px-[18px] py-3.5 text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-pub-titulo">
                      {col.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conHorario.map((c) => (
                  <tr key={c.id} className="border-t border-pub-borde">
                    <th scope="row" className="px-[18px] py-3.5 font-semibold text-pub-titulo">
                      {c.nombre}
                    </th>
                    {COLUMNAS_HORARIO.map((col) => (
                      <td key={col.clave} className="px-[18px] py-3.5 text-pub-texto">
                        {c[col.clave] ?? <SinDato />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Celular: una tarjeta por cementerio, sin desplazamiento lateral. */}
          <ul className="space-y-3 md:hidden" aria-label="Horarios de visita de cada cementerio">
            {conHorario.map((c) => (
              <li key={c.id} className={`p-4 ${TARJETA}`}>
                <h2 className="font-bold text-pub-titulo">{c.nombre}</h2>
                <dl className="mt-2 space-y-2">
                  {COLUMNAS_HORARIO.map((col) =>
                    c[col.clave] ? (
                      <div key={col.clave}>
                        <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-pub-texto-secundario">{col.titulo}</dt>
                        <dd className="text-pub-texto">{c[col.clave]}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-pub-texto-secundario">Los horarios pueden cambiar en feriados y fechas especiales.</p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// /recorridos
// ---------------------------------------------------------------------------

function DatosRecorrido({ r }: { r: RecorridoPublico }) {
  return (
    <dl className="space-y-2">
      <Dato etiqueta="Cementerio">{r.cementerio}</Dato>
      <Dato etiqueta="Días y hora">{r.diasHora}</Dato>
      <Dato etiqueta="Duración">{r.duracion}</Dato>
      <Dato etiqueta="Encuentro">{r.puntoEncuentro}</Dato>
      <Dato etiqueta="Cupo">{r.cupo}</Dato>
    </dl>
  );
}

function AccionesRecorrido({ r }: { r: RecorridoPublico }) {
  return (
    <div className="mt-auto flex flex-wrap gap-2 pt-1.5">
      {r.inscripcionUrl ? (
        <a href={r.inscripcionUrl} target="_blank" rel="noopener noreferrer" className={BOTON_PRIMARIO}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Cómo inscribirse<span className="sr-only"> a {r.nombre} (se abre en otra pestaña)</span>
        </a>
      ) : null}
      <EnlaceContacto>
        Consultas<span className="sr-only"> sobre {r.nombre}</span>
      </EnlaceContacto>
    </div>
  );
}

function FichaRecorrido({ r, destacada }: { r: RecorridoPublico; destacada: boolean }) {
  return (
    <article
      aria-labelledby={`recorrido-${r.id}`}
      className={`grid overflow-hidden shadow-pub ${TARJETA} ${destacada && r.foto ? "min-[900px]:grid-cols-[1.1fr_1fr]" : ""}`}
    >
      {r.foto ? <Foto foto={r.foto} className={destacada ? "h-full min-h-[220px] w-full object-cover" : "aspect-video w-full object-cover"} /> : null}
      <div className="flex flex-col gap-2.5 p-5">
        {r.cementerio ? (
          <span className="self-start rounded-full bg-pub-chip px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-pub-enlace">{r.cementerio}</span>
        ) : null}
        <h2 id={`recorrido-${r.id}`} className={TITULO_TARJETA}>
          {r.nombre}
        </h2>
        <Parrafos texto={r.descripcion} className="max-w-[70ch] text-[0.9375rem] text-pub-texto-secundario" />
        <DatosRecorrido r={r} />
        {r.inscripcion ? (
          <div className="text-[0.9375rem]">
            <p className="font-semibold text-pub-texto">Cómo inscribirse</p>
            <Parrafos texto={r.inscripcion} className="text-pub-texto-secundario" />
          </div>
        ) : null}
        <AccionesRecorrido r={r} />
      </div>
    </article>
  );
}

function TarjetaGrupos({ contacto }: { contacto: ContactoSitio | null }) {
  return (
    <div className={`flex flex-col gap-2.5 p-5 ${TARJETA}`}>
      <h2 className="flex items-center gap-2 text-lg font-bold text-pub-titulo">
        <Users className="h-5 w-5 shrink-0 text-pub-enlace" aria-hidden="true" />
        Grupos, escuelas e instituciones
      </h2>
      <p className="text-[0.9375rem] text-pub-texto-secundario">Para visitas de grupos o instituciones, escribinos: coordinamos el día y el horario.</p>
      <ContactoBreve contacto={contacto} />
      <div className="mt-auto pt-1.5">
        <EnlaceContacto />
      </div>
    </div>
  );
}

export function ContenidoRecorridos({ sitio }: { sitio: ContenidoSitioPublico }) {
  const [destacado, ...otros] = sitio.recorridos;
  if (!destacado) {
    return (
      <div className={`max-w-2xl p-5 ${TARJETA}`} data-sin-recorridos="">
        <p className="text-pub-texto">Por ahora no hay recorridos programados. Para visitas de grupos o instituciones, escribinos.</p>
        <ContactoBreve contacto={sitio.contacto} />
        <p className="mt-4">
          <EnlaceContacto />
        </p>
      </div>
    );
  }
  return (
    <>
      <FichaRecorrido r={destacado} destacada />
      {/* Uno solo va a todo el ancho, como el destacado: en la grilla de dos dejaría media fila vacía. */}
      {otros.length === 1 ? (
        <div className="mt-5">
          <FichaRecorrido r={otros[0]} destacada />
        </div>
      ) : otros.length > 1 ? (
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {otros.map((r) => (
            <FichaRecorrido key={r.id} r={r} destacada={false} />
          ))}
        </div>
      ) : null}
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section aria-labelledby="titulo-fechas">
          <h2 id="titulo-fechas" className="mb-3 flex items-center gap-2 text-lg font-bold text-pub-titulo">
            <CalendarDays className="h-5 w-5 shrink-0 text-pub-enlace" aria-hidden="true" />
            Próximas fechas
          </h2>
          {sitio.fechas.length === 0 ? (
            <p className={`px-4 py-3 text-[0.9375rem] text-pub-texto-secundario ${TARJETA}`}>Todavía no hay fechas programadas. Consultá en Mesa de Entradas.</p>
          ) : (
            <ListaFechas fechas={sitio.fechas} className="grid gap-2.5" />
          )}
        </section>
        <TarjetaGrupos contacto={sitio.contacto} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// /tramites
// ---------------------------------------------------------------------------

export function ContenidoTramites({ datos }: { datos: DatosLanding | null }) {
  if (!datos) return <p className="text-pub-texto-secundario">No pudimos cargar esta información ahora. Consultala en Mesa de Entradas.</p>;
  if (datos.tramites.length === 0) return <p className="text-pub-texto-secundario">Todavía no hay trámites para seguir en línea.</p>;
  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {datos.tramites.map((t) => (
        <li key={t.codigo} className={`flex flex-col gap-2.5 p-5 ${TARJETA}`}>
          <h2 className="text-[1.0625rem] font-bold text-pub-titulo">{t.nombre}</h2>
          {t.modalidades.length > 0 ? <p className="text-sm text-pub-texto-secundario">Modalidades: {t.modalidades.join(" · ")}</p> : null}
          <p className="text-[0.8125rem] font-bold text-pub-texto">Qué tenés que traer</p>
          {t.documentos.length > 0 ? (
            <ul className="list-disc space-y-1 pl-[18px] text-[0.90625rem] text-pub-texto-secundario marker:text-pub-enlace">
              {t.documentos.map((d) => (
                <li key={d.nombre}>
                  {d.nombre}
                  {d.nota ? ` (${d.nota})` : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.90625rem] text-pub-texto-secundario">Consultá en Mesa de Entradas.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// /contacto: Mesa de Entradas y las preguntas frecuentes
// ---------------------------------------------------------------------------

export function ContenidoContacto({ sitio }: { sitio: ContenidoSitioPublico }) {
  const c = sitio.contacto;
  const telefono = hrefTelefono(c?.telefono ?? null);
  const correo = hrefCorreo(c?.correo ?? null);
  return (
    <div className={`grid gap-5 ${sitio.preguntas.length > 0 ? "min-[900px]:grid-cols-[1fr_1.2fr]" : "max-w-2xl"}`}>
      <section aria-labelledby="titulo-mesa" className={`flex flex-col gap-2.5 self-start p-5 shadow-pub ${TARJETA}`} data-contacto="">
        <h2 id="titulo-mesa" className={TITULO_TARJETA}>
          Mesa de Entradas · Dirección de Cementerios
        </h2>
        <p className="text-[0.9375rem] text-pub-texto-secundario">
          Ahí se inician los trámites, se entrega el comprobante y se atienden las consultas. Si perdiste el código de consulta, te dan uno nuevo.
        </p>
        {c ? (
          <dl className="space-y-2">
            <Dato etiqueta="Domicilio">{c.domicilio}</Dato>
            <Dato etiqueta="Horario">{c.horario}</Dato>
            <Dato etiqueta="Teléfono">
              {c.telefono ? (
                telefono ? (
                  <a href={telefono} className={ENLACE}>
                    {c.telefono}
                  </a>
                ) : (
                  c.telefono
                )
              ) : null}
            </Dato>
            <Dato etiqueta="Correo">
              {c.correo && correo ? (
                <a href={correo} className={ENLACE}>
                  {c.correo}
                </a>
              ) : null}
            </Dato>
          </dl>
        ) : null}
        {c ? (
          <div className="mt-auto flex flex-wrap gap-2 pt-1.5">
            <EnlaceComoLlegar domicilio={c.domicilio} mapaUrl={c.mapaUrl} nombre="Mesa de Entradas" />
          </div>
        ) : null}
      </section>
      {sitio.preguntas.length > 0 ? (
        <section aria-labelledby="titulo-preguntas" data-preguntas="">
          <h2 id="titulo-preguntas" className="mb-3 text-lg font-bold text-pub-titulo">
            Preguntas frecuentes
          </h2>
          <div className="space-y-2.5">
            {sitio.preguntas.map((p, i) => (
              <details key={p.id} open={i === 0} className={`group px-4 ${TARJETA}`}>
                <summary className={`flex cursor-pointer list-none justify-between gap-3 rounded-control py-3.5 font-semibold text-pub-titulo [&::-webkit-details-marker]:hidden ${FOCO}`}>
                  {p.pregunta}
                  <span aria-hidden="true" className="text-xl leading-none text-pub-enlace group-open:hidden">
                    +
                  </span>
                  <span aria-hidden="true" className="hidden text-xl leading-none text-pub-enlace group-open:inline">
                    −
                  </span>
                </summary>
                <div className="max-w-[70ch] pb-3.5 text-[0.9375rem] text-pub-texto-secundario">
                  <Parrafos texto={p.respuesta} className="mt-0 [&+p]:mt-2" />
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
