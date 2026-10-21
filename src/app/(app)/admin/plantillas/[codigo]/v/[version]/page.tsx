import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CLASE_ENLACE } from "@/components/formulario";
import { exigirPantalla } from "@/lib/auth/sesion";
import { admin, type VersionPlantilla } from "@/lib/dominio/admin/servidor";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { formatearFechaHora } from "@/lib/fechas";
import { RUTA_PLANTILLAS, rutaVersionPlantilla } from "@/lib/presentacion/rutas-admin";
import { AccionesPlantilla } from "../../../catalogo";
import { EditorPlantilla } from "./editor";

export async function generateMetadata(props: PageProps<"/admin/plantillas/[codigo]/v/[version]">): Promise<Metadata> {
  const { codigo, version } = await props.params;
  return { title: `${decodeURIComponent(codigo).toUpperCase()} v${version}` };
}

const ESTADO_TEXTO: Record<string, string> = { borrador: "Borrador", publicada: "Publicada", retirada: "Retirada" };

/**
 * `/admin/plantillas/[codigo]/v/[version]` (sección 5): el editor de un
 * borrador o el visor de una versión publicada o retirada (congelada). El
 * editor (./editor.tsx) arma todo desde el esquema `DefinicionPlantilla`, sin
 * nada propio de cada trámite.
 */
export default async function PaginaVersionPlantilla(props: PageProps<"/admin/plantillas/[codigo]/v/[version]">) {
  const usuario = await exigirPantalla("admin");
  const { codigo, version } = await props.params;
  const { aviso } = await props.searchParams;
  let v: VersionPlantilla;
  try {
    v = await admin.obtenerVersion(usuario, decodeURIComponent(codigo), /^\d{1,5}$/.test(version) ? Number(version) : 0);
  } catch (e) {
    if (e instanceof ErrorDominio && e.codigo === "no_encontrado") notFound();
    throw e;
  }
  const catalogos = await admin.catalogosEditor(usuario);
  const borrador = v.versiones.find((x) => x.estado === "borrador");
  const publicada = v.versiones.find((x) => x.estado === "publicada");

  return (
    <section aria-labelledby="titulo-version" className="space-y-4">
      <p>
        <Link href={RUTA_PLANTILLAS} className={`${CLASE_ENLACE} inline-flex items-center gap-1 text-sm`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Plantillas
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 id="titulo-version" className="text-xl font-semibold text-slate-900">
          {v.nombre} <span className="font-mono text-base font-normal text-slate-600">· {v.codigo} v{v.version}</span>
        </h1>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${v.estado === "publicada" ? "bg-emerald-50 text-emerald-900 ring-emerald-300" : v.estado === "borrador" ? "bg-amber-50 text-amber-950 ring-amber-300" : "bg-slate-100 text-slate-700 ring-slate-300"}`}>
          {ESTADO_TEXTO[v.estado]}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-slate-800">Tipo de trámite: </dt>
          <dd className="inline">{v.tipoTramite.nombre}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-800">Expedientes en curso con esta versión: </dt>
          <dd className="inline">{v.enCurso}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-800">Creada: </dt>
          <dd className="inline">
            {formatearFechaHora(v.creadoEn)}
            {v.creadoPor ? ` por ${v.creadoPor}` : ""}
          </dd>
        </div>
        {v.publicadoEn ? (
          <div>
            <dt className="inline font-medium text-slate-800">Publicada: </dt>
            <dd className="inline">
              {formatearFechaHora(v.publicadoEn)}
              {v.publicadoPor ? ` por ${v.publicadoPor}` : ""}
            </dd>
          </div>
        ) : null}
        {v.notasCambio ? (
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-slate-800">Notas de cambio: </dt>
            <dd className="inline whitespace-pre-line">{v.notasCambio}</dd>
          </div>
        ) : null}
      </dl>
      {v.versiones.length > 1 ? (
        <nav aria-label="Otras versiones" className="text-sm text-slate-700">
          Versiones:{" "}
          {v.versiones.map((x, i) => (
            <span key={x.version}>
              {i > 0 ? " · " : ""}
              {x.version === v.version ? (
                <span aria-current="page" className="font-medium text-slate-900">
                  v{x.version} ({x.estado})
                </span>
              ) : (
                <Link href={rutaVersionPlantilla(v.codigo, x.version)} className="underline underline-offset-2">
                  v{x.version} ({x.estado})
                </Link>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      {aviso === "publicada" && v.estado === "publicada" ? (
        <p role="status" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          Versión publicada: las altas nuevas la usan desde ahora{v.version > 1 ? "; la anterior quedó retirada y sus expedientes en curso siguen con ella" : ""}.
        </p>
      ) : null}
      {v.estado !== "borrador" ? (
        <div className="flex flex-wrap items-start gap-3 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
          <p className="flex-1">
            {v.estado === "publicada" ? "Esta versión está publicada y congelada: para cambiarla, Editar crea el borrador de la siguiente." : "Esta versión está retirada y congelada."}
          </p>
          <AccionesPlantilla codigo={v.codigo} publicada={publicada && v.estado === "publicada" ? { version: publicada.version, enCurso: v.enCurso } : null} borrador={borrador?.version ?? null} />
        </div>
      ) : null}

      <EditorPlantilla
        key={`${v.id}-${v.estado}-${v.huella}`}
        datos={{
          codigo: v.codigo,
          version: v.version,
          estado: v.estado,
          nombre: v.nombre,
          definicion: v.definicion,
          huella: v.huella,
          catalogos: {
            areas: catalogos.areas,
            cementerios: catalogos.cementerios,
            tiposMonumento: catalogos.tiposMonumento,
          },
        }}
      />
    </section>
  );
}
