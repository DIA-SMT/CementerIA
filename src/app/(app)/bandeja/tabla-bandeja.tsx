"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRightLeft, Clock, FileClock, FolderOpen, Inbox, PackageCheck } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { EstadoVacio } from "@/components/estado-vacio";
import {
  CLASE_BOTON_COMPACTO,
  CLASE_BOTON_COMPACTO_PRIMARIO,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CASILLA,
  CLASE_ENLACE,
} from "@/components/formulario";
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
 *
 * Señales de cada fila (siempre con texto, el color no es la única): devuelto
 * en rojo con una franja a la izquierda, demorado en rojo con reloj, el
 * semáforo del plazo como insignia y "Sin confirmar" en ámbar.
 */

type AvisoBandeja = { tipo: "ok"; texto: string; detalle?: string[] } | { tipo: "error"; error: EstadoError };

/** Lo que se dice cuando una pestaña está vacía. */
const VACIA: Record<PestanaBandeja, { titulo: string; texto: string }> = {
  por_confirmar: { titulo: "No hay expedientes por confirmar.", texto: "Cuando otra área le dé un pase a la tuya, aparece acá para que confirmes la recepción." },
  en_mi_area: { titulo: "No hay expedientes en esta pestaña.", texto: "Tu área no tiene expedientes para trabajar ahora." },
  afuera: { titulo: "No hay expedientes en esta pestaña.", texto: "Ninguno de los que sigue tu área está en un área externa." },
  plazos: { titulo: "No hay expedientes con plazo.", texto: "Cuando un expediente entre a la DIM, su vencimiento se sigue acá." },
  carga_historica: { titulo: "No hay cargas históricas abiertas.", texto: "Los expedientes iniciados antes del sistema aparecen acá hasta que se termina su carga." },
};

export function TablaBandeja({ pestana, filas }: { pestana: PestanaBandeja; filas: FilaBandeja[] }) {
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [aviso, setAviso] = useState<AvisoBandeja | null>(null);
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

  const vacia = VACIA[pestana];
  const titulo = conVencimiento ? "Expedientes con plazo, del que vence antes al último" : "Expedientes de la pestaña, del que llegó antes al más nuevo";
  const elegir = (numero: string, si: boolean) => setSeleccion((s) => (si ? [...s, numero] : s.filter((n) => n !== numero)));

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" className="empty:hidden">
        {aviso?.tipo === "ok" ? (
          <Aviso tono="exito">
            <p>{aviso.texto}</p>
            {aviso.detalle && aviso.detalle.length > 0 ? (
              <ul className="list-disc pl-5 text-error">
                {aviso.detalle.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Aviso>
        ) : null}
      </div>
      {aviso?.tipo === "error" ? <AvisoError error={aviso.error} recargar={rutaBandeja(pestana)} /> : null}

      {lote ? (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-tarjeta border px-4 py-2.5 transition-colors duration-150 ${
            elegidos.length > 0 ? "border-info-borde bg-info-fondo" : "border-borde bg-white"
          }`}
        >
          <label className="inline-flex items-center gap-2 text-sm font-medium text-texto">
            <input
              type="checkbox"
              checked={todos}
              onChange={(e) => setSeleccion(e.target.checked ? confirmables.map((f) => f.numero) : [])}
              className={CLASE_CASILLA}
            />
            Seleccionar todos
          </label>
          <span className="text-sm text-texto-secundario tabular-nums" aria-hidden="true">
            {elegidos.length} de {confirmables.length}
          </span>
          <button
            type="button"
            onClick={confirmarSeleccionados}
            disabled={pendiente || elegidos.length === 0}
            className={`${CLASE_BOTON_PRIMARIO} sm:ml-auto`}
          >
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            {pendiente ? "Confirmando…" : `Confirmar seleccionados (${elegidos.length})`}
          </button>
        </div>
      ) : null}

      {filas.length === 0 ? (
        <EstadoVacio icono={pestana === "por_confirmar" ? Inbox : FolderOpen} titulo={vacia.titulo} imagen={pestana === "por_confirmar" ? "parque-memorial" : undefined}>
          <p>{vacia.texto}</p>
        </EstadoVacio>
      ) : (
        // Tabla o tarjetas según el ancho que le queda a la bandeja (container
        // query, no el de la ventana: depende de si la barra lateral está
        // contraída). Tabla desde 56rem (896 px); debajo, una tarjeta por
        // expediente. La que no corresponde queda con display:none: nunca hay
        // dos botones con el mismo nombre al alcance del lector de pantalla.
        <div className="@container">
          <div className="tarjeta relative hidden overflow-x-auto @4xl:block">
            <table className="tabla-datos table-fixed">
              <caption className="sr-only">{titulo}</caption>
              <colgroup>
                {lote ? <col className="w-10" /> : null}
                <col className="w-[9.5rem]" />
                <col />
                <col />
                <col />
                <col className="w-[8rem]" />
                {conVencimiento ? <col className="w-[9rem]" /> : null}
                <col className="w-[9.5rem]" />
                <col className="w-[9.75rem]" />
              </colgroup>
              <thead>
                <tr>
                  {lote ? (
                    <th scope="col">
                      <span className="sr-only">Seleccionar</span>
                    </th>
                  ) : null}
                  <th scope="col">N° interno</th>
                  <th scope="col">Titular</th>
                  <th scope="col">Trámite</th>
                  <th scope="col">Paso</th>
                  <th scope="col">En el área</th>
                  {conVencimiento ? <th scope="col">Vencimiento</th> : null}
                  <th scope="col">Etiquetas</th>
                  <th scope="col" className="pl-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const senal = senalDeFila(f, conVencimiento);
                  // Franja a la izquierda de la primera celda: rojo si volvió devuelto o venció el plazo.
                  const franja = senal ? "shadow-[inset_4px_0_0_var(--color-error)]" : "";
                  return (
                    <tr key={f.numero} className={senal === "devuelto" ? "bg-error-fondo" : senal === "vencido" ? "bg-error-fondo/60" : undefined}>
                      {lote ? (
                        <td className={franja}>
                          {f.puedeConfirmar ? <CasillaFila fila={f} elegida={elegidos.includes(f.numero)} onCambiar={elegir} /> : null}
                        </td>
                      ) : null}
                      <th scope="row" className={`font-normal ${lote ? "" : franja}`}>
                        <Link href={rutaFicha(f.numero)} prefetch={false} className={`${CLASE_ENLACE} whitespace-nowrap font-mono text-[0.8125rem] font-medium`}>
                          {f.numero}
                        </Link>
                        <span className="block text-xs text-texto-secundario">{f.numeroCorto}</span>
                        {f.numeroMunicipal ? (
                          <span className="block truncate text-xs text-texto-secundario tabular-nums" title={`N° municipal ${f.numeroMunicipal}`}>
                            <abbr title="Número municipal" className="no-underline">
                              N° mun.
                            </abbr>{" "}
                            {f.numeroMunicipal}
                          </span>
                        ) : null}
                      </th>
                      <td>
                        <span className="line-clamp-2 font-medium" title={f.titular ?? undefined}>
                          {f.titular ?? "—"}
                        </span>
                      </td>
                      <td>
                        <span className="line-clamp-2" title={f.tramite.tipo}>
                          {f.tramite.tipo}
                        </span>
                        <span className="block truncate text-xs text-texto-secundario" title={`${f.tramite.plantilla} · v${f.tramite.version}`}>
                          {f.tramite.plantilla} · v{f.tramite.version}
                        </span>
                      </td>
                      <td>
                        {/* El orden arriba, chico, y el nombre en hasta dos renglones: así no se corta el nombre del paso. */}
                        <span className="block text-xs font-semibold text-primario-oscuro tabular-nums">
                          {f.paso.orden}/{f.paso.total}
                        </span>
                        <span className="line-clamp-2" title={f.paso.nombre}>
                          {f.paso.nombre}
                        </span>
                        {f.areaActual.externa ? <span className="block truncate text-xs text-texto-secundario">En {f.areaActual.nombre}</span> : null}
                      </td>
                      <td>
                        <EnElArea fila={f} />
                      </td>
                      {conVencimiento ? (
                        <td>
                          <Vencimiento fila={f} />
                        </td>
                      ) : null}
                      <td>
                        <Etiquetas fila={f} conVencimiento={conVencimiento} />
                      </td>
                      <td className="pl-2">
                        <Acciones
                          fila={f}
                          pestana={pestana}
                          pendiente={pendiente}
                          onConfirmar={confirmarUno}
                          onPaseRapido={setPaseRapido}
                          className="flex flex-col items-stretch gap-1.5"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul aria-label={titulo} className="grid gap-3 @2xl:grid-cols-2 @4xl:hidden">
            {filas.map((f) => {
              const senal = senalDeFila(f, conVencimiento);
              return (
                <li
                  key={f.numero}
                  className={`tarjeta flex flex-col gap-3 p-4 ${
                    senal === "devuelto"
                      ? "border-error-borde bg-error-fondo shadow-[inset_4px_0_0_var(--color-error)]"
                      : senal === "vencido"
                        ? "border-error-borde shadow-[inset_4px_0_0_var(--color-error)]"
                        : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {lote && f.puedeConfirmar ? (
                      <CasillaFila fila={f} elegida={elegidos.includes(f.numero)} onCambiar={elegir} className="mt-1" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={rutaFicha(f.numero)} prefetch={false} className={`${CLASE_ENLACE} font-mono font-medium`}>
                          {f.numero}
                        </Link>
                        <span className="text-xs text-texto-secundario">{f.numeroCorto}</span>
                      </p>
                      <p className="mt-0.5 font-medium text-texto">{f.titular ?? "Sin titular"}</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-texto-secundario">Trámite</dt>
                    <dd className="min-w-0">
                      {f.tramite.tipo}
                      <span className="block text-xs text-texto-secundario">
                        {f.tramite.plantilla} · v{f.tramite.version}
                      </span>
                    </dd>
                    <dt className="text-texto-secundario">Paso</dt>
                    <dd className="min-w-0">
                      <span className="whitespace-nowrap text-xs font-semibold text-primario-oscuro tabular-nums">
                        {f.paso.orden}/{f.paso.total}
                      </span>{" "}
                      {f.paso.nombre}
                      {f.areaActual.externa ? <span className="block text-xs text-texto-secundario">En {f.areaActual.nombre}</span> : null}
                    </dd>
                    <dt className="text-texto-secundario">En el área</dt>
                    <dd className="min-w-0">
                      <EnElArea fila={f} />
                    </dd>
                    {conVencimiento ? (
                      <>
                        <dt className="text-texto-secundario">Vencimiento</dt>
                        <dd className="min-w-0">
                          <Vencimiento fila={f} />
                        </dd>
                      </>
                    ) : null}
                    {f.numeroMunicipal ? (
                      <>
                        <dt className="text-texto-secundario">N° municipal</dt>
                        <dd className="min-w-0 tabular-nums">{f.numeroMunicipal}</dd>
                      </>
                    ) : null}
                  </dl>
                  {f.etiquetas.length > 0 || f.soloConsulta ? <Etiquetas fila={f} conVencimiento={conVencimiento} enFila /> : null}
                  <Acciones
                    fila={f}
                    pestana={pestana}
                    pendiente={pendiente}
                    onConfirmar={confirmarUno}
                    onPaseRapido={setPaseRapido}
                    className="mt-auto flex flex-wrap gap-2 border-t border-borde pt-3"
                  />
                </li>
              );
            })}
          </ul>
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

// ---------------------------------------------------------------------------
// Piezas de una fila: las comparten la tabla y las tarjetas.
// ---------------------------------------------------------------------------

/** La señal roja de la fila: devuelto, o (en Plazos) con el plazo vencido. */
function senalDeFila(f: FilaBandeja, conVencimiento: boolean): "devuelto" | "vencido" | null {
  if (f.etiquetas.some((e) => e.tipo === "devuelto")) return "devuelto";
  const plazo = f.etiquetas.find((e) => e.tipo === "plazo");
  if (conVencimiento && plazo && plazo.tipo === "plazo" && mostrarPlazo(plazo).semaforo === "vencido") return "vencido";
  return null;
}

function CasillaFila({
  fila,
  elegida,
  onCambiar,
  className = "",
}: {
  fila: FilaBandeja;
  elegida: boolean;
  onCambiar: (numero: string, si: boolean) => void;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={`Seleccionar ${fila.numero}`}
      checked={elegida}
      onChange={(e) => onCambiar(fila.numero, e.target.checked)}
      className={`${CLASE_CASILLA} mt-0.5 ${className}`}
    />
  );
}

/** Días hábiles en el área (rojo con reloj si está demorado) y desde cuándo. */
function EnElArea({ fila: f }: { fila: FilaBandeja }) {
  return (
    <>
      <span className={f.demorado ? "inline-flex items-start gap-1 font-semibold text-error" : "text-texto"}>
        {f.demorado ? <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        <span>
          <span className="whitespace-nowrap">{textoDias(f.diasEnArea)}</span>
          {f.demorado ? <span className="block text-xs font-normal">demorado (alerta a los {f.diasAlerta})</span> : null}
        </span>
      </span>
      <span className="block text-xs text-texto-secundario">desde {formatearSegunPrecision(f.enAreaDesde, f.enAreaDesdePrecision)}</span>
    </>
  );
}

/** El vencimiento del plazo (pestaña Plazos) con su semáforo. */
function Vencimiento({ fila: f }: { fila: FilaBandeja }) {
  const etiqueta = f.etiquetas.find((e) => e.tipo === "plazo");
  if (!etiqueta || etiqueta.tipo !== "plazo") return <>—</>;
  const plazo = mostrarPlazo(etiqueta);
  return (
    <>
      <span className={`insignia ring-1 ring-inset ${plazo.clase}`}>{plazo.etiqueta}</span>
      <span className="mt-0.5 block whitespace-nowrap text-texto">{etiqueta.vence ? formatearFecha(etiqueta.vence) : "—"}</span>
      <span className="block text-xs text-texto-secundario">{plazo.texto}</span>
      {plazo.aviso ? <span className="block text-xs text-texto-secundario">{plazo.aviso}</span> : null}
    </>
  );
}

/**
 * Devuelto (con el motivo), sin confirmar, plazo y "solo consulta". En la
 * tabla el motivo de la devolución se corta a 3 renglones (el texto completo
 * queda en el `title` y lo lee entero el lector de pantalla); en la tarjeta va
 * entero, en una fila.
 */
function Etiquetas({ fila: f, conVencimiento, enFila = false }: { fila: FilaBandeja; conVencimiento: boolean; enFila?: boolean }) {
  return (
    <ul className={enFila ? "flex flex-wrap items-start gap-1.5" : "flex flex-col items-start gap-1"}>
      {f.etiquetas.map((e, i) => (
        <li key={`${e.tipo}-${i}`} className="max-w-full">
          {e.tipo === "devuelto" ? (
            <span
              title={textoDevuelto(e)}
              className={`${enFila ? "inline-block" : "line-clamp-3"} max-w-full rounded-control bg-white px-2 py-0.5 text-xs font-medium text-error ring-1 ring-inset ring-error-borde`}
            >
              {textoDevuelto(e)}
            </span>
          ) : e.tipo === "sin_confirmar" ? (
            <span className="insignia bg-advertencia-fondo text-advertencia ring-1 ring-inset ring-advertencia-borde">Sin confirmar</span>
          ) : (
            <span className={`insignia max-w-full whitespace-normal ring-1 ring-inset ${mostrarPlazo(e).clase}`}>
              Plazo: {mostrarPlazo(e).etiqueta.toLowerCase()}
              {conVencimiento ? "" : ` · ${e.texto}`}
            </span>
          )}
        </li>
      ))}
      {f.soloConsulta ? <li className="text-xs text-texto-secundario">Consulta (lo sigue {f.areaResponsable.nombre})</li> : null}
    </ul>
  );
}

/** Confirmar, Dar pase rápido, Transcribir y Abrir: botones compactos que no se parten. */
function Acciones({
  fila: f,
  pestana,
  pendiente,
  onConfirmar,
  onPaseRapido,
  className,
}: {
  fila: FilaBandeja;
  pestana: PestanaBandeja;
  pendiente: boolean;
  onConfirmar: (fila: FilaBandeja) => void;
  onPaseRapido: (fila: FilaBandeja) => void;
  className: string;
}) {
  return (
    <div className={className}>
      {f.puedeConfirmar ? (
        <button type="button" onClick={() => onConfirmar(f)} disabled={pendiente} className={CLASE_BOTON_COMPACTO_PRIMARIO}>
          Confirmar<span className="sr-only"> la recepción de {f.numero}</span>
        </button>
      ) : null}
      {f.paseRapido ? (
        <button type="button" aria-haspopup="dialog" onClick={() => onPaseRapido(f)} disabled={pendiente} className={CLASE_BOTON_COMPACTO}>
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Dar pase rápido<span className="sr-only"> de {f.numero}</span>
        </button>
      ) : null}
      {pestana === "carga_historica" ? (
        <Link href={`${rutaFicha(f.numero)}/transcribir`} prefetch={false} className={CLASE_BOTON_COMPACTO}>
          <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
          Transcribir<span className="sr-only"> {f.numero}</span>
        </Link>
      ) : null}
      <Link href={rutaFicha(f.numero)} prefetch={false} className={CLASE_BOTON_COMPACTO}>
        Abrir<span className="sr-only"> {f.numero}</span>
      </Link>
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
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-borde bg-fondo px-3 py-2.5 text-sm">
          <span className="text-texto-secundario">
            <span className="sr-only">Sale de </span>
            {fila.paso.orden}. {fila.paso.nombre}
          </span>
          <ArrowRightLeft className="h-4 w-4 text-primario-oscuro" aria-hidden="true" />
          <span className="sr-only"> y va a </span>
          <strong className="font-semibold text-texto">
            {destino.orden}. {destino.nombre}
          </strong>
        </div>
        <p className="text-sm text-texto">El pase va con fecha de ahora. Para indicar otra fecha o una observación, abrí la ficha.</p>
        {error ? <AvisoError error={error} recargar={recargar} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
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
