import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { BotonImprimir } from "@/components/boton-imprimir";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL, CLASE_ENLACE } from "@/components/formulario";
import { exigirPantalla } from "@/lib/auth/sesion";
import { expedientes, type FilaPanel, type FilaPlazoPanel, type Lista, type MovimientoPanel } from "@/lib/dominio/expedientes/servidor";
import { formatearFecha, formatearFechaHora, formatearSegunPrecision } from "@/lib/fechas";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { mostrarPlazo } from "@/lib/presentacion/estados";
import { textoDias } from "@/lib/presentacion/flujo";
import { enlaceConteo, leerFiltrosPanel, textoCantidad, textoMes } from "@/lib/presentacion/panel";
import { COLOR_ESTADO, ETIQUETA_ESTADO, etiquetaMovimiento } from "@/lib/presentacion/textos";

export const metadata: Metadata = { title: "Panel" };

/**
 * Panel (sección 5, `/panel`): el inicio de Dirección y del admin, y lo puede
 * mirar cualquiera. Conteos por estado, la matriz área × tipo de trámite,
 * demorados, plazos DIM, enviados sin confirmar hace más de 2 días hábiles,
 * pases diferidos y correcciones del mes, cargas históricas abiertas y
 * avisos. Cada número que tiene un filtro equivalente lleva a la búsqueda
 * filtrada (`rutaBusqueda()`); las filas, a la ficha. Se imprime con
 * `@media print` (el encabezado y los filtros no salen).
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
    <section aria-labelledby="titulo-pantalla" className="space-y-6 print:space-y-4 print:text-[11px]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 id="titulo-pantalla" className="text-xl font-semibold text-slate-900">
            Panel
          </h1>
          <p className="text-sm text-slate-600">
            Al {formatearFecha(panel.hoy)}
            {tipo ? ` · ${tipo.nombre}` : ""}
            {cementerio ? ` · ${cementerio.nombre}` : ""}
            {" · "}sin las cargas históricas abiertas, salvo en su bloque
          </p>
        </div>
        <BotonImprimir />
      </div>

      <Form action="/panel" className="flex flex-wrap items-end gap-3 rounded border border-slate-300 bg-white p-3 print:hidden" aria-label="Filtros del panel">
        <div>
          <label htmlFor="panel-tramite" className="mb-1 block text-sm font-medium text-slate-800">
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
        <div>
          <label htmlFor="panel-cementerio" className="mb-1 block text-sm font-medium text-slate-800">
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
        <button type="submit" className={CLASE_BOTON_PRIMARIO}>
          Aplicar
        </button>
        <Link href="/panel" className={CLASE_BOTON_SECUNDARIO}>
          Limpiar
        </Link>
      </Form>

      {panel.avisos.length > 0 ? (
        <ul className="space-y-1">
          {panel.avisos.map((a) => (
            <li key={`${a.tipo}-${a.anio}`} className="flex items-start gap-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {a.mensaje}
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="titulo-estados" className="break-inside-avoid">
        <h2 id="titulo-estados" className="mb-2 text-base font-semibold text-slate-900">
          Expedientes por estado <span className="font-normal text-slate-600">({textoCantidad(total)})</span>
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {panel.conteos.map((c) => (
            <li key={c.estado}>
              <Link
                href={enlaceConteo(c.busqueda) ?? "/expedientes"}
                prefetch={false}
                className="block rounded border border-slate-300 bg-white p-3 hover:border-slate-500 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 print:p-2"
              >
                <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${COLOR_ESTADO[c.estado]}`}>{ETIQUETA_ESTADO[c.estado]}</span>
                <span className="mt-1 block text-2xl font-semibold text-slate-900 print:text-lg">{c.cantidad.toLocaleString("es-AR")}</span>
                <span className="sr-only"> expedientes: ver en la búsqueda</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Matriz panel={panel} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 print:grid-cols-1">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 print:grid-cols-1">
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

type DatosPanel = Awaited<ReturnType<typeof expedientes.panel>>;

function Matriz({ panel }: { panel: DatosPanel }) {
  const { areas, tipos, celdas } = panel.matriz;
  const celda = (areaId: number, tipoId: number) => celdas.find((c) => c.areaId === areaId && c.tipoTramiteId === tipoId);
  return (
    <section aria-labelledby="titulo-matriz" className="break-inside-avoid">
      <h2 id="titulo-matriz" className="mb-2 text-base font-semibold text-slate-900">
        En trámite por área y tipo de trámite
      </h2>
      {areas.length === 0 || tipos.length === 0 ? (
        <p className="rounded border border-slate-300 bg-white px-3 py-4 text-sm text-slate-700">No hay expedientes en trámite.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Cantidad de expedientes en trámite según el área donde están y el tipo de trámite</caption>
            <thead className="border-b border-slate-300 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Área
                </th>
                {tipos.map((t) => (
                  <th key={t.id} scope="col" className="px-3 py-2 text-right">
                    {t.nombre}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {areas.map((a) => {
                const suma = tipos.reduce((s, t) => s + (celda(a.id, t.id)?.cantidad ?? 0), 0);
                return (
                  <tr key={a.id}>
                    <th scope="row" className="px-3 py-1.5 font-normal text-slate-900">
                      {a.nombre}
                    </th>
                    {tipos.map((t) => {
                      const c = celda(a.id, t.id);
                      return (
                        <td key={t.id} className="px-3 py-1.5 text-right tabular-nums">
                          {c && c.cantidad > 0 ? (
                            <Link href={enlaceConteo(c.busqueda) ?? "/expedientes"} prefetch={false} className={CLASE_ENLACE}>
                              {c.cantidad}
                              <span className="sr-only">
                                {" "}
                                en {a.nombre}, {t.nombre}: ver en la búsqueda
                              </span>
                            </Link>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{suma}</td>
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
  const color = lista.cantidad === 0 ? "bg-slate-200 text-slate-700" : alerta === "rojo" ? "bg-red-700 text-white" : alerta === "ambar" ? "bg-amber-600 text-white" : "bg-slate-800 text-white";
  return (
    <section aria-labelledby={`titulo-${id}`} className="rounded border border-slate-300 bg-white p-4 print:break-inside-avoid print:p-2">
      <h2 id={`titulo-${id}`} className="mb-2 flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
        {titulo}
        {enlace ? (
          <Link href={enlace} prefetch={false} className={`rounded-full px-2 text-sm ${color} hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800`}>
            {lista.cantidad}
            <span className="sr-only">: ver en la búsqueda</span>
          </Link>
        ) : (
          <span className={`rounded-full px-2 text-sm ${color}`}>{lista.cantidad}</span>
        )}
      </h2>
      {lista.cantidad === 0 ? <p className="text-sm text-slate-600">Ninguno.</p> : children}
      {lista.filas.length < lista.cantidad ? (
        <p className="mt-2 text-xs text-slate-600">
          Se muestran {lista.filas.length} de {textoCantidad(lista.cantidad, singular, plural)}.
        </p>
      ) : null}
    </section>
  );
}

const CLASE_TABLA = "w-full text-left text-sm";
const CLASE_THEAD = "border-b border-slate-300 bg-slate-50 text-xs uppercase tracking-wide text-slate-600";

function CeldaNumero({ numero, numeroCorto }: { numero: string; numeroCorto: string }) {
  return (
    <th scope="row" className="px-2 py-1.5 font-normal whitespace-nowrap">
      <Link href={rutaFicha(numero)} prefetch={false} className={`${CLASE_ENLACE} font-mono`}>
        {numero}
      </Link>
      <span className="block text-xs text-slate-600">{numeroCorto}</span>
    </th>
  );
}

function TablaFilas({ filas, conAlerta = false }: { filas: FilaPanel[]; conAlerta?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={CLASE_TABLA}>
        <thead className={CLASE_THEAD}>
          <tr>
            <th scope="col" className="px-2 py-1.5">N° interno</th>
            <th scope="col" className="px-2 py-1.5">Titular</th>
            <th scope="col" className="px-2 py-1.5">Trámite y paso</th>
            <th scope="col" className="px-2 py-1.5">Área</th>
            <th scope="col" className="px-2 py-1.5">En el área</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {filas.map((f) => (
            <tr key={f.numero} className="align-top">
              <CeldaNumero numero={f.numero} numeroCorto={f.numeroCorto} />
              <td className="px-2 py-1.5">{f.titular ?? "—"}</td>
              <td className="px-2 py-1.5">
                {f.tramite}
                <span className="block text-xs text-slate-600">{f.paso}</span>
              </td>
              <td className="px-2 py-1.5">{f.areaActual.nombre}</td>
              <td className="px-2 py-1.5">
                <span className={conAlerta ? "font-medium text-red-800" : undefined}>{textoDias(f.diasEnArea)}</span>
                {conAlerta && f.diasAlerta !== null ? <span className="block text-xs text-slate-600">alerta a los {f.diasAlerta}</span> : null}
                <span className="block text-xs text-slate-600">desde {formatearFecha(f.enAreaDesde)}</span>
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
    <div className="overflow-x-auto">
      <table className={CLASE_TABLA}>
        <thead className={CLASE_THEAD}>
          <tr>
            <th scope="col" className="px-2 py-1.5">N° interno</th>
            <th scope="col" className="px-2 py-1.5">Titular</th>
            <th scope="col" className="px-2 py-1.5">Vencimiento</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {filas.map((f) => {
            const p = mostrarPlazo(f.plazo);
            return (
              <tr key={f.numero} className="align-top">
                <CeldaNumero numero={f.numero} numeroCorto={f.numeroCorto} />
                <td className="px-2 py-1.5">
                  {f.titular ?? "—"}
                  <span className="block text-xs text-slate-600">{f.tramite}</span>
                </td>
                <td className="px-2 py-1.5">
                  <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${p.clase}`}>{p.etiqueta}</span>
                  <span className="block">{f.plazo.vence ? formatearFecha(f.plazo.vence) : "—"}</span>
                  <span className="block text-xs text-slate-700">{p.texto}</span>
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
    <div className="overflow-x-auto">
      <table className={CLASE_TABLA}>
        <thead className={CLASE_THEAD}>
          <tr>
            <th scope="col" className="px-2 py-1.5">Expediente</th>
            <th scope="col" className="px-2 py-1.5">Movimiento</th>
            <th scope="col" className="px-2 py-1.5">Cargado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {filas.map((m) => (
            <tr key={m.movimientoId} className="align-top">
              <th scope="row" className="px-2 py-1.5 font-normal whitespace-nowrap">
                <Link href={`${rutaFicha(m.numero)}#mov-${m.movimientoId}`} prefetch={false} className={`${CLASE_ENLACE} font-mono`}>
                  {m.numero}
                </Link>
              </th>
              <td className="px-2 py-1.5">
                {etiquetaMovimiento(m.tipo)} del {formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}
                {conMotivo && m.motivo ? <span className="block text-xs text-slate-600">{m.motivo}</span> : null}
              </td>
              <td className="px-2 py-1.5">
                {formatearFechaHora(m.registradoEn)}
                <span className="block text-xs text-slate-600">{m.usuario}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
