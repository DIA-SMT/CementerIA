import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, FileSpreadsheet, Plus, Search } from "lucide-react";
import { EtiquetaEstado } from "@/components/etiquetas";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL, CLASE_ENLACE } from "@/components/formulario";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type ResultadoBusqueda } from "@/lib/dominio/expedientes/servidor";
import { ESTADOS_EXPEDIENTE, puede } from "@/lib/dominio/permisos";
import { formatearFecha } from "@/lib/fechas";
import { cantidadDeFiltros, leerParametrosBusqueda } from "@/lib/presentacion/busqueda";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { rutaExportarDesde } from "@/lib/presentacion/exportar-http";
import { ETIQUETA_ESTADO } from "@/lib/presentacion/textos";
import { FiltroCementerio } from "./filtro-cementerio";

export const metadata: Metadata = { title: "Buscar expedientes" };

/**
 * Buscador (sección 5, `/expedientes`; caja única de 2.13(g)). La búsqueda
 * vive en la URL (`?q=` y los filtros): el formulario es GET y el buscador del
 * encabezado manda acá. Si el dominio dice `abrir` (un número interno, o una
 * búsqueda numérica con un solo resultado), se va directo a la ficha.
 *
 * Buscar no registra accesos; abrir la ficha sí (por eso los enlaces de los
 * resultados van sin prefetch).
 *
 * Semana 4: "Exportar CSV" (Dirección y admin) descarga lo mismo que se ve,
 * con los filtros de la URL, desde el Route Handler `/expedientes/exportar`
 * (queda registrado; sin teléfono, correo ni domicilio).
 */
export default async function PaginaExpedientes(props: PageProps<"/expedientes">) {
  const usuario = await exigirPantalla("expedientes");
  const parametros = await props.searchParams;
  const { valores, entrada, conCriterio } = leerParametrosBusqueda(parametros);
  const exportar = puede("exportar_csv", null, usuario);
  const opciones = await expedientes.opcionesBusqueda();

  let resultado: ResultadoBusqueda | null = null;
  let error: string | null = null;
  try {
    resultado = await expedientes.buscar(usuario, entrada);
  } catch (e) {
    if (!(e instanceof ErrorDominio)) throw e;
    error = e.message;
  }
  if (resultado?.abrir) redirect(rutaFicha(resultado.abrir));

  const filtrosPuestos = cantidadDeFiltros(valores);
  const numerica = resultado?.consulta.tipo === "numerica";

  return (
    <section aria-labelledby="titulo-pantalla" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="titulo-pantalla" className="text-xl font-semibold text-slate-900">
          Buscar expedientes
        </h1>
        <div className="flex flex-wrap gap-2">
          {exportar ? (
            // Un <a> y no un Link: es una descarga (no se navega ni se precarga, y cada clic queda registrado).
            <a href={rutaExportarDesde(parametros)} download className={CLASE_BOTON_SECUNDARIO}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Exportar CSV
              <span className="sr-only"> con los filtros de esta búsqueda (queda registrado)</span>
            </a>
          ) : null}
          {puede("alta", null, usuario) ? (
            <Link href="/expedientes/nuevo" className={CLASE_BOTON_PRIMARIO}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuevo
            </Link>
          ) : null}
        </div>
      </div>

      <Form action="/expedientes" role="search" aria-label="Buscar expedientes" className="space-y-3 rounded border border-slate-300 bg-white p-4">
        <div>
          <label htmlFor="busqueda-q" className="mb-1 block text-sm font-medium text-slate-800">
            N° interno o municipal, padrón, DNI, CUIT, apellido o razón social
          </label>
          <div className="flex gap-2">
            <input
              id="busqueda-q"
              name="q"
              type="search"
              defaultValue={valores.q}
              autoComplete="off"
              // En el mostrador se llega a buscar: el cursor ya está en la caja.
              autoFocus={!conCriterio}
              aria-describedby="busqueda-q-ayuda"
              className={CLASE_CONTROL}
            />
            <button type="submit" className={CLASE_BOTON_PRIMARIO}>
              <Search className="h-4 w-4" aria-hidden="true" />
              Buscar
            </button>
          </div>
          <p id="busqueda-q-ayuda" className="mt-1 text-xs text-slate-600">
            Con &quot;CEM-2026-42&quot; abre ese expediente. Un número (30.111.222, 1234/2026) busca por N° municipal, padrón, DNI o N°
            interno; un texto, por nombre, ubicación o datos del trámite. Enter para buscar.
          </p>
        </div>

        <details open={filtrosPuestos > 0} className="group">
          <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-slate-600">
            Filtros{filtrosPuestos > 0 ? ` (${filtrosPuestos})` : ""}
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <fieldset className="sm:col-span-4">
              <legend className="mb-1 text-sm font-medium text-slate-800">Estado</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {ESTADOS_EXPEDIENTE.filter((e) => e !== "anulado").map((e) => (
                  <label key={e} className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" name="estado" value={e} defaultChecked={valores.estados.includes(e)} className={CLASE_CASILLA} />
                    {ETIQUETA_ESTADO[e]}
                  </label>
                ))}
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="anulados" value="1" defaultChecked={valores.anulados} className={CLASE_CASILLA} />
                  Incluir anulados
                </label>
              </div>
            </fieldset>
            <div>
              <label htmlFor="filtro-tramite" className="mb-1 block text-sm font-medium text-slate-800">
                Tipo de trámite
              </label>
              <select id="filtro-tramite" name="tramite" defaultValue={valores.tramite} className={CLASE_CONTROL}>
                <option value="">Todos</option>
                {opciones.tiposTramite.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filtro-plantilla" className="mb-1 block text-sm font-medium text-slate-800">
                Plantilla
              </label>
              <select id="filtro-plantilla" name="plantilla" defaultValue={valores.plantilla} className={CLASE_CONTROL}>
                <option value="">Todas</option>
                {opciones.plantillas.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filtro-area" className="mb-1 block text-sm font-medium text-slate-800">
                Área actual
              </label>
              <select id="filtro-area" name="area" defaultValue={valores.area} className={CLASE_CONTROL}>
                <option value="">Todas</option>
                {opciones.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-800">Fecha de inicio</legend>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="filtro-desde" className="block text-xs text-slate-700">
                    Desde
                  </label>
                  <input id="filtro-desde" name="desde" type="date" defaultValue={valores.desde} className={CLASE_CONTROL} />
                </div>
                <div className="flex-1">
                  <label htmlFor="filtro-hasta" className="block text-xs text-slate-700">
                    Hasta
                  </label>
                  <input id="filtro-hasta" name="hasta" type="date" defaultValue={valores.hasta} className={CLASE_CONTROL} />
                </div>
              </div>
            </fieldset>
            <FiltroCementerio cementerios={opciones.cementerios} cementerio={valores.cementerio} ubicacion={valores.ubicacion} />
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" className={CLASE_BOTON_PRIMARIO}>
              Aplicar filtros
            </button>
            <Link href="/expedientes" className={CLASE_BOTON_SECUNDARIO}>
              Limpiar
            </Link>
          </div>
        </details>
      </Form>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {resultado ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-700" aria-live="polite">
            {resultado.consulta.tipo === "numero_interno"
              ? `No existe el expediente ${resultado.consulta.numero}.`
              : !conCriterio
                ? `Los ${resultado.resultados.length} expedientes más recientes.`
                : resultado.resultados.length === 0
                  ? "No se encontraron expedientes con esos datos."
                  : `${resultado.resultados.length} ${resultado.resultados.length === 1 ? "expediente" : "expedientes"}.`}
            {resultado.hayMas ? " Hay más: afiná la búsqueda o usá los filtros." : ""}
          </p>
          {resultado.resultados.length > 0 ? (
            <div className="overflow-x-auto rounded border border-slate-300 bg-white">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Resultados de la búsqueda</caption>
                <thead className="border-b border-slate-300 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      N° interno
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      N° municipal
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Titular
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Trámite
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Paso y área
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Estado
                    </th>
                    {numerica ? (
                      <th scope="col" className="px-3 py-2 font-medium">
                        Coincide por
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {resultado.resultados.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={rutaFicha(r.numero)} prefetch={false} className={`${CLASE_ENLACE} font-medium`}>
                          {r.numero}
                        </Link>
                        <div className="text-xs text-slate-600">{r.numeroCorto}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.numeroMunicipal ?? <span className="text-slate-500">—</span>}</td>
                      <td className="px-3 py-2">{r.titular ?? <span className="text-slate-500">—</span>}</td>
                      <td className="px-3 py-2">
                        <div>{r.tipoTramite.nombre}</div>
                        <div className="text-xs text-slate-600">
                          {r.plantilla.nombre} · v{r.plantilla.version}
                        </div>
                        <div className="text-xs text-slate-600">
                          {r.cementerio.nombre}
                          {r.ubicacionTexto ? ` · ${r.ubicacionTexto}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{r.paso.nombre}</div>
                        <div className="text-xs text-slate-600">{r.areaActual.nombre}</div>
                      </td>
                      <td className="px-3 py-2">
                        <EtiquetaEstado estado={r.estado} />
                        {r.sinConfirmar ? <div className="mt-1 text-xs text-slate-600">Sin confirmar recepción</div> : null}
                        {r.cargaHistorica ? <div className="mt-1 text-xs text-slate-600">Antes del sistema</div> : null}
                        <div className="mt-1 text-xs text-slate-600">Inicio {formatearFecha(r.fechaInicio)}</div>
                      </td>
                      {numerica ? <td className="px-3 py-2">{r.coincidencias.map((c) => c.etiqueta).join(", ")}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
