"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, PencilLine } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_COMPACTO, CLASE_CASILLA, CLASE_CONTROL, MensajeError } from "@/components/formulario";
import { hoyEnTucuman, comoDatetimeLocal } from "@/lib/fechas";
import type { EstadoError } from "@/lib/presentacion/errores";
import { menuCorreccion, type OpcionMenuCorreccion } from "@/lib/presentacion/estados";
import { nuevoComandoId } from "@/lib/presentacion/flujo";
import { accionCorreccion, accionSupresion } from "../../acciones";
import { useFlujo } from "./estado";
import { erroresDe, Motivo, motivoCorto, Pie, RUTAS_EN_CAMPO, useEnvio } from "./piezas";
import type { MovimientoCorregible } from "./tipos";

/**
 * Correcciones del historial (2.13(b)): el menú "Corregir" de cada movimiento
 * (lo que el dominio dice en `historial[i].correcciones`) y sus diálogos, y
 * la supresión de una persona (Ley 25.326, admin). Nada se borra del
 * historial: cada corrección es un movimiento nuevo con motivo, y el original
 * se muestra tachado con el enlace a su corrección.
 */


/** El menú "Corregir" de un movimiento: un botón que despliega las correcciones posibles. */
export function MenuCorregir({ movimiento }: { movimiento: MovimientoCorregible }) {
  const { abrir } = useFlujo();
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const items = menuCorreccion(movimiento, movimiento.subtarea);

  useEffect(() => {
    if (!abierto) return;
    contenedor.current?.querySelector<HTMLButtonElement>("ul button")?.focus();
  }, [abierto]);

  if (items.length === 0) return null;

  function elegir(opcion: OpcionMenuCorreccion) {
    setAbierto(false);
    abrir({ tipo: "corregir", opcion, movimiento });
  }

  return (
    <div
      ref={contenedor}
      className="relative inline-block print:hidden"
      onKeyDown={(e) => {
        if (e.key === "Escape" && abierto) {
          e.stopPropagation();
          setAbierto(false);
          boton.current?.focus();
        }
      }}
      onBlur={(e) => {
        // Se cierra cuando el foco sale del menú (Tab o un clic afuera).
        if (abierto && !e.currentTarget.contains(e.relatedTarget as Node | null)) setAbierto(false);
      }}
    >
      <button
        ref={boton}
        type="button"
        aria-expanded={abierto}
        aria-controls={`${id}-menu`}
        aria-label={`Corregir: ${movimiento.descripcion}`}
        onClick={() => setAbierto((a) => !a)}
        className={CLASE_BOTON_COMPACTO}
      >
        <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
        Corregir
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {abierto ? (
        <ul id={`${id}-menu`} className="absolute right-0 z-10 mt-1 w-64 rounded-control border border-borde bg-white py-1 shadow-elevada">
          {items.map((i) => (
            <li key={i.opcion}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => elegir(i.opcion)}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-superficie-azul focus-visible:bg-superficie-azul focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primario ${
                  i.delicada ? "text-error" : "text-texto"
                }`}
              >
                {i.etiqueta}
                {i.soloAdmin ? <span className="block text-xs text-texto-secundario">Administrador · Ley 25.326</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const TITULO: Record<OpcionMenuCorreccion, string> = {
  revertir: "Revertir",
  fecha: "Corregir la fecha",
  observacion: "Corregir la observación",
  subtarea_dato: "Corregir el dato de la subtarea",
  subtarea_destildar: "Destildar la subtarea",
  retirar_adjunto: "Retirar el adjunto",
  purgar_adjunto: "Purgar el adjunto",
};

const RUTAS = [...RUTAS_EN_CAMPO, "confirmado"];

/** Una casilla de confirmación explícita (purgar, suprimir). */
function Confirmacion({ marcado, poner, error, texto }: { marcado: boolean; poner: (v: boolean) => void; error: EstadoError | null; texto: string }) {
  const errores = erroresDe(error, "confirmado");
  return (
    <div>
      <label className="flex items-start gap-2 text-sm font-medium text-error">
        <input
          {...atributosCampo("confirmado", errores)}
          type="checkbox"
          checked={marcado}
          onChange={(e) => poner(e.target.checked)}
          className={`${CLASE_CASILLA} mt-0.5`}
        />
        {texto}
      </label>
      <MensajeError ruta="confirmado" errores={errores} />
    </div>
  );
}

function faltaConfirmar(): EstadoError {
  return { ok: false, codigo: "validacion", mensaje: "Falta confirmar", errores: [{ ruta: "confirmado", mensaje: "Marcá la casilla para confirmar" }] };
}

export function DialogoCorreccion({ opcion, movimiento: m }: { opcion: OpcionMenuCorreccion; movimiento: MovimientoCorregible }) {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [motivo, setMotivo] = useState("");
  const [precision, setPrecision] = useState<"dia" | "minuto">(m.fecha.precision);
  const [dia, setDia] = useState(m.fecha.dia);
  const [momento, setMomento] = useState(m.fecha.momento);
  const [observacion, setObservacion] = useState(m.observacion ?? "");
  const [dato, setDato] = useState(m.subtarea?.valor ?? "");
  const [confirmado, setConfirmado] = useState(false);
  const [limites] = useState(() => ({ dia: hoyEnTucuman(new Date()), momento: comoDatetimeLocal(new Date()) }));
  const { pendiente, error, setError, enviar } = useEnvio();
  const erroresFecha = erroresDe(error, "fechaEfectiva");
  const erroresObs = erroresDe(error, "observacion");
  const erroresDato = erroresDe(error, "dato");

  return (
    <Dialogo titulo={TITULO[opcion]} descripcion={m.descripcion} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const corto = motivoCorto(motivo);
          if (corto) return setError(corto);
          if (opcion === "purgar_adjunto" && !confirmado) return setError(faltaConfirmar());
          enviar(
            () =>
              accionCorreccion({
                tipo: opcion,
                numero: datos.numero,
                versionVista: version,
                comandoId,
                movimientoId: m.id,
                motivo,
                fecha: opcion === "fecha" ? (precision === "dia" ? dia : momento) : null,
                observacion: opcion === "observacion" ? observacion : null,
                clave: m.subtarea?.clave ?? null,
                dato: opcion === "subtarea_dato" ? dato : null,
                confirmado: opcion === "purgar_adjunto" ? confirmado : undefined,
              }),
            hecho,
          );
        }}
      >
        {opcion === "revertir" ? (
          <p className="text-sm text-texto">
            El expediente vuelve a como estaba antes de este movimiento. Las recepciones y notas que vinieron después se revierten con él. El movimiento queda en el historial, marcado
            como revertido.
          </p>
        ) : null}

        {opcion === "fecha" ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-texto">Fecha correcta</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(
                [
                  ["dia", "Solo el día"],
                  ["minuto", "Día y hora"],
                ] as const
              ).map(([v, etiqueta]) => (
                <label key={v} className="inline-flex items-center gap-1.5 text-sm text-texto">
                  <input type="radio" name="precision-correccion" checked={precision === v} onChange={() => setPrecision(v)} className="h-4 w-4 accent-primario" />
                  {etiqueta}
                </label>
              ))}
            </div>
            {precision === "dia" ? (
              <input
                {...atributosCampo("fechaEfectiva", erroresFecha)}
                aria-label="Día"
                type="date"
                value={dia}
                max={limites.dia}
                onChange={(e) => setDia(e.target.value)}
                data-autofocus
                className={`${CLASE_CONTROL} max-w-48`}
              />
            ) : (
              <input
                {...atributosCampo("fechaEfectiva", erroresFecha)}
                aria-label="Día y hora"
                type="datetime-local"
                value={momento}
                max={limites.momento}
                onChange={(e) => setMomento(e.target.value)}
                data-autofocus
                className={`${CLASE_CONTROL} max-w-60`}
              />
            )}
            <p className="text-xs text-texto-secundario">La fecha original queda tachada en el historial. Un pase o una recepción no pueden quedar antes del movimiento anterior ni después del siguiente.</p>
            <MensajeError ruta="fechaEfectiva" errores={erroresFecha} />
          </fieldset>
        ) : null}

        {opcion === "observacion" ? (
          <Campo ruta="observacion" etiqueta="Observación correcta" errores={erroresObs} ayuda="Vacío la borra. La original queda en el historial.">
            <textarea
              {...atributosCampo("observacion", erroresObs, "campo-observacion-ayuda")}
              rows={3}
              maxLength={2000}
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              data-autofocus
              className={CLASE_CONTROL}
            />
          </Campo>
        ) : null}

        {opcion === "subtarea_dato" && m.subtarea ? (
          <Campo ruta="dato" etiqueta={m.subtarea.dato === "fecha" ? `Fecha correcta de "${m.subtarea.nombre}"` : `Dato correcto de "${m.subtarea.nombre}"`} errores={erroresDato}>
            <input
              {...atributosCampo("dato", erroresDato)}
              type={m.subtarea.dato === "fecha" ? "date" : "text"}
              maxLength={200}
              max={m.subtarea.dato === "fecha" ? limites.dia : undefined}
              value={dato}
              onChange={(e) => setDato(e.target.value)}
              data-autofocus
              className={m.subtarea.dato === "fecha" ? `${CLASE_CONTROL} max-w-48` : CLASE_CONTROL}
            />
          </Campo>
        ) : null}

        {opcion === "subtarea_destildar" && m.subtarea ? (
          <p className="text-sm text-texto">
            &quot;{m.subtarea.nombre}&quot; es de un paso ya cerrado: queda sin tildar sin devolver el papel. Si es una subtarea obligatoria, se va a pedir de nuevo si el expediente vuelve
            a ese paso.
          </p>
        ) : null}

        {opcion === "retirar_adjunto" ? (
          <p className="text-sm text-texto">
            {m.adjunto ? <>&quot;{m.adjunto}&quot; deja de verse en la ficha. </> : "El adjunto deja de verse en la ficha. "}El archivo se conserva y el historial muestra que se retiró.
          </p>
        ) : null}

        {opcion === "purgar_adjunto" ? (
          <div className="space-y-2 rounded-control border border-error-borde bg-error-fondo px-3 py-2">
            <p className="text-sm text-error">
              Ley 25.326: el archivo{m.adjunto ? ` "${m.adjunto}"` : ""} se borra del disco y no se puede recuperar. En el historial quedan el nombre, el tamaño y la huella (sha256).
            </p>
            <Confirmacion marcado={confirmado} poner={setConfirmado} error={error} texto="Entiendo que el archivo se borra y no se recupera" />
          </div>
        ) : null}

        <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="Por qué se corrige (10 caracteres o más). Queda en el historial." autoFocus={opcion === "revertir" || opcion.endsWith("adjunto") || opcion === "subtarea_destildar"} />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto={TITULO[opcion]} textoPendiente="Guardando…" onCancelar={cerrar} peligro={opcion === "revertir" || opcion === "purgar_adjunto"} />
      </form>
    </Dialogo>
  );
}

/** Suprimir los datos de una persona (Ley 25.326): solo el admin, con motivo y confirmación explícita. */
export function DialogoSuprimir({ persona }: { persona: { id: string; texto: string } }) {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const { pendiente, error, setError, enviar } = useEnvio();
  return (
    <Dialogo titulo="Suprimir datos personales" descripcion={persona.texto} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const corto = motivoCorto(motivo);
          if (corto) return setError(corto);
          if (!confirmado) return setError(faltaConfirmar());
          enviar(() => accionSupresion({ numero: datos.numero, versionVista: version, comandoId, personaId: persona.id, motivo, confirmado }), hecho);
        }}
      >
        <div className="space-y-2 rounded-control border border-error-borde bg-error-fondo px-3 py-2">
          <p className="text-sm text-error">
            Ley 25.326 (datos de un tercero cargados por error): se borran el nombre, el documento y el contacto de esta versión de la persona. Quedan el rol y la constancia de la
            supresión. No se puede deshacer.
          </p>
          <Confirmacion marcado={confirmado} poner={setConfirmado} error={error} texto="Entiendo que los datos se borran y no se recuperan" />
        </div>
        <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="Por qué se suprimen (10 caracteres o más). Queda en el historial." autoFocus />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto="Suprimir" textoPendiente="Suprimiendo…" onCancelar={cerrar} peligro />
      </form>
    </Dialogo>
  );
}
