import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Download, Filter } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL, CLASE_ENLACE } from "@/components/formulario";
import { clasePestana } from "@/components/pestanas";
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
      <h1 id="titulo-auditoria" className="text-2xl font-semibold tracking-tight text-texto">
        Auditoría
      </h1>
      <nav aria-label="Vista de la auditoría">
        <ul className="flex flex-wrap gap-1 border-b border-borde">
          {(["accesos", "cambios"] as const).map((v) => (
            <li key={v}>
              <Link
                href={rutaAuditoria(v, {})}
                aria-current={v === vista ? "page" : undefined}
                className={clasePestana(v === vista)}
              >
                {v === "accesos" ? "Accesos" : "Cambios de configuración"}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Form action="/admin/auditoria" className="grid gap-3 tarjeta px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtros">
        <input type="hidden" name="vista" value={vista} />
        <div>
          <label htmlFor="filtro-usuario" className="mb-1 block text-sm font-medium text-texto">
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
              <label htmlFor="filtro-expediente" className="mb-1 block text-sm font-medium text-texto">
                Expediente
              </label>
              <input id="filtro-expediente" name="expediente" type="text" placeholder="CEM-2026-00042 o 42/2026" defaultValue={filtros.accesos.numero ?? ""} className={CLASE_CONTROL} />
            </div>
            <div>
              <label htmlFor="filtro-accion" className="mb-1 block text-sm font-medium text-texto">
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
            <label htmlFor="filtro-tabla" className="mb-1 block text-sm font-medium text-texto">
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
          <label htmlFor="filtro-desde" className="mb-1 block text-sm font-medium text-texto">
            Desde
          </label>
          <input id="filtro-desde" name="desde" type="date" defaultValue={activos.desde ?? ""} className={CLASE_CONTROL} />
        </div>
        <div>
          <label htmlFor="filtro-hasta" className="mb-1 block text-sm font-medium text-texto">
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
        <p className="text-sm text-texto-secundario" aria-live="polite">
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
    <div className="tarjeta relative @container overflow-x-auto">
      <table className="tabla-datos tabla-apilable">
        <caption className="sr-only">Accesos</caption>
        <thead>
          <tr>
            <th scope="col" className="font-medium">Fecha y hora</th>
            <th scope="col" className="font-medium">Usuario</th>
            <th scope="col" className="font-medium">Acción</th>
            <th scope="col" className="font-medium">Expediente</th>
            <th scope="col" className="font-medium">Motivo y detalle</th>
            <th scope="col" className="font-medium">IP</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="align-top">
              <td data-etiqueta="Fecha y hora" className="whitespace-nowrap">{formatearFechaHora(f.en)}</td>
              <td data-etiqueta="Usuario">{f.usuario ? f.usuario.nombre : <span className="text-texto-secundario">Sin usuario</span>}</td>
              <td data-etiqueta="Acción">{ETIQUETA_ACCION_ACCESO[f.accion as AccionAccesoAuditoria] ?? f.accion}</td>
              <td data-etiqueta="Expediente" className="whitespace-nowrap">
                {f.expediente ? (
                  // Sin prefetch: un prefetch de la ficha quedaría registrado como si se la hubiera abierto.
                  <Link href={rutaFicha(f.expediente)} prefetch={false} className={CLASE_ENLACE}>
                    {f.expediente}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td data-etiqueta="Motivo y detalle">
                {f.motivo ? <p className="font-medium text-texto">Motivo: {f.motivo}</p> : null}
                <p className="text-xs text-texto-secundario">{detalleAcceso(f.detalle) || (f.motivo ? null : "—")}</p>
              </td>
              <td data-etiqueta="IP" className="font-mono text-xs">{f.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaCambios({ filas }: { filas: readonly FilaCambio[] }) {
  return (
    <div className="tarjeta relative @container overflow-x-auto">
      <table className="tabla-datos tabla-apilable">
        <caption className="sr-only">Cambios de configuración</caption>
        <thead>
          <tr>
            <th scope="col" className="font-medium">Fecha y hora</th>
            <th scope="col" className="font-medium">Usuario</th>
            <th scope="col" className="font-medium">Qué</th>
            <th scope="col" className="font-medium">Cambio</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="align-top">
              <td data-etiqueta="Fecha y hora" className="whitespace-nowrap">{formatearFechaHora(f.en)}</td>
              <td data-etiqueta="Usuario">{f.usuario.nombre}</td>
              <td data-etiqueta="Qué">
                <span className="block font-medium text-texto">
                  {f.operacionEtiqueta}: {f.tablaEtiqueta}
                </span>
                <span className="block text-xs text-texto-secundario">{f.registro}</span>
                {f.motivo ? <span className="block text-xs text-texto-secundario">Motivo: {f.motivo}</span> : null}
              </td>
              <td data-etiqueta="Cambio">
                {f.diferencias.length === 0 ? (
                  <span className="text-texto-secundario">Sin diferencias visibles</span>
                ) : (
                  <dl className="space-y-0.5">
                    {f.diferencias.map((d) => (
                      <div key={d.campo}>
                        <dt className="inline font-medium text-texto">{d.etiqueta}: </dt>
                        <dd className="inline text-texto">
                          {f.operacion === "U" ? (
                            <>
                              <del className="text-texto-secundario">{d.antes}</del>
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
      <span className="text-texto-secundario">
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
