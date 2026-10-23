"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, LockOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_COMPACTO, CLASE_BOTON_COMPACTO_PELIGRO, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL, CLASE_FOCO } from "@/components/formulario";
import { AMBITOS_FERIADO, type Feriado } from "@/lib/dominio/expedientes/feriados";
import { formatearFecha } from "@/lib/fechas";
import { accionFeriado } from "../acciones";
import { AvisoHecho, DialogoConfirmar, erroresDe, useAccion } from "../piezas";

/**
 * Pestaña Feriados de `/admin/catalogos` (2.9 y 3.6), sobre la API de
 * feriados de la semana 4: el año elegido, sus feriados (agregar, modificar,
 * quitar) y "Cerrar año" / "Reabrir año" (este último con motivo: los
 * vencimientos del año vuelven a ser provisorios). Los días hábiles saltean
 * todos los feriados, de cualquier ámbito.
 */

const AMBITO_TEXTO: Record<string, string> = { nacional: "Nacional", provincial: "Provincial", municipal: "Municipal", asueto: "Asueto", feria: "Feria" };

export function PestanaFeriados({
  anio,
  anios,
  cerrado,
  cerradoTexto,
  feriados,
}: {
  anio: number;
  anios: ReadonlyArray<{ anio: number; cerrado: boolean }>;
  cerrado: boolean;
  cerradoTexto: string | null;
  feriados: readonly Feriado[];
}) {
  const [editando, setEditando] = useState<Feriado | "nuevo" | null>(null);
  const [confirmar, setConfirmar] = useState<{ tipo: "cerrar" | "reabrir" } | { tipo: "quitar"; feriado: Feriado } | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const accion = useAccion();
  const terminar = (r: { mensaje: string }) => {
    setConfirmar(null);
    setEditando(null);
    setHecho(r.mensaje);
  };
  const ruta = `/admin/catalogos?pestana=feriados&anio=${anio}`;

  return (
    <div className="space-y-3">
      <nav aria-label="Años de feriados" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-texto-secundario">Año:</span>
        {anios.map((a) => (
          <Link
            key={a.anio}
            href={`/admin/catalogos?pestana=feriados&anio=${a.anio}`}
            aria-current={a.anio === anio ? "page" : undefined}
            className={`inline-flex min-h-8 items-center rounded-control border px-2.5 font-medium tabular-nums transition-colors duration-150 ${CLASE_FOCO} ${a.anio === anio ? "border-institucional bg-institucional text-white" : "border-borde-control bg-white text-texto hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro"}`}
          >
            {a.anio}
            {a.cerrado ? <span className="sr-only"> (cerrado)</span> : <span className="sr-only"> (sin cerrar)</span>}
            {a.cerrado ? <Lock className="ml-1 inline h-3 w-3" aria-hidden="true" /> : null}
          </Link>
        ))}
      </nav>

      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2 text-sm ${cerrado ? "border-exito-borde bg-exito-fondo text-exito" : "border-advertencia-borde bg-advertencia-fondo text-advertencia"}`}>
        <p>
          {cerrado
            ? `${anio} está cerrado${cerradoTexto ? ` (${cerradoTexto})` : ""}: sus vencimientos son definitivos. Si se decreta un asueto, se agrega igual y el vencimiento se corrige solo.`
            : `${anio} no está cerrado: los vencimientos que lo tocan se muestran como provisorios. Cerralo cuando estén cargados todos sus feriados.`}
        </p>
        {cerrado ? (
          <button type="button" aria-haspopup="dialog" onClick={() => setConfirmar({ tipo: "reabrir" })} className={CLASE_BOTON_SECUNDARIO}>
            <LockOpen className="h-4 w-4" aria-hidden="true" />
            Reabrir {anio}
          </button>
        ) : (
          <button type="button" aria-haspopup="dialog" onClick={() => setConfirmar({ tipo: "cerrar" })} className={CLASE_BOTON_PRIMARIO}>
            <Lock className="h-4 w-4" aria-hidden="true" />
            Cerrar {anio}
          </button>
        )}
      </div>

      <AvisoHecho mensaje={hecho} />

      <div className="flex justify-end">
        <button type="button" aria-haspopup="dialog" onClick={() => setEditando("nuevo")} className={CLASE_BOTON_SECUNDARIO}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Agregar feriado
        </button>
      </div>
      <div className="tarjeta relative @container overflow-x-auto">
        <table className="tabla-datos tabla-apilable">
          <caption className="sr-only">Feriados de {anio}</caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">Fecha</th>
              <th scope="col" className="font-medium">Descripción</th>
              <th scope="col" className="font-medium">Ámbito</th>
              <th scope="col" className="font-medium">Norma</th>
              <th scope="col" className="font-medium"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {feriados.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-texto-secundario">
                  No hay feriados cargados para {anio}.
                </td>
              </tr>
            ) : null}
            {feriados.map((f) => (
              <tr key={f.fecha}>
                <td data-etiqueta="Fecha" className="whitespace-nowrap">{formatearFecha(f.fecha)}</td>
                <th scope="row" className="font-normal">{f.descripcion}</th>
                <td data-etiqueta="Ámbito">{AMBITO_TEXTO[f.ambito] ?? f.ambito}</td>
                <td data-etiqueta="Norma" className="text-texto-secundario">{f.norma ?? "—"}</td>
                <td>
                  <div className="flex gap-1">
                    <button type="button" aria-haspopup="dialog" onClick={() => setEditando(f)} className={CLASE_BOTON_COMPACTO}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Modificar el feriado del {formatearFecha(f.fecha)}</span>
                    </button>
                    <button type="button" aria-haspopup="dialog" onClick={() => setConfirmar({ tipo: "quitar", feriado: f })} className={CLASE_BOTON_COMPACTO_PELIGRO}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Quitar el feriado del {formatearFecha(f.fecha)}</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando ? <DialogoFeriado anio={anio} feriado={editando === "nuevo" ? null : editando} onCerrar={() => setEditando(null)} onHecho={terminar} /> : null}
      {confirmar?.tipo === "cerrar" ? (
        <DialogoConfirmar
          titulo={`Cerrar ${anio}`}
          textoBoton={`Cerrar ${anio}`}
          motivo="opcional"
          pendiente={accion.pendiente}
          error={accion.error}
          recargar={ruta}
          onCerrar={() => setConfirmar(null)}
          onConfirmar={(motivo) => accion.enviar(() => accionFeriado({ accion: "cerrar", anio, motivo }), terminar)}
        >
          <p>
            Confirmás que están cargados todos los feriados de {anio} ({feriados.length === 1 ? "1 cargado" : `${feriados.length} cargados`}). Desde ahí, los vencimientos que caen en
            {" "}{anio} dejan de ser provisorios.
          </p>
        </DialogoConfirmar>
      ) : null}
      {confirmar?.tipo === "reabrir" ? (
        <DialogoConfirmar
          titulo={`Reabrir ${anio}`}
          textoBoton={`Reabrir ${anio}`}
          motivo="obligatorio"
          pendiente={accion.pendiente}
          error={accion.error}
          recargar={ruta}
          onCerrar={() => setConfirmar(null)}
          onConfirmar={(motivo) => accion.enviar(() => accionFeriado({ accion: "reabrir", anio, motivo }), terminar)}
        >
          <p>Los vencimientos que caen en {anio} vuelven a mostrarse como provisorios hasta que se cierre de nuevo.</p>
        </DialogoConfirmar>
      ) : null}
      {confirmar?.tipo === "quitar" ? (
        <DialogoConfirmar
          titulo={`Quitar el feriado del ${formatearFecha(confirmar.feriado.fecha)}`}
          textoBoton="Quitar"
          peligro
          motivo="opcional"
          pendiente={accion.pendiente}
          error={accion.error}
          recargar={ruta}
          onCerrar={() => setConfirmar(null)}
          onConfirmar={(motivo) => accion.enviar(() => accionFeriado({ accion: "quitar", fecha: confirmar.feriado.fecha, motivo }), terminar)}
        >
          <p>
            {confirmar.feriado.descripcion}. Ese día pasa a ser hábil y los vencimientos que lo saltaban se recalculan.
          </p>
        </DialogoConfirmar>
      ) : null}
    </div>
  );
}

function DialogoFeriado({ anio, feriado, onCerrar, onHecho }: { anio: number; feriado: Feriado | null; onCerrar: () => void; onHecho: (r: { mensaje: string }) => void }) {
  const { pendiente, error, enviar } = useAccion();
  const [fecha, setFecha] = useState(feriado?.fecha ?? "");
  const [descripcion, setDescripcion] = useState(feriado?.descripcion ?? "");
  const [ambito, setAmbito] = useState<string>(feriado?.ambito ?? "nacional");
  const [norma, setNorma] = useState(feriado?.norma ?? "");
  const [motivo, setMotivo] = useState("");
  return (
    <Dialogo titulo={feriado ? `Modificar el feriado del ${formatearFecha(feriado.fecha)}` : `Agregar un feriado`} onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(() => accionFeriado({ accion: "guardar", fecha, descripcion, ambito, norma, motivo }), onHecho);
        }}
      >
        <Campo ruta="fecha" etiqueta="Fecha" obligatorio errores={erroresDe(error, "fecha")} ayuda={feriado ? "La fecha no se cambia: para moverlo, quitalo y agregá otro" : undefined}>
          <input
            {...atributosCampo("fecha", erroresDe(error, "fecha"), feriado ? "campo-fecha-ayuda" : undefined)}
            type="date"
            readOnly={feriado !== null}
            min={`${anio - 1}-01-01`}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className={`${CLASE_CONTROL} max-w-48 read-only:bg-fondo`}
            data-autofocus={feriado ? undefined : true}
          />
        </Campo>
        <Campo ruta="descripcion" etiqueta="Descripción" obligatorio errores={erroresDe(error, "descripcion")}>
          <input {...atributosCampo("descripcion", erroresDe(error, "descripcion"))} type="text" maxLength={200} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={CLASE_CONTROL} data-autofocus={feriado ? true : undefined} />
        </Campo>
        <Campo ruta="ambito" etiqueta="Ámbito" errores={erroresDe(error, "ambito")}>
          <select {...atributosCampo("ambito", erroresDe(error, "ambito"))} value={ambito} onChange={(e) => setAmbito(e.target.value)} className={CLASE_CONTROL}>
            {AMBITOS_FERIADO.map((a) => (
              <option key={a} value={a}>
                {AMBITO_TEXTO[a]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo ruta="norma" etiqueta="Norma (opcional)" errores={erroresDe(error, "norma")} ayuda="Ley, decreto u ordenanza que lo establece">
          <input {...atributosCampo("norma", erroresDe(error, "norma"), "campo-norma-ayuda")} type="text" maxLength={200} value={norma} onChange={(e) => setNorma(e.target.value)} className={CLASE_CONTROL} />
        </Campo>
        <Campo ruta="motivo" etiqueta="Motivo (opcional)" ayuda="Queda en la auditoría">
          <input {...atributosCampo("motivo", undefined, "campo-motivo-ayuda")} type="text" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASE_CONTROL} />
        </Campo>
        {error ? <AvisoError error={error} recargar={`/admin/catalogos?pestana=feriados&anio=${anio}`} yaMostradas={["fecha", "descripcion", "ambito", "norma"]} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            {pendiente ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
