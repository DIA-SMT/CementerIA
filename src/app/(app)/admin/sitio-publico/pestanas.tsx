"use client";

import { useState } from "react";
import { CalendarPlus, CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import {
  atributosCampo,
  Campo,
  CLASE_BOTON_COMPACTO,
  CLASE_BOTON_COMPACTO_PELIGRO,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CASILLA,
  CLASE_CONTROL,
  MensajeError,
} from "@/components/formulario";
import type { ContactoSitio, FilaCementerioSitio, FilaNovedad, FilaPregunta, FilaRecorrido } from "@/lib/dominio/sitio";
import { LARGOS } from "@/lib/dominio/sitio/validacion";
import { formatearFecha, formatearFechaHora } from "@/lib/fechas";
import { idDeCampo, type EstadoError } from "@/lib/presentacion/errores";
import type { EntradaSitioAdmin } from "@/lib/presentacion/acciones-sitio";
import { AvisoHecho, DialogoConfirmar, erroresDe, useAccion } from "../piezas";
import { accionSitio } from "./acciones";

/**
 * Las pestañas de /admin/sitio-publico (28/10/2026): Cementerios, Recorridos
 * (con sus fechas), Novedades, Contacto y Preguntas frecuentes. Alta y
 * modificación en un diálogo (el contacto, en la pestaña: es uno solo); quitar
 * (fechas y novedades) con confirmación. Cada formulario lleva un motivo
 * opcional, que queda en la auditoría con el cambio.
 *
 * Todo es texto plano: lo que se escribe se ve tal cual en la página pública.
 * Un campo vacío no se muestra. Las reglas (largos, enlaces, fechas) son del
 * dominio, que devuelve cada error en su campo.
 */

const RUTA = "/admin/sitio-publico";

type Foto = { clave: string; etiqueta: string };

/** Envía una acción del sitio y avisa (cierra el diálogo) si salió bien. */
function useGuardar(onHecho: (m: string) => void) {
  const accion = useAccion();
  return { ...accion, guardar: (entrada: EntradaSitioAdmin) => accion.enviar(() => accionSitio(entrada), (r) => onHecho(r.mensaje)) };
}

function Casilla({ ruta, etiqueta, marcado, poner, error, ayuda }: { ruta: string; etiqueta: string; marcado: boolean; poner: (v: boolean) => void; error: EstadoError | null; ayuda?: string }) {
  const errores = erroresDe(error, ruta);
  return (
    <div>
      <label className="inline-flex items-center gap-2 text-sm text-texto">
        <input {...atributosCampo(ruta, errores, ayuda ? `${ruta}-ayuda` : undefined)} type="checkbox" checked={marcado} onChange={(e) => poner(e.target.checked)} className={CLASE_CASILLA} />
        {etiqueta}
      </label>
      {ayuda ? (
        <p id={`${ruta}-ayuda`} className="ml-6 text-xs text-texto-secundario">
          {ayuda}
        </p>
      ) : null}
      <MensajeError ruta={ruta} errores={errores} />
    </div>
  );
}

/** Un campo de texto: una línea (`input`) o varias (`textarea`), con su largo máximo. */
function Texto({
  ruta,
  etiqueta,
  valor,
  poner,
  error,
  max,
  obligatorio = false,
  ayuda,
  filas,
  tipo = "text",
  autofoco = false,
}: {
  ruta: string;
  etiqueta: string;
  valor: string;
  poner: (v: string) => void;
  error: EstadoError | null;
  max: number;
  obligatorio?: boolean;
  ayuda?: string;
  /** Con filas, un `textarea` (admite párrafos). */
  filas?: number;
  tipo?: "text" | "url" | "email" | "tel";
  autofoco?: boolean;
}) {
  const errores = erroresDe(error, ruta);
  const textoAyuda = [ayuda, `Hasta ${max} caracteres.`].filter(Boolean).join(" ");
  const atributos = { ...atributosCampo(ruta, errores, `${idDeCampo(ruta)}-ayuda`), maxLength: max, value: valor, className: CLASE_CONTROL, "data-autofocus": autofoco ? true : undefined };
  return (
    <Campo ruta={ruta} etiqueta={etiqueta} obligatorio={obligatorio} errores={errores} ayuda={textoAyuda}>
      {filas ? (
        <textarea {...atributos} rows={filas} onChange={(e) => poner(e.target.value)} />
      ) : (
        <input {...atributos} type={tipo} onChange={(e) => poner(e.target.value)} />
      )}
    </Campo>
  );
}

function CampoMotivo({ valor, poner }: { valor: string; poner: (v: string) => void }) {
  return (
    <Campo ruta="motivo" etiqueta="Motivo (opcional)" ayuda="Queda en la auditoría junto con el cambio">
      <input {...atributosCampo("motivo", undefined, "campo-motivo-ayuda")} type="text" maxLength={300} value={valor} onChange={(e) => poner(e.target.value)} className={CLASE_CONTROL} />
    </Campo>
  );
}

function SelectorFoto({ valor, poner, fotos, error }: { valor: string; poner: (v: string) => void; fotos: readonly Foto[]; error: EstadoError | null }) {
  const errores = erroresDe(error, "foto");
  return (
    <Campo ruta="foto" etiqueta="Foto" errores={errores} ayuda="Una de las fotos ilustrativas del sistema. Subir fotos propias queda para más adelante.">
      <select {...atributosCampo("foto", errores, "campo-foto-ayuda")} value={valor} onChange={(e) => poner(e.target.value)} className={CLASE_CONTROL}>
        <option value="">Sin foto</option>
        {fotos.map((f) => (
          <option key={f.clave} value={f.clave}>
            {f.etiqueta}
          </option>
        ))}
      </select>
    </Campo>
  );
}

function PieDialogo({ pendiente, onCerrar, texto }: { pendiente: boolean; onCerrar: () => void; texto: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
      <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
        Cancelar
      </button>
      <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
        {pendiente ? "Guardando…" : texto}
      </button>
    </div>
  );
}

function Estado({ activo, si = "Se muestra", no = "No se muestra" }: { activo: boolean; si?: string; no?: string }) {
  return activo ? <span>{si}</span> : <span className="insignia bg-fondo text-texto-secundario ring-1 ring-inset ring-borde">{no}</span>;
}

/** "Cargado" o un guion, para las columnas de la lista. */
function Cargado({ valor }: { valor: string | null }) {
  return valor ? <span className="[overflow-wrap:anywhere]">{valor}</span> : <span className="text-texto-secundario">Sin cargar</span>;
}

// ---------------------------------------------------------------------------
// Cementerios
// ---------------------------------------------------------------------------

export function PestanaCementerios({ filas, fotos }: { filas: readonly FilaCementerioSitio[]; fotos: readonly Foto[] }) {
  const [editando, setEditando] = useState<FilaCementerioSitio | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-secundario">
        Los cementerios son los del catálogo (Administración, Catálogos). Acá va lo que se muestra de cada uno en la página pública. Sin domicilio no hay
        botón &quot;Cómo llegar&quot;; si no hay ningún horario cargado, la página remite a Mesa de Entradas.
      </p>
      <AvisoHecho mensaje={hecho} />
      <div className="tarjeta relative @container overflow-x-auto">
        <table className="tabla-datos tabla-apilable-amplia">
          <caption className="sr-only">Datos públicos de cada cementerio</caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">Cementerio</th>
              <th scope="col" className="font-medium">En la página</th>
              <th scope="col" className="font-medium">Domicilio</th>
              <th scope="col" className="font-medium">Lunes a viernes</th>
              <th scope="col" className="font-medium">Sábados, domingos y feriados</th>
              <th scope="col" className="font-medium"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.cementerioId} className={c.visible && c.activoEnCatalogo ? "" : "text-texto-secundario"}>
                <th scope="row" className="font-normal">{c.nombre}</th>
                <td data-etiqueta="En la página">
                  {c.activoEnCatalogo ? <Estado activo={c.visible} /> : <Estado activo={false} no="Inactivo en el catálogo" />}
                </td>
                <td data-etiqueta="Domicilio"><Cargado valor={c.domicilio} /></td>
                <td data-etiqueta="Lunes a viernes"><Cargado valor={c.horarioSemana} /></td>
                <td data-etiqueta="Sábados, domingos y feriados"><Cargado valor={c.horarioFinDeSemana} /></td>
                <td>
                  <button type="button" aria-haspopup="dialog" onClick={() => setEditando(c)} className={CLASE_BOTON_COMPACTO}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Modificar<span className="sr-only"> {c.nombre}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando ? (
        <DialogoCementerio
          c={editando}
          fotos={fotos}
          onCerrar={() => setEditando(null)}
          onHecho={(m) => {
            setEditando(null);
            setHecho(m);
          }}
        />
      ) : null}
    </div>
  );
}

function DialogoCementerio({ c, fotos, onCerrar, onHecho }: { c: FilaCementerioSitio; fotos: readonly Foto[]; onCerrar: () => void; onHecho: (m: string) => void }) {
  const { pendiente, error, guardar } = useGuardar(onHecho);
  const [visible, setVisible] = useState(c.visible);
  const [domicilio, setDomicilio] = useState(c.domicilio ?? "");
  const [mapaUrl, setMapaUrl] = useState(c.mapaUrl ?? "");
  const [descripcion, setDescripcion] = useState(c.descripcion ?? "");
  const [queTiene, setQueTiene] = useState(c.queTiene ?? "");
  const [horarioSemana, setHorarioSemana] = useState(c.horarioSemana ?? "");
  const [horarioFinDeSemana, setHorarioFinDeSemana] = useState(c.horarioFinDeSemana ?? "");
  const [horarioEspecial, setHorarioEspecial] = useState(c.horarioEspecial ?? "");
  const [foto, setFoto] = useState(c.foto ?? "");
  const [motivo, setMotivo] = useState("");
  return (
    <Dialogo titulo={`${c.nombre} en la página pública`} onCerrar={onCerrar} ocupado={pendiente} ancho="ancho">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar({
            accion: "cementerio",
            datos: { cementerioId: c.cementerioId, visible, domicilio, mapaUrl, descripcion, queTiene, horarioSemana, horarioFinDeSemana, horarioEspecial, foto },
            motivo,
          });
        }}
      >
        <Casilla ruta="visible" etiqueta="Mostrar este cementerio en la página pública" marcado={visible} poner={setVisible} error={error} />
        <div className="grid gap-4 md:grid-cols-2">
          <Texto ruta="domicilio" etiqueta="Domicilio" valor={domicilio} poner={setDomicilio} error={error} max={LARGOS.domicilio} autofoco />
          <Texto
            ruta="mapaUrl"
            etiqueta="Enlace al mapa"
            tipo="url"
            valor={mapaUrl}
            poner={setMapaUrl}
            error={error}
            max={LARGOS.url}
            ayuda="De Google Maps (google.com/maps o maps.app.goo.gl) o de OpenStreetMap. Sin enlace, «Cómo llegar» busca el domicilio."
          />
        </div>
        <Texto ruta="descripcion" etiqueta="Descripción corta" valor={descripcion} poner={setDescripcion} error={error} max={LARGOS.descripcionCementerio} filas={3} />
        <Texto ruta="queTiene" etiqueta="Qué tiene" valor={queTiene} poner={setQueTiene} error={error} max={LARGOS.queTiene} ayuda="Por ejemplo: mausoleos, capillas, nichos y sepulturas." />
        <fieldset className="space-y-3 rounded-tarjeta border border-borde p-4">
          <legend className="px-1 text-sm font-semibold text-texto">Horarios de visita</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Texto ruta="horarioSemana" etiqueta="Lunes a viernes" valor={horarioSemana} poner={setHorarioSemana} error={error} max={LARGOS.horario} ayuda="Por ejemplo: de 7 a 18." />
            <Texto ruta="horarioFinDeSemana" etiqueta="Sábados, domingos y feriados" valor={horarioFinDeSemana} poner={setHorarioFinDeSemana} error={error} max={LARGOS.horario} />
          </div>
          <Texto ruta="horarioEspecial" etiqueta="Fechas especiales" valor={horarioEspecial} poner={setHorarioEspecial} error={error} max={LARGOS.horarioEspecial} ayuda="Por ejemplo: 2 de noviembre, de 7 a 19." />
        </fieldset>
        <SelectorFoto valor={foto} poner={setFoto} fotos={fotos} error={error} />
        <CampoMotivo valor={motivo} poner={setMotivo} />
        {error ? (
          <AvisoError
            error={error}
            recargar={`${RUTA}?pestana=cementerios`}
            yaMostradas={["visible", "domicilio", "mapaUrl", "descripcion", "queTiene", "horarioSemana", "horarioFinDeSemana", "horarioEspecial", "foto"]}
          />
        ) : null}
        <PieDialogo pendiente={pendiente} onCerrar={onCerrar} texto="Guardar" />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Recorridos y sus fechas
// ---------------------------------------------------------------------------

export function PestanaRecorridos({ filas, cementerios, fotos }: { filas: readonly FilaRecorrido[]; cementerios: ReadonlyArray<{ id: number; nombre: string }>; fotos: readonly Foto[] }) {
  const [editando, setEditando] = useState<FilaRecorrido | "nuevo" | null>(null);
  const [fechasDe, setFechasDe] = useState<number | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const recorridoFechas = filas.find((r) => r.id === fechasDe) ?? null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-texto-secundario">
          Las visitas guiadas. El primero (por orden) va destacado; la página muestra hasta 6 próximas fechas de los recorridos que se muestran. Sin
          recorridos, la página invita a escribir para visitas de grupos.
        </p>
        <button type="button" aria-haspopup="dialog" onClick={() => setEditando("nuevo")} className={CLASE_BOTON_PRIMARIO}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo recorrido
        </button>
      </div>
      <AvisoHecho mensaje={hecho} />
      {filas.length === 0 ? (
        <p className="tarjeta px-4 py-3 text-sm text-texto-secundario">Todavía no hay recorridos cargados.</p>
      ) : (
        <div className="tarjeta relative @container overflow-x-auto">
          <table className="tabla-datos tabla-apilable-amplia">
            <caption className="sr-only">Recorridos históricos</caption>
            <thead>
              <tr>
                <th scope="col" className="font-medium">Orden</th>
                <th scope="col" className="font-medium">Recorrido</th>
                <th scope="col" className="font-medium">Cementerio</th>
                <th scope="col" className="font-medium">En la página</th>
                <th scope="col" className="font-medium">Próximas fechas</th>
                <th scope="col" className="font-medium"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => {
                const proximas = r.fechas.filter((f) => !f.pasada);
                return (
                  <tr key={r.id} className={r.activo ? "" : "text-texto-secundario"}>
                    <td data-etiqueta="Orden">{r.orden}</td>
                    <th scope="row" className="font-normal">{r.nombre}</th>
                    <td data-etiqueta="Cementerio">{r.cementerio ?? "—"}</td>
                    <td data-etiqueta="En la página"><Estado activo={r.activo} /></td>
                    <td data-etiqueta="Próximas fechas">{proximas.length === 0 ? "Ninguna" : proximas.length === 1 ? formatearFechaHora(proximas[0].fecha) : `${proximas.length}, desde el ${formatearFechaHora(proximas[0].fecha)}`}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" aria-haspopup="dialog" onClick={() => setEditando(r)} className={CLASE_BOTON_COMPACTO}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          Modificar<span className="sr-only"> {r.nombre}</span>
                        </button>
                        <button type="button" aria-haspopup="dialog" onClick={() => setFechasDe(r.id)} className={CLASE_BOTON_COMPACTO}>
                          <CalendarDays className="h-4 w-4" aria-hidden="true" />
                          Fechas<span className="sr-only"> de {r.nombre}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editando ? (
        <DialogoRecorrido
          r={editando === "nuevo" ? null : editando}
          cementerios={cementerios}
          fotos={fotos}
          onCerrar={() => setEditando(null)}
          onHecho={(m) => {
            setEditando(null);
            setHecho(m);
          }}
        />
      ) : null}
      {recorridoFechas ? <DialogoFechas r={recorridoFechas} onCerrar={() => setFechasDe(null)} onHecho={setHecho} /> : null}
    </div>
  );
}

function DialogoRecorrido({
  r,
  cementerios,
  fotos,
  onCerrar,
  onHecho,
}: {
  r: FilaRecorrido | null;
  cementerios: ReadonlyArray<{ id: number; nombre: string }>;
  fotos: readonly Foto[];
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const { pendiente, error, guardar } = useGuardar(onHecho);
  const [nombre, setNombre] = useState(r?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(r?.descripcion ?? "");
  const [cementerioId, setCementerioId] = useState(r?.cementerioId ? String(r.cementerioId) : "");
  const [diasHora, setDiasHora] = useState(r?.diasHora ?? "");
  const [duracion, setDuracion] = useState(r?.duracion ?? "");
  const [puntoEncuentro, setPuntoEncuentro] = useState(r?.puntoEncuentro ?? "");
  const [cupo, setCupo] = useState(r?.cupo ?? "");
  const [inscripcion, setInscripcion] = useState(r?.inscripcion ?? "");
  const [inscripcionUrl, setInscripcionUrl] = useState(r?.inscripcionUrl ?? "");
  const [foto, setFoto] = useState(r?.foto ?? "");
  const [activo, setActivo] = useState(r?.activo ?? true);
  const [orden, setOrden] = useState(r?.orden ?? 0);
  const [motivo, setMotivo] = useState("");
  const erroresCementerio = erroresDe(error, "cementerioId");
  const erroresOrden = erroresDe(error, "orden");
  return (
    <Dialogo titulo={r ? `Modificar ${r.nombre}` : "Nuevo recorrido"} onCerrar={onCerrar} ocupado={pendiente} ancho="ancho">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar({
            accion: "recorrido",
            datos: {
              id: r?.id ?? null,
              nombre,
              descripcion,
              cementerioId: cementerioId === "" ? null : Number(cementerioId),
              diasHora,
              duracion,
              puntoEncuentro,
              cupo,
              inscripcion,
              inscripcionUrl,
              foto,
              activo,
              orden,
            },
            motivo,
          });
        }}
      >
        <Texto ruta="nombre" etiqueta="Nombre" valor={nombre} poner={setNombre} error={error} max={LARGOS.nombreRecorrido} obligatorio autofoco />
        <Texto ruta="descripcion" etiqueta="Descripción" valor={descripcion} poner={setDescripcion} error={error} max={LARGOS.descripcionRecorrido} filas={3} ayuda="Qué se visita, a quién está dirigido y qué conviene llevar." />
        <div className="grid gap-4 md:grid-cols-2">
          <Campo ruta="cementerioId" etiqueta="Cementerio" errores={erroresCementerio}>
            <select {...atributosCampo("cementerioId", erroresCementerio)} value={cementerioId} onChange={(e) => setCementerioId(e.target.value)} className={CLASE_CONTROL}>
              <option value="">Sin cementerio (o varios)</option>
              {cementerios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Texto ruta="diasHora" etiqueta="Días y hora" valor={diasHora} poner={setDiasHora} error={error} max={LARGOS.diasHora} ayuda="Por ejemplo: sábados a las 10." />
          <Texto ruta="duracion" etiqueta="Duración" valor={duracion} poner={setDuracion} error={error} max={LARGOS.duracion} />
          <Texto ruta="cupo" etiqueta="Cupo" valor={cupo} poner={setCupo} error={error} max={LARGOS.cupo} />
        </div>
        <Texto ruta="puntoEncuentro" etiqueta="Punto de encuentro" valor={puntoEncuentro} poner={setPuntoEncuentro} error={error} max={LARGOS.puntoEncuentro} />
        <Texto ruta="inscripcion" etiqueta="Cómo inscribirse" valor={inscripcion} poner={setInscripcion} error={error} max={LARGOS.inscripcion} filas={2} />
        <Texto ruta="inscripcionUrl" etiqueta="Enlace de inscripción (opcional)" tipo="url" valor={inscripcionUrl} poner={setInscripcionUrl} error={error} max={LARGOS.url} ayuda="Un enlace que empiece con https:// (un formulario, por ejemplo)." />
        <div className="grid gap-4 md:grid-cols-2">
          <SelectorFoto valor={foto} poner={setFoto} fotos={fotos} error={error} />
          <Campo ruta="orden" etiqueta="Orden" errores={erroresOrden} ayuda="El de número más bajo va destacado.">
            <input
              {...atributosCampo("orden", erroresOrden, "campo-orden-ayuda")}
              type="number"
              min={0}
              max={999}
              value={orden}
              onChange={(e) => setOrden(Math.trunc(Number(e.target.value) || 0))}
              className={`${CLASE_CONTROL} max-w-28`}
            />
          </Campo>
        </div>
        <Casilla ruta="activo" etiqueta="Mostrar en la página pública" marcado={activo} poner={setActivo} error={error} ayuda="Desmarcado, el recorrido y sus fechas dejan de verse (no se borra nada)." />
        <CampoMotivo valor={motivo} poner={setMotivo} />
        {error ? (
          <AvisoError
            error={error}
            recargar={`${RUTA}?pestana=recorridos`}
            yaMostradas={["nombre", "descripcion", "cementerioId", "diasHora", "duracion", "puntoEncuentro", "cupo", "inscripcion", "inscripcionUrl", "foto", "activo", "orden"]}
          />
        ) : null}
        <PieDialogo pendiente={pendiente} onCerrar={onCerrar} texto={r ? "Guardar" : "Dar de alta"} />
      </form>
    </Dialogo>
  );
}

/** Las fechas de un recorrido: las que vienen (y las de los últimos 30 días), agregar y quitar. */
function DialogoFechas({ r, onCerrar, onHecho }: { r: FilaRecorrido; onCerrar: () => void; onHecho: (m: string) => void }) {
  const { pendiente, error, enviar, setError } = useAccion();
  const [fecha, setFecha] = useState("");
  const [nota, setNota] = useState("");
  const [quitando, setQuitando] = useState<{ id: number; texto: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const erroresFecha = erroresDe(error, "fecha");
  const erroresNota = erroresDe(error, "nota");

  if (quitando) {
    return (
      <DialogoConfirmar
        titulo="Quitar la fecha"
        textoBoton="Quitar"
        motivo="opcional"
        peligro
        pendiente={pendiente}
        error={error}
        recargar={`${RUTA}?pestana=recorridos`}
        onCerrar={() => {
          setError(null);
          setQuitando(null);
        }}
        onConfirmar={(motivo) =>
          enviar(
            () => accionSitio({ accion: "quitar_fecha", id: quitando.id, motivo }),
            (res) => {
              setQuitando(null);
              setAviso(res.mensaje);
              onHecho(res.mensaje);
            },
          )
        }
      >
        <p>
          ¿Quitar el {quitando.texto} de «{r.nombre}»? Deja de verse en la página. Queda registrado en la auditoría.
        </p>
      </DialogoConfirmar>
    );
  }

  return (
    <Dialogo titulo={`Fechas de ${r.nombre}`} onCerrar={onCerrar} ocupado={pendiente} ancho="ancho">
      <div className="space-y-4">
        <div role="status" aria-live="polite" className="text-sm text-exito">
          {aviso}
        </div>
        {r.fechas.length === 0 ? (
          <p className="text-sm text-texto-secundario">Todavía no tiene fechas.</p>
        ) : (
          <ul className="divide-y divide-borde rounded-tarjeta border border-borde" aria-label={`Fechas de ${r.nombre}`}>
            {r.fechas.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className={f.pasada ? "text-texto-secundario" : "text-texto"}>
                  <span className="font-medium">{formatearFechaHora(f.fecha)}</span>
                  {f.nota ? ` · ${f.nota}` : ""}
                  {f.pasada ? " (ya pasó)" : ""}
                </span>
                <button type="button" onClick={() => setQuitando({ id: f.id, texto: formatearFechaHora(f.fecha) })} className={CLASE_BOTON_COMPACTO_PELIGRO}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Quitar<span className="sr-only"> la fecha {formatearFechaHora(f.fecha)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="space-y-3 rounded-tarjeta border border-borde bg-fondo p-4"
          aria-labelledby="titulo-fecha-nueva"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(
              () => accionSitio({ accion: "fecha", datos: { recorridoId: r.id, fecha, nota }, motivo: null }),
              (res) => {
                setFecha("");
                setNota("");
                setAviso(res.mensaje);
                onHecho(res.mensaje);
              },
            );
          }}
        >
          <h3 id="titulo-fecha-nueva" className="text-sm font-semibold text-texto">
            Agregar una fecha
          </h3>
          <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_1fr]">
            <Campo ruta="fecha" etiqueta="Fecha y hora" obligatorio errores={erroresFecha} ayuda="Hora de Tucumán.">
              <input {...atributosCampo("fecha", erroresFecha, "campo-fecha-ayuda")} type="datetime-local" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={CLASE_CONTROL} data-autofocus />
            </Campo>
            <Campo ruta="nota" etiqueta="Nota (opcional)" errores={erroresNota} ayuda={`Por ejemplo: con reserva previa. Hasta ${LARGOS.notaFecha} caracteres.`}>
              <input {...atributosCampo("nota", erroresNota, "campo-nota-ayuda")} type="text" maxLength={LARGOS.notaFecha} value={nota} onChange={(e) => setNota(e.target.value)} className={CLASE_CONTROL} />
            </Campo>
          </div>
          {error ? <AvisoError error={error} recargar={`${RUTA}?pestana=recorridos`} yaMostradas={["fecha", "nota"]} /> : null}
          <div className="flex justify-end">
            <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              {pendiente ? "Agregando…" : "Agregar fecha"}
            </button>
          </div>
        </form>
        <div className="flex justify-end border-t border-borde pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cerrar
          </button>
        </div>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Novedades
// ---------------------------------------------------------------------------

const ESTADO_NOVEDAD: Record<FilaNovedad["estado"], string> = {
  vigente: "Se ve hoy",
  programada: "Programada",
  terminada: "Terminó",
  inactiva: "Desactivada",
};

export function PestanaNovedades({ filas }: { filas: readonly FilaNovedad[] }) {
  const [editando, setEditando] = useState<FilaNovedad | "nueva" | null>(null);
  const [quitando, setQuitando] = useState<FilaNovedad | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const quitar = useAccion();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-texto-secundario">
          La franja amarilla debajo de los accesos: horarios especiales, cortes por mantenimiento, fechas nuevas. Se ve desde el primer día hasta el
          último (inclusive), si está activa. Sin novedades vigentes, la franja no aparece.
        </p>
        <button type="button" aria-haspopup="dialog" onClick={() => setEditando("nueva")} className={CLASE_BOTON_PRIMARIO}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva novedad
        </button>
      </div>
      <AvisoHecho mensaje={hecho} />
      {filas.length === 0 ? (
        <p className="tarjeta px-4 py-3 text-sm text-texto-secundario">No hay novedades cargadas.</p>
      ) : (
        <div className="tarjeta relative @container overflow-x-auto">
          <table className="tabla-datos tabla-apilable-amplia">
            <caption className="sr-only">Novedades de la página pública</caption>
            <thead>
              <tr>
                <th scope="col" className="font-medium">Título</th>
                <th scope="col" className="font-medium">Desde</th>
                <th scope="col" className="font-medium">Hasta</th>
                <th scope="col" className="font-medium">Estado</th>
                <th scope="col" className="font-medium"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((n) => (
                <tr key={n.id} className={n.vigente ? "" : "text-texto-secundario"}>
                  <th scope="row" className="font-normal">{n.titulo}</th>
                  <td data-etiqueta="Desde">{formatearFecha(n.desde)}</td>
                  <td data-etiqueta="Hasta">{formatearFecha(n.hasta)}</td>
                  <td data-etiqueta="Estado">{ESTADO_NOVEDAD[n.estado]}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" aria-haspopup="dialog" onClick={() => setEditando(n)} className={CLASE_BOTON_COMPACTO}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Modificar<span className="sr-only"> {n.titulo}</span>
                      </button>
                      <button type="button" aria-haspopup="dialog" onClick={() => setQuitando(n)} className={CLASE_BOTON_COMPACTO_PELIGRO}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Quitar<span className="sr-only"> {n.titulo}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando ? (
        <DialogoNovedad
          n={editando === "nueva" ? null : editando}
          onCerrar={() => setEditando(null)}
          onHecho={(m) => {
            setEditando(null);
            setHecho(m);
          }}
        />
      ) : null}
      {quitando ? (
        <DialogoConfirmar
          titulo="Quitar la novedad"
          textoBoton="Quitar"
          motivo="opcional"
          peligro
          pendiente={quitar.pendiente}
          error={quitar.error}
          recargar={`${RUTA}?pestana=novedades`}
          onCerrar={() => {
            quitar.setError(null);
            setQuitando(null);
          }}
          onConfirmar={(motivo) =>
            quitar.enviar(
              () => accionSitio({ accion: "quitar_novedad", id: quitando.id, motivo }),
              (r) => {
                setQuitando(null);
                setHecho(r.mensaje);
              },
            )
          }
        >
          <p>¿Quitar «{quitando.titulo}»? Deja de verse en la página y se borra (queda en la auditoría). Para guardarla, desactivala en vez de quitarla.</p>
        </DialogoConfirmar>
      ) : null}
    </div>
  );
}

function DialogoNovedad({ n, onCerrar, onHecho }: { n: FilaNovedad | null; onCerrar: () => void; onHecho: (m: string) => void }) {
  const { pendiente, error, guardar } = useGuardar(onHecho);
  const [titulo, setTitulo] = useState(n?.titulo ?? "");
  const [texto, setTexto] = useState(n?.texto ?? "");
  const [desde, setDesde] = useState(n?.desde ?? "");
  const [hasta, setHasta] = useState(n?.hasta ?? "");
  const [activa, setActiva] = useState(n?.activa ?? true);
  const [motivo, setMotivo] = useState("");
  const erroresDesde = erroresDe(error, "desde");
  const erroresHasta = erroresDe(error, "hasta");
  return (
    <Dialogo titulo={n ? `Modificar ${n.titulo}` : "Nueva novedad"} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar({ accion: "novedad", datos: { id: n?.id ?? null, titulo, texto, desde, hasta, activa }, motivo });
        }}
      >
        <Texto ruta="titulo" etiqueta="Título" valor={titulo} poner={setTitulo} error={error} max={LARGOS.tituloNovedad} obligatorio autofoco />
        <Texto ruta="texto" etiqueta="Texto" valor={texto} poner={setTexto} error={error} max={LARGOS.textoNovedad} obligatorio filas={3} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo ruta="desde" etiqueta="Desde" obligatorio errores={erroresDesde}>
            <input {...atributosCampo("desde", erroresDesde)} type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className={CLASE_CONTROL} />
          </Campo>
          <Campo ruta="hasta" etiqueta="Hasta (inclusive)" obligatorio errores={erroresHasta}>
            <input {...atributosCampo("hasta", erroresHasta)} type="date" required value={hasta} onChange={(e) => setHasta(e.target.value)} className={CLASE_CONTROL} />
          </Campo>
        </div>
        <Casilla ruta="activa" etiqueta="Activa" marcado={activa} poner={setActiva} error={error} ayuda="Desactivada, no se ve aunque esté dentro de las fechas." />
        <CampoMotivo valor={motivo} poner={setMotivo} />
        {error ? <AvisoError error={error} recargar={`${RUTA}?pestana=novedades`} yaMostradas={["titulo", "texto", "desde", "hasta", "activa"]} /> : null}
        <PieDialogo pendiente={pendiente} onCerrar={onCerrar} texto={n ? "Guardar" : "Publicar"} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Contacto
// ---------------------------------------------------------------------------

export function PestanaContacto({ contacto }: { contacto: ContactoSitio }) {
  const [hecho, setHecho] = useState<string | null>(null);
  const { pendiente, error, guardar } = useGuardar(setHecho);
  const [domicilio, setDomicilio] = useState(contacto.domicilio ?? "");
  const [horario, setHorario] = useState(contacto.horario ?? "");
  const [telefono, setTelefono] = useState(contacto.telefono ?? "");
  const [correo, setCorreo] = useState(contacto.correo ?? "");
  const [mapaUrl, setMapaUrl] = useState(contacto.mapaUrl ?? "");
  const [motivo, setMotivo] = useState("");
  return (
    <form
      className="tarjeta max-w-3xl space-y-4 p-5"
      aria-labelledby="titulo-contacto-sitio"
      onSubmit={(e) => {
        e.preventDefault();
        setHecho(null);
        guardar({ accion: "contacto", datos: { domicilio, horario, telefono, correo, mapaUrl }, motivo });
      }}
    >
      <div>
        <h2 id="titulo-contacto-sitio" className="titulo-seccion">
          Mesa de Entradas de la Dirección de Cementerios
        </h2>
        <p className="mt-1 text-sm text-texto-secundario">
          Se muestra en Contacto y, si faltan horarios o recorridos, en esas secciones. Solo datos institucionales: nada personal. Lo que queda vacío no
          aparece.
        </p>
      </div>
      <AvisoHecho mensaje={hecho} />
      <div className="grid gap-4 md:grid-cols-2">
        <Texto ruta="domicilio" etiqueta="Domicilio" valor={domicilio} poner={setDomicilio} error={error} max={LARGOS.domicilio} />
        <Texto ruta="horario" etiqueta="Horario de atención" valor={horario} poner={setHorario} error={error} max={LARGOS.horarioContacto} ayuda="Por ejemplo: lunes a viernes de 7 a 13." />
        <Texto ruta="telefono" etiqueta="Teléfono" tipo="tel" valor={telefono} poner={setTelefono} error={error} max={LARGOS.telefono} />
        <Texto ruta="correo" etiqueta="Correo" tipo="email" valor={correo} poner={setCorreo} error={error} max={LARGOS.correo} ayuda="Uno institucional." />
      </div>
      <Texto
        ruta="mapaUrl"
        etiqueta="Enlace al mapa"
        tipo="url"
        valor={mapaUrl}
        poner={setMapaUrl}
        error={error}
        max={LARGOS.url}
        ayuda="De Google Maps (google.com/maps o maps.app.goo.gl) o de OpenStreetMap. Sin enlace, «Cómo llegar» busca el domicilio."
      />
      <CampoMotivo valor={motivo} poner={setMotivo} />
      {error ? <AvisoError error={error} recargar={`${RUTA}?pestana=contacto`} yaMostradas={["domicilio", "horario", "telefono", "correo", "mapaUrl"]} /> : null}
      <div className="flex justify-end border-t border-borde pt-3">
        <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
          {pendiente ? "Guardando…" : "Guardar contacto"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Preguntas frecuentes
// ---------------------------------------------------------------------------

export function PestanaPreguntas({ filas }: { filas: readonly FilaPregunta[] }) {
  const [editando, setEditando] = useState<FilaPregunta | "nueva" | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-texto-secundario">
          El acordeón de Contacto, por orden. Sin preguntas activas, no aparece. Para sacar una, desactivala.
        </p>
        <button type="button" aria-haspopup="dialog" onClick={() => setEditando("nueva")} className={CLASE_BOTON_PRIMARIO}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva pregunta
        </button>
      </div>
      <AvisoHecho mensaje={hecho} />
      {filas.length === 0 ? (
        <p className="tarjeta px-4 py-3 text-sm text-texto-secundario">No hay preguntas cargadas.</p>
      ) : (
        <div className="tarjeta relative @container overflow-x-auto">
          <table className="tabla-datos tabla-apilable-amplia">
            <caption className="sr-only">Preguntas frecuentes</caption>
            <thead>
              <tr>
                <th scope="col" className="font-medium">Orden</th>
                <th scope="col" className="font-medium">Pregunta</th>
                <th scope="col" className="font-medium">En la página</th>
                <th scope="col" className="font-medium"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => (
                <tr key={p.id} className={p.activa ? "" : "text-texto-secundario"}>
                  <td data-etiqueta="Orden">{p.orden}</td>
                  <th scope="row" className="font-normal">{p.pregunta}</th>
                  <td data-etiqueta="En la página"><Estado activo={p.activa} /></td>
                  <td>
                    <button type="button" aria-haspopup="dialog" onClick={() => setEditando(p)} className={CLASE_BOTON_COMPACTO}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Modificar<span className="sr-only"> {p.pregunta}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando ? (
        <DialogoPregunta
          p={editando === "nueva" ? null : editando}
          onCerrar={() => setEditando(null)}
          onHecho={(m) => {
            setEditando(null);
            setHecho(m);
          }}
        />
      ) : null}
    </div>
  );
}

function DialogoPregunta({ p, onCerrar, onHecho }: { p: FilaPregunta | null; onCerrar: () => void; onHecho: (m: string) => void }) {
  const { pendiente, error, guardar } = useGuardar(onHecho);
  const [pregunta, setPregunta] = useState(p?.pregunta ?? "");
  const [respuesta, setRespuesta] = useState(p?.respuesta ?? "");
  const [orden, setOrden] = useState(p?.orden ?? 0);
  const [activa, setActiva] = useState(p?.activa ?? true);
  const [motivo, setMotivo] = useState("");
  const erroresOrden = erroresDe(error, "orden");
  return (
    <Dialogo titulo={p ? "Modificar la pregunta" : "Nueva pregunta"} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar({ accion: "pregunta", datos: { id: p?.id ?? null, pregunta, respuesta, orden, activa }, motivo });
        }}
      >
        <Texto ruta="pregunta" etiqueta="Pregunta" valor={pregunta} poner={setPregunta} error={error} max={LARGOS.pregunta} obligatorio autofoco />
        <Texto ruta="respuesta" etiqueta="Respuesta" valor={respuesta} poner={setRespuesta} error={error} max={LARGOS.respuesta} obligatorio filas={4} />
        <Campo ruta="orden" etiqueta="Orden" errores={erroresOrden} ayuda="De menor a mayor.">
          <input
            {...atributosCampo("orden", erroresOrden, "campo-orden-ayuda")}
            type="number"
            min={0}
            max={999}
            value={orden}
            onChange={(e) => setOrden(Math.trunc(Number(e.target.value) || 0))}
            className={`${CLASE_CONTROL} max-w-28`}
          />
        </Campo>
        <Casilla ruta="activa" etiqueta="Mostrar en la página pública" marcado={activa} poner={setActiva} error={error} />
        <CampoMotivo valor={motivo} poner={setMotivo} />
        {error ? <AvisoError error={error} recargar={`${RUTA}?pestana=preguntas`} yaMostradas={["pregunta", "respuesta", "orden", "activa"]} /> : null}
        <PieDialogo pendiente={pendiente} onCerrar={onCerrar} texto={p ? "Guardar" : "Agregar"} />
      </form>
    </Dialogo>
  );
}
