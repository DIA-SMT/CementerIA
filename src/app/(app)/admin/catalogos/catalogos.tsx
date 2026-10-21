"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_COMPACTO, CLASE_BOTON_COMPACTO_PELIGRO, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL, MensajeError } from "@/components/formulario";
import type { FilaArea, FilaCementerio } from "@/lib/dominio/admin";
import type { CampoUbicacion } from "@/lib/dominio/expedientes/ubicacion";
import type { EstadoError } from "@/lib/presentacion/errores";
import { mover, normalizarClave } from "@/lib/presentacion/editor-plantilla";
import type { CatalogoAdmin } from "@/lib/presentacion/acciones-admin";
import { accionCatalogo } from "../acciones";
import { AvisoHecho, erroresDe, useAccion } from "../piezas";

/**
 * Las pestañas Áreas, Cementerios, Tipos de monumento y Tipos de trámite de
 * `/admin/catalogos`. Alta y modificación en un diálogo; la baja es
 * desactivar. El código se elige en el alta y después no cambia.
 */

const RUTA = "/admin/catalogos";

function Casilla({ ruta, etiqueta, marcado, poner, error, ayuda, deshabilitada = false }: { ruta: string; etiqueta: string; marcado: boolean; poner: (v: boolean) => void; error: EstadoError | null; ayuda?: string; deshabilitada?: boolean }) {
  const errores = erroresDe(error, ruta);
  return (
    <div>
      <label className="inline-flex items-center gap-2 text-sm text-texto">
        <input {...atributosCampo(ruta, errores, ayuda ? `${ruta}-ayuda` : undefined)} type="checkbox" checked={marcado} disabled={deshabilitada} onChange={(e) => poner(e.target.checked)} className={CLASE_CASILLA} />
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

function CampoMotivo({ valor, poner }: { valor: string; poner: (v: string) => void }) {
  return (
    <Campo ruta="motivo" etiqueta="Motivo (opcional)" ayuda="Queda en la auditoría">
      <input {...atributosCampo("motivo", undefined, "campo-motivo-ayuda")} type="text" maxLength={300} value={valor} onChange={(e) => poner(e.target.value)} className={CLASE_CONTROL} />
    </Campo>
  );
}

function CampoCodigo({ valor, poner, error, fijo, ayuda }: { valor: string; poner: (v: string) => void; error: EstadoError | null; fijo: boolean; ayuda: string }) {
  return (
    <Campo ruta="codigo" etiqueta="Código" obligatorio errores={erroresDe(error, "codigo")} ayuda={fijo ? "No se cambia: las plantillas y los expedientes lo nombran" : ayuda}>
      <input
        {...atributosCampo("codigo", erroresDe(error, "codigo"), "campo-codigo-ayuda")}
        type="text"
        maxLength={40}
        readOnly={fijo}
        value={valor}
        onChange={(e) => poner(e.target.value)}
        onBlur={() => poner(normalizarClave(valor, false))}
        className={`${CLASE_CONTROL} font-mono read-only:bg-fondo`}
        data-autofocus={fijo ? undefined : true}
      />
    </Campo>
  );
}

/** Guarda un catálogo y cierra el diálogo con el aviso. */
function useGuardar(catalogo: CatalogoAdmin, onHecho: (m: string) => void) {
  const accion = useAccion();
  return {
    ...accion,
    guardar: (datos: Record<string, unknown>, motivo: string) => accion.enviar(() => accionCatalogo({ catalogo, datos, motivo }), (r) => onHecho(r.mensaje)),
  };
}

function Etiqueta({ activo }: { activo: boolean }) {
  return activo ? <span>Activo</span> : <span className="insignia bg-fondo text-texto-secundario ring-1 ring-inset ring-borde">Inactivo</span>;
}

// ---------------------------------------------------------------------------
// Áreas
// ---------------------------------------------------------------------------

export function PestanaAreas({ areas }: { areas: readonly FilaArea[] }) {
  const [editando, setEditando] = useState<FilaArea | "nueva" | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-texto-secundario">
          Internas: tienen usuarios y reciben pases (Dirección no los recibe). Externas: la DIM y los cementerios, sin usuarios; los opera la custodia del paso.
        </p>
        <button type="button" aria-haspopup="dialog" onClick={() => setEditando("nueva")} className={CLASE_BOTON_PRIMARIO}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva área
        </button>
      </div>
      <AvisoHecho mensaje={hecho} />
      <div className="tarjeta relative overflow-x-auto">
        <table className="tabla-datos">
          <caption className="sr-only">Áreas</caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">Código</th>
              <th scope="col" className="font-medium">Nombre</th>
              <th scope="col" className="font-medium">Tipo</th>
              <th scope="col" className="font-medium">Recibe pases</th>
              <th scope="col" className="font-medium">Estado</th>
              <th scope="col" className="font-medium">Uso</th>
              <th scope="col" className="font-medium"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => (
              <tr key={a.id} className={a.activa ? "" : "text-texto-secundario"}>
                <td className="font-mono text-xs">{a.codigo}</td>
                <th scope="row" className="font-normal">{a.nombre}</th>
                <td>{a.tipo === "interna" ? "Interna" : "Externa"}</td>
                <td>{a.recibePases ? "Sí" : "No"}</td>
                <td><Etiqueta activo={a.activa} /></td>
                <td className="text-xs text-texto-secundario">
                  {[a.usuariosActivos > 0 ? `${a.usuariosActivos} usuarios activos` : null, a.cementerio ? `Área del cementerio ${a.cementerio}` : null, a.plantillas.length > 0 ? `En ${a.plantillas.join(", ")}` : null].filter(Boolean).join(" · ") || "—"}
                </td>
                <td>
                  <button type="button" aria-haspopup="dialog" onClick={() => setEditando(a)} className={CLASE_BOTON_COMPACTO}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Modificar<span className="sr-only"> {a.nombre}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando ? (
        <DialogoArea
          area={editando === "nueva" ? null : editando}
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

function DialogoArea({ area, onCerrar, onHecho }: { area: FilaArea | null; onCerrar: () => void; onHecho: (m: string) => void }) {
  const { pendiente, error, guardar } = useGuardar("area", onHecho);
  const [codigo, setCodigo] = useState(area?.codigo ?? "");
  const [nombre, setNombre] = useState(area?.nombre ?? "");
  const [tipo, setTipo] = useState<"interna" | "externa">(area?.tipo ?? "interna");
  const [recibePases, setRecibePases] = useState(area?.recibePases ?? true);
  const [activa, setActiva] = useState(area?.activa ?? true);
  const [orden, setOrden] = useState(area?.orden ?? 0);
  const [motivo, setMotivo] = useState("");
  return (
    <Dialogo titulo={area ? `Modificar ${area.nombre}` : "Nueva área"} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar({ id: area?.id ?? null, codigo, nombre, tipo, recibePases: tipo === "externa" ? true : recibePases, activa, orden }, motivo);
        }}
      >
        <CampoCodigo valor={codigo} poner={setCodigo} error={error} fijo={area !== null} ayuda="Mayúsculas, números y _ (ej. CEM_SUR)" />
        <Campo ruta="nombre" etiqueta="Nombre" obligatorio errores={erroresDe(error, "nombre")}>
          <input {...atributosCampo("nombre", erroresDe(error, "nombre"))} type="text" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} className={CLASE_CONTROL} data-autofocus={area ? true : undefined} />
        </Campo>
        <Campo ruta="tipo" etiqueta="Tipo" errores={erroresDe(error, "tipo")}>
          <select {...atributosCampo("tipo", erroresDe(error, "tipo"))} value={tipo} onChange={(e) => setTipo(e.target.value === "externa" ? "externa" : "interna")} className={CLASE_CONTROL}>
            <option value="interna">Interna (con usuarios)</option>
            <option value="externa">Externa (la DIM, un cementerio: sin usuarios)</option>
          </select>
        </Campo>
        <Casilla ruta="recibePases" etiqueta="Recibe pases" marcado={tipo === "externa" ? true : recibePases} deshabilitada={tipo === "externa"} poner={setRecibePases} error={error} ayuda={tipo === "externa" ? "Un área externa siempre recibe pases" : "Dirección, por ejemplo, no recibe"} />
        <Casilla ruta="activa" etiqueta="Activa" marcado={activa} poner={setActiva} error={error} />
        <Campo ruta="orden" etiqueta="Orden en las listas" errores={erroresDe(error, "orden")}>
          <input {...atributosCampo("orden", erroresDe(error, "orden"))} type="number" min={0} max={999} value={orden} onChange={(e) => setOrden(Math.trunc(Number(e.target.value) || 0))} className={`${CLASE_CONTROL} max-w-28`} />
        </Campo>
        <CampoMotivo valor={motivo} poner={setMotivo} />
        {error ? <AvisoError error={error} recargar={`${RUTA}?pestana=areas`} yaMostradas={["codigo", "nombre", "tipo", "recibePases", "activa", "orden"]} /> : null}
        <PieDialogo pendiente={pendiente} onCerrar={onCerrar} texto={area ? "Guardar" : "Dar de alta"} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Cementerios
// ---------------------------------------------------------------------------

type AreaExterna = { id: number; nombre: string; activa: boolean; cementerio: string | null };
type Monumento = { codigo: string; nombre: string; activo: boolean };

export function PestanaCementerios({ cementerios, areasExternas, tiposMonumento }: { cementerios: readonly FilaCementerio[]; areasExternas: readonly AreaExterna[]; tiposMonumento: readonly Monumento[] }) {
  const [editando, setEditando] = useState<FilaCementerio | "nuevo" | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const nombreMonumento = (c: string) => tiposMonumento.find((t) => t.codigo === c)?.nombre ?? c;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-texto-secundario">
          La nomenclatura (campos de ubicación) y los monumentos de cada cementerio. Una clave que ya tiene valores en expedientes no se borra ni se renombra: se desactiva.
        </p>
        <button type="button" aria-haspopup="dialog" onClick={() => setEditando("nuevo")} className={CLASE_BOTON_PRIMARIO}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo cementerio
        </button>
      </div>
      <AvisoHecho mensaje={hecho} />
      <ul className="space-y-3">
        {cementerios.map((c) => (
          <li key={c.id} className="tarjeta px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-medium text-texto">
                  {c.nombre} <span className="font-mono text-xs font-normal text-texto-secundario">{c.codigo}</span> {c.activo ? null : <Etiqueta activo={false} />}
                </h2>
                <p className="text-sm text-texto-secundario">
                  Área: {c.area.nombre} · {c.expedientes} expedientes{c.plantillas.length > 0 ? ` · Lo nombran los filtros de ${c.plantillas.join(", ")}` : ""}
                </p>
              </div>
              <button type="button" aria-haspopup="dialog" onClick={() => setEditando(c)} className={CLASE_BOTON_COMPACTO}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Modificar<span className="sr-only"> {c.nombre}</span>
              </button>
            </div>
            <p className="mt-1 text-sm text-texto">Monumentos: {c.tiposMonumento.length > 0 ? c.tiposMonumento.map(nombreMonumento).join(", ") : <span className="text-error">ninguno (no se pueden dar altas)</span>}</p>
            <p className="text-sm text-texto">
              Ubicación:{" "}
              {c.camposUbicacion.length > 0
                ? c.camposUbicacion.map((u) => `${u.etiqueta}${u.obligatorio ? "*" : ""}${u.activo ? "" : " (inactivo)"}`).join(" · ")
                : "sin campos"}
            </p>
          </li>
        ))}
      </ul>
      {editando ? (
        <DialogoCementerio
          cementerio={editando === "nuevo" ? null : editando}
          areasExternas={areasExternas}
          tiposMonumento={tiposMonumento}
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

type CampoEditable = { clave: string; etiqueta: string; tipo: "texto" | "entero"; obligatorio: boolean; patron: string; activo: boolean; ayuda: string; nuevo: boolean };

function editable(c: CampoUbicacion): CampoEditable {
  return { clave: c.clave, etiqueta: c.etiqueta, tipo: c.tipo, obligatorio: c.obligatorio, patron: c.patron ?? "", activo: c.activo, ayuda: c.ayuda ?? "", nuevo: false };
}

function DialogoCementerio({
  cementerio,
  areasExternas,
  tiposMonumento,
  onCerrar,
  onHecho,
}: {
  cementerio: FilaCementerio | null;
  areasExternas: readonly AreaExterna[];
  tiposMonumento: readonly Monumento[];
  onCerrar: () => void;
  onHecho: (m: string) => void;
}) {
  const { pendiente, error, guardar } = useGuardar("cementerio", onHecho);
  const [codigo, setCodigo] = useState(cementerio?.codigo ?? "");
  const [nombre, setNombre] = useState(cementerio?.nombre ?? "");
  const disponibles = areasExternas.filter((a) => a.cementerio === null || a.cementerio === cementerio?.codigo);
  const [areaId, setAreaId] = useState<number | "">(cementerio?.area.id ?? disponibles[0]?.id ?? "");
  const [activo, setActivo] = useState(cementerio?.activo ?? true);
  const [tipos, setTipos] = useState<string[]>(cementerio?.tiposMonumento ?? []);
  const [campos, setCampos] = useState<CampoEditable[]>(cementerio?.camposUbicacion.map(editable) ?? []);
  const [motivo, setMotivo] = useState("");
  const usadas = cementerio?.clavesUsadas ?? {};
  const ponerCampo = (i: number, cambios: Partial<CampoEditable>) => setCampos((cs) => cs.map((c, j) => (j === i ? { ...c, ...cambios } : c)));
  const erroresCampos = erroresDe(error, "camposUbicacion");

  return (
    <Dialogo titulo={cementerio ? `Modificar ${cementerio.nombre}` : "Nuevo cementerio"} onCerrar={onCerrar} ocupado={pendiente} ancho="ancho">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar(
            {
              id: cementerio?.id ?? null,
              codigo,
              nombre,
              areaId: areaId === "" ? 0 : areaId,
              activo,
              tiposMonumento: tipos,
              camposUbicacion: campos.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta, tipo: c.tipo, obligatorio: c.obligatorio, patron: c.patron, activo: c.activo, ayuda: c.ayuda })),
            },
            motivo,
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoCodigo valor={codigo} poner={setCodigo} error={error} fijo={cementerio !== null} ayuda="Mayúsculas, números y _ (ej. CEM_SUR)" />
          <Campo ruta="nombre" etiqueta="Nombre" obligatorio errores={erroresDe(error, "nombre")}>
            <input {...atributosCampo("nombre", erroresDe(error, "nombre"))} type="text" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} className={CLASE_CONTROL} data-autofocus={cementerio ? true : undefined} />
          </Campo>
          <Campo ruta="areaId" etiqueta="Área externa (a donde va el papel)" obligatorio errores={erroresDe(error, "areaId")} ayuda="Si no está, se crea en Áreas como externa">
            <select {...atributosCampo("areaId", erroresDe(error, "areaId"), "campo-areaId-ayuda")} value={areaId} onChange={(e) => setAreaId(e.target.value === "" ? "" : Number(e.target.value))} className={CLASE_CONTROL}>
              {disponibles.length === 0 ? <option value="">No hay áreas externas libres</option> : null}
              {disponibles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                  {a.activa ? "" : " (inactiva)"}
                </option>
              ))}
            </select>
          </Campo>
          <Casilla ruta="activo" etiqueta="Activo" marcado={activo} poner={setActivo} error={error} />
        </div>

        <fieldset id="campo-tiposMonumento" className="space-y-1">
          <legend className="mb-1 text-sm font-medium text-texto">Tipos de monumento habilitados</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {tiposMonumento.map((t) => (
              <label key={t.codigo} className="inline-flex items-center gap-1.5 text-sm text-texto">
                <input type="checkbox" checked={tipos.includes(t.codigo)} onChange={(e) => setTipos((ts) => (e.target.checked ? [...ts, t.codigo] : ts.filter((x) => x !== t.codigo)))} className={CLASE_CASILLA} />
                {t.nombre}
                {t.activo ? null : " (inactivo)"}
              </label>
            ))}
          </div>
          <MensajeError ruta="tiposMonumento" errores={error?.errores.filter((e) => e.ruta.startsWith("tiposMonumento")).map((e) => e.mensaje)} />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-texto">Campos de ubicación (nomenclatura)</legend>
          <MensajeError ruta="camposUbicacion" errores={erroresCampos} />
          <ol className="space-y-2">
            {campos.map((c, i) => {
              const ruta = `camposUbicacion[${i}]`;
              const usada = !c.nuevo && usadas[c.clave] !== undefined;
              const titulo = c.etiqueta || c.clave || `campo ${i + 1}`;
              return (
                <li key={i} className="space-y-2 rounded-control border border-borde bg-fondo px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-texto">
                      {i + 1}. {titulo}
                      {usada ? <span className="ml-2 text-xs font-normal text-texto-secundario">con valores en {usadas[c.clave]} expedientes: no se borra ni se renombra</span> : null}
                    </p>
                    <div className="flex gap-1">
                      <button type="button" disabled={i === 0} onClick={() => setCampos((cs) => mover(cs, i, -1))} className={CLASE_BOTON_COMPACTO}>
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Subir {titulo}</span>
                      </button>
                      <button type="button" disabled={i === campos.length - 1} onClick={() => setCampos((cs) => mover(cs, i, 1))} className={CLASE_BOTON_COMPACTO}>
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Bajar {titulo}</span>
                      </button>
                      {usada ? null : (
                        <button type="button" onClick={() => setCampos((cs) => cs.filter((_, j) => j !== i))} className={CLASE_BOTON_COMPACTO_PELIGRO}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">Quitar {titulo}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Campo ruta={`${ruta}.clave`} etiqueta="Clave" obligatorio errores={erroresDe(error, `${ruta}.clave`)}>
                      <input
                        {...atributosCampo(`${ruta}.clave`, erroresDe(error, `${ruta}.clave`))}
                        type="text"
                        maxLength={40}
                        readOnly={usada}
                        value={c.clave}
                        onChange={(e) => ponerCampo(i, { clave: e.target.value })}
                        onBlur={() => ponerCampo(i, { clave: normalizarClave(c.clave, true) })}
                        className={`${CLASE_CONTROL} font-mono read-only:bg-fondo`}
                      />
                    </Campo>
                    <Campo ruta={`${ruta}.etiqueta`} etiqueta="Etiqueta" obligatorio errores={erroresDe(error, `${ruta}.etiqueta`)}>
                      <input {...atributosCampo(`${ruta}.etiqueta`, erroresDe(error, `${ruta}.etiqueta`))} type="text" maxLength={60} value={c.etiqueta} onChange={(e) => ponerCampo(i, { etiqueta: e.target.value })} className={CLASE_CONTROL} />
                    </Campo>
                    <Campo ruta={`${ruta}.tipo`} etiqueta="Tipo" errores={erroresDe(error, `${ruta}.tipo`)}>
                      <select {...atributosCampo(`${ruta}.tipo`, erroresDe(error, `${ruta}.tipo`))} value={c.tipo} disabled={usada} onChange={(e) => ponerCampo(i, { tipo: e.target.value === "entero" ? "entero" : "texto" })} className={CLASE_CONTROL}>
                        <option value="texto">Texto</option>
                        <option value="entero">Entero</option>
                      </select>
                    </Campo>
                    <Campo ruta={`${ruta}.patron`} etiqueta="Patrón (opcional)" errores={erroresDe(error, `${ruta}.patron`)}>
                      <input {...atributosCampo(`${ruta}.patron`, erroresDe(error, `${ruta}.patron`))} type="text" maxLength={200} value={c.patron} onChange={(e) => ponerCampo(i, { patron: e.target.value })} className={`${CLASE_CONTROL} font-mono`} />
                    </Campo>
                    <Campo ruta={`${ruta}.ayuda`} etiqueta="Ayuda para quien carga" className="sm:col-span-2" errores={erroresDe(error, `${ruta}.ayuda`)}>
                      <input {...atributosCampo(`${ruta}.ayuda`, erroresDe(error, `${ruta}.ayuda`))} type="text" maxLength={200} value={c.ayuda} onChange={(e) => ponerCampo(i, { ayuda: e.target.value })} className={CLASE_CONTROL} />
                    </Campo>
                  </div>
                  <div className="flex flex-wrap gap-x-6">
                    <Casilla ruta={`${ruta}.obligatorio`} etiqueta="Obligatorio" marcado={c.obligatorio} poner={(v) => ponerCampo(i, { obligatorio: v })} error={error} />
                    <Casilla ruta={`${ruta}.activo`} etiqueta="Activo (se pide en el alta)" marcado={c.activo} poner={(v) => ponerCampo(i, { activo: v })} error={error} />
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={() => setCampos((cs) => [...cs, { clave: "", etiqueta: "", tipo: "texto", obligatorio: false, patron: "", activo: true, ayuda: "", nuevo: true }])}
            className={CLASE_BOTON_COMPACTO}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Agregar campo de ubicación
          </button>
        </fieldset>
        <CampoMotivo valor={motivo} poner={setMotivo} />
        {error ? <AvisoError error={error} recargar={`${RUTA}?pestana=cementerios`} yaMostradas={error.errores.map((e) => e.ruta).filter((r) => r !== "")} /> : null}
        <PieDialogo pendiente={pendiente} onCerrar={onCerrar} texto={cementerio ? "Guardar" : "Dar de alta"} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Tipos de monumento y de trámite
// ---------------------------------------------------------------------------

interface FilaSimple {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  uso: string;
}

export function PestanaSimple({ catalogo, titulo, descripcion, ayudaCodigo, filas }: { catalogo: "tipo_monumento" | "tipo_tramite"; titulo: string; descripcion: string; ayudaCodigo: string; filas: readonly FilaSimple[] }) {
  const [editando, setEditando] = useState<FilaSimple | "nuevo" | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const singular = catalogo === "tipo_monumento" ? "tipo de monumento" : "tipo de trámite";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-texto-secundario">{descripcion}</p>
        <button type="button" aria-haspopup="dialog" onClick={() => setEditando("nuevo")} className={CLASE_BOTON_PRIMARIO}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo {singular}
        </button>
      </div>
      <AvisoHecho mensaje={hecho} />
      <div className="tarjeta relative overflow-x-auto">
        <table className="tabla-datos">
          <caption className="sr-only">{titulo}</caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">Código</th>
              <th scope="col" className="font-medium">Nombre</th>
              <th scope="col" className="font-medium">Estado</th>
              <th scope="col" className="font-medium">Uso</th>
              <th scope="col" className="font-medium"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className={f.activo ? "" : "text-texto-secundario"}>
                <td className="font-mono text-xs">{f.codigo}</td>
                <th scope="row" className="font-normal">{f.nombre}</th>
                <td><Etiqueta activo={f.activo} /></td>
                <td className="text-xs text-texto-secundario">{f.uso}</td>
                <td>
                  <button type="button" aria-haspopup="dialog" onClick={() => setEditando(f)} className={CLASE_BOTON_COMPACTO}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Modificar<span className="sr-only"> {f.nombre}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando ? (
        <DialogoSimple
          catalogo={catalogo}
          fila={editando === "nuevo" ? null : editando}
          singular={singular}
          ayudaCodigo={ayudaCodigo}
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

function DialogoSimple({ catalogo, fila, singular, ayudaCodigo, onCerrar, onHecho }: { catalogo: "tipo_monumento" | "tipo_tramite"; fila: FilaSimple | null; singular: string; ayudaCodigo: string; onCerrar: () => void; onHecho: (m: string) => void }) {
  const { pendiente, error, guardar } = useGuardar(catalogo, onHecho);
  const [codigo, setCodigo] = useState(fila?.codigo ?? "");
  const [nombre, setNombre] = useState(fila?.nombre ?? "");
  const [activo, setActivo] = useState(fila?.activo ?? true);
  const [motivo, setMotivo] = useState("");
  return (
    <Dialogo titulo={fila ? `Modificar ${fila.nombre}` : `Nuevo ${singular}`} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar({ id: fila?.id ?? null, codigo, nombre, activo }, motivo);
        }}
      >
        <CampoCodigo valor={codigo} poner={setCodigo} error={error} fijo={fila !== null} ayuda={ayudaCodigo} />
        <Campo ruta="nombre" etiqueta="Nombre" obligatorio errores={erroresDe(error, "nombre")}>
          <input {...atributosCampo("nombre", erroresDe(error, "nombre"))} type="text" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} className={CLASE_CONTROL} data-autofocus={fila ? true : undefined} />
        </Campo>
        <Casilla ruta="activo" etiqueta="Activo" marcado={activo} poner={setActivo} error={error} />
        <CampoMotivo valor={motivo} poner={setMotivo} />
        {error ? <AvisoError error={error} recargar={RUTA} yaMostradas={["codigo", "nombre", "activo"]} /> : null}
        <PieDialogo pendiente={pendiente} onCerrar={onCerrar} texto={fila ? "Guardar" : "Dar de alta"} />
      </form>
    </Dialogo>
  );
}
