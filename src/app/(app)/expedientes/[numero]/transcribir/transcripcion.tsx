"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, FileUp, Flag, Plus, Save, Trash2 } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL, MensajeError } from "@/components/formulario";
import { LARGO_MINIMO_MOTIVO } from "@/lib/dominio/expedientes/errores";
import type { EstadoExpediente } from "@/lib/dominio/permisos";
import { comoDatetimeLocal, formatearFecha, hoyEnTucuman } from "@/lib/fechas";
import type { EstadoError } from "@/lib/presentacion/errores";
import { UBICACION_DESCONOCIDA, valorUbicacion } from "@/lib/presentacion/estados";
import { formatearBytes, nuevoComandoId } from "@/lib/presentacion/flujo";
import { ACCEPT_ADJUNTO, mensajeRespuestaSubida, prepararArchivo } from "@/lib/presentacion/imagen";
import {
  cambiarPrecision,
  COLUMNAS_GRILLA,
  erroresDeGrilla,
  ETIQUETA_COLUMNA,
  filaNueva,
  FUENTE_POR_DEFECTO,
  idCelda,
  loteParaEnviar,
  recorrerFilas,
  siguienteCelda,
  type ColumnaGrilla,
  type ErroresGrilla,
  type FilaGrilla,
} from "@/lib/presentacion/transcripcion";
import { accionEstadoHistorico, accionSubtareaHistorica, accionTerminarCarga, accionTranscribir } from "../../acciones";
import { rutaSubida } from "../flujo/adjuntar";

/**
 * Las piezas de `/expedientes/[numero]/transcribir` que actúan (2.13(c)): la
 * grilla, las subtareas con su fecha, el estado final, la foto de la ficha y
 * "Terminar carga histórica". Comparten la versión que se manda como
 * `versionVista`: la mayor entre la de la página y la que devolvió la última
 * acción (las Server Actions recargan la página con `refresh()`).
 */

export interface DatosTranscripcion {
  numero: string;
  version: number;
  rutaFicha: string;
  estado: EstadoExpediente;
  paso: { orden: number; nombre: string; esFinal: boolean };
  fechaInicio: string;
  pasos: Array<{ clave: string; nombre: string; orden: number }>;
  /** Las de los pasos recorridos y el actual. */
  subtareas: Array<{ clave: string; nombre: string; paso: string; dato: "fecha" | "texto" | null; hecha: boolean; valor: string | null }>;
  /** Lo que "Terminar carga histórica" pasaría a histórico (nombres). */
  pendientes: { subtareas: string[]; documentos: string[] } | null;
  puedeAdjuntar: boolean;
}

type Aviso = { tipo: "ok"; texto: string } | null;

export function Transcripcion({ datos }: { datos: DatosTranscripcion }) {
  const [ultima, setUltima] = useState(-1);
  const [aviso, setAviso] = useState<Aviso>(null);
  const version = Math.max(datos.version, ultima);
  const hecho = (r: { version?: number; mensaje: string }) => {
    if (r.version !== undefined) setUltima((v) => Math.max(v, r.version ?? -1));
    setAviso({ tipo: "ok", texto: r.mensaje });
  };
  const activo = datos.estado === "en_tramite" || datos.estado === "espera_pago_dim";

  return (
    <div className="space-y-5">
      <div role="status" aria-live="polite" className="empty:hidden">
        {aviso ? (
          <p className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            {aviso.texto}
          </p>
        ) : null}
      </div>
      {activo ? <Grilla datos={datos} version={version} hecho={hecho} /> : null}
      <Subtareas datos={datos} version={version} hecho={hecho} />
      <EstadoFinal datos={datos} version={version} hecho={hecho} />
      {datos.puedeAdjuntar ? <FotoFicha datos={datos} version={version} hecho={hecho} /> : null}
      <Terminar datos={datos} version={version} />
    </div>
  );
}

interface PropsSeccion {
  datos: DatosTranscripcion;
  version: number;
  hecho: (r: { version?: number; mensaje: string }) => void;
}

function Seccion({ id, titulo, descripcion, children }: { id: string; titulo: string; descripcion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded border border-slate-300 bg-white p-4">
      <h2 id={id} className="text-base font-semibold text-slate-900">
        {titulo}
      </h2>
      {descripcion ? <div className="mt-1 mb-3 text-sm text-slate-700">{descripcion}</div> : <div className="mb-3" />}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// La grilla
// ---------------------------------------------------------------------------

const TEXTO_TIPO = { pase: "Pase", devolucion: "Devolución", mismo_paso: "Ya está en ese paso", sin_paso: "Elegí el paso" } as const;

function Grilla({ datos, version, hecho }: PropsSeccion) {
  const [filas, setFilas] = useState<FilaGrilla[]>(() => [filaNueva(nuevoComandoId())]);
  const [error, setError] = useState<EstadoError | null>(null);
  const [celdas, setCeldas] = useState<ErroresGrilla>({ celdas: new Map(), generales: [] });
  const [pendiente, iniciar] = useTransition();
  // La celda que recibe el foco cuando aparece la fila agregada con Enter (una vez por pedido).
  const [foco, setFoco] = useState<{ id: string; pedido: number } | null>(null);
  const atendido = useRef(0);
  const ordenDe = (clave: string) => datos.pasos.find((p) => p.clave === clave)?.orden ?? null;
  const recorrido = recorrerFilas(filas, datos.paso.orden, ordenDe);
  const maximo = { dia: hoyEnTucuman(new Date()), momento: comoDatetimeLocal(new Date()) };

  // Después de agregar una fila con Enter, el foco va a su celda.
  useEffect(() => {
    if (!foco || atendido.current === foco.pedido) return;
    const celda = document.getElementById(foco.id);
    if (!celda) return;
    atendido.current = foco.pedido;
    celda.focus();
  }, [foco, filas.length]);

  function poner(id: string, cambios: Partial<FilaGrilla>) {
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
  }
  function agregar(despuesDe = filas.length - 1) {
    setFilas((fs) => [...fs.slice(0, despuesDe + 1), filaNueva(nuevoComandoId(), fs[despuesDe] ?? fs.at(-1)), ...fs.slice(despuesDe + 1)]);
  }
  function quitar(id: string) {
    setFilas((fs) => (fs.length === 1 ? [filaNueva(nuevoComandoId())] : fs.filter((f) => f.id !== id)));
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, fila: number, columna: ColumnaGrilla) {
    if (e.key !== "Enter") return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
      return;
    }
    e.preventDefault();
    const destino = siguienteCelda({ fila, columna }, e.shiftKey ? "arriba" : "abajo", filas.length);
    if (destino.agregarFila) agregar(filas.length - 1);
    const id = idCelda(destino.fila, destino.columna === "motivo" ? "observacion" : destino.columna);
    if (destino.agregarFila) setFoco((f) => ({ id, pedido: (f?.pedido ?? 0) + 1 }));
    else document.getElementById(id)?.focus();
  }

  function registrar() {
    setError(null);
    const lote = loteParaEnviar(filas, recorrido);
    const locales: Array<{ ruta: string; mensaje: string }> = [];
    lote.indices.forEach((i, k) => {
      const r = recorrido[i];
      if (filas[i].fecha.trim() === "") locales.push({ ruta: `filas[${k}].fecha`, mensaje: "Indicá la fecha" });
      if (r.tipo === "sin_paso") locales.push({ ruta: `filas[${k}].pasoDestino`, mensaje: "Elegí el paso al que llegó" });
      if (r.tipo === "mismo_paso") locales.push({ ruta: `filas[${k}].pasoDestino`, mensaje: "El expediente ya está en ese paso" });
      if (filas[i].fuente.trim() === "") locales.push({ ruta: `filas[${k}].fuente`, mensaje: 'Indicá la fuente (ej. "Ficha papel")' });
      if (r.tipo === "devolucion" && filas[i].motivo.trim().length < LARGO_MINIMO_MOTIVO) {
        locales.push({ ruta: `filas[${k}].motivo`, mensaje: `Una vuelta a un paso anterior es una devolución: escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` });
      }
    });
    if (lote.filas.length === 0) {
      setError({ ok: false, codigo: "validacion", mensaje: "Cargá al menos una fila", errores: [] });
      return;
    }
    if (locales.length > 0) {
      setCeldas(erroresDeGrilla(locales, filas, lote.indices));
      setError({ ok: false, codigo: "validacion", mensaje: "Revisá las celdas marcadas", errores: [] });
      return;
    }
    setCeldas({ celdas: new Map(), generales: [] });
    iniciar(async () => {
      const r = await accionTranscribir({ numero: datos.numero, versionVista: version, filas: lote.filas });
      if (!r.ok) {
        const g = erroresDeGrilla(r.errores, filas, lote.indices);
        setCeldas(g);
        setError({ ...r, errores: g.generales.map((m) => ({ ruta: "", mensaje: m })) });
        return;
      }
      // Lo registrado ya está arriba, en "Lo ya transcripto": la grilla vuelve a una fila nueva.
      setFilas((fs) => [filaNueva(nuevoComandoId(), fs.at(-1))].map((f) => ({ ...f, fecha: "" })));
      hecho({ version: r.version, mensaje: r.mensaje });
    });
  }

  const errorCelda = (f: FilaGrilla, c: ColumnaGrilla) => celdas.celdas.get(f.id)?.[c];

  return (
    <Seccion
      id="titulo-grilla"
      titulo="Pases de la ficha"
      descripcion={
        <>
          <p>
            Una fila por pase de la ficha de papel: la fecha y el paso al que llegó el papel. Si vuelve a un paso anterior es una devolución y lleva motivo. Las fechas no pueden ir
            hacia atrás. Para un expediente en curso alcanza con una fila (por ejemplo, &quot;está en Legal desde el 03/10&quot;).
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Teclado: Tab pasa a la celda siguiente; Enter baja a la fila de abajo (en la última, agrega una); Mayús+Enter sube; Ctrl+Enter registra el lote.
          </p>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          registrar();
        }}
        className="space-y-3"
        aria-busy={pendiente}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">Grilla de pases de la ficha de papel: cada fila es un pase o una devolución</caption>
            <thead className="border-b border-slate-300 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="w-8 px-2 py-2">
                  #
                </th>
                {COLUMNAS_GRILLA.map((c) => (
                  <th key={c} scope="col" className="px-2 py-2">
                    {ETIQUETA_COLUMNA[c]}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2">
                  Qué es
                </th>
                <th scope="col" className="px-2 py-2">
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filas.map((f, i) => {
                const r = recorrido[i];
                const devolucion = r?.tipo === "devolucion";
                const etiqueta = (c: ColumnaGrilla) => `${ETIQUETA_COLUMNA[c]}, fila ${i + 1}`;
                const atributos = (c: ColumnaGrilla) => {
                  const err = errorCelda(f, c);
                  return {
                    id: idCelda(i, c),
                    "aria-label": etiqueta(c),
                    "aria-invalid": err ? (true as const) : undefined,
                    "aria-describedby": err ? `${idCelda(i, c)}-error` : undefined,
                    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => alTeclear(e, i, c),
                  };
                };
                const mensaje = (c: ColumnaGrilla) => {
                  const err = errorCelda(f, c);
                  return err ? (
                    <p id={`${idCelda(i, c)}-error`} className="mt-0.5 text-xs text-red-800">
                      {err.join(" · ")}
                    </p>
                  ) : null;
                };
                return (
                  <tr key={f.id} className="align-top">
                    <td className="px-2 py-1.5 text-slate-600">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <input
                        {...atributos("fecha")}
                        type={f.precision === "dia" ? "date" : "datetime-local"}
                        value={f.fecha}
                        min={datos.fechaInicio}
                        max={f.precision === "dia" ? maximo.dia : maximo.momento}
                        onChange={(e) => poner(f.id, { fecha: e.target.value })}
                        className={`${CLASE_CONTROL} min-w-36`}
                      />
                      {mensaje("fecha")}
                    </td>
                    <td className="px-2 py-1.5">
                      <select {...atributos("precision")} value={f.precision} onChange={(e) => setFilas((fs) => fs.map((x) => (x.id === f.id ? cambiarPrecision(x, e.target.value === "minuto" ? "minuto" : "dia") : x)))} className={CLASE_CONTROL}>
                        <option value="dia">Día</option>
                        <option value="minuto">Día y hora</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select {...atributos("pasoDestino")} value={f.pasoDestino} onChange={(e) => poner(f.id, { pasoDestino: e.target.value })} className={`${CLASE_CONTROL} min-w-44`}>
                        <option value="">Elegí…</option>
                        {datos.pasos.map((p) => (
                          <option key={p.clave} value={p.clave}>
                            {p.orden}. {p.nombre}
                          </option>
                        ))}
                      </select>
                      {mensaje("pasoDestino")}
                    </td>
                    <td className="px-2 py-1.5">
                      <input {...atributos("observacion")} type="text" maxLength={2000} value={f.observacion} onChange={(e) => poner(f.id, { observacion: e.target.value })} className={CLASE_CONTROL} />
                      {mensaje("observacion")}
                    </td>
                    <td className="px-2 py-1.5">
                      <input {...atributos("fuente")} type="text" maxLength={200} value={f.fuente} onChange={(e) => poner(f.id, { fuente: e.target.value })} className={`${CLASE_CONTROL} min-w-28`} />
                      {mensaje("fuente")}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        {...atributos("motivo")}
                        type="text"
                        maxLength={2000}
                        value={devolucion ? f.motivo : ""}
                        disabled={!devolucion}
                        placeholder={devolucion ? "Por qué volvió" : "Solo en devoluciones"}
                        onChange={(e) => poner(f.id, { motivo: e.target.value })}
                        className={CLASE_CONTROL}
                      />
                      {mensaje("motivo")}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      <span className={r?.tipo === "devolucion" ? "font-medium text-red-900" : r?.tipo === "pase" ? "text-slate-900" : "text-slate-500"}>{r ? TEXTO_TIPO[r.tipo] : ""}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => quitar(f.id)} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-1`}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">Quitar la fila {i + 1}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error ? <AvisoError error={error} recargar={`${datos.rutaFicha}/transcribir`} /> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => agregar()} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Agregar fila
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {pendiente ? "Registrando…" : "Registrar lote"}
          </button>
        </div>
      </form>
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Subtareas con su fecha
// ---------------------------------------------------------------------------

function Subtareas({ datos, version, hecho }: PropsSeccion) {
  const [abierta, setAbierta] = useState<DatosTranscripcion["subtareas"][number] | null>(null);
  if (datos.subtareas.length === 0) return null;
  return (
    <Seccion id="titulo-subtareas" titulo="Subtareas de los pasos recorridos" descripcion="Se pueden tildar con la fecha que figura en el papel. Lo obligatorio que quede sin tildar pasa a histórico al terminar la carga.">
      <ul className="divide-y divide-slate-200 text-sm">
        {datos.subtareas.map((s) => (
          <li key={s.clave} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              <span aria-hidden="true">{s.hecha ? "☑ " : "☐ "}</span>
              {s.nombre}
              <span className="text-slate-600"> · {s.paso}</span>
              {s.hecha && s.valor ? <span className="text-slate-700"> · {s.dato === "fecha" ? formatearFecha(s.valor) : s.valor}</span> : null}
              <span className="sr-only">{s.hecha ? " (tildada)" : " (sin tildar)"}</span>
            </span>
            {s.hecha ? null : (
              <button type="button" aria-haspopup="dialog" onClick={() => setAbierta(s)} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-0.5 text-xs`}>
                Tildar<span className="sr-only">: {s.nombre}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {abierta ? (
        <DialogoSubtarea
          subtarea={abierta}
          datos={datos}
          version={version}
          onCerrar={() => setAbierta(null)}
          onHecho={(r) => {
            setAbierta(null);
            hecho(r);
          }}
        />
      ) : null}
    </Seccion>
  );
}

function DialogoSubtarea({
  subtarea: s,
  datos,
  version,
  onCerrar,
  onHecho,
}: {
  subtarea: DatosTranscripcion["subtareas"][number];
  datos: DatosTranscripcion;
  version: number;
  onCerrar: () => void;
  onHecho: (r: { version: number; mensaje: string }) => void;
}) {
  const [comandoId] = useState(nuevoComandoId);
  const [dato, setDato] = useState("");
  const [fecha, setFecha] = useState("");
  const [fuente, setFuente] = useState(FUENTE_POR_DEFECTO);
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState<EstadoError | null>(null);
  const [pendiente, iniciar] = useTransition();
  const hoy = hoyEnTucuman(new Date());
  const e = (ruta: string) => error?.errores.filter((x) => x.ruta === ruta).map((x) => x.mensaje);
  return (
    <Dialogo titulo="Tildar subtarea (carga histórica)" descripcion={`${s.nombre} · ${s.paso}`} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          setError(null);
          iniciar(async () => {
            const r = await accionSubtareaHistorica({ numero: datos.numero, versionVista: version, comandoId, clave: s.clave, dato: s.dato ? dato : null, fecha, fuente, observacion });
            if (r.ok) onHecho(r);
            else setError(r);
          });
        }}
      >
        {s.dato ? (
          <Campo ruta="dato" etiqueta={s.dato === "fecha" ? "Fecha (el dato)" : "Dato"} errores={e("dato")}>
            <input {...atributosCampo("dato", e("dato"))} type={s.dato === "fecha" ? "date" : "text"} max={s.dato === "fecha" ? hoy : undefined} maxLength={200} value={dato} onChange={(x) => setDato(x.target.value)} data-autofocus className={CLASE_CONTROL} />
          </Campo>
        ) : null}
        <Campo ruta="fecha" etiqueta="Cuándo se hizo (opcional)" errores={e("fecha")} ayuda={s.dato === "fecha" ? "Si queda vacío, la fecha del dato." : "Si queda vacío, hoy."}>
          <input {...atributosCampo("fecha", e("fecha"), "campo-fecha-ayuda")} type="date" min={datos.fechaInicio} max={hoy} value={fecha} onChange={(x) => setFecha(x.target.value)} data-autofocus={s.dato ? undefined : true} className={`${CLASE_CONTROL} max-w-48`} />
        </Campo>
        <Campo ruta="fuente" etiqueta="Fuente" obligatorio errores={e("fuente")}>
          <input {...atributosCampo("fuente", e("fuente"))} type="text" maxLength={200} value={fuente} onChange={(x) => setFuente(x.target.value)} className={CLASE_CONTROL} />
        </Campo>
        <Campo ruta="observacion" etiqueta="Observación (opcional)" errores={e("observacion")}>
          <input {...atributosCampo("observacion", e("observacion"))} type="text" maxLength={2000} value={observacion} onChange={(x) => setObservacion(x.target.value)} className={CLASE_CONTROL} />
        </Campo>
        {error ? <AvisoError error={error} recargar={`${datos.rutaFicha}/transcribir`} yaMostradas={["dato", "fecha", "fuente", "observacion"]} /> : null}
        <PieDialogo pendiente={pendiente} texto="Tildar" onCancelar={onCerrar} />
      </form>
    </Dialogo>
  );
}

function PieDialogo({ pendiente, texto, onCancelar, peligro = false }: { pendiente: boolean; texto: string; onCancelar: () => void; peligro?: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
      <button type="button" onClick={onCancelar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
        Cancelar
      </button>
      <button type="submit" disabled={pendiente} className={peligro ? `${CLASE_BOTON_PRIMARIO} bg-red-800 hover:bg-red-700` : CLASE_BOTON_PRIMARIO}>
        {pendiente ? "Guardando…" : texto}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Llevar a concluido o archivado
// ---------------------------------------------------------------------------

function EstadoFinal({ datos, version, hecho }: PropsSeccion) {
  const activo = datos.estado === "en_tramite" || datos.estado === "espera_pago_dim";
  const puedeConcluir = activo && datos.paso.esFinal;
  const puedeArchivar = activo || datos.estado === "concluido";
  const [comandoId, setComandoId] = useState(nuevoComandoId);
  const [estado, setEstado] = useState<"concluido" | "archivado">(puedeConcluir ? "concluido" : "archivado");
  const [fecha, setFecha] = useState("");
  const [fuente, setFuente] = useState(FUENTE_POR_DEFECTO);
  const [ubicacion, setUbicacion] = useState("");
  const [desconocida, setDesconocida] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<EstadoError | null>(null);
  const [pendiente, iniciar] = useTransition();
  if (!puedeConcluir && !puedeArchivar) return null;
  const sinConcluir = estado === "archivado" && activo;
  const elegido = estado === "concluido" && !puedeConcluir ? "archivado" : estado;
  const e = (ruta: string) => error?.errores.filter((x) => x.ruta === ruta).map((x) => x.mensaje);

  return (
    <Seccion
      id="titulo-estado"
      titulo="Cómo terminó según la ficha"
      descripcion="Si el papel dice que el trámite terminó o que se archivó, se registra acá. Si no se sabe en qué caja está, marcá “No se sabe”."
    >
      <form
        className="space-y-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          setError(null);
          iniciar(async () => {
            const r = await accionEstadoHistorico({
              numero: datos.numero,
              versionVista: version,
              comandoId,
              estado: elegido,
              fecha,
              precision: "dia",
              fuente,
              ubicacionArchivo: elegido === "archivado" ? valorUbicacion(ubicacion, desconocida) : null,
              motivo: sinConcluir ? motivo : null,
            });
            if (r.ok) {
              setComandoId(nuevoComandoId());
              hecho(r);
            } else setError(r);
          });
        }}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Estado</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {puedeConcluir ? (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="estado-historico" checked={elegido === "concluido"} onChange={() => setEstado("concluido")} className="h-4 w-4 accent-slate-800" />
                Concluido
              </label>
            ) : null}
            {puedeArchivar ? (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="estado-historico" checked={elegido === "archivado"} onChange={() => setEstado("archivado")} className="h-4 w-4 accent-slate-800" />
                Archivado{activo ? " (sin concluir)" : ""}
              </label>
            ) : null}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo ruta="fecha" etiqueta="Fecha (según la ficha)" obligatorio errores={e("fecha")}>
            <input {...atributosCampo("fecha", e("fecha"))} type="date" min={datos.fechaInicio} max={hoyEnTucuman(new Date())} value={fecha} onChange={(x) => setFecha(x.target.value)} className={`${CLASE_CONTROL} max-w-48`} />
          </Campo>
          <Campo ruta="fuente" etiqueta="Fuente" obligatorio errores={e("fuente")}>
            <input {...atributosCampo("fuente", e("fuente"))} type="text" maxLength={200} value={fuente} onChange={(x) => setFuente(x.target.value)} className={CLASE_CONTROL} />
          </Campo>
        </div>
        {elegido === "archivado" ? (
          <div className="space-y-2">
            <Campo ruta="ubicacionArchivo" etiqueta="Ubicación en el archivo (caja o estante)" obligatorio={!desconocida} errores={e("ubicacionArchivo")}>
              <input
                {...atributosCampo("ubicacionArchivo", e("ubicacionArchivo"))}
                type="text"
                maxLength={120}
                value={desconocida ? "" : ubicacion}
                disabled={desconocida}
                onChange={(x) => setUbicacion(x.target.value)}
                className={CLASE_CONTROL}
              />
            </Campo>
            <label className="inline-flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={desconocida} onChange={(x) => setDesconocida(x.target.checked)} className={CLASE_CASILLA} />
              No se sabe en qué caja está (queda como {UBICACION_DESCONOCIDA})
            </label>
          </div>
        ) : null}
        {sinConcluir ? (
          <Campo ruta="motivo" etiqueta="Motivo (archivado sin concluir)" obligatorio errores={e("motivo")} ayuda="10 caracteres o más">
            <textarea {...atributosCampo("motivo", e("motivo"), "campo-motivo-ayuda")} rows={2} maxLength={2000} value={motivo} onChange={(x) => setMotivo(x.target.value)} className={CLASE_CONTROL} />
          </Campo>
        ) : null}
        {error ? <AvisoError error={error} recargar={`${datos.rutaFicha}/transcribir`} yaMostradas={["fecha", "fuente", "ubicacionArchivo", "motivo"]} /> : null}
        <button type="submit" disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
          {pendiente ? "Guardando…" : elegido === "concluido" ? "Registrar como concluido" : "Registrar como archivado"}
        </button>
      </form>
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Foto de la ficha (un adjunto suelto con rótulo)
// ---------------------------------------------------------------------------

/** El rótulo con que se guarda la foto de la ficha (un adjunto suelto; la propuesta no le dio un documento propio). */
const ROTULO_FICHA = "Ficha de papel";

function FotoFicha({ datos, version, hecho }: PropsSeccion) {
  const router = useRouter();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [comandoId, setComandoId] = useState(nuevoComandoId);
  const [error, setError] = useState<EstadoError | null>(null);
  const [etapa, setEtapa] = useState<"elegir" | "preparando" | "subiendo">("elegir");
  const [, iniciar] = useTransition();
  const ocupado = etapa !== "elegir";

  async function subir(elegido: File) {
    const fallar = (mensaje: string) => {
      setError({ ok: false, codigo: "adjunto_invalido", mensaje, errores: [] });
      setEtapa("elegir");
    };
    setError(null);
    setEtapa("preparando");
    const preparado = await prepararArchivo(elegido);
    if (!preparado.ok) return fallar(preparado.mensaje);
    setEtapa("subiendo");
    let respuesta: Response;
    try {
      respuesta = await fetch(rutaSubida(datos.numero, { nombre: `${ROTULO_FICHA} - ${preparado.archivo.nombre}`, documento: null, version, comando: comandoId }), {
        method: "POST",
        body: preparado.archivo.contenido,
        headers: { "Content-Type": preparado.archivo.contenido.type || "application/octet-stream" },
      });
    } catch {
      return fallar("No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.");
    }
    const cuerpo = (await respuesta.json().catch(() => null)) as ({ ok: true; version: number; nombre: string } | EstadoError) | null;
    if (!cuerpo || typeof cuerpo !== "object" || !("ok" in cuerpo)) return fallar(mensajeRespuestaSubida(respuesta.status));
    if (!cuerpo.ok) {
      setError(cuerpo);
      setEtapa("elegir");
      return;
    }
    setEtapa("elegir");
    setArchivo(null);
    setComandoId(nuevoComandoId());
    iniciar(() => router.refresh());
    hecho({ version: cuerpo.version, mensaje: `Se adjuntó ${cuerpo.nombre}.` });
  }

  return (
    <Seccion id="titulo-foto" titulo="Foto de la ficha de papel" descripcion={`Queda como adjunto suelto, con el rótulo "${ROTULO_FICHA}". PDF, JPG o PNG de hasta 10 MB.`}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!archivo) return setError({ ok: false, codigo: "validacion", mensaje: "Elegí un archivo", errores: [] });
          void subir(archivo);
        }}
      >
        <div className="min-w-64 flex-1">
          <label htmlFor="foto-ficha" className="mb-1 block text-sm font-medium text-slate-800">
            Archivo
          </label>
          <input
            id="foto-ficha"
            type="file"
            accept={ACCEPT_ADJUNTO}
            onChange={(ev) => {
              setError(null);
              setArchivo(ev.target.files?.[0] ?? null);
            }}
            className={`${CLASE_CONTROL} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-sm`}
          />
          {archivo ? (
            <p className="mt-1 text-xs text-slate-700">
              {archivo.name} · {formatearBytes(archivo.size)}
            </p>
          ) : null}
        </div>
        <button type="submit" disabled={ocupado} className={CLASE_BOTON_SECUNDARIO}>
          <FileUp className="h-4 w-4" aria-hidden="true" />
          {etapa === "preparando" ? "Preparando…" : etapa === "subiendo" ? "Subiendo…" : "Subir la foto"}
        </button>
      </form>
      {error ? (
        <div className="mt-2">
          <AvisoError error={error} recargar={`${datos.rutaFicha}/transcribir`} />
        </div>
      ) : null}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Terminar la carga histórica
// ---------------------------------------------------------------------------

function Terminar({ datos, version }: { datos: DatosTranscripcion; version: number }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Seccion
      id="titulo-terminar"
      titulo="Terminar carga histórica"
      descripcion="Cuando la ficha está pasada entera. Desde ahí el expediente sigue con las reglas normales: aparece en las bandejas y los pases se dan desde la ficha."
    >
      <button type="button" aria-haspopup="dialog" onClick={() => setAbierto(true)} className={CLASE_BOTON_PRIMARIO}>
        <Flag className="h-4 w-4" aria-hidden="true" />
        Terminar carga histórica
      </button>
      {abierto ? <DialogoTerminar datos={datos} version={version} onCerrar={() => setAbierto(false)} /> : null}
    </Seccion>
  );
}

function DialogoTerminar({ datos, version, onCerrar }: { datos: DatosTranscripcion; version: number; onCerrar: () => void }) {
  const [comandoId] = useState(nuevoComandoId);
  const [confirmado, setConfirmado] = useState(false);
  const [error, setError] = useState<EstadoError | null>(null);
  const [pendiente, iniciar] = useTransition();
  const p = datos.pendientes;
  const errores = error?.errores.filter((x) => x.ruta === "confirmado").map((x) => x.mensaje);
  return (
    <Dialogo titulo="Terminar carga histórica" descripcion={`${datos.numero} · ${datos.paso.orden}. ${datos.paso.nombre}`} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!confirmado) {
            return setError({ ok: false, codigo: "validacion", mensaje: "Falta confirmar", errores: [{ ruta: "confirmado", mensaje: "Marcá la casilla para confirmar" }] });
          }
          setError(null);
          iniciar(async () => {
            // Si sale bien, la acción lleva a la ficha.
            const r = await accionTerminarCarga({ numero: datos.numero, versionVista: version, comandoId });
            if (r && !r.ok) setError(r);
          });
        }}
      >
        {p && (p.subtareas.length > 0 || p.documentos.length > 0) ? (
          <div className="text-sm text-slate-800">
            <p>Lo obligatorio de los pasos ya recorridos que sigue sin marcar pasa a &quot;histórico&quot; (el pase lo acepta):</p>
            <ul className="mt-1 list-disc pl-6">
              {p.subtareas.map((s) => (
                <li key={`s-${s}`}>Subtarea: {s}</li>
              ))}
              {p.documentos.map((d) => (
                <li key={`d-${d}`}>Documento: {d}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-800">No queda nada obligatorio sin marcar en los pasos recorridos.</p>
        )}
        <div>
          <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
            <input {...atributosCampo("confirmado", errores)} type="checkbox" checked={confirmado} onChange={(ev) => setConfirmado(ev.target.checked)} data-autofocus className={`${CLASE_CASILLA} mt-0.5`} />
            La ficha de papel está transcripta entera
          </label>
          <MensajeError ruta="confirmado" errores={errores} />
        </div>
        {error ? <AvisoError error={error} recargar={`${datos.rutaFicha}/transcribir`} yaMostradas={["confirmado"]} /> : null}
        <PieDialogo pendiente={pendiente} texto="Terminar carga histórica" onCancelar={onCerrar} />
      </form>
    </Dialogo>
  );
}
