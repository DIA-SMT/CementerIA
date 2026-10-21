import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileSpreadsheet, Plus, Search, SearchX, SlidersHorizontal } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { EncabezadoPagina } from "@/components/encabezado-pagina";
import { EstadoVacio } from "@/components/estado-vacio";
import { EtiquetaEstado } from "@/components/etiquetas";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL, CLASE_ENLACE, CLASE_FOCO } from "@/components/formulario";
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
      <EncabezadoPagina
        titulo="Buscar expedientes"
        antetitulo="Expedientes"
        acciones={
          <>
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
          </>
        }
      />

      <Form action="/expedientes" role="search" aria-label="Buscar expedientes" className="tarjeta space-y-4 p-4 sm:p-5">
        <div>
          <label htmlFor="busqueda-q" className="mb-1.5 block text-sm font-medium text-texto">
            N° interno o municipal, padrón, DNI, CUIT, apellido o razón social
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-secundario" aria-hidden="true" />
              <input
                id="busqueda-q"
                name="q"
                type="search"
                defaultValue={valores.q}
                autoComplete="off"
                // En el mostrador se llega a buscar: el cursor ya está en la caja.
                autoFocus={!conCriterio}
                aria-describedby="busqueda-q-ayuda"
                className={`${CLASE_CONTROL} pl-9`}
              />
            </div>
            <button type="submit" className={CLASE_BOTON_PRIMARIO}>
              <Search className="h-4 w-4" aria-hidden="true" />
              Buscar
            </button>
          </div>
          <p id="busqueda-q-ayuda" className="mt-1.5 text-xs text-texto-secundario">
            Con &quot;CEM-2026-42&quot; abre ese expediente. Un número (30.111.222, 1234/2026) busca por N° municipal, padrón, DNI o N°
            interno; un texto, por nombre, ubicación o datos del trámite. Enter para buscar.
          </p>
        </div>

        <details open={filtrosPuestos > 0} className="group border-t border-borde pt-3">
          <summary
            className={`inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-control px-1 text-sm font-semibold text-texto transition-colors duration-150 hover:text-primario-oscuro [&::-webkit-details-marker]:hidden ${CLASE_FOCO}`}
          >
            <ChevronRight className="h-4 w-4 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
            <SlidersHorizontal className="h-4 w-4 text-primario-oscuro" aria-hidden="true" />
            Filtros
            {filtrosPuestos > 0 ? (
              <span className="min-w-6 rounded-full bg-primario px-1.5 text-center text-xs font-semibold text-white tabular-nums">
                <span className="sr-only">(</span>
                {filtrosPuestos}
                <span className="sr-only">)</span>
              </span>
            ) : null}
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <fieldset className="sm:col-span-2 lg:col-span-4">
              <legend className="mb-1.5 text-sm font-medium text-texto">Estado</legend>
              <div className="flex flex-wrap gap-2">
                {ESTADOS_EXPEDIENTE.filter((e) => e !== "anulado").map((e) => (
                  <label key={e} className={CLASE_OPCION}>
                    <input type="checkbox" name="estado" value={e} defaultChecked={valores.estados.includes(e)} className={CLASE_CASILLA} />
                    {ETIQUETA_ESTADO[e]}
                  </label>
                ))}
                <label className={CLASE_OPCION}>
                  <input type="checkbox" name="anulados" value="1" defaultChecked={valores.anulados} className={CLASE_CASILLA} />
                  Incluir anulados
                </label>
              </div>
            </fieldset>
            <div>
              <label htmlFor="filtro-tramite" className="mb-1.5 block text-sm font-medium text-texto">
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
              <label htmlFor="filtro-plantilla" className="mb-1.5 block text-sm font-medium text-texto">
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
              <label htmlFor="filtro-area" className="mb-1.5 block text-sm font-medium text-texto">
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
              <legend className="mb-1.5 text-sm font-medium text-texto">Fecha de inicio</legend>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="filtro-desde" className="mb-1 block text-xs font-medium text-texto-secundario">
                    Desde
                  </label>
                  <input id="filtro-desde" name="desde" type="date" defaultValue={valores.desde} className={CLASE_CONTROL} />
                </div>
                <div className="min-w-0 flex-1">
                  <label htmlFor="filtro-hasta" className="mb-1 block text-xs font-medium text-texto-secundario">
                    Hasta
                  </label>
                  <input id="filtro-hasta" name="hasta" type="date" defaultValue={valores.hasta} className={CLASE_CONTROL} />
                </div>
              </div>
            </fieldset>
            <FiltroCementerio cementerios={opciones.cementerios} cementerio={valores.cementerio} ubicacion={valores.ubicacion} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-borde pt-4">
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
        <Aviso tono="error" role="alert">
          <p>{error}</p>
        </Aviso>
      ) : null}

      {resultado ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-texto" aria-live="polite">
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
            <div className="tarjeta relative overflow-x-auto">
              <table className="tabla-datos min-w-[760px]">
                <caption className="sr-only">Resultados de la búsqueda</caption>
                <thead>
                  <tr>
                    <th scope="col">N° interno</th>
                    <th scope="col">N° municipal</th>
                    <th scope="col">Titular</th>
                    <th scope="col">Trámite</th>
                    <th scope="col">Paso y área</th>
                    <th scope="col">Estado</th>
                    {numerica ? <th scope="col">Coincide por</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {resultado.resultados.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        <Link href={rutaFicha(r.numero)} prefetch={false} className={`${CLASE_ENLACE} font-mono font-medium`}>
                          {r.numero}
                        </Link>
                        <div className="text-xs text-texto-secundario">{r.numeroCorto}</div>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{r.numeroMunicipal ?? <span className="text-texto-secundario">—</span>}</td>
                      <td className="font-medium">{r.titular ?? <span className="font-normal text-texto-secundario">—</span>}</td>
                      <td>
                        <div>{r.tipoTramite.nombre}</div>
                        <div className="text-xs text-texto-secundario">
                          {r.plantilla.nombre} · v{r.plantilla.version}
                        </div>
                        <div className="text-xs text-texto-secundario">
                          {r.cementerio.nombre}
                          {r.ubicacionTexto ? ` · ${r.ubicacionTexto}` : ""}
                        </div>
                      </td>
                      <td>
                        <div>{r.paso.nombre}</div>
                        <div className="text-xs text-texto-secundario">{r.areaActual.nombre}</div>
                      </td>
                      <td>
                        <EtiquetaEstado estado={r.estado} />
                        {r.sinConfirmar ? <div className="mt-1 text-xs font-medium text-advertencia">Sin confirmar recepción</div> : null}
                        {r.cargaHistorica ? <div className="mt-1 text-xs text-texto-secundario">Antes del sistema</div> : null}
                        <div className="mt-1 whitespace-nowrap text-xs text-texto-secundario">Inicio {formatearFecha(r.fechaInicio)}</div>
                      </td>
                      {numerica ? (
                        <td>
                          <ul className="flex flex-wrap gap-1">
                            {r.coincidencias.map((c) => (
                              <li key={c.etiqueta} className="insignia bg-info-fondo text-info ring-1 ring-inset ring-info-borde">
                                {c.etiqueta}
                              </li>
                            ))}
                          </ul>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EstadoVacio icono={SearchX} titulo="Sin resultados" imagen="avenida-azul">
              <p>
                Probá con el N° interno corto (por ejemplo 31/2026), el DNI con o sin puntos o solo el apellido, sin acentos. Si pusiste filtros, sacá alguno o
                tocá «Limpiar».
              </p>
            </EstadoVacio>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Una opción de casilla como pastilla: más fácil de tocar y se ve marcada. */
const CLASE_OPCION =
  "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-control border border-borde-control bg-white px-3 text-sm transition-colors duration-150 " +
  "hover:border-primario has-checked:border-primario has-checked:bg-superficie-azul has-checked:font-medium";
