"use client";

import { Plus } from "lucide-react";
import { CLASE_BOTON_SECUNDARIO } from "@/components/formulario";
import { COMODIN_CEMENTERIO, DATOS_SUBTAREA, ESTADOS_PASO, PREFIJO_CAMPO, type PasoPlantilla, type SubtareaPlantilla } from "@/lib/dominio/plantillas/esquema";
import {
  activarPlazo,
  agregarPaso,
  agregarSubtarea,
  cambiarPaso,
  cambiarSubtarea,
  erroresDentroDe,
  moverPaso,
  moverSubtarea,
  necesitaCustodia,
  quitarPaso,
  quitarSubtarea,
} from "@/lib/presentacion/editor-plantilla";
import { idDeCampo } from "@/lib/presentacion/errores";
import { BotonesOrden, CampoClave, CampoNumero, CampoTexto, Casilla, ErroresDe, FiltroCementerios, idTrasMover, Selector, useEditor, type OpcionSelector } from "./controles";

/**
 * Pestaña Pasos: el recorrido, en orden, con ↑↓ para moverlo. Cada paso es un
 * `<details>` (se abre con Enter o Espacio sobre su título) con su área o
 * comodín, custodia, estado, omitible, días de alerta, instrucciones, plazo y
 * subtareas. Los que tienen errores muestran cuántos en el título.
 */

const ETIQUETA_ESTADO_PASO: Record<(typeof ESTADOS_PASO)[number], string> = {
  en_tramite: "En trámite",
  espera_pago_dim: "En espera de pago (DIM)",
};

const ETIQUETA_DATO: Record<string, string> = { "": "Sin dato", fecha: "Pide una fecha", texto: "Pide un texto" };

/** Los pasos abiertos, por índice: al mover o quitar un paso, su panel sigue abierto donde quedó. */
export type Abiertos = ReadonlySet<number>;

function intercambiar(s: Abiertos, a: number, b: number): Set<number> {
  const r = new Set<number>();
  for (const i of s) r.add(i === a ? b : i === b ? a : i);
  return r;
}

function sinIndice(s: Abiertos, quitado: number): Set<number> {
  const r = new Set<number>();
  for (const i of s) if (i !== quitado) r.add(i > quitado ? i - 1 : i);
  return r;
}

export function PestanaPasos({ abiertos, setAbiertos }: { abiertos: Abiertos; setAbiertos: (f: (s: Abiertos) => Abiertos) => void }) {
  const alternar = (indice: number, abierto: boolean) =>
    setAbiertos((s) => {
      const r = new Set(s);
      if (abierto) r.add(indice);
      else r.delete(indice);
      return r;
    });
  const { def, estructura, soloLectura } = useEditor();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        El recorrido del papel, en orden. El último paso tiene que ser de un área interna (ahí se concluye). Un paso externo (la DIM, un cementerio) o con comodín
        necesita la custodia: el área interna que lo sigue desde afuera.
      </p>
      <ErroresDe ruta="pasos" />
      <ol className="space-y-2">
        {def.pasos.map((p, i) => (
          <li key={`${p.clave}#${i}`}>
            <Paso paso={p} indice={i} abierto={abiertos.has(i)} alternar={alternar} reordenar={setAbiertos} />
          </li>
        ))}
      </ol>
      {!soloLectura ? (
        <button
          type="button"
          className={CLASE_BOTON_SECUNDARIO}
          onClick={() => {
            alternar(def.pasos.length, true);
            estructura((d) => agregarPaso(d), idDeCampo(`pasos[${def.pasos.length}].nombre`));
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Agregar paso
        </button>
      ) : null}
    </div>
  );
}

function opcionesDeArea(areas: ReturnType<typeof useEditor>["catalogos"]["areas"], campos: ReturnType<typeof useEditor>["def"]["campos_extra"]): OpcionSelector[] {
  const marca = (a: { activa: boolean; recibePases: boolean }) => (!a.activa ? " (inactiva)" : !a.recibePases ? " (no recibe pases)" : "");
  return [
    { valor: "", etiqueta: "Elegí el área…" },
    ...areas.filter((a) => a.tipo === "interna").map((a) => ({ valor: a.codigo, etiqueta: `${a.nombre}${marca(a)}`, grupo: "Áreas internas" })),
    ...areas.filter((a) => a.tipo !== "interna").map((a) => ({ valor: a.codigo, etiqueta: `${a.nombre}${marca(a)}`, grupo: "Áreas externas (sin usuarios)" })),
    { valor: COMODIN_CEMENTERIO, etiqueta: "El cementerio del expediente ($CEMENTERIO)", grupo: "Comodines" },
    ...campos
      .filter((c) => c.tipo === "cementerio" && c.clave !== "")
      .map((c) => ({ valor: `${PREFIJO_CAMPO}${c.clave}`, etiqueta: `El cementerio del campo "${c.etiqueta || c.clave}" ($CAMPO:${c.clave})`, grupo: "Comodines" })),
  ];
}

function Paso({
  paso,
  indice,
  abierto,
  alternar,
  reordenar,
}: {
  paso: PasoPlantilla;
  indice: number;
  abierto: boolean;
  alternar: (indice: number, abierto: boolean) => void;
  reordenar: (f: (s: Abiertos) => Abiertos) => void;
}) {
  const { def, cambiar, estructura, errores, catalogos, soloLectura } = useEditor();
  const ruta = `pasos[${indice}]`;
  const total = def.pasos.length;
  const cantidadErrores = erroresDentroDe(errores, ruta);
  const nombre = paso.nombre || paso.clave || `paso ${indice + 1}`;
  const custodia = necesitaCustodia(paso.area, catalogos.areas);
  const poner = (cambios: Parameters<typeof cambiarPaso>[2]) => cambiar((d) => cambiarPaso(d, indice, cambios, catalogos.areas));
  const area = catalogos.areas.find((a) => a.codigo === paso.area);
  const destino = paso.area === COMODIN_CEMENTERIO ? "cementerio del expediente" : paso.area.startsWith(PREFIJO_CAMPO) ? "cementerio de un campo" : (area?.nombre ?? (paso.area || "sin área"));

  // Las subtareas que pueden iniciar el plazo: con fecha, de este paso o de uno anterior.
  const desdePosibles = def.pasos.slice(0, indice + 1).flatMap((p) => p.subtareas.filter((s) => s.dato === "fecha").map((s) => ({ valor: s.clave, etiqueta: `${s.nombre || s.clave} (${p.nombre || p.clave})` })));

  return (
    <details
      open={abierto}
      onToggle={(e) => {
        const ahora = e.currentTarget.open;
        if (ahora !== abierto) alternar(indice, ahora);
      }}
      className="rounded border border-slate-300 bg-white"
    >
      <summary id={idDeCampo(ruta)} className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800">
        <span className="font-medium text-slate-900">
          {indice + 1}. {paso.nombre || <span className="italic text-slate-500">(sin nombre)</span>}
        </span>
        <span className="font-mono text-xs text-slate-600">{paso.clave}</span>
        <span className="text-sm text-slate-600">· {destino}</span>
        {paso.subtareas.length > 0 ? <span className="text-xs text-slate-600">· {paso.subtareas.length} subtareas</span> : null}
        {cantidadErrores > 0 ? <span className="rounded-full bg-red-700 px-1.5 text-xs font-semibold text-white">{cantidadErrores} {cantidadErrores === 1 ? "error" : "errores"}</span> : null}
      </summary>
      <div className="space-y-4 border-t border-slate-200 px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <ErroresDe ruta={ruta} />
          <BotonesOrden
            ruta={ruta}
            nombre={`el paso ${nombre}`}
            indice={indice}
            total={total}
            onMover={(delta) => {
              reordenar((s) => intercambiar(s, indice, indice + delta));
              estructura((d) => moverPaso(d, indice, delta), idTrasMover("pasos", indice + delta, total, delta));
            }}
            onQuitar={() => {
              reordenar((s) => sinIndice(s, indice));
              estructura((d) => quitarPaso(d, indice));
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <CampoClave ruta={`${ruta}.clave`} referencia={{ tipo: "paso", paso: indice }} valor={paso.clave} />
          <CampoTexto ruta={`${ruta}.nombre`} etiqueta="Nombre" obligatorio valor={paso.nombre} poner={(v) => poner({ nombre: v })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Selector ruta={`${ruta}.area`} etiqueta="Área" valor={paso.area} opciones={opcionesDeArea(catalogos.areas, def.campos_extra)} poner={(v) => poner({ area: v })} />
          <Selector
            ruta={`${ruta}.custodia`}
            etiqueta="Custodia"
            valor={paso.custodia ?? ""}
            deshabilitado={custodia === false && paso.custodia === null}
            ayuda={custodia === false ? "Un paso interno no lleva custodia" : "El área interna que sigue el papel mientras está afuera"}
            opciones={[
              { valor: "", etiqueta: custodia === false ? "Sin custodia" : "Elegí la custodia…" },
              ...catalogos.areas.filter((a) => a.tipo === "interna").map((a) => ({ valor: a.codigo, etiqueta: `${a.nombre}${a.activa ? "" : " (inactiva)"}` })),
            ]}
            poner={(v) => poner({ custodia: v === "" ? null : v })}
          />
          <Selector
            ruta={`${ruta}.estado`}
            etiqueta="Estado del expediente en este paso"
            valor={paso.estado}
            opciones={ESTADOS_PASO.map((e) => ({ valor: e, etiqueta: ETIQUETA_ESTADO_PASO[e] }))}
            poner={(v) => poner({ estado: v === "espera_pago_dim" ? "espera_pago_dim" : "en_tramite" })}
          />
          <CampoNumero ruta={`${ruta}.dias_alerta`} etiqueta="Días hábiles para la alerta" min={1} valor={paso.dias_alerta} poner={(v) => poner({ dias_alerta: v })} ayuda="Desde ahí la bandeja lo marca demorado" />
        </div>
        <Casilla ruta={`${ruta}.omitible`} etiqueta="Omitible (el pase lo puede saltear con motivo)" marcado={paso.omitible} poner={(v) => poner({ omitible: v })} />
        <CampoTexto ruta={`${ruta}.instrucciones`} etiqueta="Instrucciones (se muestran en la ficha)" multilinea valor={paso.instrucciones ?? ""} poner={(v) => poner({ instrucciones: v === "" ? null : v })} />

        <fieldset className="space-y-2 rounded border border-slate-200 px-3 pb-3 pt-1">
          <legend className="px-1 text-sm font-medium text-slate-800">Plazo</legend>
          <Casilla ruta={`${ruta}.plazo`} etiqueta="Este paso tiene un plazo en días hábiles" marcado={paso.plazo !== null} poner={(v) => cambiar((d) => activarPlazo(d, indice, v))} />
          {paso.plazo ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <CampoNumero ruta={`${ruta}.plazo.dias_habiles`} etiqueta="Días hábiles" min={1} valor={paso.plazo.dias_habiles} poner={(v) => cambiar((d) => cambiarPaso(d, indice, { plazo: paso.plazo ? { ...paso.plazo, dias_habiles: v } : null }))} />
              <Selector
                ruta={`${ruta}.plazo.desde_subtarea`}
                etiqueta="Empieza con la fecha de"
                valor={paso.plazo.desde_subtarea}
                opciones={[{ valor: "", etiqueta: "Elegí la subtarea…" }, ...desdePosibles]}
                poner={(v) => cambiar((d) => cambiarPaso(d, indice, { plazo: paso.plazo ? { ...paso.plazo, desde_subtarea: v } : null }))}
                ayuda="Una subtarea que pide fecha, de este paso o de uno anterior"
              />
              <Selector
                ruta={`${ruta}.plazo.hasta_subtarea`}
                etiqueta="Se cumple al tildar"
                valor={paso.plazo.hasta_subtarea}
                opciones={[{ valor: "", etiqueta: "Elegí la subtarea…" }, ...paso.subtareas.map((s) => ({ valor: s.clave, etiqueta: s.nombre || s.clave }))]}
                poner={(v) => cambiar((d) => cambiarPaso(d, indice, { plazo: paso.plazo ? { ...paso.plazo, hasta_subtarea: v } : null }))}
                ayuda="Una subtarea de este paso"
              />
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">Subtareas</legend>
          <ErroresDe ruta={`${ruta}.subtareas`} />
          {paso.subtareas.length === 0 ? <p className="text-sm text-slate-600">Sin subtareas: el pase no exige nada en este paso.</p> : null}
          <ol className="space-y-2">
            {paso.subtareas.map((s, j) => (
              <li key={`${s.clave}#${j}`}>
                <Subtarea paso={indice} indice={j} subtarea={s} total={paso.subtareas.length} />
              </li>
            ))}
          </ol>
          {!soloLectura ? (
            <button
              type="button"
              className={`${CLASE_BOTON_SECUNDARIO} py-1`}
              onClick={() => estructura((d) => agregarSubtarea(d, indice), idDeCampo(`${ruta}.subtareas[${paso.subtareas.length}].nombre`))}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Agregar subtarea<span className="sr-only"> a {nombre}</span>
            </button>
          ) : null}
        </fieldset>
      </div>
    </details>
  );
}

function Subtarea({ paso, indice, subtarea, total }: { paso: number; indice: number; subtarea: SubtareaPlantilla; total: number }) {
  const { cambiar, estructura } = useEditor();
  const ruta = `pasos[${paso}].subtareas[${indice}]`;
  const poner = (cambios: Parameters<typeof cambiarSubtarea>[3]) => cambiar((d) => cambiarSubtarea(d, paso, indice, cambios));
  const nombre = subtarea.nombre || subtarea.clave || `subtarea ${indice + 1}`;
  return (
    <fieldset id={idDeCampo(ruta)} tabIndex={-1} className="space-y-3 rounded border border-slate-200 bg-slate-50 px-3 pb-3 pt-1">
      <legend className="px-1 text-sm text-slate-800">
        Subtarea {indice + 1}: {subtarea.nombre || <span className="italic text-slate-500">(sin nombre)</span>}
      </legend>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ErroresDe ruta={ruta} />
        <BotonesOrden
          ruta={ruta}
          nombre={`la subtarea ${nombre}`}
          indice={indice}
          total={total}
          onMover={(delta) => estructura((d) => moverSubtarea(d, paso, indice, delta), idTrasMover(`pasos[${paso}].subtareas`, indice + delta, total, delta))}
          onQuitar={() => estructura((d) => quitarSubtarea(d, paso, indice))}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <CampoClave ruta={`${ruta}.clave`} referencia={{ tipo: "subtarea", paso, subtarea: indice }} valor={subtarea.clave} />
        <CampoTexto ruta={`${ruta}.nombre`} etiqueta="Nombre" obligatorio valor={subtarea.nombre} poner={(v) => poner({ nombre: v })} />
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Casilla ruta={`${ruta}.obligatoria`} etiqueta="Obligatoria para el pase" marcado={subtarea.obligatoria} poner={(v) => poner({ obligatoria: v })} />
        <Selector
          ruta={`${ruta}.dato`}
          etiqueta="Dato"
          valor={subtarea.dato ?? ""}
          opciones={["", ...DATOS_SUBTAREA].map((d) => ({ valor: d, etiqueta: ETIQUETA_DATO[d] }))}
          poner={(v) => poner({ dato: v === "fecha" || v === "texto" ? v : null })}
          className="min-w-44"
        />
        <Casilla ruta={`${ruta}.dato_obligatorio`} etiqueta="El dato es obligatorio" marcado={subtarea.dato_obligatorio} deshabilitada={subtarea.dato === null} poner={(v) => poner({ dato_obligatorio: v })} />
      </div>
      <FiltroCementerios ruta={ruta} filtro={subtarea} poner={(f) => poner(f)} />
    </fieldset>
  );
}
