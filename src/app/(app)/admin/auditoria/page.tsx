import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Download, Filter } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import { exigirPantalla } from "@/lib/auth/sesion";
import { admin, ETIQUETA_ACCION_ACCESO, type AccionAccesoAuditoria, type FilaAcceso, type FilaCambio, type Pagina } from "@/lib/dominio/admin/servidor";
import { formatearFechaHora } from "@/lib/fechas";
import { detalleAcceso, leerFiltrosAuditoria, rutaAuditoria, rutaExportarAuditoria, type VistaAuditoria } from "@/lib/presentacion/auditoria";
import { estadoDeError, type EstadoError } from "@/lib/presentacion/errores";
import { rutaFicha } from "@/lib/presentacion/enlaces";

export const metadata: Metadata = { title: "Auditoría" };

/**
 * `/admin/auditoria` (sección 5): los accesos (filtrables por usuario,
 * expediente, acción y fechas; "Ver datos completos" con su motivo) y los
 * cambios de configuración con el antes y el después legibles. Los filtros y
 * la página viven en la URL; "Exportar CSV" baja lo filtrado
 * (`/admin/auditoria/exportar`) y queda registrado como `exportar`.
 */
export default async function PaginaAuditoria(props: PageProps<"/admin/auditoria">) {
  const usuario = await exigirPantalla("admin");
  const filtros = leerFiltrosAuditoria(await props.searchParams);
  const opciones = await admin.opcionesAuditoria(usuario);
  const vista = filtros.vista;
  const activos = vista === "accesos" ? filtros.accesos : filtros.cambios;

  let accesos: Pagina<FilaAcceso> | null = null;
  let cambios: Pagina<FilaCambio> | null = null;
  let error: EstadoError | null = null;
  try {
    if (vista === "accesos") accesos = await admin.listarAccesos(usuario, filtros.accesos);
    else cambios = await admin.listarCambios(usuario, filtros.cambios);
  } catch (e) {
    error = estadoDeError(e);
  }
  const pagina = accesos ?? cambios;

  return (
    <section aria-labelledby="titulo-auditoria" className="space-y-4">
      <h1 id="titulo-auditoria" className="text-xl font-semibold text-slate-900">
        Auditoría
      </h1>
      <nav aria-label="Vista de la auditoría">
        <ul className="flex flex-wrap gap-1 border-b border-slate-300">
          {(["accesos", "cambios"] as const).map((v) => (
            <li key={v}>
              <Link
                href={rutaAuditoria(v, {})}
                aria-current={v === vista ? "page" : undefined}
                className={`-mb-px inline-flex rounded-t border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 ${
                  v === vista ? "border-slate-300 border-b-white bg-white font-medium text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {v === "accesos" ? "Accesos" : "Cambios de configuración"}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Form action="/admin/auditoria" className="grid gap-3 rounded border border-slate-300 bg-white px-4 py-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtros">
        <input type="hidden" name="vista" value={vista} />
        <div>
          <label htmlFor="filtro-usuario" className="mb-1 block text-sm font-medium text-slate-800">
            Usuario
          </label>
          <select id="filtro-usuario" name="usuario" defaultValue={activos.usuarioId ?? ""} className={CLASE_CONTROL}>
            <option value="">Todos</option>
            {opciones.usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>
        {vista === "accesos" ? (
          <>
            <div>
              <label htmlFor="filtro-expediente" className="mb-1 block text-sm font-medium text-slate-800">
                Expediente
              </label>
              <input id="filtro-expediente" name="expediente" type="text" placeholder="CEM-2026-00042 o 42/2026" defaultValue={filtros.accesos.numero ?? ""} className={CLASE_CONTROL} />
            </div>
            <div>
              <label htmlFor="filtro-accion" className="mb-1 block text-sm font-medium text-slate-800">
                Acción
              </label>
              <select id="filtro-accion" name="accion" defaultValue={filtros.accesos.accion ?? ""} className={CLASE_CONTROL}>
                <option value="">Todas</option>
                {opciones.acciones.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="filtro-tabla" className="mb-1 block text-sm font-medium text-slate-800">
              Qué
            </label>
            <select id="filtro-tabla" name="tabla" defaultValue={filtros.cambios.tabla ?? ""} className={CLASE_CONTROL}>
              <option value="">Todo</option>
              {opciones.tablas.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="filtro-desde" className="mb-1 block text-sm font-medium text-slate-800">
            Desde
          </label>
          <input id="filtro-desde" name="desde" type="date" defaultValue={activos.desde ?? ""} className={CLASE_CONTROL} />
        </div>
        <div>
          <label htmlFor="filtro-hasta" className="mb-1 block text-sm font-medium text-slate-800">
            Hasta
          </label>
          <input id="filtro-hasta" name="hasta" type="date" defaultValue={activos.hasta ?? ""} className={CLASE_CONTROL} />
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className={CLASE_BOTON_PRIMARIO}>
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filtrar
          </button>
          <Link href={rutaAuditoria(vista, {})} className={CLASE_BOTON_SECUNDARIO}>
            Limpiar
          </Link>
          {/* Un <a>: es una descarga (attachment), no una navegación de la app. */}
          <a href={rutaExportarAuditoria(vista, activos)} className={`${CLASE_BOTON_SECUNDARIO} ml-auto`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar CSV
          </a>
        </div>
      </Form>

      {error ? <AvisoError error={error} recargar={rutaAuditoria(vista, {})} /> : null}

      {pagina ? (
        <p className="text-sm text-slate-700" aria-live="polite">
          {pagina.total === 0 ? "No hay registros con esos filtros." : `${pagina.total === 1 ? "1 registro" : `${pagina.total} registros`} · página ${pagina.pagina} de ${pagina.paginas}`}
        </p>
      ) : null}

      {accesos && accesos.filas.length > 0 ? <TablaAccesos filas={accesos.filas} /> : null}
      {cambios && cambios.filas.length > 0 ? <TablaCambios filas={cambios.filas} /> : null}

      {pagina && pagina.paginas > 1 ? <Paginas vista={vista} filtros={activos} pagina={pagina.pagina} paginas={pagina.paginas} /> : null}
    </section>
  );
}

function TablaAccesos({ filas }: { filas: readonly FilaAcceso[] }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-300 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Accesos</caption>
        <thead className="border-b border-slate-300 bg-slate-50 text-slate-700">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Fecha y hora</th>
            <th scope="col" className="px-3 py-2 font-medium">Usuario</th>
            <th scope="col" className="px-3 py-2 font-medium">Acción</th>
            <th scope="col" className="px-3 py-2 font-medium">Expediente</th>
            <th scope="col" className="px-3 py-2 font-medium">Motivo y detalle</th>
            <th scope="col" className="px-3 py-2 font-medium">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {filas.map((f) => (
            <tr key={f.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-2">{formatearFechaHora(f.en)}</td>
              <td className="px-3 py-2">{f.usuario ? f.usuario.nombre : <span className="text-slate-500">Sin usuario</span>}</td>
              <td className="px-3 py-2">{ETIQUETA_ACCION_ACCESO[f.accion as AccionAccesoAuditoria] ?? f.accion}</td>
              <td className="whitespace-nowrap px-3 py-2">
                {f.expediente ? (
                  // Sin prefetch: un prefetch de la ficha quedaría registrado como si se la hubiera abierto.
                  <Link href={rutaFicha(f.expediente)} prefetch={false} className="underline underline-offset-2">
                    {f.expediente}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {f.motivo ? <p className="font-medium text-slate-900">Motivo: {f.motivo}</p> : null}
                <p className="text-xs text-slate-600">{detalleAcceso(f.detalle) || (f.motivo ? null : "—")}</p>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{f.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaCambios({ filas }: { filas: readonly FilaCambio[] }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-300 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Cambios de configuración</caption>
        <thead className="border-b border-slate-300 bg-slate-50 text-slate-700">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Fecha y hora</th>
            <th scope="col" className="px-3 py-2 font-medium">Usuario</th>
            <th scope="col" className="px-3 py-2 font-medium">Qué</th>
            <th scope="col" className="px-3 py-2 font-medium">Cambio</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {filas.map((f) => (
            <tr key={f.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-2">{formatearFechaHora(f.en)}</td>
              <td className="px-3 py-2">{f.usuario.nombre}</td>
              <td className="px-3 py-2">
                <span className="block font-medium text-slate-900">
                  {f.operacionEtiqueta}: {f.tablaEtiqueta}
                </span>
                <span className="block text-xs text-slate-700">{f.registro}</span>
                {f.motivo ? <span className="block text-xs text-slate-700">Motivo: {f.motivo}</span> : null}
              </td>
              <td className="px-3 py-2">
                {f.diferencias.length === 0 ? (
                  <span className="text-slate-500">Sin diferencias visibles</span>
                ) : (
                  <dl className="space-y-0.5">
                    {f.diferencias.map((d) => (
                      <div key={d.campo}>
                        <dt className="inline font-medium text-slate-800">{d.etiqueta}: </dt>
                        <dd className="inline text-slate-800">
                          {f.operacion === "U" ? (
                            <>
                              <del className="text-slate-500">{d.antes}</del>
                              <span aria-hidden="true"> → </span>
                              <span className="sr-only"> pasó a </span>
                              {d.despues}
                            </>
                          ) : f.operacion === "I" ? (
                            d.despues
                          ) : (
                            d.antes
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Paginas({ vista, filtros, pagina, paginas }: { vista: VistaAuditoria; filtros: Parameters<typeof rutaAuditoria>[1]; pagina: number; paginas: number }) {
  return (
    <nav aria-label="Páginas" className="flex flex-wrap items-center gap-2 text-sm">
      {pagina > 1 ? (
        <Link href={rutaAuditoria(vista, { ...filtros, pagina: pagina - 1 })} className={CLASE_BOTON_SECUNDARIO}>
          Anterior
        </Link>
      ) : null}
      <span className="text-slate-700">
        Página {pagina} de {paginas}
      </span>
      {pagina < paginas ? (
        <Link href={rutaAuditoria(vista, { ...filtros, pagina: pagina + 1 })} className={CLASE_BOTON_SECUNDARIO}>
          Siguiente
        </Link>
      ) : null}
    </nav>
  );
}
