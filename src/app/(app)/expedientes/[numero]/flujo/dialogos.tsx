"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL } from "@/components/formulario";
import { LARGO_MINIMO_MOTIVO } from "@/lib/dominio/expedientes/errores";
import {
  aplicarAtajo,
  ATAJOS_DEVOLUCION,
  destinoInicial,
  itemsFaltan,
  nuevoComandoId,
  opcionesDestino,
  reiniciablesPara,
  tituloFaltan,
  type ItemFaltante,
} from "@/lib/presentacion/flujo";
import { ETIQUETA_DOCUMENTO } from "@/lib/presentacion/textos";
import { accionDevolucion, accionDocumento, accionPase, accionRecepcion, accionSubtarea, verDatosCompletos } from "../../acciones";
import { DialogoAdjuntar } from "./adjuntar";
import { useFlujo } from "./estado";
import { CampoFecha, erroresDe, ListaFaltan, useEnvio, useFechaEfectiva } from "./piezas";
import type { DialogoFlujo, DatosFlujo } from "./tipos";

/**
 * Los diálogos de las acciones de la semana 3 en la ficha. Cada uno genera su
 * `comandoId` al abrirse (un doble clic o un reintento no repite la acción) y
 * manda la `versionVista` del contexto. Las reglas las controla el dominio:
 * acá solo se piden los datos y se muestran sus errores.
 */

export function DialogoActivo({ dialogo }: { dialogo: DialogoFlujo }) {
  switch (dialogo.tipo) {
    case "recepcion":
      return <DialogoRecepcion />;
    case "pase":
      return <DialogoPase />;
    case "devolver":
      return <DialogoDevolver />;
    case "tildar":
      return <DialogoTildar clave={dialogo.clave} volverAlPase={dialogo.volverAlPase ?? false} />;
    case "destildar":
      return <DialogoDestildar clave={dialogo.clave} />;
    case "documento":
      return <DialogoDocumento clave={dialogo.clave} volverAlPase={dialogo.volverAlPase ?? false} />;
    case "adjuntar":
      return <DialogoAdjuntar documento={dialogo.documento} volverAlPase={dialogo.volverAlPase ?? false} />;
    case "visor":
      return <DialogoVisor adjunto={dialogo.adjunto} motivo={dialogo.motivo} />;
    case "motivoAdjuntos":
      return <DialogoMotivoAdjuntos />;
  }
}

/** Botones de pie: la acción y Cancelar. */
function Pie({ pendiente, texto, textoPendiente, onCancelar, deshabilitado = false }: {
  pendiente: boolean;
  texto: string;
  textoPendiente: string;
  onCancelar: () => void;
  deshabilitado?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
      <button type="button" onClick={onCancelar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
        Cancelar
      </button>
      <button type="submit" disabled={pendiente || deshabilitado} className={CLASE_BOTON_PRIMARIO}>
        {pendiente ? textoPendiente : texto}
      </button>
    </div>
  );
}

function Observacion({ valor, poner, error, etiqueta = "Observación (opcional)", obligatoria = false }: {
  valor: string;
  poner: (v: string) => void;
  error: ReturnType<typeof useEnvio>["error"];
  etiqueta?: string;
  obligatoria?: boolean;
}) {
  const errores = erroresDe(error, "observacion");
  return (
    <Campo ruta="observacion" etiqueta={etiqueta} obligatorio={obligatoria} errores={errores}>
      <textarea {...atributosCampo("observacion", errores)} rows={2} maxLength={2000} value={valor} onChange={(e) => poner(e.target.value)} className={CLASE_CONTROL} />
    </Campo>
  );
}

function Motivo({ valor, poner, error, ayuda, autoFocus = false }: {
  valor: string;
  poner: (v: string) => void;
  error: ReturnType<typeof useEnvio>["error"];
  ayuda?: string;
  autoFocus?: boolean;
}) {
  const errores = erroresDe(error, "motivo");
  return (
    <Campo ruta="motivo" etiqueta="Motivo" obligatorio errores={errores} ayuda={ayuda ?? `${LARGO_MINIMO_MOTIVO} caracteres o más`}>
      <textarea
        {...atributosCampo("motivo", errores, "campo-motivo-ayuda")}
        rows={3}
        maxLength={2000}
        value={valor}
        onChange={(e) => poner(e.target.value)}
        data-autofocus={autoFocus ? true : undefined}
        className={CLASE_CONTROL}
      />
    </Campo>
  );
}

/** Si el motivo es corto, el error se muestra sin ir al servidor (el servidor lo controla igual). */
function motivoCorto(motivo: string): { ok: false; codigo: string; mensaje: string; errores: Array<{ ruta: string; mensaje: string }> } | null {
  if (motivo.trim().length >= LARGO_MINIMO_MOTIVO) return null;
  return { ok: false, codigo: "motivo_requerido", mensaje: "Falta el motivo", errores: [{ ruta: "motivo", mensaje: `Escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` }] };
}

const RUTAS_EN_CAMPO = ["motivo", "observacion", "fechaEfectiva", "dato"];

// ---------------------------------------------------------------------------
// Recepción
// ---------------------------------------------------------------------------

function DialogoRecepcion() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const fecha = useFechaEfectiva();
  const { pendiente, error, enviar } = useEnvio();

  return (
    <Dialogo titulo="Confirmar recepción" descripcion={`${datos.numero} · ${datos.areaActual}`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(() => accionRecepcion({ numero: datos.numero, versionVista: version, comandoId, fechaEfectiva: fecha.valor }), hecho);
        }}
      >
        <p className="text-sm text-slate-800">Confirmás que el expediente en papel llegó a tu área.</p>
        <CampoFecha fecha={fecha} error={error} ayuda="Si llegó antes y lo confirmás ahora, indicá cuándo llegó." />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS_EN_CAMPO} /> : null}
        <Pie pendiente={pendiente} texto="Confirmar recepción" textoPendiente="Confirmando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Pase ("Faltan N" y destinos)
// ---------------------------------------------------------------------------

/** El acceso directo de un faltante: cierra la lista y abre el diálogo que lo resuelve; al terminar, vuelve al pase. */
function useAccesoFaltante(): (item: ItemFaltante) => void {
  const { abrir } = useFlujo();
  return (item) => {
    const a = item.accion?.acceso;
    if (!a) return;
    if (a.tipo === "tildar") abrir({ tipo: "tildar", clave: a.clave, volverAlPase: true });
    else if (a.tipo === "documento") abrir({ tipo: "documento", clave: a.clave, volverAlPase: true });
    else if (a.tipo === "adjuntar") abrir({ tipo: "adjuntar", documento: a.documento, volverAlPase: true });
  };
}

export function faltantesDe(datos: DatosFlujo): ItemFaltante[] {
  return itemsFaltan(datos.pase.faltan, datos.permisos, datos.rutaEditar);
}

function DialogoPase() {
  const { datos, cerrar } = useFlujo();
  const acceso = useAccesoFaltante();
  const faltan = faltantesDe(datos);

  if (faltan.length > 0) {
    return (
      <Dialogo titulo={tituloFaltan(faltan.length)} descripcion={`Para dar el pase desde ${datos.paso.nombre} falta:`} onCerrar={cerrar}>
        <div className="space-y-4">
          <ListaFaltan items={faltan} onAcceso={acceso} />
          <div className="flex justify-end border-t border-slate-200 pt-3">
            <button type="button" onClick={cerrar} className={CLASE_BOTON_SECUNDARIO} data-autofocus>
              Cerrar
            </button>
          </div>
        </div>
      </Dialogo>
    );
  }
  return <FormularioPase />;
}

function FormularioPase() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const opciones = opcionesDestino(datos.pase.destinos, (c) => datos.nombresPasos[c] ?? c);
  const [comandoId] = useState(nuevoComandoId);
  const [destino, setDestino] = useState<string | null>(() => destinoInicial(opciones));
  const [motivo, setMotivo] = useState("");
  const [observacion, setObservacion] = useState("");
  const fecha = useFechaEfectiva();
  const { pendiente, error, setError, enviar } = useEnvio();
  const elegida = opciones.find((o) => o.clave === destino) ?? null;

  return (
    <Dialogo titulo="Dar pase" descripcion={`${datos.numero} · sale de ${datos.paso.orden}. ${datos.paso.nombre}`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!elegida) return;
          if (elegida.requiereMotivo) {
            const corto = motivoCorto(motivo);
            if (corto) return setError(corto);
          }
          enviar(
            () =>
              accionPase({
                numero: datos.numero,
                pasoDestino: elegida.clave,
                versionVista: version,
                comandoId,
                fechaEfectiva: fecha.valor,
                motivo: elegida.requiereMotivo ? motivo : null,
                observacion,
              }),
            hecho,
          );
        }}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Destino</legend>
          {opciones.length === 0 ? <p className="text-sm text-slate-700">No hay a dónde dar el pase.</p> : null}
          <ul className="space-y-2">
            {opciones.map((o, i) => (
              <li key={o.clave}>
                <label className={`flex items-start gap-2 text-sm ${o.disponible ? "text-slate-900" : "text-slate-500"}`}>
                  <input
                    type="radio"
                    name="destino"
                    value={o.clave}
                    checked={destino === o.clave}
                    disabled={!o.disponible}
                    onChange={() => setDestino(o.clave)}
                    data-autofocus={i === 0 ? true : undefined}
                    className="mt-0.5 h-4 w-4 accent-slate-800"
                  />
                  <span>
                    {o.etiqueta}
                    {o.detalle ? <span className="block text-xs text-slate-600">{o.detalle}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {elegida?.requiereMotivo ? <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="Por qué se saltean pasos (10 caracteres o más)" /> : null}
        <Observacion valor={observacion} poner={setObservacion} error={error} />
        <CampoFecha fecha={fecha} error={error} ayuda="Cuándo salió el papel. Si fue antes, hasta 30 días atrás." />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS_EN_CAMPO} /> : null}
        <Pie pendiente={pendiente} texto="Dar pase" textoPendiente="Dando el pase…" onCancelar={cerrar} deshabilitado={!elegida} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Devolución (3.4)
// ---------------------------------------------------------------------------

function DialogoDevolver() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const destinos = datos.devolucion.destinos;
  const [comandoId] = useState(nuevoComandoId);
  const [destino, setDestino] = useState<string | null>(destinos.at(-1)?.clave ?? null);
  const [motivo, setMotivo] = useState("");
  const [rehacer, setRehacer] = useState<string[]>([]);
  const [observacion, setObservacion] = useState("");
  const fecha = useFechaEfectiva();
  const { pendiente, error, setError, enviar } = useEnvio();
  const ordenDestino = destinos.find((d) => d.clave === destino)?.orden ?? null;
  const reiniciables = reiniciablesPara(datos.devolucion.subtareasReiniciables, ordenDestino);

  return (
    <Dialogo titulo="Devolver" descripcion={`${datos.numero} · está en ${datos.paso.orden}. ${datos.paso.nombre}`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!destino) return;
          const corto = motivoCorto(motivo);
          if (corto) return setError(corto);
          const subtareas = rehacer.filter((c) => reiniciables.some((s) => s.clave === c));
          enviar(
            () => accionDevolucion({ numero: datos.numero, pasoDestino: destino, motivo, subtareas, versionVista: version, comandoId, fechaEfectiva: fecha.valor, observacion }),
            hecho,
          );
        }}
      >
        <Campo ruta="pasoDestino" etiqueta="Devolver al paso" obligatorio>
          <select {...atributosCampo("pasoDestino", undefined)} value={destino ?? ""} onChange={(e) => setDestino(e.target.value)} className={CLASE_CONTROL} data-autofocus>
            {destinos.map((d) => (
              <option key={d.clave} value={d.clave}>
                {d.orden}. {d.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Atajos para el motivo">
            <span className="text-xs text-slate-600">Atajos:</span>
            {ATAJOS_DEVOLUCION.map((a) => (
              <button key={a} type="button" onClick={() => setMotivo((m) => aplicarAtajo(m, a))} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-0.5 text-xs`}>
                {a}
              </button>
            ))}
          </div>
          <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="Lo ve el área que lo recibe, en rojo en su bandeja (10 caracteres o más)" />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Qué hay que rehacer</legend>
          {reiniciables.length === 0 ? (
            <p className="text-sm text-slate-600">No hay subtareas tildadas desde ese paso.</p>
          ) : (
            <ul className="space-y-1">
              {reiniciables.map((s) => (
                <li key={s.clave}>
                  <label className="flex items-start gap-2 text-sm text-slate-900">
                    <input
                      type="checkbox"
                      checked={rehacer.includes(s.clave)}
                      onChange={(e) => setRehacer((r) => (e.target.checked ? [...r, s.clave] : r.filter((c) => c !== s.clave)))}
                      className={`${CLASE_CASILLA} mt-0.5`}
                    />
                    <span>
                      {s.nombre} <span className="text-slate-600">({s.paso.nombre})</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-slate-600">Las marcadas se destildan; lo demás sigue tildado (la firma en papel sigue existiendo).</p>
        </fieldset>
        <Observacion valor={observacion} poner={setObservacion} error={error} />
        <CampoFecha fecha={fecha} error={error} />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS_EN_CAMPO} /> : null}
        <Pie pendiente={pendiente} texto="Devolver" textoPendiente="Devolviendo…" onCancelar={cerrar} deshabilitado={!destino} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Subtareas
// ---------------------------------------------------------------------------

function DialogoTildar({ clave, volverAlPase }: { clave: string; volverAlPase: boolean }) {
  const { datos, version, cerrar, hecho } = useFlujo();
  const s = datos.subtareas.find((x) => x.clave === clave);
  const [comandoId] = useState(nuevoComandoId);
  const [dato, setDato] = useState(s?.valor ?? "");
  const [observacion, setObservacion] = useState("");
  const fecha = useFechaEfectiva();
  const { pendiente, error, enviar } = useEnvio();
  if (!s) return null;
  const erroresDato = erroresDe(error, "dato");
  const fechaDelDato = datos.paso.externo && s.dato === "fecha";

  return (
    <Dialogo titulo={s.hecha ? "Cambiar el dato" : "Tildar subtarea"} descripcion={s.nombre} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(
            () =>
              accionSubtarea({
                numero: datos.numero,
                clave,
                hecha: true,
                dato: s.dato ? dato : null,
                observacion,
                fechaEfectiva: fechaDelDato ? "" : fecha.valor,
                versionVista: version,
                comandoId,
              }),
            (r) => hecho(r, volverAlPase ? { tipo: "pase" } : null),
          );
        }}
      >
        {s.dato === "fecha" ? (
          <Campo ruta="dato" etiqueta="Fecha" obligatorio={s.datoObligatorio} errores={erroresDato} ayuda={fechaDelDato ? "Es la fecha del movimiento (paso externo)" : undefined}>
            <input {...atributosCampo("dato", erroresDato)} type="date" value={dato} max={fecha.limites.maxDia} onChange={(e) => setDato(e.target.value)} data-autofocus className={`${CLASE_CONTROL} max-w-48`} />
          </Campo>
        ) : s.dato === "texto" ? (
          <Campo ruta="dato" etiqueta="Dato" obligatorio={s.datoObligatorio} errores={erroresDato} ayuda="Por ejemplo, el N° de registro o de boleta (hasta 200 caracteres)">
            <input {...atributosCampo("dato", erroresDato)} type="text" maxLength={200} value={dato} onChange={(e) => setDato(e.target.value)} data-autofocus className={CLASE_CONTROL} />
          </Campo>
        ) : (
          <p className="text-sm text-slate-800">Se marca como hecha.</p>
        )}
        <Observacion valor={observacion} poner={setObservacion} error={error} />
        {fechaDelDato ? null : <CampoFecha fecha={fecha} error={error} ayuda="Cuándo se hizo, si no fue recién (hasta 30 días atrás)." />}
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS_EN_CAMPO} /> : null}
        <Pie pendiente={pendiente} texto={s.hecha ? "Guardar" : "Tildar"} textoPendiente="Guardando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

function DialogoDestildar({ clave }: { clave: string }) {
  const { datos, version, cerrar, hecho } = useFlujo();
  const s = datos.subtareas.find((x) => x.clave === clave);
  const [comandoId] = useState(nuevoComandoId);
  const [motivo, setMotivo] = useState("");
  const [observacion, setObservacion] = useState("");
  const { pendiente, error, setError, enviar } = useEnvio();
  if (!s) return null;

  return (
    <Dialogo titulo="Destildar subtarea" descripcion={s.nombre} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const corto = motivoCorto(motivo);
          if (corto) return setError(corto);
          enviar(() => accionSubtarea({ numero: datos.numero, clave, hecha: false, motivo, observacion, versionVista: version, comandoId }), hecho);
        }}
      >
        <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="Por qué se destilda (10 caracteres o más). Queda en el historial." autoFocus />
        <Observacion valor={observacion} poner={setObservacion} error={error} />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS_EN_CAMPO} /> : null}
        <Pie pendiente={pendiente} texto="Destildar" textoPendiente="Guardando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

type EstadoMarca = "presentado" | "no_corresponde" | "pendiente";

function DialogoDocumento({ clave, volverAlPase }: { clave: string; volverAlPase: boolean }) {
  const { datos, version, cerrar, hecho } = useFlujo();
  const d = datos.documentos.find((x) => x.clave === clave);
  const [comandoId] = useState(nuevoComandoId);
  const [estado, setEstado] = useState<EstadoMarca>(() => (d?.estado === "presentado" || d?.estado === "historico" ? "presentado" : d?.estado === "no_corresponde" ? "no_corresponde" : "presentado"));
  const [observacion, setObservacion] = useState(d?.obs ?? "");
  const { pendiente, error, setError, enviar } = useEnvio();
  if (!d) return null;
  const opciones: Array<{ valor: EstadoMarca; etiqueta: string }> = [
    { valor: "presentado", etiqueta: "Presentado" },
    { valor: "no_corresponde", etiqueta: "No corresponde (con observación)" },
    { valor: "pendiente", etiqueta: "Volver a pendiente" },
  ];

  return (
    <Dialogo titulo="Documento" descripcion={`${d.nombre} · hoy: ${ETIQUETA_DOCUMENTO[d.estado] ?? d.estado}`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (estado === "no_corresponde" && observacion.trim() === "") {
            return setError({ ok: false, codigo: "validacion", mensaje: "Falta la observación", errores: [{ ruta: "observacion", mensaje: "Escribí por qué no corresponde" }] });
          }
          enviar(
            () => accionDocumento({ numero: datos.numero, clave, estado, observacion: estado === "pendiente" ? null : observacion, versionVista: version, comandoId }),
            (r) => hecho(r, volverAlPase ? { tipo: "pase" } : null),
          );
        }}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Estado</legend>
          <div className="space-y-1">
            {opciones.map((o, i) => (
              <label key={o.valor} className="flex items-center gap-2 text-sm text-slate-900">
                <input
                  type="radio"
                  name="estado-documento"
                  value={o.valor}
                  checked={estado === o.valor}
                  onChange={() => setEstado(o.valor)}
                  data-autofocus={i === 0 ? true : undefined}
                  className="h-4 w-4 accent-slate-800"
                />
                {o.etiqueta}
              </label>
            ))}
          </div>
        </fieldset>
        {estado !== "pendiente" ? (
          <Observacion
            valor={observacion}
            poner={setObservacion}
            error={error}
            etiqueta={estado === "no_corresponde" ? "Por qué no corresponde" : "Observación (opcional)"}
            obligatoria={estado === "no_corresponde"}
          />
        ) : null}
        {d.adjunto === "obligatorio" ? <p className="text-xs text-slate-700">Este documento lleva el archivo adjunto para poder dar el pase.</p> : null}
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS_EN_CAMPO} /> : null}
        <Pie pendiente={pendiente} texto="Guardar" textoPendiente="Guardando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Adjuntos: visor y motivo
// ---------------------------------------------------------------------------

/** La ruta de lectura (`/adjuntos/[movimientoId]`), con el motivo si el dominio lo pide. */
export function rutaAdjunto(movimientoId: string, opciones: { descargar?: boolean; motivo?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (opciones.descargar) q.set("descargar", "1");
  if (opciones.motivo) q.set("motivo", opciones.motivo);
  const s = q.toString();
  return `/adjuntos/${encodeURIComponent(movimientoId)}${s ? `?${s}` : ""}`;
}

function DialogoVisor({ adjunto, motivo }: { adjunto: { movimientoId: string; nombre: string; mime: string }; motivo: string | null }) {
  const { cerrar } = useFlujo();
  const src = rutaAdjunto(adjunto.movimientoId, { motivo });
  return (
    <Dialogo titulo={adjunto.nombre} descripcion="Vista del adjunto. Abrirlo queda registrado." onCerrar={cerrar} ancho="ancho">
      <div className="space-y-3">
        {adjunto.mime.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element -- lo sirve un Route Handler con control de acceso: no pasa por next/image.
          <img src={src} alt={`Adjunto: ${adjunto.nombre}`} className="mx-auto max-h-[65vh] w-auto border border-slate-200" />
        ) : (
          <iframe src={src} title={`Adjunto: ${adjunto.nombre}`} className="h-[65vh] w-full border border-slate-200" />
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <a href={rutaAdjunto(adjunto.movimientoId, { descargar: true, motivo })} className={CLASE_BOTON_SECUNDARIO} download>
            <Download className="h-4 w-4" aria-hidden="true" />
            Descargar
          </a>
          <button type="button" onClick={cerrar} className={CLASE_BOTON_PRIMARIO} data-autofocus>
            Cerrar
          </button>
        </div>
      </div>
    </Dialogo>
  );
}

/** Para quien no trabaja el expediente: los adjuntos se ven dando un motivo, como "Ver datos completos" (decisión 13). */
function DialogoMotivoAdjuntos() {
  const { datos, cerrar, hecho, setAdjuntosConMotivo } = useFlujo();
  const [motivo, setMotivo] = useState("");
  const { pendiente, error, setError, enviar } = useEnvio();
  return (
    <Dialogo titulo="Ver adjuntos" descripcion="Tu área no trabaja este expediente: escribí por qué necesitás verlos. Queda registrado." onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const corto = motivoCorto(motivo);
          if (corto) return setError(corto);
          enviar(
            async () => {
              const r = await verDatosCompletos(datos.numero, motivo);
              return r.ok ? { ok: true as const, datos: r.datos } : r;
            },
            (r) => {
              setAdjuntosConMotivo({ motivo, lista: r.datos.adjuntos });
              hecho({ mensaje: "Tu consulta quedó registrada: ya podés ver los adjuntos." });
            },
          );
        }}
      >
        <Motivo valor={motivo} poner={setMotivo} error={error} autoFocus />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS_EN_CAMPO} /> : null}
        <Pie pendiente={pendiente} texto="Ver adjuntos" textoPendiente="Consultando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}
