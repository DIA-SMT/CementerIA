import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Archive, ArrowRight, Ban, ChartColumnIncreasing, CircleCheck, FileText, FolderOpen, History, Hourglass, Library, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { BotonImprimir } from "@/components/boton-imprimir";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL, CLASE_ENLACE, CLASE_FOCO } from "@/components/formulario";
import { ICONO_PANTALLA } from "@/components/iconos-modulos";
import { PantallaConRecorrido } from "@/components/recorrido/proveedor";
import { exigirPantalla } from "@/lib/auth/sesion";
import { expedientes, type FilaPanel, type FilaPlazoPanel, type Lista, type MovimientoPanel } from "@/lib/dominio/expedientes/servidor";
import { navegacionPara, puedeVerPantalla, SECCIONES_ADMIN } from "@/lib/dominio/navegacion";
import { formatearFecha, formatearFechaHora, formatearSegunPrecision, inicioDelDiaEnTucuman, ZONA_TUCUMAN } from "@/lib/fechas";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { mostrarPlazo } from "@/lib/presentacion/estados";
import { textoDias } from "@/lib/presentacion/flujo";
import { enlaceConteo, leerFiltrosPanel, textoCantidad, textoMes } from "@/lib/presentacion/panel";
import { COLOR_ESTADO, ETIQUETA_ESTADO, etiquetaMovimiento } from "@/lib/presentacion/textos";

export const metadata: Metadata = { title: "Panel" };

/** El ícono de cada estado en las tarjetas de conteo (kit institucional): decorativo, el nombre va escrito. */
const ICONO_ESTADO: Record<keyof typeof ETIQUETA_ESTADO, LucideIcon> = {
  en_tramite: FolderOpen,
  espera_pago_dim: Hourglass,
  concluido: CircleCheck,
  archivado: Archive,
  anulado: Ban,
};

function IconoEstado({ estado }: { estado: keyof typeof ICONO_ESTADO }) {
  const Icono = ICONO_ESTADO[estado];
  return <Icono className="h-5 w-5" />;
}

/**
 * Panel (sección 5, `/panel`): el inicio de Dirección y del admin, y lo puede
 * mirar cualquiera. Conteos por estado, la matriz área × tipo de trámite,
 * demorados, plazos DIM, enviados sin confirmar hace más de 2 días hábiles,
 * pases diferidos y correcciones del mes, cargas históricas abiertas y
 * avisos. Cada número que tiene un filtro equivalente lleva a la búsqueda
 * filtrada (`rutaBusqueda()`); las filas, a la ficha. Se imprime con
 * `@media print` (la portada, el encabezado y los filtros no salen).
 *
 * Arriba va la portada con la marca y los accesos rápidos a los módulos que el
 * rol tiene (los mismos de la barra lateral, más las secciones de
 * Administración para el admin). Todos los números son los del dominio.
 * Dirección y el admin tienen además "Métricas de gestión" (/panel/metricas):
 * cómo viene funcionando el circuito, junto al botón de imprimir.
 *
 * Leer el panel no registra accesos (no muestra contacto); abrir una ficha sí
 * (por eso los enlaces van sin prefetch).
 */
export default async function PaginaPanel(props: PageProps<"/panel">) {
  const usuario = await exigirPantalla("panel");
  const { filtros, valores } = leerFiltrosPanel(await props.searchParams);
  const [panel, opciones] = await Promise.all([expedientes.panel(usuario, filtros), expedientes.opcionesBusqueda()]);
  const tipo = opciones.tiposTramite.find((t) => t.id === filtros.tipoTramiteId);
  const cementerio = opciones.cementerios.find((c) => c.id === filtros.cementerioId);
  const total = panel.conteos.reduce((s, c) => s + c.cantidad, 0);

  return (
    <section aria-labelledby="titulo-pantalla" className="@container space-y-6 print:space-y-4 print:text-[11px]">
      <PantallaConRecorrido id="panel" />
      <Portada nombre={usuario.nombre} hoy={panel.hoy} accesos={accesosRapidos(navegacionPara(usuario))} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="titulo-pantalla" className="text-2xl font-bold tracking-tight text-institucional print:text-xl">
            Panel
          </h1>
          <p className="mt-0.5 text-sm text-texto-secundario">
            Al {formatearFecha(panel.hoy)}
            {tipo ? ` · ${tipo.nombre}` : ""}
            {cementerio ? ` · ${cementerio.nombre}` : ""}
            {" · "}sin las cargas históricas abiertas, salvo en su bloque
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-recorrido="panel-imprimir">
          {puedeVerPantalla(usuario, "metricas") ? (
            <Link href="/panel/metricas" className={`${CLASE_BOTON_SECUNDARIO} print:hidden`}>
              <ChartColumnIncreasing className="h-4 w-4" aria-hidden="true" />
              Métricas de gestión
            </Link>
          ) : null}
          <BotonImprimir />
        </div>
      </div>

      <Form action="/panel" className="tarjeta flex flex-wrap items-end gap-3 p-4 print:hidden" aria-label="Filtros del panel" data-recorrido="panel-filtros">
        <div className="w-full sm:w-auto sm:min-w-56">
          <label htmlFor="panel-tramite" className="mb-1.5 block text-sm font-medium text-texto">
            Tipo de trámite
          </label>
          <select id="panel-tramite" name="tramite" defaultValue={valores.tramite} className={CLASE_CONTROL}>
            <option value="">Todos</option>
            {opciones.tiposTramite.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-auto sm:min-w-56">
          <label htmlFor="panel-cementerio" className="mb-1.5 block text-sm font-medium text-texto">
            Cementerio
          </label>
          <select id="panel-cementerio" name="cementerio" defaultValue={valores.cementerio} className={CLASE_CONTROL}>
            <option value="">Todos</option>
            {opciones.cementerios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={CLASE_BOTON_PRIMARIO}>
            Aplicar
          </button>
          <Link href="/panel" className={CLASE_BOTON_SECUNDARIO}>
            Limpiar
          </Link>
        </div>
      </Form>

      {panel.avisos.length > 0 ? (
        <ul className="space-y-2">
          {panel.avisos.map((a) => (
            <li
              key={`${a.tipo}-${a.anio}`}
              className="flex items-start gap-2 rounded-control border border-advertencia-borde bg-advertencia-fondo px-3 py-2.5 text-sm text-advertencia"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {a.mensaje}
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="titulo-estados" data-recorrido="panel-estados" className="break-inside-avoid">
        <h2 id="titulo-estados" className="titulo-seccion mb-3">
          Expedientes por estado <span className="font-normal text-texto-secundario">({textoCantidad(total)})</span>
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {panel.conteos.map((c) => (
            <li key={c.estado}>
              <Link
                href={enlaceConteo(c.busqueda) ?? "/expedientes"}
                prefetch={false}
                className={`tarjeta group flex h-full items-start gap-3 p-4 transition-[border-color,box-shadow,transform] duration-200 ease-salida hover:-translate-y-0.5 hover:border-primario hover:shadow-elevada motion-reduce:hover:translate-y-0 ${CLASE_FOCO} print:p-2`}
              >
                {/* El ícono del estado, en el color de su insignia (decorativo: el nombre está escrito). */}
                <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-inset print:hidden ${COLOR_ESTADO[c.estado]}`}>
                  <IconoEstado estado={c.estado} />
                </span>
                <span className="min-w-0">
                  <span className={`insignia max-w-full whitespace-normal ring-1 ring-inset ${COLOR_ESTADO[c.estado]}`}>{ETIQUETA_ESTADO[c.estado]}</span>
                  <span className="mt-1.5 block text-3xl font-semibold tracking-tight text-institucional tabular-nums print:text-lg">
                    {c.cantidad.toLocaleString("es-AR")}
                  </span>
                  <span className="sr-only"> expedientes: ver en la búsqueda</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Matriz panel={panel} />

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-2 print:grid-cols-1">
        <Bloque id="vencidos" titulo="Plazos DIM vencidos" lista={panel.plazos.vencidos} alerta="rojo">
          <TablaPlazos filas={panel.plazos.vencidos.filas} />
        </Bloque>
        <Bloque id="por-vencer" titulo="Plazos DIM por vencer (5 días hábiles o menos)" lista={panel.plazos.porVencer} alerta="ambar">
          <TablaPlazos filas={panel.plazos.porVencer.filas} />
        </Bloque>
      </div>

      <Bloque id="demorados" titulo="Demorados (días en el área según la alerta de cada paso)" lista={panel.demorados}>
        <TablaFilas filas={panel.demorados.filas} conAlerta />
      </Bloque>

      <Bloque id="sin-confirmar" titulo="Enviados sin confirmar hace más de 2 días hábiles" lista={panel.sinConfirmar}>
        <TablaFilas filas={panel.sinConfirmar.filas} />
      </Bloque>

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-2 print:grid-cols-1">
        <Bloque id="diferidos" titulo={`Pases diferidos de ${textoMes(panel.diferidos.mes)} (más de 48 h entre la fecha y la carga)`} lista={panel.diferidos} singular="movimiento" plural="movimientos">
          <TablaMovimientos filas={panel.diferidos.filas} />
        </Bloque>
        <Bloque id="correcciones" titulo={`Correcciones de ${textoMes(panel.correcciones.mes)}`} lista={panel.correcciones} singular="corrección" plural="correcciones">
          <TablaMovimientos filas={panel.correcciones.filas} conMotivo />
        </Bloque>
      </div>

      <Bloque id="cargas" titulo="Cargas históricas abiertas" lista={panel.cargasHistoricas}>
        <TablaFilas filas={panel.cargasHistoricas.filas} />
      </Bloque>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Portada y accesos rápidos
// ---------------------------------------------------------------------------

interface AccesoRapido {
  href: string;
  etiqueta: string;
  Icono: LucideIcon;
}

/** Cómo se rotula cada módulo en los accesos rápidos (más explícito que en la barra). */
const ETIQUETA_ACCESO: Record<string, string> = {
  "/bandeja": "Ir a la bandeja",
  "/expedientes/nuevo": "Nuevo expediente",
  "/expedientes": "Buscar expedientes",
  "/panel/metricas": "Métricas de gestión",
};

const ICONO_SECCION_ADMIN: Record<string, LucideIcon> = {
  "/admin/plantillas": FileText,
  "/admin/usuarios": Users,
  "/admin/catalogos": Library,
  "/admin/auditoria": History,
};

/**
 * Los accesos rápidos: los módulos del menú del rol (navegacionPara) menos el
 * panel, que es esta pantalla. Administración se abre en sus secciones. Nada
 * que el rol no tenga: es la misma lista que arma la barra lateral.
 */
function accesosRapidos(items: ReturnType<typeof navegacionPara>): AccesoRapido[] {
  return items
    .filter((item) => item.pantalla !== "panel")
    .flatMap((item): AccesoRapido[] =>
      item.pantalla === "admin"
        ? SECCIONES_ADMIN.map((s) => ({ href: s.href, etiqueta: s.etiqueta, Icono: ICONO_SECCION_ADMIN[s.href] ?? ICONO_PANTALLA.admin }))
        : [{ href: item.href, etiqueta: ETIQUETA_ACCESO[item.href] ?? item.etiqueta, Icono: ICONO_PANTALLA[item.pantalla] }],
    );
}

/** "jueves 30 de octubre de 2026", en hora de Tucumán: la fecha del banner. */
const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_TUCUMAN, weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * El banner de bienvenida (kit institucional, 30/10/2026; antes, la portada):
 * compacto, con `hero-dashboard` (conceptual, decorativa, `alt=""`) bajo un
 * velo azul parejo, más denso a la izquierda, donde va el texto (blanco: más
 * de 7:1 aunque la foto fuera blanca, docs/diseno.md). El saludo con el
 * nombre de quien entró, la Dirección, la fecha de hoy y los accesos rápidos.
 * Nada de cifras: los números del panel van abajo, los del dominio. No sale en
 * el papel.
 */
function Portada({ nombre, hoy, accesos }: { nombre: string; hoy: string; accesos: AccesoRapido[] }) {
  return (
    <div data-banner-bienvenida="" className="relative isolate overflow-hidden rounded-panel bg-institucional shadow-elevada print:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/assets. */}
      <img
        src="/assets/cementeria/hero-dashboard-960.webp"
        srcSet="/assets/cementeria/hero-dashboard-960.webp 960w, /assets/cementeria/hero-dashboard.webp 1672w"
        sizes="(min-width: 1024px) calc(100vw - 20rem), 100vw"
        width={1672}
        height={941}
        alt=""
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 -z-10 h-full w-full object-cover object-[50%_45%]"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-institucional/95 via-institucional/88 to-institucional/80" />
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-linear-to-r from-amarillo via-celeste to-primario" />
      <div className="flex flex-col gap-5 px-5 py-6 sm:px-8 lg:py-7">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="motion-safe:animate-aparecer">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-institucional-texto">Dirección de Cementerios</p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-white sm:text-[1.75rem]">Hola, {nombre}</p>
          </div>
          <p className="text-sm text-institucional-texto first-letter:uppercase">
            <time dateTime={hoy}>{FORMATO_FECHA_LARGA.format(inicioDelDiaEnTucuman(hoy))}</time>
          </p>
        </div>
        {accesos.length > 0 ? (
          <nav aria-label="Accesos rápidos" data-recorrido="panel-accesos">
            <ul className="flex flex-wrap gap-2">
              {accesos.map(({ href, etiqueta, Icono }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="group inline-flex min-h-10 items-center gap-2 rounded-control bg-white px-3.5 py-2 text-sm font-medium text-institucional shadow-xs transition-[background-color,transform] duration-200 ease-salida hover:-translate-y-px hover:bg-superficie-azul focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <Icono className="h-4 w-4 text-primario-oscuro" aria-hidden="true" />
                    {etiqueta}
                    <ArrowRight className="h-3.5 w-3.5 text-texto-secundario transition-transform duration-200 ease-salida group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Bloques y tablas
// ---------------------------------------------------------------------------

type DatosPanel = Awaited<ReturnType<typeof expedientes.panel>>;

function Matriz({ panel }: { panel: DatosPanel }) {
  const { areas, tipos, celdas } = panel.matriz;
  const celda = (areaId: number, tipoId: number) => celdas.find((c) => c.areaId === areaId && c.tipoTramiteId === tipoId);
  return (
    <section aria-labelledby="titulo-matriz" data-recorrido="panel-matriz" className="tarjeta overflow-hidden break-inside-avoid">
      <div className="border-b border-borde px-4 py-3 print:px-2 print:py-1.5">
        <h2 id="titulo-matriz" className="titulo-seccion">
          En trámite por área y tipo de trámite
        </h2>
      </div>
      {areas.length === 0 || tipos.length === 0 ? (
        <p className="px-4 py-4 text-sm text-texto-secundario">No hay expedientes en trámite.</p>
      ) : (
        <div className="relative @container overflow-x-auto">
          <table className="tabla-datos tabla-apilable-amplia">
            <caption className="sr-only">Cantidad de expedientes en trámite según el área donde están y el tipo de trámite</caption>
            <thead>
              <tr>
                <th scope="col" className={CLASE_CELDA}>
                  Área
                </th>
                {tipos.map((t) => (
                  <th key={t.id} scope="col" className={`${CLASE_CELDA} text-right`}>
                    {t.nombre}
                  </th>
                ))}
                <th scope="col" className={`${CLASE_CELDA} text-right`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => {
                const suma = tipos.reduce((s, t) => s + (celda(a.id, t.id)?.cantidad ?? 0), 0);
                return (
                  <tr key={a.id}>
                    <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                      {a.nombre}
                    </th>
                    {tipos.map((t) => {
                      const c = celda(a.id, t.id);
                      return (
                        <td key={t.id} data-etiqueta={t.nombre} className={`${CLASE_CELDA} text-right tabular-nums`}>
                          {c && c.cantidad > 0 ? (
                            <Link href={enlaceConteo(c.busqueda) ?? "/expedientes"} prefetch={false} className={`${CLASE_ENLACE} font-medium`}>
                              {c.cantidad}
                              <span className="sr-only">
                                {" "}
                                en {a.nombre}, {t.nombre}: ver en la búsqueda
                              </span>
                            </Link>
                          ) : (
                            <span className="text-texto-secundario">0</span>
                          )}
                        </td>
                      );
                    })}
                    <td data-etiqueta="Total" className={`${CLASE_CELDA} text-right font-semibold tabular-nums text-institucional`}>{suma}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Bloque({
  id,
  titulo,
  lista,
  alerta,
  singular = "expediente",
  plural = "expedientes",
  children,
}: {
  id: string;
  titulo: string;
  lista: Lista<unknown>;
  alerta?: "rojo" | "ambar";
  singular?: string;
  plural?: string;
  children: React.ReactNode;
}) {
  const enlace = enlaceConteo(lista.busqueda);
  // El número va junto al título: el color (rojo, ámbar) no es la única señal.
  const color =
    lista.cantidad === 0
      ? "bg-fondo text-texto-secundario ring-1 ring-inset ring-borde"
      : alerta === "rojo"
        ? "bg-error text-white"
        : alerta === "ambar"
          ? "bg-amarillo text-institucional"
          : "bg-institucional text-white";
  const clasePastilla = `min-w-7 rounded-full px-2 text-center text-sm font-semibold tabular-nums ${color}`;
  return (
    <section aria-labelledby={`titulo-${id}`} data-recorrido={`panel-${id}`} className="tarjeta overflow-hidden print:break-inside-avoid">
      <h2 id={`titulo-${id}`} className="titulo-seccion flex flex-wrap items-center gap-2 border-b border-borde px-4 py-3 print:px-2 print:py-1.5">
        {titulo}
        {enlace ? (
          <Link href={enlace} prefetch={false} className={`${clasePastilla} transition-opacity duration-150 hover:opacity-90 ${CLASE_FOCO}`}>
            {lista.cantidad}
            <span className="sr-only">: ver en la búsqueda</span>
          </Link>
        ) : (
          <span className={clasePastilla}>{lista.cantidad}</span>
        )}
      </h2>
      {lista.cantidad === 0 ? <p className="px-4 py-3 text-sm text-texto-secundario">Ninguno.</p> : children}
      {lista.filas.length < lista.cantidad ? (
        <p className="border-t border-borde px-4 py-2 text-xs text-texto-secundario">
          Se muestran {lista.filas.length} de {textoCantidad(lista.cantidad, singular, plural)}.
        </p>
      ) : null}
    </section>
  );
}

/** Las celdas de las tablas (`tabla-datos` de globals.css): compactas, con aire en los bordes de la tarjeta. */
const CLASE_CELDA = "px-3 py-2 align-top first:pl-4 last:pr-4 print:px-1.5 print:py-1";

function CeldaNumero({ numero, numeroCorto }: { numero: string; numeroCorto: string }) {
  return (
    <th scope="row" className={`${CLASE_CELDA} font-normal whitespace-nowrap`}>
      <Link href={rutaFicha(numero)} prefetch={false} className={`${CLASE_ENLACE} font-mono`}>
        {numero}
      </Link>
      <span className="block text-xs text-texto-secundario">{numeroCorto}</span>
    </th>
  );
}

function TablaFilas({ filas, conAlerta = false }: { filas: FilaPanel[]; conAlerta?: boolean }) {
  return (
    <div className="relative @container overflow-x-auto">
      <table className="tabla-datos tabla-apilable">
        <thead>
          <tr>
            <th scope="col" className={CLASE_CELDA}>N° interno</th>
            <th scope="col" className={CLASE_CELDA}>Titular</th>
            <th scope="col" className={CLASE_CELDA}>Trámite y paso</th>
            <th scope="col" className={CLASE_CELDA}>Área</th>
            <th scope="col" className={CLASE_CELDA}>En el área</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.numero}>
              <CeldaNumero numero={f.numero} numeroCorto={f.numeroCorto} />
              <td data-etiqueta="Titular" className={CLASE_CELDA}>{f.titular ?? "—"}</td>
              <td data-etiqueta="Trámite y paso" className={CLASE_CELDA}>
                {f.tramite}
                <span className="block text-xs text-texto-secundario">{f.paso}</span>
              </td>
              <td data-etiqueta="Área" className={CLASE_CELDA}>{f.areaActual.nombre}</td>
              <td data-etiqueta="En el área" className={CLASE_CELDA}>
                <span className={conAlerta ? "font-medium text-error" : undefined}>{textoDias(f.diasEnArea)}</span>
                {conAlerta && f.diasAlerta !== null ? <span className="block text-xs text-texto-secundario">alerta a los {f.diasAlerta}</span> : null}
                <span className="block text-xs text-texto-secundario">desde {formatearFecha(f.enAreaDesde)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaPlazos({ filas }: { filas: FilaPlazoPanel[] }) {
  return (
    <div className="relative @container overflow-x-auto">
      <table className="tabla-datos tabla-apilable-compacta">
        <thead>
          <tr>
            <th scope="col" className={CLASE_CELDA}>N° interno</th>
            <th scope="col" className={CLASE_CELDA}>Titular</th>
            <th scope="col" className={CLASE_CELDA}>Vencimiento</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const p = mostrarPlazo(f.plazo);
            return (
              <tr key={f.numero}>
                <CeldaNumero numero={f.numero} numeroCorto={f.numeroCorto} />
                <td data-etiqueta="Titular" className={CLASE_CELDA}>
                  {f.titular ?? "—"}
                  <span className="block text-xs text-texto-secundario">{f.tramite}</span>
                </td>
                <td data-etiqueta="Vencimiento" className={CLASE_CELDA}>
                  <span className={`insignia ring-1 ring-inset ${p.clase}`}>{p.etiqueta}</span>
                  <span className="mt-0.5 block">{f.plazo.vence ? formatearFecha(f.plazo.vence) : "—"}</span>
                  <span className="block text-xs text-texto-secundario">{p.texto}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TablaMovimientos({ filas, conMotivo = false }: { filas: MovimientoPanel[]; conMotivo?: boolean }) {
  return (
    <div className="relative @container overflow-x-auto">
      <table className="tabla-datos tabla-apilable-compacta">
        <thead>
          <tr>
            <th scope="col" className={CLASE_CELDA}>Expediente</th>
            <th scope="col" className={CLASE_CELDA}>Movimiento</th>
            <th scope="col" className={CLASE_CELDA}>Cargado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => (
            <tr key={m.movimientoId}>
              <th scope="row" className={`${CLASE_CELDA} font-normal whitespace-nowrap`}>
                <Link href={`${rutaFicha(m.numero)}#mov-${m.movimientoId}`} prefetch={false} className={`${CLASE_ENLACE} font-mono`}>
                  {m.numero}
                </Link>
              </th>
              <td data-etiqueta="Movimiento" className={CLASE_CELDA}>
                {etiquetaMovimiento(m.tipo)} del {formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}
                {conMotivo && m.motivo ? <span className="block text-xs text-texto-secundario">{m.motivo}</span> : null}
              </td>
              <td data-etiqueta="Cargado" className={CLASE_CELDA}>
                {formatearFechaHora(m.registradoEn)}
                <span className="block text-xs text-texto-secundario">{m.usuario}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
