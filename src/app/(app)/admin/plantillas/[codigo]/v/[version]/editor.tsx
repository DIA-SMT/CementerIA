"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CheckCheck, CircleAlert, Save, Send, Trash2 } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_BOTON_SECUNDARIO_PELIGRO, CLASE_CONTROL } from "@/components/formulario";
import { clasePestana } from "@/components/pestanas";
import { LARGO_MINIMO_MOTIVO, type ErrorCampo } from "@/lib/dominio/expedientes/errores";
import type { DefinicionPlantilla } from "@/lib/dominio/plantillas/esquema";
import {
  ETIQUETA_PESTANA_EDITOR,
  erroresPorPestana,
  indiceDePaso,
  PESTANAS_EDITOR,
  pestanaDeRuta,
  rutasAncestras,
  ubicacionDeRuta,
  type PestanaEditor,
} from "@/lib/presentacion/editor-plantilla";
import type { EstadoError } from "@/lib/presentacion/errores";
import { idDeCampo } from "@/lib/presentacion/errores";
import { RUTA_PLANTILLAS, rutaVersionPlantilla } from "@/lib/presentacion/rutas-admin";
import { accionDescartar, accionGuardarBorrador, accionPublicar, accionValidarBorrador } from "../../../../acciones";
import { AvisoHecho, DialogoConfirmar, erroresDe, useAccion } from "../../../../piezas";
import { ProveedorEditor, type CatalogosDelEditor, type ContextoEditor } from "./controles";
import { PestanaPasos, type Abiertos } from "./pasos";
import { PestanaCamposExtra, PestanaConceptos, PestanaDocumentacion, PestanaGeneral, PestanaPersonas, PestanaVistaPrevia } from "./pestanas";

/**
 * El editor de un borrador de plantilla (o el visor de una versión publicada
 * o retirada, con todo deshabilitado). Lo que se edita vive acá, en el
 * navegador, hasta "Guardar borrador" o "Publicar"; "Validar" corre las
 * reglas de "Publicar" (validar.ts) sobre lo que está en pantalla y cada error
 * aparece en su pestaña y junto a su campo, con un resumen arriba que lleva a
 * cada uno. Atajos: Ctrl+S guarda; las pestañas se recorren con ← y →.
 */

export interface DatosEditor {
  codigo: string;
  version: number;
  estado: "borrador" | "publicada" | "retirada";
  nombre: string;
  definicion: DefinicionPlantilla;
  huella: string;
  catalogos: CatalogosDelEditor;
}

function huellaLocal(nombre: string, def: DefinicionPlantilla): string {
  return JSON.stringify([nombre, def]);
}

export function EditorPlantilla({ datos }: { datos: DatosEditor }) {
  const soloLectura = datos.estado !== "borrador";
  const [def, setDef] = useState(datos.definicion);
  const [nombre, setNombre] = useState(datos.nombre);
  const [huella, setHuella] = useState(datos.huella);
  const [guardado, setGuardado] = useState(() => huellaLocal(datos.nombre, datos.definicion));
  const [errores, setErrores] = useState<readonly ErrorCampo[]>([]);
  const [pestana, setPestana] = useState<PestanaEditor>("general");
  const [abiertos, setAbiertos] = useState<Abiertos>(() => new Set());
  const [hecho, setHecho] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<"publicar" | "descartar" | null>(null);
  const enfocar = useRef<string | null>(null);
  const accion = useAccion();

  const sucio = huellaLocal(nombre, def) !== guardado;

  // Antes de cerrar o recargar con cambios sin guardar, el navegador pregunta.
  useEffect(() => {
    if (!sucio || soloLectura) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sucio, soloLectura]);

  // El foco pendiente (un campo nuevo, el botón de un elemento movido, un error) se aplica después de pintar.
  useEffect(() => {
    if (enfocar.current === null) return;
    const objetivo = document.getElementById(enfocar.current);
    if (objetivo) {
      objetivo.focus();
      objetivo.scrollIntoView({ block: "center" });
    }
    enfocar.current = null;
  });

  const contexto: ContextoEditor = useMemo(
    () => ({
      def,
      soloLectura,
      errores,
      catalogos: datos.catalogos,
      cambiar: (f) => setDef((d) => f(d)),
      estructura: (f, foco) => {
        setDef((d) => f(d));
        if (errores.length > 0) {
          setErrores([]);
          setHecho("La lista cambió: volvé a validar para ver los errores al día.");
        }
        if (foco) enfocar.current = foco;
      },
    }),
    [def, soloLectura, errores, datos.catalogos],
  );

  const contenido = useCallback(() => ({ nombre, definicion: def as unknown as Record<string, unknown> }), [nombre, def]);

  const guardar = useCallback(() => {
    if (soloLectura) return;
    setHecho(null);
    const enviado = huellaLocal(nombre, def);
    accion.enviar(
      () => accionGuardarBorrador({ codigo: datos.codigo, version: datos.version, huella, ...contenido() }),
      (r) => {
        setHuella(r.huella);
        setGuardado(enviado);
        setHecho(r.mensaje);
      },
    );
  }, [accion, contenido, datos.codigo, datos.version, def, huella, nombre, soloLectura]);

  const validar = () => {
    setHecho(null);
    accion.enviar(
      () => accionValidarBorrador(contenido()),
      (r) => {
        setErrores(r.errores);
        // Con errores, el resumen rojo ya lo dice; el aviso verde es para "se puede publicar".
        setHecho(r.errores.length === 0 ? r.mensaje : null);
      },
    );
  };

  /** Lleva a un error: su pestaña, su paso abierto y el foco en su campo (o el más cercano). */
  const irAError = (ruta: string) => {
    setPestana(pestanaDeRuta(ruta));
    const paso = indiceDePaso(ruta);
    if (paso !== null) setAbiertos((s) => new Set([...s, paso]));
    requestAnimationFrame(() => {
      for (const r of rutasAncestras(ruta)) {
        const el = document.getElementById(idDeCampo(r));
        if (el) {
          el.focus();
          el.scrollIntoView({ block: "center" });
          return;
        }
      }
      document.getElementById(`panel-${pestanaDeRuta(ruta)}`)?.focus();
    });
  };

  const porPestana = erroresPorPestana(errores);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const teclaPestanas = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = PESTANAS_EDITOR.indexOf(pestana);
    const destino =
      e.key === "ArrowRight" ? PESTANAS_EDITOR[(i + 1) % PESTANAS_EDITOR.length]
      : e.key === "ArrowLeft" ? PESTANAS_EDITOR[(i - 1 + PESTANAS_EDITOR.length) % PESTANAS_EDITOR.length]
      : e.key === "Home" ? PESTANAS_EDITOR[0]
      : e.key === "End" ? PESTANAS_EDITOR[PESTANAS_EDITOR.length - 1]
      : null;
    if (!destino) return;
    e.preventDefault();
    setPestana(destino);
    tabs.current[destino]?.focus();
  };

  return (
    <ProveedorEditor value={contexto}>
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            guardar();
          }
        }}
      >
        {!soloLectura ? (
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-borde bg-white/95 py-2 backdrop-blur" role="toolbar" aria-label="Acciones del borrador">
            <button type="button" onClick={guardar} disabled={accion.pendiente} className={CLASE_BOTON_PRIMARIO} aria-keyshortcuts="Control+S">
              <Save className="h-4 w-4" aria-hidden="true" />
              Guardar borrador
            </button>
            <button type="button" onClick={validar} disabled={accion.pendiente} className={CLASE_BOTON_SECUNDARIO}>
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Validar
            </button>
            <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("publicar")} disabled={accion.pendiente} className={CLASE_BOTON_SECUNDARIO}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Publicar…
            </button>
            <button type="button" aria-haspopup="dialog" onClick={() => setDialogo("descartar")} disabled={accion.pendiente} className={CLASE_BOTON_SECUNDARIO_PELIGRO}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Descartar borrador…
            </button>
            <span className="ml-auto text-sm text-texto-secundario" aria-live="polite">
              {accion.pendiente ? "Un momento…" : sucio ? "Hay cambios sin guardar" : "Todo guardado"}
            </span>
          </div>
        ) : null}

        <AvisoHecho mensaje={hecho} />
        {accion.error ? <AvisoError error={accion.error} recargar={rutaVersionPlantilla(datos.codigo, datos.version)} yaMostradas={accion.error.errores.map((e) => e.ruta)} /> : null}

        {errores.length > 0 ? (
          <nav aria-label="Errores de la validación" className="rounded-control border border-error-borde bg-error-fondo px-3 py-2 text-sm text-error">
            <p className="flex items-center gap-1.5 font-medium">
              <CircleAlert className="h-4 w-4" aria-hidden="true" />
              {errores.length === 1 ? "1 error para corregir antes de publicar" : `${errores.length} errores para corregir antes de publicar`}
            </p>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pl-6">
              {errores.map((e, i) => (
                <li key={`${e.ruta}-${i}`} className="list-disc">
                  <button type="button" onClick={() => irAError(e.ruta)} className="text-left underline underline-offset-2 hover:text-error">
                    {ETIQUETA_PESTANA_EDITOR[pestanaDeRuta(e.ruta)]} · {ubicacionDeRuta(e.ruta, def)}: {e.mensaje}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div role="tablist" aria-label="Partes de la plantilla" onKeyDown={teclaPestanas} className="flex flex-wrap gap-1 border-b border-borde">
          {PESTANAS_EDITOR.map((p) => {
            const actual = p === pestana;
            return (
              <button
                key={p}
                ref={(el) => {
                  tabs.current[p] = el;
                }}
                type="button"
                role="tab"
                id={`pestana-${p}`}
                aria-selected={actual}
                aria-controls={`panel-${p}`}
                tabIndex={actual ? 0 : -1}
                onClick={() => setPestana(p)}
                className={clasePestana(actual)}
              >
                {ETIQUETA_PESTANA_EDITOR[p]}
                {porPestana[p] > 0 ? (
                  <span className="rounded-full bg-error px-1.5 text-xs font-semibold text-white">
                    {porPestana[p]}
                    <span className="sr-only"> {porPestana[p] === 1 ? "error" : "errores"}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`panel-${pestana}`} aria-labelledby={`pestana-${pestana}`} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario">
          {/* Una versión publicada o retirada se ve con los controles deshabilitados: está congelada. */}
          <fieldset disabled={soloLectura} className="min-w-0 border-0 p-0">
            <legend className="sr-only">{ETIQUETA_PESTANA_EDITOR[pestana]}</legend>
            {pestana === "general" ? <PestanaGeneral nombre={nombre} ponerNombre={setNombre} /> : null}
            {pestana === "personas" ? <PestanaPersonas /> : null}
            {pestana === "pasos" ? <PestanaPasos abiertos={abiertos} setAbiertos={setAbiertos} /> : null}
            {pestana === "documentacion" ? <PestanaDocumentacion /> : null}
            {pestana === "conceptos" ? <PestanaConceptos /> : null}
            {pestana === "campos_extra" ? <PestanaCamposExtra /> : null}
          </fieldset>
          {/* La vista previa se puede mirar también en una versión publicada (elegir el cementerio no edita nada). */}
          {pestana === "vista_previa" ? <PestanaVistaPrevia /> : null}
        </div>

        {dialogo === "publicar" ? (
          <DialogoPublicar
            datos={datos}
            pendiente={accion.pendiente}
            error={accion.error}
            onCerrar={() => setDialogo(null)}
            onPublicar={(notas) =>
              accion.enviar(
                () => accionPublicar({ codigo: datos.codigo, version: datos.version, huella, notas, ...contenido() }),
                () => setDialogo(null),
              )
            }
            onErroresDeValidacion={(lista) => {
              setErrores(lista);
              setDialogo(null);
            }}
          />
        ) : null}
        {dialogo === "descartar" ? (
          <DialogoConfirmar
            titulo={`Descartar el borrador ${datos.codigo} v${datos.version}`}
            textoBoton="Descartar"
            peligro
            pendiente={accion.pendiente}
            error={accion.error}
            recargar={RUTA_PLANTILLAS}
            onCerrar={() => setDialogo(null)}
            onConfirmar={() => accion.enviar(() => accionDescartar({ codigo: datos.codigo, version: datos.version }))}
          >
            <p>Se borra el borrador con todos sus cambios. La versión publicada (si hay) no cambia.</p>
          </DialogoConfirmar>
        ) : null}
      </div>
    </ProveedorEditor>
  );
}

/**
 * "Publicar": pide las notas de cambio (quedan en la versión y en la
 * auditoría). Si la validación falla, cierra y deja los errores marcados en
 * cada pestaña.
 */
function DialogoPublicar({
  datos,
  pendiente,
  error,
  onCerrar,
  onPublicar,
  onErroresDeValidacion,
}: {
  datos: DatosEditor;
  pendiente: boolean;
  error: EstadoError | null;
  onCerrar: () => void;
  onPublicar: (notas: string) => void;
  onErroresDeValidacion: (errores: ErrorCampo[]) => void;
}) {
  const [notas, setNotas] = useState("");
  const [local, setLocal] = useState<EstadoError | null>(null);
  const enviado = useRef(false);
  useEffect(() => {
    // Un rechazo de "Publicar" con errores por campo es el de la validación: se muestran en las pestañas.
    if (enviado.current && error && error.codigo === "validacion" && error.errores.length > 0) onErroresDeValidacion(error.errores);
  }, [error, onErroresDeValidacion]);
  const mostrado = local ?? (error && !(error.codigo === "validacion" && error.errores.length > 0) ? error : null);
  const erroresNotas = erroresDe(mostrado, "motivo");
  const anterior = datos.version > 1 ? `La versión publicada hasta ahora pasa a retirada; sus expedientes en curso siguen con ella.` : null;
  return (
    <Dialogo titulo={`Publicar ${datos.codigo} v${datos.version}`} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (notas.trim().length < LARGO_MINIMO_MOTIVO) {
            setLocal({ ok: false, codigo: "motivo_requerido", mensaje: "Faltan las notas de cambio", errores: [{ ruta: "motivo", mensaje: `Escribí qué cambia (${LARGO_MINIMO_MOTIVO} caracteres o más)` }] });
            return;
          }
          setLocal(null);
          enviado.current = true;
          onPublicar(notas);
        }}
      >
        <div className="space-y-1 text-sm text-texto">
          <p>Se guarda lo que está en pantalla, se valida y, si pasa, las altas nuevas usan esta versión desde ahora. Una versión publicada no se modifica.</p>
          {anterior ? <p>{anterior}</p> : null}
        </div>
        <Campo ruta="motivo" etiqueta="Notas de cambio" obligatorio errores={erroresNotas} ayuda="Qué cambia respecto de la versión anterior">
          <textarea
            {...atributosCampo("motivo", erroresNotas, "campo-motivo-ayuda")}
            rows={4}
            maxLength={4000}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            data-autofocus
            className={CLASE_CONTROL}
          />
        </Campo>
        {mostrado ? <AvisoError error={mostrado} recargar={rutaVersionPlantilla(datos.codigo, datos.version)} yaMostradas={["motivo"]} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            {pendiente ? "Publicando…" : "Publicar"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
