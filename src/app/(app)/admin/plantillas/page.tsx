import type { Metadata } from "next";
import Link from "next/link";
import { CLASE_ENLACE } from "@/components/formulario";
import { exigirPantalla } from "@/lib/auth/sesion";
import { admin } from "@/lib/dominio/admin/servidor";
import { formatearFecha } from "@/lib/fechas";
import { rutaVersionPlantilla } from "@/lib/presentacion/rutas-admin";
import { AccionesPlantilla, BotonNuevaPlantilla } from "./catalogo";

export const metadata: Metadata = { title: "Plantillas" };

const ETIQUETA_ESTADO: Record<string, string> = { borrador: "borrador", publicada: "publicada", retirada: "retirada" };

/**
 * `/admin/plantillas` (sección 5): el catálogo de trámites por código, con la
 * versión publicada, el borrador y cuántos expedientes en curso tiene cada
 * versión (2.13(a): los en curso siguen con la suya). Nueva, Editar (borrador
 * v+1) y Retirar (con confirmación) están en ./catalogo.tsx.
 */
export default async function PaginaPlantillas() {
  const usuario = await exigirPantalla("admin");
  const [filas, catalogos] = await Promise.all([admin.catalogoPlantillas(usuario), admin.catalogosEditor(usuario)]);
  const tiposTramite = catalogos.tiposTramite.filter((t) => t.activo).map((t) => ({ id: t.id, nombre: t.nombre }));

  return (
    <section aria-labelledby="titulo-plantillas" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="titulo-plantillas" className="text-2xl font-semibold tracking-tight text-texto">
          Plantillas de trámite
        </h1>
        <BotonNuevaPlantilla tiposTramite={tiposTramite} />
      </div>
      <p className="text-sm text-texto-secundario">
        Cada trámite tiene como máximo una versión publicada (la que usan las altas nuevas) y un borrador. Publicar un borrador retira la versión anterior:
        los expedientes en curso siguen con la suya.
      </p>

      <div className="tarjeta relative @container overflow-x-auto">
        <table className="tabla-datos tabla-apilable">
          <caption className="sr-only">Plantillas por código</caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">Código</th>
              <th scope="col" className="font-medium">Trámite</th>
              <th scope="col" className="font-medium">Publicada</th>
              <th scope="col" className="font-medium">Borrador</th>
              <th scope="col" className="font-medium">En curso por versión</th>
              <th scope="col" className="font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-texto-secundario">
                  Todavía no hay plantillas.
                </td>
              </tr>
            ) : null}
            {filas.map((p) => (
              <tr key={p.codigo} className="align-top">
                <th scope="row" className="font-mono text-xs font-medium text-texto">
                  {p.codigo}
                </th>
                <td data-etiqueta="Trámite">
                  <span className="block text-texto">{p.nombre}</span>
                  <span className="block text-xs text-texto-secundario">{p.tipoTramite.nombre}</span>
                </td>
                <td data-etiqueta="Publicada">
                  {p.publicada ? (
                    <>
                      <Link href={rutaVersionPlantilla(p.codigo, p.publicada.version)} className={CLASE_ENLACE}>
                        v{p.publicada.version}
                      </Link>
                      {p.publicada.publicadoEn ? <span className="block text-xs text-texto-secundario">desde {formatearFecha(p.publicada.publicadoEn)}</span> : null}
                    </>
                  ) : (
                    <span className="text-texto-secundario">Ninguna (no se ofrece en el alta)</span>
                  )}
                </td>
                <td data-etiqueta="Borrador">
                  {p.borrador ? (
                    <>
                      <Link href={rutaVersionPlantilla(p.codigo, p.borrador.version)} className={CLASE_ENLACE}>
                        v{p.borrador.version}
                      </Link>
                      <span className="block text-xs text-texto-secundario">
                        {p.borrador.creadoPor ? `de ${p.borrador.creadoPor}, ` : ""}
                        {formatearFecha(p.borrador.creadoEn)}
                      </span>
                    </>
                  ) : (
                    <span className="text-texto-secundario">—</span>
                  )}
                </td>
                <td data-etiqueta="En curso">
                  <ul className="space-y-0.5">
                    {p.versiones
                      .filter((v) => v.estado !== "borrador")
                      .map((v) => (
                        <li key={v.version}>
                          <Link href={rutaVersionPlantilla(p.codigo, v.version)} className={CLASE_ENLACE}>
                            v{v.version}
                          </Link>{" "}
                          <span className="text-xs text-texto-secundario">({ETIQUETA_ESTADO[v.estado]})</span>: {v.enCurso}
                          <span className="sr-only"> en curso</span>
                          {v.total > v.enCurso ? <span className="text-xs text-texto-secundario"> de {v.total}</span> : null}
                        </li>
                      ))}
                  </ul>
                </td>
                <td>
                  <AccionesPlantilla codigo={p.codigo} publicada={p.publicada ? { version: p.publicada.version, enCurso: p.publicada.enCurso } : null} borrador={p.borrador?.version ?? null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
