"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRightLeft, CircleCheck, FileClock, PackageCheck } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_ENLACE } from "@/components/formulario";
import type { FilaBandeja, PestanaBandeja } from "@/lib/dominio/expedientes/bandejas";
import { formatearFecha, formatearSegunPrecision } from "@/lib/fechas";
import { mostrarPlazo } from "@/lib/presentacion/estados";
import type { EstadoError } from "@/lib/presentacion/errores";
import { nuevoComandoId, resumenLote, rutaBandeja, textoDevuelto, textoDias } from "@/lib/presentacion/flujo";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { accionPase, accionRecepcion, accionRecepciones } from "../expedientes/acciones";

/**
 * La tabla de una pestaña de la bandeja, con sus acciones: confirmar la
 * recepción de a uno o en lote (casillas y "Confirmar seleccionados"), "Dar
 * pase rápido" cuando el dominio dice que no falta nada y hay un único
 * destino (`fila.paseRapido`), y Abrir. Cada acción manda la `version` de la
 * fila: si otro usuario lo movió en el medio, el dominio contesta "Otro
 * usuario modificó el expediente; recargá". Las Server Actions recargan la
 * bandeja (y el contador del encabezado) en la misma respuesta.
 */

const CLASE_CHICO = `${CLASE_BOTON_SECUNDARIO} px-2 py-1 text-xs`;

type Aviso = { tipo: "ok"; texto: string; detalle?: string[] } | { tipo: "error"; error: EstadoError };

export function TablaBandeja({ pestana, filas }: { pestana: PestanaBandeja; filas: FilaBandeja[] }) {
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [paseRapido, setPaseRapido] = useState<FilaBandeja | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [comandoLote, setComandoLote] = useState(nuevoComandoId);

  const confirmables = filas.filter((f) => f.puedeConfirmar);
  const conVencimiento = pestana === "plazos";
  const lote = pestana === "por_confirmar" && confirmables.length > 0;
  // La selección se limpia sola de lo que ya no está (lo confirmó otro, se recargó la bandeja).
  const elegidos = seleccion.filter((n) => confirmables.some((f) => f.numero === n));
  const todos = elegidos.length === confirmables.length && confirmables.length > 0;

  function confirmarUno(fila: FilaBandeja) {
    setAviso(null);
    iniciar(async () => {
      const r = await accionRecepcion({ numero: fila.numero, versionVista: fila.version, comandoId: nuevoComandoId() });
      setAviso(r.ok ? { tipo: "ok", texto: r.mensaje } : { tipo: "error", error: r });
    });
  }

  function confirmarSeleccionados() {
    const elegidas = confirmables.filter((f) => elegidos.includes(f.numero)).map((f) => ({ numero: f.numero, version: f.version }));
    if (elegidas.length === 0) return;
    setAviso(null);
    iniciar(async () => {
      const r = await accionRecepciones({ seleccion: elegidas, comandoId: comandoLote });
      if (!r.ok) {
        setAviso({ tipo: "error", error: r });
        return;
      }
      const resumen = resumenLote(r.resultados);
      setAviso({ tipo: "ok", texto: resumen.texto, detalle: resumen.fallidos.map((f) => `${f.numero}: ${f.mensaje}`) });
      setSeleccion([]);
      // Un lote nuevo, un comando nuevo (reintentar el mismo no repetiría nada, pero tampoco confirmaría lo nuevo).
      setComandoLote(nuevoComandoId());
    });
  }

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" className="empty:hidden">
        {aviso?.tipo === "ok" ? (
          <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <p className="flex items-center gap-2">
              <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              {aviso.texto}
            </p>
            {aviso.detalle && aviso.detalle.length > 0 ? (
              <ul className="mt-1 list-disc pl-6 text-red-900">
                {aviso.detalle.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {aviso?.tipo === "error" ? <AvisoError error={aviso.error} recargar={rutaBandeja(pestana)} /> : null}

      {lote ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={todos}
              onChange={(e) => setSeleccion(e.target.checked ? confirmables.map((f) => f.numero) : [])}
              className={CLASE_CASILLA}
            />
            Seleccionar todos
          </label>
          <button type="button" onClick={confirmarSeleccionados} disabled={pendiente || elegidos.length === 0} className={CLASE_BOTON_PRIMARIO}>
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            {pendiente ? "Confirmando…" : `Confirmar seleccionados (${elegidos.length})`}
          </button>
        </div>
      ) : null}

      {filas.length === 0 ? (
        <p className="rounded border border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-700">No hay expedientes en esta pestaña.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">{conVencimiento ? "Expedientes con plazo, del que vence antes al último" : "Expedientes de la pestaña, del que llegó antes al más nuevo"}</caption>
            <thead className="border-b border-slate-300 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                {lote ? (
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Seleccionar</span>
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-2">N° interno</th>
                <th scope="col" className="px-3 py-2">N° municipal</th>
                <th scope="col" className="px-3 py-2">Titular</th>
                <th scope="col" className="px-3 py-2">Trámite</th>
                <th scope="col" className="px-3 py-2">Paso</th>
                <th scope="col" className="px-3 py-2">En el área</th>
                {conVencimiento ? (
                  <th scope="col" className="px-3 py-2">
                    Vencimiento
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-2">Etiquetas</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filas.map((f) => {
                const devuelto = f.etiquetas.find((e) => e.tipo === "devuelto");
                const etiquetaPlazo = f.etiquetas.find((e) => e.tipo === "plazo");
                const plazo = etiquetaPlazo && etiquetaPlazo.tipo === "plazo" ? mostrarPlazo(etiquetaPlazo) : null;
                return (
                  <tr key={f.numero} className={devuelto ? "bg-red-50" : conVencimiento && plazo?.semaforo === "vencido" ? "bg-red-50/60" : undefined}>
                    {lote ? (
                      <td className="px-3 py-2 align-top">
                        {f.puedeConfirmar ? (
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${f.numero}`}
                            checked={elegidos.includes(f.numero)}
                            onChange={(e) => setSeleccion((s) => (e.target.checked ? [...s, f.numero] : s.filter((n) => n !== f.numero)))}
                            className={CLASE_CASILLA}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <th scope="row" className="px-3 py-2 align-top font-normal">
                      <Link href={rutaFicha(f.numero)} prefetch={false} className={`${CLASE_ENLACE} whitespace-nowrap font-mono font-medium`}>
                        {f.numero}
                      </Link>
                      <span className="block text-xs text-slate-600">{f.numeroCorto}</span>
                    </th>
                    <td className="px-3 py-2 align-top">{f.numeroMunicipal ?? "—"}</td>
                    <td className="px-3 py-2 align-top">{f.titular ?? "—"}</td>
                    <td className="px-3 py-2 align-top">
                      {f.tramite.tipo}
                      <span className="block text-xs text-slate-600">
                        {f.tramite.plantilla} · v{f.tramite.version}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {f.paso.orden}/{f.paso.total} {f.paso.nombre}
                      {f.areaActual.externa ? <span className="block text-xs text-slate-600">En {f.areaActual.nombre}</span> : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={f.demorado ? "font-semibold text-red-800" : "text-slate-900"}>
                        {textoDias(f.diasEnArea)}
                        {f.demorado ? <span className="block text-xs font-normal">demorado (alerta a los {f.diasAlerta})</span> : null}
                      </span>
                      <span className="block text-xs text-slate-600">desde {formatearSegunPrecision(f.enAreaDesde, f.enAreaDesdePrecision)}</span>
                    </td>
                    {conVencimiento ? (
                      <td className="px-3 py-2 align-top">
                        {plazo && etiquetaPlazo?.tipo === "plazo" ? (
                          <>
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${plazo.clase}`}>{plazo.etiqueta}</span>
                            <span className="block text-sm text-slate-900">{etiquetaPlazo.vence ? formatearFecha(etiquetaPlazo.vence) : "—"}</span>
                            <span className="block text-xs text-slate-700">{plazo.texto}</span>
                            {plazo.aviso ? <span className="block text-xs text-slate-600">{plazo.aviso}</span> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 align-top">
                      <ul className="flex flex-col gap-1">
                        {f.etiquetas.map((e, i) => (
                          <li key={`${e.tipo}-${i}`}>
                            {e.tipo === "devuelto" ? (
                              <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900 ring-1 ring-inset ring-red-300">
                                {textoDevuelto(e)}
                              </span>
                            ) : e.tipo === "sin_confirmar" ? (
                              <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-950 ring-1 ring-inset ring-amber-300">Sin confirmar</span>
                            ) : (
                              <span className={`inline-block rounded px-2 py-0.5 text-xs ring-1 ring-inset ${mostrarPlazo(e).clase}`}>
                                Plazo: {mostrarPlazo(e).etiqueta.toLowerCase()}
                                {conVencimiento ? "" : ` · ${e.texto}`}
                              </span>
                            )}
                          </li>
                        ))}
                        {f.soloConsulta ? <li className="text-xs text-slate-600">Consulta (lo sigue {f.areaResponsable.nombre})</li> : null}
                      </ul>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col items-start gap-1">
                        {f.puedeConfirmar ? (
                          <button type="button" onClick={() => confirmarUno(f)} disabled={pendiente} className={CLASE_CHICO}>
                            Confirmar<span className="sr-only"> la recepción de {f.numero}</span>
                          </button>
                        ) : null}
                        {f.paseRapido ? (
                          <button type="button" aria-haspopup="dialog" onClick={() => setPaseRapido(f)} disabled={pendiente} className={CLASE_CHICO}>
                            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                            Dar pase rápido<span className="sr-only"> de {f.numero}</span>
                          </button>
                        ) : null}
                        {pestana === "carga_historica" ? (
                          <Link href={`${rutaFicha(f.numero)}/transcribir`} prefetch={false} className={CLASE_CHICO}>
                            <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
                            Transcribir<span className="sr-only"> {f.numero}</span>
                          </Link>
                        ) : null}
                        <Link href={rutaFicha(f.numero)} prefetch={false} className={CLASE_CHICO}>
                          Abrir<span className="sr-only"> {f.numero}</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paseRapido ? (
        <DialogoPaseRapido
          fila={paseRapido}
          recargar={rutaBandeja(pestana)}
          onCerrar={() => setPaseRapido(null)}
          onHecho={(texto) => {
            setPaseRapido(null);
            setAviso({ tipo: "ok", texto });
          }}
        />
      ) : null}
    </div>
  );
}

/** "Dar pase rápido": al paso siguiente, ahora, sin más datos. Para elegir otra fecha u observación, la ficha. */
function DialogoPaseRapido({ fila, recargar, onCerrar, onHecho }: { fila: FilaBandeja; recargar: string; onCerrar: () => void; onHecho: (texto: string) => void }) {
  const [comandoId] = useState(nuevoComandoId);
  const [error, setError] = useState<EstadoError | null>(null);
  const [pendiente, iniciar] = useTransition();
  const destino = fila.paseRapido;
  if (!destino) return null;
  return (
    <Dialogo titulo="Dar pase rápido" descripcion={`${fila.numero} · ${fila.titular ?? "sin titular"}`} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          iniciar(async () => {
            const r = await accionPase({ numero: fila.numero, pasoDestino: destino.clave, versionVista: fila.version, comandoId });
            if (r.ok) onHecho(r.mensaje);
            else setError(r);
          });
        }}
      >
        <p className="text-sm text-slate-800">
          Sale de {fila.paso.orden}. {fila.paso.nombre} y va a{" "}
          <strong>
            {destino.orden}. {destino.nombre}
          </strong>
          , con fecha de ahora. Para indicar otra fecha o una observación, abrí la ficha.
        </p>
        {error ? <AvisoError error={error} recargar={recargar} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO} data-autofocus>
            {pendiente ? "Dando el pase…" : "Dar pase"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
