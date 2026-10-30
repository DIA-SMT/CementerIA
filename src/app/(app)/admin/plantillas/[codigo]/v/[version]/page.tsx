import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CLASE_ENLACE } from "@/components/formulario";
import { PantallaConRecorrido } from "@/components/recorrido/proveedor";
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
      <PantallaConRecorrido id="admin-editor" />
      <p>
        <Link href={RUTA_PLANTILLAS} className={`${CLASE_ENLACE} inline-flex items-center gap-1 text-sm`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Plantillas
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-recorrido="editor-cabecera">
        <h1 id="titulo-version" className="text-2xl font-bold tracking-tight text-institucional">
          {v.nombre} <span className="font-mono text-base font-normal text-texto-secundario">· {v.codigo} v{v.version}</span>
        </h1>
        <span className={`insignia ring-1 ring-inset ${v.estado === "publicada" ? "bg-exito-fondo text-exito ring-exito-borde" : v.estado === "borrador" ? "bg-advertencia-fondo text-advertencia ring-advertencia-borde" : "bg-fondo text-texto-secundario ring-borde"}`}>
          {ESTADO_TEXTO[v.estado]}
        </span>
      </div>
      <dl className="tarjeta grid gap-x-6 gap-y-1 px-4 py-3 text-sm text-texto-secundario sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-texto">Tipo de trámite: </dt>
          <dd className="inline">{v.tipoTramite.nombre}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-texto">Expedientes en curso con esta versión: </dt>
          <dd className="inline">{v.enCurso}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-texto">Creada: </dt>
          <dd className="inline">
            {formatearFechaHora(v.creadoEn)}
            {v.creadoPor ? ` por ${v.creadoPor}` : ""}
          </dd>
        </div>
        {v.publicadoEn ? (
          <div>
            <dt className="inline font-medium text-texto">Publicada: </dt>
            <dd className="inline">
              {formatearFechaHora(v.publicadoEn)}
              {v.publicadoPor ? ` por ${v.publicadoPor}` : ""}
            </dd>
          </div>
        ) : null}
        {v.notasCambio ? (
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-texto">Notas de cambio: </dt>
            <dd className="inline whitespace-pre-line">{v.notasCambio}</dd>
          </div>
        ) : null}
      </dl>
      {v.versiones.length > 1 ? (
        <nav aria-label="Otras versiones" data-recorrido="editor-versiones" className="text-sm text-texto-secundario">
          Versiones:{" "}
          {v.versiones.map((x, i) => (
            <span key={x.version}>
              {i > 0 ? " · " : ""}
              {x.version === v.version ? (
                <span aria-current="page" className="font-medium text-texto">
                  v{x.version} ({x.estado})
                </span>
              ) : (
                <Link href={rutaVersionPlantilla(v.codigo, x.version)} className={CLASE_ENLACE}>
                  v{x.version} ({x.estado})
                </Link>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      {aviso === "publicada" && v.estado === "publicada" ? (
        <p role="status" className="rounded-control border border-exito-borde bg-exito-fondo px-3 py-2 text-sm text-exito">
          Versión publicada: las altas nuevas la usan desde ahora{v.version > 1 ? "; la anterior quedó retirada y sus expedientes en curso siguen con ella" : ""}.
        </p>
      ) : null}
      {v.estado !== "borrador" ? (
        <div className="flex flex-wrap items-start gap-3 rounded-control border border-borde bg-white px-3 py-2 text-sm text-texto">
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
