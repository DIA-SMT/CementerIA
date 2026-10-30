import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronDown, Clock3, ExternalLink, MapPin, Megaphone, Search, Users } from "lucide-react";
import { ChipPublico, CONTENEDOR_PUBLICO as CONTENEDOR, FOCO_PUBLICO as FOCO, FOCO_SOBRE_FOTO, ICONOS_PAGINAS } from "@/components/publico";
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
  TITULO_SITIO,
} from "@/lib/presentacion/sitio-publico";

/**
 * El contenido de las páginas públicas (28/10/2026; docs/diseno.md, "Página
 * pública"). El inicio (`/`): el hero de alto completo, los seis accesos, las
 * novedades, el adelanto de los próximos recorridos y la banda de la
 * consulta, todo sobre el fondo fijo. Las páginas internas: los cementerios,
 * los horarios de visita, los recorridos, los trámites y el contacto con las
 * preguntas frecuentes (la consulta está en src/app/(publico)/consulta/), que
 * van dentro del panel de lectura. Server Components, sin JavaScript.
 *
 * Claro y oscuro: solo tokens `pub-*` (src/app/globals.css). Sobre la foto,
 * vidrio: las tarjetas en `.vidrio` (claro en claro) y `.vidrio-azul`; las
 * pastillas y los botones chicos en `.vidrio-foto`; el texto que va directo
 * encima, en `pub-sobre-foto-*` (claro en los dos modos: el velo es azul).
 * Dentro del panel, superficies opacas.
 *
 * En las internas el `h1` es el del encabezado (PaginaInterna, en
 * ./publico.tsx): acá los títulos empiezan en `h2`.
 *
 * El contenido lo carga la Dirección (/admin/sitio-publico) y en producción
 * arranca vacío: cada página muestra solo lo cargado y, si no hay nada, dice
 * a dónde ir. Todo el texto de la base va como texto (React lo escapa): nada
 * de HTML ni Markdown.
 */

const FOCO_OSCURO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-celeste";

const BOTON_BASE = "inline-flex min-h-10 items-center gap-1.5 rounded-control border px-3.5 py-2 text-sm font-semibold transition-colors duration-150";
const BOTON = `${BOTON_BASE} ${FOCO}`;
const BOTON_PRIMARIO = `${BOTON} border-primario bg-primario text-white hover:border-primario-oscuro hover:bg-primario-oscuro`;
const BOTON_SECUNDARIO = `${BOTON} border-pub-borde bg-pub-superficie text-pub-titulo hover:border-pub-enlace hover:bg-pub-chip`;
const TITULO_TARJETA = "text-[1.1875rem] font-bold text-pub-titulo";
/** Una tarjeta dentro del panel de lectura: opaca, con borde y sombra suave. */
const TARJETA = "rounded-[14px] border border-pub-borde bg-pub-superficie";
/** Un enlace dentro del texto. */
const ENLACE = `rounded-sm text-pub-enlace underline underline-offset-2 ${FOCO}`;

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
 * El encabezado de una sección del inicio: el antetítulo (la pastilla de
 * vidrio), el `h2` claro sobre el halo (va directo sobre la foto, que se
 * desplaza detrás: el halo asegura el contraste en cualquier posición) y, a la
 * derecha, un enlace (si hay, en `.vidrio-foto`). Mismo ritmo en todas las
 * secciones.
 */
function EncabezadoSeccion({ id, antetitulo, titulo, children }: { id: string; antetitulo: string; titulo: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="relative isolate max-w-[60ch]">
        <span aria-hidden="true" className="halo-publico absolute -inset-x-6 -inset-y-5 -z-10 rounded-[40px]" />
        <ChipPublico>{antetitulo}</ChipPublico>
        <h2 id={id} className="mt-2.5 text-[1.5rem] font-bold leading-tight tracking-tight text-pub-sobre-foto-titulo sm:text-[1.875rem]">
          {titulo}
        </h2>
      </div>
      {children}
    </div>
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
 * y el mes, el recorrido, el día completo y la hora. `superficie`: vidrio
 * sobre la foto (el inicio) u opaca dentro del panel (/recorridos).
 */
function ListaFechas({ fechas, className, superficie }: { fechas: FechaRecorridoPublica[]; className: string; superficie: "vidrio" | "panel" }) {
  return (
    <ul className={className} data-proximas-fechas="">
      {fechas.map((f) => {
        const p = partesFechaRecorrido(f.fecha);
        return (
          <li key={f.id} className={`flex items-center gap-3.5 rounded-xl px-3.5 py-3 ${superficie === "vidrio" ? "vidrio" : "border border-pub-borde bg-pub-superficie"}`}>
            <span aria-hidden="true" className="w-14 shrink-0 rounded-[10px] bg-institucional py-1.5 text-center leading-tight text-white ring-1 ring-celeste/30">
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
 * el inicio, en vidrio y con su título visible; en /horarios, dentro del
 * panel, con el título solo para lectores.
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
          <div
            key={n.id}
            className={`flex items-start gap-3 rounded-xl border-l-4 border-l-amarillo px-4 py-3.5 ${enInicio ? "vidrio" : "border border-pub-borde bg-pub-superficie"}`}
          >
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
// Inicio: hero, accesos, novedades, próximos recorridos y la consulta
// ---------------------------------------------------------------------------

/**
 * El hero: alto completo (la pantalla menos la barra), sobre el fondo fijo.
 * El antetítulo en una pastilla de vidrio, el `h1`, el filete, la bajada y
 * los dos llamados ("Consultá tu trámite" primario, "Horarios de visita"
 * secundario, en `.vidrio-foto`), en los colores claros de
 * `pub-sobre-foto-*` y sobre el halo que asegura el contraste en cualquier
 * ancho (docs/diseno.md). En claro, el primario lleva un filete blanco para
 * despegarse del velo azul. Abajo, el indicador para bajar (un enlace a los
 * accesos) y la línea celeste que cierra el hero.
 */
export function Hero() {
  return (
    <section aria-labelledby="titulo-inicio" className="relative flex min-h-[calc(100svh-4rem)] flex-col">
      <div className={`${CONTENEDOR} flex flex-1 flex-col items-center justify-center pb-10 pt-14 text-center sm:pt-16`}>
        <div className="relative isolate mx-auto max-w-[52rem]">
          <span aria-hidden="true" className="halo-publico absolute -inset-x-8 -inset-y-8 -z-10 rounded-[56px] sm:-inset-x-14" />
          <ChipPublico className="px-3.5 py-1.5">Municipalidad de San Miguel de Tucumán</ChipPublico>
          <h1 id="titulo-inicio" className="mx-auto mt-5 text-balance text-[2.125rem] font-extrabold leading-[1.05] tracking-tight text-pub-sobre-foto-titulo sm:text-5xl lg:text-[3.75rem]">
            {TITULO_SITIO}
          </h1>
          <span aria-hidden="true" className="mx-auto mt-5 block h-1 w-16 rounded-full bg-amarillo" />
          <p className="mx-auto mt-5 max-w-[56ch] text-pretty text-base font-medium text-pub-sobre-foto-texto sm:text-[1.1875rem]">
            Horarios de visita, recorridos por el patrimonio, trámites y seguimiento de expedientes, en un solo lugar.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/consulta"
              className={`inline-flex min-h-12 items-center gap-2 rounded-control bg-primario px-5 text-[0.9375rem] font-semibold text-white shadow-[0_8px_24px_rgb(15_104_255/0.35)] ring-1 ring-white/45 transition-colors duration-150 hover:bg-primario-oscuro pub-oscuro:ring-0 ${FOCO_SOBRE_FOTO}`}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Consultá tu trámite
            </Link>
            <Link
              href="/horarios"
              className={`vidrio-foto inline-flex min-h-12 items-center gap-2 rounded-control px-5 text-[0.9375rem] font-semibold text-pub-sobre-foto-titulo transition-colors duration-150 hover:border-pub-sobre-foto-enlace ${FOCO_SOBRE_FOTO}`}
            >
              <Clock3 className="h-4 w-4 text-pub-sobre-foto-enlace" aria-hidden="true" />
              Horarios de visita
            </Link>
          </div>
        </div>
      </div>
      <div className="flex justify-center pb-6">
        <a
          href="#accesos"
          className={`vidrio-foto group inline-flex items-center gap-2 rounded-full py-1.5 pl-3.5 pr-2 text-xs font-semibold uppercase tracking-[0.14em] text-pub-sobre-foto-texto ${FOCO_SOBRE_FOTO}`}
        >
          Explorá el sitio
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-celeste/14 text-pub-sobre-foto-enlace transition-transform duration-150 group-hover:translate-y-0.5">
            <ChevronDown className="h-4 w-4" />
          </span>
        </a>
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-celeste/70 to-transparent" />
    </section>
  );
}

/**
 * Los seis accesos (uno por página, en el orden de la barra), en vidrio, y
 * debajo las novedades vigentes. "Consultá tu trámite", destacada en vidrio
 * azul con el ícono amarillo.
 */
export function AccesosYNovedades({ novedades }: { novedades: ContenidoSitioPublico["novedades"] }) {
  return (
    <div className={`${CONTENEDOR} pt-14 sm:pt-20`}>
      <nav id="accesos" aria-label="Accesos rápidos" className="scroll-mt-20">
        <EncabezadoSeccion id="titulo-secciones" antetitulo="Secciones" titulo="Todo lo que necesitás, en un lugar" />
        <ul className="grid gap-3 min-[560px]:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {NAVEGACION_PUBLICA.map(({ ruta, destacada }) => {
            const { titulo, resumen } = PAGINAS_PUBLICAS[ruta];
            const Icono = ICONOS_PAGINAS[ruta];
            return (
              <li key={ruta}>
                <Link
                  href={ruta}
                  className={`group flex h-full items-start gap-3.5 rounded-2xl p-5 transition-[translate,border-color] duration-150 hover:-translate-y-0.5 ${
                    destacada ? `vidrio-azul ${FOCO_OSCURO}` : `vidrio text-pub-texto hover:border-pub-enlace ${FOCO}`
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ${destacada ? "bg-white/10 text-amarillo ring-white/15" : "bg-pub-chip text-pub-enlace ring-pub-borde"}`}
                  >
                    <Icono className="h-[22px] w-[22px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-base font-bold leading-tight ${destacada ? "text-white" : "text-pub-titulo"}`}>{titulo}</span>
                    <span className={`mt-1 block text-[0.875rem] leading-snug ${destacada ? "text-institucional-texto" : "text-pub-texto-secundario"}`}>{resumen}</span>
                  </span>
                  <ArrowRight
                    className={`mt-0.5 h-4 w-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 ${destacada ? "text-amarillo" : "text-pub-enlace"}`}
                    aria-hidden="true"
                  />
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

/** "Próximos recorridos": hasta tres fechas y el enlace a la página. Sin fechas, no se muestra. */
export function AdelantoRecorridos({ fechas }: { fechas: FechaRecorridoPublica[] }) {
  if (fechas.length === 0) return null;
  return (
    <section aria-labelledby="titulo-proximos" className={`${CONTENEDOR} pt-14 sm:pt-20`}>
      <EncabezadoSeccion id="titulo-proximos" antetitulo="Patrimonio" titulo="Próximos recorridos">
        <Link href="/recorridos" className={`vidrio-foto ${BOTON_BASE} text-pub-sobre-foto-titulo hover:border-pub-sobre-foto-enlace ${FOCO_SOBRE_FOTO}`}>
          Ver todos los recorridos
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </EncabezadoSeccion>
      <ListaFechas fechas={fechas.slice(0, 3)} className="grid gap-3 md:grid-cols-3" superficie="vidrio" />
    </section>
  );
}

/**
 * La banda corta de la consulta: a `/consulta`, donde están los pasos y el
 * formulario. En vidrio azul, con el anillo celeste y la trama, dentro del
 * contenedor (a todo el ancho se pegaría al pie, del mismo azul).
 */
export function BandaConsulta() {
  return (
    <section aria-labelledby="titulo-banda-consulta" className={`${CONTENEDOR} py-14 sm:py-20`}>
      <div className="vidrio-azul isolate flex flex-wrap items-center justify-between gap-x-10 gap-y-5 overflow-hidden rounded-[20px] px-6 py-8 sm:px-10 sm:py-10">
        <span aria-hidden="true" className="pointer-events-none absolute -right-[120px] -top-[140px] -z-10 hidden h-[360px] w-[360px] rounded-full border border-celeste/20 sm:block" />
        <span aria-hidden="true" className="pointer-events-none absolute -right-[60px] -top-[80px] -z-10 hidden h-[240px] w-[240px] rounded-full border border-celeste/10 sm:block" />
        <div className="max-w-[60ch]">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8fd6fb]">Seguimiento en línea</p>
          <h2 id="titulo-banda-consulta" className="mt-1.5 text-[1.5rem] font-bold tracking-tight text-white sm:text-[1.875rem]">
            Consultá tu trámite
          </h2>
          <p className="mt-2 text-institucional-texto">
            Con el número de expediente y el código de consulta del comprobante que te dieron en Mesa de Entradas, o escaneando su QR.
          </p>
        </div>
        <Link
          href="/consulta"
          className={`inline-flex min-h-11 items-center gap-2 rounded-control bg-amarillo px-5 py-2.5 text-[0.9375rem] font-bold text-institucional transition-colors duration-150 hover:bg-white ${FOCO_OSCURO}`}
        >
          Consultar mi trámite
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
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
            <ListaFechas fechas={sitio.fechas} className="grid gap-2.5" superficie="panel" />
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
