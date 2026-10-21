"use client";

import { createContext, useContext, useId, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Trash2 } from "lucide-react";
import { atributosCampo, Campo, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL, MensajeError } from "@/components/formulario";
import type { ErrorCampo } from "@/lib/dominio/expedientes/errores";
import type { DefinicionPlantilla, FiltroCementerios as Filtro } from "@/lib/dominio/plantillas/esquema";
import {
  cementeriosDelFiltro,
  filtroConCementerio,
  filtroConModo,
  mensajesDe,
  modoFiltro,
  renombrarClave,
  type AreaEditor,
  type CementerioEditor,
  type ModoFiltro,
  type RefClave,
} from "@/lib/presentacion/editor-plantilla";
import { idDeCampo } from "@/lib/presentacion/errores";

/**
 * Lo que comparten las pestañas del editor de plantillas: la definición, cómo
 * cambiarla, los errores de la última validación y los catálogos; y los
 * controles, todos con su `<label>` y, si tienen error, `aria-invalid` y el
 * mensaje enlazado. El `id` de cada control sale de la ruta del esquema
 * (`pasos[2].custodia` → `campo-pasos-2-custodia`), así un error de
 * validar.ts lleva directo al campo.
 */

export interface CatalogosDelEditor {
  areas: readonly AreaEditor[];
  cementerios: readonly CementerioEditor[];
  tiposMonumento: ReadonlyArray<{ codigo: string; nombre: string; activo: boolean }>;
}

export interface ContextoEditor {
  def: DefinicionPlantilla;
  /** Un cambio de valores (los errores quedan: siguen apuntando a lo mismo). */
  cambiar: (f: (d: DefinicionPlantilla) => DefinicionPlantilla) => void;
  /** Agregar, quitar o mover: las rutas de los errores cambian, así que se limpian. */
  estructura: (f: (d: DefinicionPlantilla) => DefinicionPlantilla, enfocar?: string) => void;
  errores: readonly ErrorCampo[];
  soloLectura: boolean;
  catalogos: CatalogosDelEditor;
}

const Contexto = createContext<ContextoEditor | null>(null);
export const ProveedorEditor = Contexto.Provider;

export function useEditor(): ContextoEditor {
  const c = useContext(Contexto);
  if (!c) throw new Error("useEditor fuera del editor de plantillas");
  return c;
}

export function useErrores(ruta: string): string[] | undefined {
  return mensajesDe(useEditor().errores, ruta);
}

/** Los errores de un elemento entero (`pasos[2]`, `personas`), arriba de sus campos. */
export function ErroresDe({ ruta }: { ruta: string }) {
  const errores = useErrores(ruta);
  if (!errores) return null;
  return (
    <ul className="space-y-0.5 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
      {errores.map((m, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {m}
        </li>
      ))}
    </ul>
  );
}

export function CampoTexto({
  ruta,
  etiqueta,
  valor,
  poner,
  obligatorio = false,
  ayuda,
  multilinea = false,
  className,
  monoespaciado = false,
}: {
  ruta: string;
  etiqueta: string;
  valor: string;
  poner: (v: string) => void;
  obligatorio?: boolean;
  ayuda?: string;
  multilinea?: boolean;
  className?: string;
  monoespaciado?: boolean;
}) {
  const errores = useErrores(ruta);
  const atributos = atributosCampo(ruta, errores, ayuda ? `${idDeCampo(ruta)}-ayuda` : undefined);
  return (
    <Campo ruta={ruta} etiqueta={etiqueta} errores={errores} obligatorio={obligatorio} ayuda={ayuda} className={className}>
      {multilinea ? (
        <textarea {...atributos} rows={3} maxLength={2000} value={valor} onChange={(e) => poner(e.target.value)} className={CLASE_CONTROL} />
      ) : (
        <input {...atributos} type="text" maxLength={300} value={valor} onChange={(e) => poner(e.target.value)} className={`${CLASE_CONTROL} ${monoespaciado ? "font-mono" : ""}`} />
      )}
    </Campo>
  );
}

export function CampoNumero({ ruta, etiqueta, valor, poner, min = 0, ayuda, className }: { ruta: string; etiqueta: string; valor: number; poner: (v: number) => void; min?: number; ayuda?: string; className?: string }) {
  const errores = useErrores(ruta);
  return (
    <Campo ruta={ruta} etiqueta={etiqueta} errores={errores} ayuda={ayuda} className={className}>
      <input
        {...atributosCampo(ruta, errores, ayuda ? `${idDeCampo(ruta)}-ayuda` : undefined)}
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={Number.isFinite(valor) ? valor : ""}
        onChange={(e) => poner(e.target.value === "" ? 0 : Math.trunc(Number(e.target.value)))}
        className={`${CLASE_CONTROL} max-w-28`}
      />
    </Campo>
  );
}

export function Casilla({ ruta, etiqueta, marcado, poner, ayuda, deshabilitada = false }: { ruta: string; etiqueta: string; marcado: boolean; poner: (v: boolean) => void; ayuda?: string; deshabilitada?: boolean }) {
  const errores = useErrores(ruta);
  const idAyuda = ayuda ? `${idDeCampo(ruta)}-ayuda` : undefined;
  return (
    <div>
      <label className="inline-flex items-center gap-2 text-sm text-slate-800">
        <input
          {...atributosCampo(ruta, errores, idAyuda)}
          type="checkbox"
          checked={marcado}
          disabled={deshabilitada}
          onChange={(e) => poner(e.target.checked)}
          className={CLASE_CASILLA}
        />
        {etiqueta}
      </label>
      {ayuda ? (
        <p id={idAyuda} className="ml-6 text-xs text-slate-600">
          {ayuda}
        </p>
      ) : null}
      <MensajeError ruta={ruta} errores={errores} />
    </div>
  );
}

export interface OpcionSelector {
  valor: string;
  etiqueta: string;
  grupo?: string;
}

/** Una lista de opciones; `null` en el modelo es la opción de valor "". */
export function Selector({
  ruta,
  etiqueta,
  valor,
  opciones,
  poner,
  ayuda,
  deshabilitado = false,
  className,
}: {
  ruta: string;
  etiqueta: string;
  valor: string;
  opciones: readonly OpcionSelector[];
  poner: (v: string) => void;
  ayuda?: string;
  deshabilitado?: boolean;
  className?: string;
}) {
  const errores = useErrores(ruta);
  const conValor = valor === "" || opciones.some((o) => o.valor === valor) ? opciones : [...opciones, { valor, etiqueta: `${valor} (no existe)` }];
  const grupos = [...new Set(conValor.map((o) => o.grupo ?? ""))];
  return (
    <Campo ruta={ruta} etiqueta={etiqueta} errores={errores} ayuda={ayuda} className={className}>
      <select
        {...atributosCampo(ruta, errores, ayuda ? `${idDeCampo(ruta)}-ayuda` : undefined)}
        value={valor}
        disabled={deshabilitado}
        onChange={(e) => poner(e.target.value)}
        className={CLASE_CONTROL}
      >
        {grupos.map((g) =>
          g === "" ? (
            conValor.filter((o) => (o.grupo ?? "") === "").map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))
          ) : (
            <optgroup key={g} label={g}>
              {conValor
                .filter((o) => o.grupo === g)
                .map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
            </optgroup>
          ),
        )}
      </select>
    </Campo>
  );
}

/**
 * Una clave (de paso, subtarea, documento, concepto, campo extra o rol). Se
 * escribe libre y se aplica al salir del campo o con Enter: ahí se normaliza
 * (mayúsculas o minúsculas, sin acentos ni espacios), se rechaza si otro
 * elemento ya la usa y se renombran las referencias (ver `renombrarClave`).
 */
export function CampoClave({ ruta, etiqueta = "Clave", referencia, valor, ayuda }: { ruta: string; etiqueta?: string; referencia: RefClave; valor: string; ayuda?: string }) {
  const { cambiar, def } = useEditor();
  const [borrador, setBorrador] = useState<string | null>(null);
  const [rechazo, setRechazo] = useState<string | null>(null);
  const deValidacion = useErrores(ruta);
  const errores = [...(rechazo ? [rechazo] : []), ...(deValidacion ?? [])];
  const minusculas = referencia.tipo === "campo" || referencia.tipo === "rol";
  const aplicar = () => {
    if (borrador === null) return;
    const r = renombrarClave(def, referencia, borrador);
    if (r.ok) {
      if (r.def !== def) cambiar(() => r.def);
      setRechazo(null);
    } else {
      setRechazo(r.mensaje);
    }
    setBorrador(null);
  };
  const textoAyuda = ayuda ?? (minusculas ? "Minúsculas y _ (se ajusta al salir del campo)" : "Mayúsculas, números y _ (se ajusta al salir del campo)");
  return (
    <Campo ruta={ruta} etiqueta={etiqueta} errores={errores.length > 0 ? errores : undefined} ayuda={textoAyuda}>
      <input
        {...atributosCampo(ruta, errores.length > 0 ? errores : undefined, `${idDeCampo(ruta)}-ayuda`)}
        type="text"
        maxLength={60}
        spellCheck={false}
        autoCapitalize={minusculas ? "none" : "characters"}
        value={borrador ?? valor}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={aplicar}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            aplicar();
          } else if (e.key === "Escape" && borrador !== null) {
            e.preventDefault();
            setBorrador(null);
            setRechazo(null);
          }
        }}
        className={`${CLASE_CONTROL} font-mono`}
      />
    </Campo>
  );
}

const ETIQUETA_MODO: Record<ModoFiltro, string> = { todos: "En todos los cementerios", solo: "Solo en…", excepto: "En todos menos…" };

/** El filtro por cementerio de un concepto, documento o subtarea (resolver.ts). */
export function FiltroCementerios({ ruta, filtro, poner }: { ruta: string; filtro: Filtro; poner: (f: Filtro) => void }) {
  const { catalogos } = useEditor();
  const id = useId();
  const modo = modoFiltro(filtro);
  const marcados = cementeriosDelFiltro(filtro);
  const campo = modo === "solo" ? "solo_cementerios" : "excepto_cementerios";
  const erroresModo = [...(useErrores(`${ruta}.solo_cementerios`) ?? []), ...(useErrores(`${ruta}.excepto_cementerios`) ?? [])];
  const editor = useEditor();
  const erroresCodigos = editor.errores.filter((e) => e.ruta.startsWith(`${ruta}.${campo}[`)).map((e) => e.mensaje);
  const todos = [...erroresModo, ...erroresCodigos];
  const conocidos = catalogos.cementerios.map((c) => c.codigo);
  const desconocidos = marcados.filter((c) => !conocidos.includes(c));
  return (
    <fieldset id={idDeCampo(`${ruta}.${campo}`)} tabIndex={-1} className="space-y-1.5">
      <legend className="mb-1 text-sm font-medium text-slate-800">Cementerios</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(["todos", "solo", "excepto"] as const).map((m) => (
          <label key={m} className="inline-flex items-center gap-1.5 text-sm text-slate-800">
            <input type="radio" name={`${id}-modo`} checked={modo === m} onChange={() => poner(filtroConModo(filtro, m))} className="h-4 w-4 accent-slate-800" />
            {ETIQUETA_MODO[m]}
          </label>
        ))}
      </div>
      {modo !== "todos" ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-2" role="group" aria-label={modo === "solo" ? "Solo en estos cementerios" : "Menos en estos cementerios"}>
          {catalogos.cementerios.map((c) => (
            <label key={c.codigo} className="inline-flex items-center gap-1.5 text-sm text-slate-800">
              <input type="checkbox" checked={marcados.includes(c.codigo)} onChange={(e) => poner(filtroConCementerio(filtro, c.codigo, e.target.checked))} className={CLASE_CASILLA} />
              {c.nombre}
              {c.activo ? null : " (inactivo)"}
            </label>
          ))}
          {desconocidos.map((c) => (
            <label key={c} className="inline-flex items-center gap-1.5 text-sm text-red-900">
              <input type="checkbox" checked onChange={() => poner(filtroConCementerio(filtro, c, false))} className={CLASE_CASILLA} />
              {c} (no existe)
            </label>
          ))}
        </div>
      ) : null}
      <MensajeError ruta={`${ruta}.${campo}`} errores={todos.length > 0 ? todos : undefined} />
    </fieldset>
  );
}

/** Subir, bajar y quitar un elemento de una lista, con el nombre del elemento para el lector de pantalla. */
export function BotonesOrden({ ruta, nombre, indice, total, onMover, onQuitar }: { ruta: string; nombre: string; indice: number; total: number; onMover: (delta: number) => void; onQuitar: () => void }) {
  const { soloLectura } = useEditor();
  if (soloLectura) return null;
  const base = idDeCampo(ruta);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" id={`${base}-subir`} disabled={indice === 0} onClick={() => onMover(-1)} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-1`}>
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Subir {nombre}</span>
      </button>
      <button type="button" id={`${base}-bajar`} disabled={indice === total - 1} onClick={() => onMover(1)} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-1`}>
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Bajar {nombre}</span>
      </button>
      <button type="button" onClick={onQuitar} className={`${CLASE_BOTON_SECUNDARIO} px-2 py-1 text-red-800`}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Quitar {nombre}</span>
      </button>
    </div>
  );
}

/** El id del botón que conviene enfocar después de mover un elemento a `indice`. */
export function idTrasMover(rutaLista: string, indice: number, total: number, delta: number): string {
  const ruta = `${rutaLista}[${indice}]`;
  const preferido = delta < 0 ? "subir" : "bajar";
  const alReves = delta < 0 ? "bajar" : "subir";
  const enBorde = (delta < 0 && indice === 0) || (delta > 0 && indice === total - 1);
  return `${idDeCampo(ruta)}-${enBorde ? alReves : preferido}`;
}
