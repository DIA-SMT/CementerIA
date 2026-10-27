"use client";

import { ArrowRightLeft, Check, Download, Eye, FileUp, ListChecks, PackageCheck, Undo2 } from "lucide-react";
import { CLASE_BOTON_ADVERTENCIA, CLASE_BOTON_COMPACTO, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO } from "@/components/formulario";
import { formatearFechaHora } from "@/lib/fechas";
import { formatearBytes, itemsFaltan, textoBotonPase, tituloFaltan } from "@/lib/presentacion/flujo";
import { faltantesDe, rutaAdjunto } from "./dialogos";
import { useFlujo } from "./estado";
import { ListaFaltan } from "./piezas";
import type { DialogoFlujo } from "./tipos";

/**
 * Los controles del flujo que la ficha (un Server Component) pone en su
 * lugar: la barra de acciones, el panel "Qué falta para avanzar", los botones
 * de cada subtarea y documento y la lista de adjuntos con su visor.
 */


/** Confirmar recepción, Dar pase ("Faltan N") y Devolver. */
export function BarraAcciones() {
  const { datos, abrir } = useFlujo();
  const p = datos.permisos;
  const faltan = datos.pase.faltan.length;
  const botones: React.ReactNode[] = [];
  if (p.confirmarRecepcion && datos.sinConfirmar) {
    botones.push(
      <button key="recepcion" type="button" aria-haspopup="dialog" onClick={() => abrir({ tipo: "recepcion" })} className={CLASE_BOTON_PRIMARIO}>
        <PackageCheck className="h-4 w-4" aria-hidden="true" />
        Confirmar recepción
      </button>,
    );
  }
  if (p.darPase && datos.pase.destinos.length > 0) {
    botones.push(
      <button
        key="pase"
        type="button"
        aria-haspopup="dialog"
        onClick={() => abrir({ tipo: "pase" })}
        className={faltan > 0 ? CLASE_BOTON_ADVERTENCIA : CLASE_BOTON_PRIMARIO}
      >
        <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
        {textoBotonPase(faltan)}
      </button>,
    );
  }
  if (p.devolver && datos.devolucion.destinos.length > 0) {
    botones.push(
      <button key="devolver" type="button" aria-haspopup="dialog" onClick={() => abrir({ tipo: "devolver" })} className={CLASE_BOTON_SECUNDARIO}>
        <Undo2 className="h-4 w-4" aria-hidden="true" />
        Devolver
      </button>,
    );
  }
  if (botones.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Acciones del paso" data-recorrido="ficha-acciones-paso">
      {botones}
    </div>
  );
}

/**
 * "Qué falta para avanzar" (sección 5): lo mismo que abre "Faltan N", siempre
 * a la vista. En el último paso (semana 4), lo que falta para concluir.
 */
export function PanelFaltan() {
  const { datos, abrir } = useFlujo();
  const final = datos.paso.esFinal;
  const items = final ? itemsFaltan(datos.concluir.faltan, datos.permisos, datos.rutaEditar) : faltantesDe(datos);
  const abrirItem = (d: DialogoFlujo) => abrir(d);
  return (
    <section aria-labelledby="titulo-faltan" data-recorrido="ficha-faltan" className={`rounded-tarjeta border p-4 shadow-tarjeta sm:px-5 ${items.length > 0 ? "border-advertencia-borde bg-advertencia-fondo" : "border-exito-borde bg-exito-fondo"}`}>
      <h2 id="titulo-faltan" className={`titulo-seccion mb-2 flex items-center gap-2 ${items.length > 0 ? "text-advertencia" : "text-exito"}`}>
        <ListChecks className="h-5 w-5" aria-hidden="true" />
        {final ? "Qué falta para concluir" : "Qué falta para avanzar"}
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-exito">
          <Check className="h-4 w-4" aria-hidden="true" />
          {final ? `Es el último paso y no falta nada: el expediente se puede concluir.` : `No falta nada para dar el pase desde ${datos.paso.nombre}.`}
        </p>
      ) : (
        <>
          <p className="mb-1 text-sm text-advertencia">
            {final ? tituloFaltan(items.length).replace("para avanzar", "para concluir") : `${tituloFaltan(items.length)} desde ${datos.paso.nombre}`}:
          </p>
          <ListaFaltan
            items={items}
            onAcceso={(item) => {
              const a = item.accion?.acceso;
              if (a?.tipo === "tildar") abrirItem({ tipo: "tildar", clave: a.clave });
              else if (a?.tipo === "documento") abrirItem({ tipo: "documento", clave: a.clave });
              else if (a?.tipo === "adjuntar") abrirItem({ tipo: "adjuntar", documento: a.documento });
            }}
          />
        </>
      )}
    </section>
  );
}

/** Tildar, cambiar el dato o destildar una subtarea del paso actual. */
export function BotonesSubtarea({ clave, nombre, hecha, conDato }: { clave: string; nombre: string; hecha: boolean; conDato: boolean }) {
  const { datos, abrir } = useFlujo();
  if (!datos.permisos.tildarSubtarea) return null;
  if (!hecha) {
    return (
      <button type="button" aria-haspopup="dialog" aria-label={`Tildar: ${nombre}`} onClick={() => abrir({ tipo: "tildar", clave })} className={CLASE_BOTON_COMPACTO}>
        Tildar
      </button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      {conDato ? (
        <button type="button" aria-haspopup="dialog" aria-label={`Cambiar dato: ${nombre}`} onClick={() => abrir({ tipo: "tildar", clave })} className={CLASE_BOTON_COMPACTO}>
          Cambiar dato
        </button>
      ) : null}
      <button type="button" aria-haspopup="dialog" aria-label={`Destildar: ${nombre}`} onClick={() => abrir({ tipo: "destildar", clave })} className={CLASE_BOTON_COMPACTO}>
        Destildar
      </button>
    </span>
  );
}

/** Marcar y adjuntar en la fila de un documento. */
export function BotonesDocumento({ clave, nombre, adjunto }: { clave: string; nombre: string; adjunto: "no" | "sugerido" | "obligatorio" }) {
  const { datos, abrir } = useFlujo();
  const marcar = datos.permisos.marcarDocumento;
  const adjuntar = datos.permisos.adjuntar && adjunto !== "no";
  if (!marcar && !adjuntar) return null;
  return (
    <span className="inline-flex gap-1">
      {marcar ? (
        <button type="button" aria-haspopup="dialog" aria-label={`Marcar: ${nombre}`} onClick={() => abrir({ tipo: "documento", clave })} className={CLASE_BOTON_COMPACTO}>
          Marcar
        </button>
      ) : null}
      {adjuntar ? (
        <button type="button" aria-haspopup="dialog" aria-label={`Adjuntar a ${nombre}`} onClick={() => abrir({ tipo: "adjuntar", documento: clave })} className={CLASE_BOTON_COMPACTO}>
          Adjuntar
        </button>
      ) : null}
    </span>
  );
}

/** Los adjuntos vigentes con el visor (en la ficha) y la descarga como acción aparte. */
export function ListaAdjuntos() {
  const { datos, abrir, adjuntosConMotivo } = useFlujo();
  const nombreDocumento = (clave: string | null) => (clave ? (datos.documentos.find((d) => d.clave === clave)?.nombre ?? clave) : "Suelto");
  // Quien trabaja el expediente los trae en la ficha; el resto, después de dar el motivo (sin quién ni cuándo).
  const lista =
    datos.adjuntos?.map((a) => ({ ...a, detalle: `${formatearFechaHora(a.registradoEn)} · ${a.usuario.corto}` })) ??
    adjuntosConMotivo?.lista.map((a) => ({ ...a, detalle: null })) ??
    null;
  const motivo = datos.adjuntos ? null : (adjuntosConMotivo?.motivo ?? null);

  return (
    <div className="space-y-3">
      {datos.permisos.adjuntar ? (
        <button type="button" aria-haspopup="dialog" onClick={() => abrir({ tipo: "adjuntar", documento: null })} className={CLASE_BOTON_SECUNDARIO}>
          <FileUp className="h-4 w-4" aria-hidden="true" />
          Adjuntar archivo suelto
        </button>
      ) : null}
      {datos.cantidadAdjuntos === 0 ? (
        <p className="text-sm text-texto-secundario">No hay adjuntos.</p>
      ) : lista === null ? (
        <div className="space-y-2 text-sm text-texto-secundario">
          <p>
            {datos.cantidadAdjuntos === 1 ? "Hay 1 adjunto." : `Hay ${datos.cantidadAdjuntos} adjuntos.`} Tu área no trabaja este expediente: para verlos,
            indicá el motivo (queda registrado).
          </p>
          <button type="button" aria-haspopup="dialog" onClick={() => abrir({ tipo: "motivoAdjuntos" })} className={CLASE_BOTON_SECUNDARIO}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Ver adjuntos
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-borde text-sm">
          {lista.map((a) => (
            <li key={a.movimientoId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-medium text-texto">{a.nombre}</span>
                <span className="block text-xs text-texto-secundario">
                  {nombreDocumento(a.documento)} · {formatearBytes(a.bytes)}
                  {a.detalle ? ` · ${a.detalle}` : ""}
                </span>
              </span>
              <span className="inline-flex gap-1">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`Ver ${a.nombre}`}
                  onClick={() => abrir({ tipo: "visor", adjunto: { movimientoId: a.movimientoId, nombre: a.nombre, mime: a.mime }, motivo })}
                  className={CLASE_BOTON_COMPACTO}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  Ver
                </button>
                <a
                  href={rutaAdjunto(a.movimientoId, { descargar: true, motivo })}
                  download
                  aria-label={`Descargar ${a.nombre}`}
                  className={CLASE_BOTON_COMPACTO}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Descargar
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
