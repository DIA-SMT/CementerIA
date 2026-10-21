import type { Metadata } from "next";
import Link from "next/link";
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
        <h1 id="titulo-plantillas" className="text-xl font-semibold text-slate-900">
          Plantillas de trámite
        </h1>
        <BotonNuevaPlantilla tiposTramite={tiposTramite} />
      </div>
      <p className="text-sm text-slate-700">
        Cada trámite tiene como máximo una versión publicada (la que usan las altas nuevas) y un borrador. Publicar un borrador retira la versión anterior:
        los expedientes en curso siguen con la suya.
      </p>

      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Plantillas por código</caption>
          <thead className="border-b border-slate-300 bg-slate-50 text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Código</th>
              <th scope="col" className="px-3 py-2 font-medium">Trámite</th>
              <th scope="col" className="px-3 py-2 font-medium">Publicada</th>
              <th scope="col" className="px-3 py-2 font-medium">Borrador</th>
              <th scope="col" className="px-3 py-2 font-medium">En curso por versión</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filas.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-slate-600">
                  Todavía no hay plantillas.
                </td>
              </tr>
            ) : null}
            {filas.map((p) => (
              <tr key={p.codigo} className="align-top">
                <th scope="row" className="px-3 py-2 font-mono text-xs font-medium text-slate-900">
                  {p.codigo}
                </th>
                <td className="px-3 py-2">
                  <span className="block text-slate-900">{p.nombre}</span>
                  <span className="block text-xs text-slate-600">{p.tipoTramite.nombre}</span>
                </td>
                <td className="px-3 py-2">
                  {p.publicada ? (
                    <>
                      <Link href={rutaVersionPlantilla(p.codigo, p.publicada.version)} className="underline underline-offset-2">
                        v{p.publicada.version}
                      </Link>
                      {p.publicada.publicadoEn ? <span className="block text-xs text-slate-600">desde {formatearFecha(p.publicada.publicadoEn)}</span> : null}
                    </>
                  ) : (
                    <span className="text-slate-600">Ninguna (no se ofrece en el alta)</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {p.borrador ? (
                    <>
                      <Link href={rutaVersionPlantilla(p.codigo, p.borrador.version)} className="underline underline-offset-2">
                        v{p.borrador.version}
                      </Link>
                      <span className="block text-xs text-slate-600">
                        {p.borrador.creadoPor ? `de ${p.borrador.creadoPor}, ` : ""}
                        {formatearFecha(p.borrador.creadoEn)}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <ul className="space-y-0.5">
                    {p.versiones
                      .filter((v) => v.estado !== "borrador")
                      .map((v) => (
                        <li key={v.version}>
                          <Link href={rutaVersionPlantilla(p.codigo, v.version)} className="underline underline-offset-2">
                            v{v.version}
                          </Link>{" "}
                          <span className="text-xs text-slate-600">({ETIQUETA_ESTADO[v.estado]})</span>: {v.enCurso}
                          <span className="sr-only"> en curso</span>
                          {v.total > v.enCurso ? <span className="text-xs text-slate-600"> de {v.total}</span> : null}
                        </li>
                      ))}
                  </ul>
                </td>
                <td className="px-3 py-2">
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
