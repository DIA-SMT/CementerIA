import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { EtiquetaEstado } from "@/components/etiquetas";
import { CLASE_ENLACE } from "@/components/formulario";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type Ficha } from "@/lib/dominio/expedientes/servidor";
import { formatearFecha } from "@/lib/fechas";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { contextoResumen } from "@/lib/presentacion/historial";
import { TEXTO_DENEGACION } from "@/lib/presentacion/textos";
import { LineaDeTiempo } from "../../linea-de-tiempo";
import { Transcripcion, type DatosTranscripcion } from "./transcripcion";

export async function generateMetadata(props: PageProps<"/expedientes/[numero]/transcribir">): Promise<Metadata> {
  const { numero } = await props.params;
  return { title: `Transcribir ${numero.toUpperCase()}` };
}

/**
 * Transcripción de la ficha de papel (2.13(c), sección 5,
 * `/expedientes/[numero]/transcribir`): Mesa de Entradas y el admin, en un
 * expediente "iniciado antes del sistema" con la carga histórica abierta.
 * Arriba, lo ya transcripto; abajo, la grilla (fecha, precisión, paso
 * destino, observación, fuente; "Registrar lote"), las subtareas que se tildan
 * con su fecha, llevarlo a concluido o archivado, la foto de la ficha como
 * adjunto suelto y "Terminar carga histórica". Las reglas son del dominio
 * (`acciones.transcribir`, `transcribir`, `tildarSubtareaHistorica`,
 * `transcribirEstado`, `terminarCargaHistorica`).
 */
export default async function PaginaTranscribir(props: PageProps<"/expedientes/[numero]/transcribir">) {
  const usuario = await exigirPantalla("expedientes");
  const { numero } = await props.params;
  let ficha: Ficha;
  try {
    ficha = await expedientes.obtenerFicha(usuario, numero, { ip: ipDeSolicitud(await headers()) });
  } catch (e) {
    if (e instanceof ErrorDominio && e.codigo === "no_encontrado") notFound();
    throw e;
  }
  const permiso = ficha.acciones.transcribir;
  const historicos = ficha.historial.filter((m) => m.cargaHistorica || m.tipo === "alta");
  const documentos = [...ficha.documentacion.direccion, ...ficha.documentacion.concesionario];
  const resumen = contextoResumen([...ficha.personas, ...ficha.personasHistoricas], ficha.datosExtra, {
    subtareas: ficha.recorrido.flatMap((p) => p.subtareas),
    documentos,
  });
  const nombreSubtarea = new Map(ficha.recorrido.flatMap((p) => p.subtareas.map((s) => [s.clave, s.nombre] as const)));
  const nombreDocumento = new Map(documentos.map((d) => [d.clave, d.nombre] as const));

  const datos: DatosTranscripcion = {
    numero: ficha.numero,
    version: ficha.version,
    rutaFicha: rutaFicha(ficha.numero),
    estado: ficha.estado,
    paso: { orden: ficha.paso.orden, nombre: ficha.paso.nombre, esFinal: ficha.paso.esFinal },
    fechaInicio: ficha.fechaInicio,
    pasos: ficha.recorrido.map((p) => ({ clave: p.clave, nombre: p.nombre, orden: p.orden })),
    subtareas: ficha.recorrido
      .filter((p) => p.orden <= ficha.paso.orden)
      .flatMap((p) => p.subtareas.map((s) => ({ clave: s.clave, nombre: s.nombre, paso: `${p.orden}. ${p.nombre}`, dato: s.dato, hecha: s.hecha, valor: s.valor }))),
    pendientes: ficha.cargaHistoricaPendiente
      ? {
          subtareas: ficha.cargaHistoricaPendiente.subtareas.map((c) => nombreSubtarea.get(c) ?? c),
          documentos: ficha.cargaHistoricaPendiente.documentos.map((c) => nombreDocumento.get(c) ?? c),
        }
      : null,
    puedeAdjuntar: ficha.acciones.adjuntar.permitido,
  };

  return (
    <section aria-labelledby="titulo-pantalla" className="space-y-5">
      <p>
        <Link href={rutaFicha(ficha.numero)} prefetch={false} className={`${CLASE_ENLACE} inline-flex items-center gap-1 text-sm`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver a la ficha
        </Link>
      </p>
      <header className="space-y-2 rounded border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 id="titulo-pantalla" className="text-xl font-semibold text-slate-900">
            Transcribir la ficha de papel · <span className="font-mono">{ficha.numero}</span>
          </h1>
          <EtiquetaEstado estado={ficha.estado} />
        </div>
        <p className="text-sm text-slate-700">
          {ficha.tipoTramite.nombre} · {ficha.plantilla.nombre} v{ficha.plantilla.version} · iniciado el {formatearFecha(ficha.fechaInicio)} · hoy en {ficha.paso.orden} de{" "}
          {ficha.paso.total}: {ficha.paso.nombre} ({ficha.areaActual.nombre})
        </p>
      </header>

      {!permiso.permitido ? (
        <p role="alert" className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {ficha.cargaHistorica
            ? `No podés transcribir este expediente. ${TEXTO_DENEGACION[permiso.motivo]}`
            : "Este expediente no tiene la carga histórica abierta: sus movimientos se registran en la ficha, como los demás."}
        </p>
      ) : null}

      <section aria-labelledby="titulo-transcripto" className="rounded border border-slate-300 bg-white p-4">
        <h2 id="titulo-transcripto" className="mb-3 text-base font-semibold text-slate-900">
          Lo ya transcripto
        </h2>
        <LineaDeTiempo historial={historicos} contexto={resumen} />
      </section>

      {permiso.permitido ? <Transcripcion datos={datos} /> : null}
    </section>
  );
}
