"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Ban, CheckCheck, FilePlus2, MapPin, MessageSquarePlus, RotateCcw, Unlock, type LucideIcon } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_ADVERTENCIA, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_BOTON_SECUNDARIO_PELIGRO, CLASE_CONTROL } from "@/components/formulario";
import type { EstadoError } from "@/lib/presentacion/errores";
import { botonesEstado, LARGO_MAXIMO_UBICACION, textoUbicacion, type AccionEstado } from "@/lib/presentacion/estados";
import { itemsFaltan, nuevoComandoId, tituloFaltan } from "@/lib/presentacion/flujo";
import { accionEstado, accionNota, accionReiniciar, accionVinculado } from "../../acciones";
import { useAccesoFaltante, useFlujo } from "./estado";
import { CampoFecha, erroresDe, ListaFaltan, Motivo, motivoCorto, Observacion, Pie, RUTAS_EN_CAMPO, useEnvio, useFechaEfectiva } from "./piezas";

/**
 * Semana 4 en la ficha: los cambios de estado (3.1), reiniciar con otra
 * plantilla (2.13(a)), "archivar y abrir vinculado" (la caducidad) y la nota
 * libre. Cada diálogo genera su `comandoId` al abrirse y manda la
 * `versionVista`; qué botón aparece lo dice `ficha.acciones` y las reglas las
 * controla el dominio.
 */

const ICONO: Record<AccionEstado, LucideIcon> = {
  concluir: CheckCheck,
  archivar: Archive,
  archivarSinConcluir: Archive,
  vinculado: FilePlus2,
  desarchivar: ArchiveRestore,
  anular: Ban,
  reabrir: Unlock,
  ubicacionArchivo: MapPin,
  reiniciar: RotateCcw,
  nota: MessageSquarePlus,
};

/** Los botones de estado de la ficha (debajo de Dar pase y Devolver). */
export function BarraEstado() {
  const { datos, abrir } = useFlujo();
  const botones = botonesEstado(datos.permisos, { faltanConcluir: datos.concluir.faltan.length, hayPlantillas: datos.plantillas.length > 0 });
  if (botones.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Estado del expediente">
      {botones.map((b) => {
        const Icono = ICONO[b.accion];
        const ambar = b.accion === "concluir" && !b.principal;
        return (
          <button
            key={b.accion}
            type="button"
            aria-haspopup="dialog"
            onClick={() => abrir({ tipo: "estado", accion: b.accion })}
            className={
              b.principal
                ? CLASE_BOTON_PRIMARIO
                : ambar
                  ? CLASE_BOTON_ADVERTENCIA
                  : b.accion === "anular"
                    ? CLASE_BOTON_SECUNDARIO_PELIGRO
                    : CLASE_BOTON_SECUNDARIO
            }
          >
            <Icono className="h-4 w-4" aria-hidden="true" />
            {b.etiqueta}
          </button>
        );
      })}
    </div>
  );
}

export function DialogoEstado({ accion }: { accion: AccionEstado }) {
  switch (accion) {
    case "concluir":
      return <DialogoConcluir />;
    case "archivar":
      return <DialogoArchivar />;
    case "archivarSinConcluir":
      return <DialogoArchivarSinConcluir />;
    case "vinculado":
      return <DialogoPlantillaNueva modo="vinculado" />;
    case "reiniciar":
      return <DialogoPlantillaNueva modo="reiniciar" />;
    case "desarchivar":
    case "anular":
    case "reabrir":
      return <DialogoConMotivo accion={accion} />;
    case "ubicacionArchivo":
      return <DialogoUbicacion />;
    case "nota":
      return <DialogoNota />;
  }
}

/** La caja o el estante del archivo. */
function CampoUbicacion({ valor, poner, error, autoFocus = false }: { valor: string; poner: (v: string) => void; error: EstadoError | null; autoFocus?: boolean }) {
  const errores = erroresDe(error, "ubicacionArchivo");
  return (
    <Campo ruta="ubicacionArchivo" etiqueta="Ubicación en el archivo (caja o estante)" obligatorio errores={errores} ayuda="Por ejemplo: Caja 12, estante B">
      <input
        {...atributosCampo("ubicacionArchivo", errores, "campo-ubicacionArchivo-ayuda")}
        type="text"
        maxLength={LARGO_MAXIMO_UBICACION}
        value={valor}
        onChange={(e) => poner(e.target.value)}
        data-autofocus={autoFocus ? true : undefined}
        className={CLASE_CONTROL}
      />
    </Campo>
  );
}

const RUTAS = [...RUTAS_EN_CAMPO, "ubicacionArchivo", "plantillaId", "texto"];

/** Si falta la ubicación, el error se muestra sin ir al servidor (el servidor lo controla igual). */
function ubicacionVacia(ubicacion: string): EstadoError | null {
  if (ubicacion.trim() !== "") return null;
  return { ok: false, codigo: "validacion", mensaje: "Falta la ubicación en el archivo", errores: [{ ruta: "ubicacionArchivo", mensaje: "Indicá la caja o el estante" }] };
}

// ---------------------------------------------------------------------------
// Concluir (con "Faltan N", como el pase)
// ---------------------------------------------------------------------------

function DialogoConcluir() {
  const { datos, cerrar } = useFlujo();
  const acceso = useAccesoFaltante("concluir");
  const faltan = itemsFaltan(datos.concluir.faltan, datos.permisos, datos.rutaEditar);
  if (faltan.length > 0) {
    return (
      <Dialogo titulo={tituloFaltan(faltan.length).replace("para avanzar", "para concluir")} descripcion={`Para concluir ${datos.numero} falta:`} onCerrar={cerrar}>
        <div className="space-y-4">
          <ListaFaltan items={faltan} onAcceso={acceso} />
          <div className="flex justify-end border-t border-borde pt-3">
            <button type="button" onClick={cerrar} className={CLASE_BOTON_SECUNDARIO} data-autofocus>
              Cerrar
            </button>
          </div>
        </div>
      </Dialogo>
    );
  }
  return <FormularioConcluir />;
}

function FormularioConcluir() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [observacion, setObservacion] = useState("");
  const fecha = useFechaEfectiva();
  const { pendiente, error, enviar } = useEnvio();
  return (
    <Dialogo titulo="Concluir" descripcion={`${datos.numero} · ${datos.paso.orden}. ${datos.paso.nombre}`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(() => accionEstado({ accion: "concluir", numero: datos.numero, versionVista: version, comandoId, fechaEfectiva: fecha.valor, observacion }), hecho);
        }}
      >
        <p className="text-sm text-texto">El trámite terminó. Después se archiva con la caja o el estante.</p>
        <Observacion valor={observacion} poner={setObservacion} error={error} />
        <CampoFecha fecha={fecha} error={error} ayuda="Cuándo terminó, si no fue recién (hasta 30 días atrás)." />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto="Concluir" textoPendiente="Concluyendo…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Archivar
// ---------------------------------------------------------------------------

function DialogoArchivar() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [ubicacion, setUbicacion] = useState("");
  const [observacion, setObservacion] = useState("");
  const fecha = useFechaEfectiva();
  const { pendiente, error, setError, enviar } = useEnvio();
  return (
    <Dialogo titulo="Archivar" descripcion={`${datos.numero} · concluido`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const falta = ubicacionVacia(ubicacion);
          if (falta) return setError(falta);
          enviar(
            () => accionEstado({ accion: "archivar", numero: datos.numero, versionVista: version, comandoId, ubicacionArchivo: ubicacion, fechaEfectiva: fecha.valor, observacion }),
            hecho,
          );
        }}
      >
        <CampoUbicacion valor={ubicacion} poner={setUbicacion} error={error} autoFocus />
        <Observacion valor={observacion} poner={setObservacion} error={error} />
        <CampoFecha fecha={fecha} error={error} />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto="Archivar" textoPendiente="Archivando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

/** Desde un paso externo, el regreso del papel: va a la custodia, con la fecha en que volvió. */
function AvisoRegreso() {
  const { datos } = useFlujo();
  if (!datos.paso.externo) return null;
  return (
    <p className="rounded-control border border-info-borde bg-info-fondo px-3 py-2 text-sm text-info">
      El papel está en {datos.areaActual}. Al archivar se registra que volvió a <strong>{datos.areaResponsable}</strong> (la custodia): indicá abajo cuándo volvió.
    </p>
  );
}

function DialogoArchivarSinConcluir() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [motivo, setMotivo] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [observacion, setObservacion] = useState("");
  const fecha = useFechaEfectiva();
  const { pendiente, error, setError, enviar } = useEnvio();
  return (
    <Dialogo titulo="Archivar sin concluir" descripcion={`${datos.numero} · ${datos.paso.orden}. ${datos.paso.nombre}`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const falta = motivoCorto(motivo) ?? ubicacionVacia(ubicacion);
          if (falta) return setError(falta);
          enviar(
            () =>
              accionEstado({
                accion: "archivar_sin_concluir",
                numero: datos.numero,
                versionVista: version,
                comandoId,
                motivo,
                ubicacionArchivo: ubicacion,
                fechaEfectiva: fecha.valor,
                observacion,
              }),
            hecho,
          );
        }}
      >
        <p className="text-sm text-texto">El trámite no sigue (por ejemplo, el concesionario desistió). Queda archivado y se puede desarchivar con motivo.</p>
        <AvisoRegreso />
        <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="Por qué se archiva sin terminar (10 caracteres o más). Queda en el historial." autoFocus />
        <CampoUbicacion valor={ubicacion} poner={setUbicacion} error={error} />
        <Observacion valor={observacion} poner={setObservacion} error={error} />
        <CampoFecha fecha={fecha} error={error} ayuda={datos.paso.externo ? "Cuándo volvió el papel. Si fue antes, hasta 30 días atrás." : undefined} />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto="Archivar sin concluir" textoPendiente="Archivando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Desarchivar, anular, reabrir (solo motivo)
// ---------------------------------------------------------------------------

const TEXTOS_MOTIVO = {
  desarchivar: {
    titulo: "Desarchivar",
    explicacion: "Vuelve al estado y al paso en que estaba antes de archivarse. Si estaba en trámite, el papel sale del archivo hacia ese paso.",
    boton: "Desarchivar",
    pendiente: "Desarchivando…",
  },
  anular: {
    titulo: "Anular",
    explicacion: "El expediente queda anulado: no se mueve más y no aparece en la búsqueda salvo que se pidan los anulados. Solo el administrador lo puede reabrir.",
    boton: "Anular",
    pendiente: "Anulando…",
  },
  reabrir: {
    titulo: "Reabrir",
    explicacion: "Vuelve al estado que tenía antes de anularse.",
    boton: "Reabrir",
    pendiente: "Reabriendo…",
  },
} as const;

function DialogoConMotivo({ accion }: { accion: "desarchivar" | "anular" | "reabrir" }) {
  const { datos, version, cerrar, hecho } = useFlujo();
  const t = TEXTOS_MOTIVO[accion];
  const [comandoId] = useState(nuevoComandoId);
  const [motivo, setMotivo] = useState("");
  const { pendiente, error, setError, enviar } = useEnvio();
  return (
    <Dialogo titulo={t.titulo} descripcion={datos.numero} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const corto = motivoCorto(motivo);
          if (corto) return setError(corto);
          enviar(() => accionEstado({ accion, numero: datos.numero, versionVista: version, comandoId, motivo }), hecho);
        }}
      >
        <p className="text-sm text-texto">{t.explicacion}</p>
        {accion === "desarchivar" && datos.ubicacionArchivo ? <p className="text-sm text-texto-secundario">Hoy está en: {textoUbicacion(datos.ubicacionArchivo)}.</p> : null}
        <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="10 caracteres o más. Queda en el historial." autoFocus />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto={t.boton} textoPendiente={t.pendiente} onCancelar={cerrar} peligro={accion === "anular"} />
      </form>
    </Dialogo>
  );
}

function DialogoUbicacion() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [ubicacion, setUbicacion] = useState(datos.ubicacionArchivo ?? "");
  const [motivo, setMotivo] = useState("");
  const { pendiente, error, setError, enviar } = useEnvio();
  return (
    <Dialogo titulo="Cambiar ubicación de archivo" descripcion={`${datos.numero} · hoy: ${textoUbicacion(datos.ubicacionArchivo)}`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const falta = ubicacionVacia(ubicacion);
          if (falta) return setError(falta);
          enviar(() => accionEstado({ accion: "ubicacion_archivo", numero: datos.numero, versionVista: version, comandoId, ubicacionArchivo: ubicacion, motivo }), hecho);
        }}
      >
        <CampoUbicacion valor={ubicacion} poner={setUbicacion} error={error} autoFocus />
        <Observacion valor={motivo} poner={setMotivo} error={error} etiqueta="Motivo (opcional)" />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto="Guardar" textoPendiente="Guardando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Reiniciar con otra plantilla y archivar y abrir vinculado
// ---------------------------------------------------------------------------

function DialogoPlantillaNueva({ modo }: { modo: "reiniciar" | "vinculado" }) {
  const { datos, version, cerrar } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [plantilla, setPlantilla] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [observacion, setObservacion] = useState("");
  const fecha = useFechaEfectiva();
  const [error, setError] = useState<EstadoError | null>(null);
  const [pendiente, iniciar] = useTransition();
  const erroresPlantilla = erroresDe(error, "plantillaId");
  const tipos = [...new Set(datos.plantillas.map((p) => p.tipoTramite))];
  const reiniciar = modo === "reiniciar";

  return (
    <Dialogo
      titulo={reiniciar ? "Reiniciar con otra plantilla" : "Archivar y abrir vinculado"}
      descripcion={`${datos.numero} · ${datos.paso.orden}. ${datos.paso.nombre}`}
      onCerrar={cerrar}
      ocupado={pendiente}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (plantilla === "") {
            return setError({ ok: false, codigo: "validacion", mensaje: "Falta la plantilla", errores: [{ ruta: "plantillaId", mensaje: "Elegí el trámite nuevo" }] });
          }
          const falta = motivoCorto(motivo) ?? (reiniciar ? null : ubicacionVacia(ubicacion));
          if (falta) return setError(falta);
          setError(null);
          iniciar(async () => {
            // Si sale bien, la acción navega (al alta precargada o a la ficha del nuevo) y no vuelve.
            const r = reiniciar
              ? await accionReiniciar({ numero: datos.numero, versionVista: version, comandoId, motivo, plantillaId: Number(plantilla) })
              : await accionVinculado({
                  numero: datos.numero,
                  versionVista: version,
                  comandoId,
                  motivo,
                  plantillaId: Number(plantilla),
                  ubicacionArchivo: ubicacion,
                  fechaEfectiva: fecha.valor,
                  observacion,
                });
            if (r && !r.ok) setError(r);
          });
        }}
      >
        <p className="text-sm text-texto">
          {reiniciar
            ? "Este expediente se anula (queda la constancia) y se abre el alta del trámite nuevo con los datos, las personas, la ubicación, el padrón y el N° municipal precargados. Las dos fichas quedan enlazadas."
            : "Para la caducidad: este expediente se archiva sin concluir (no se anula) y se abre otro, del trámite que elijas, con sus datos y enlazado a este. Las dos cosas van juntas: si el alta no sale, no se archiva."}
        </p>
        {reiniciar ? null : <AvisoRegreso />}
        <Campo ruta="plantillaId" etiqueta="Trámite nuevo" obligatorio errores={erroresPlantilla}>
          <select {...atributosCampo("plantillaId", erroresPlantilla)} value={plantilla} onChange={(e) => setPlantilla(e.target.value)} className={CLASE_CONTROL} data-autofocus>
            <option value="">Elegí…</option>
            {tipos.map((t) => (
              <optgroup key={t} label={t}>
                {datos.plantillas
                  .filter((p) => p.tipoTramite === t)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} (v{p.version})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Campo>
        <Motivo valor={motivo} poner={setMotivo} error={error} ayuda="10 caracteres o más. Queda en el historial de los dos expedientes." />
        {reiniciar ? null : (
          <>
            <CampoUbicacion valor={ubicacion} poner={setUbicacion} error={error} />
            <Observacion valor={observacion} poner={setObservacion} error={error} />
            <CampoFecha fecha={fecha} error={error} ayuda={datos.paso.externo ? "Cuándo volvió el papel. Si fue antes, hasta 30 días atrás." : undefined} />
          </>
        )}
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
          <button type="button" onClick={cerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            {pendiente ? "Guardando…" : reiniciar ? "Anular y abrir el alta" : "Archivar y abrir el nuevo"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// Nota
// ---------------------------------------------------------------------------

function DialogoNota() {
  const { datos, version, cerrar, hecho } = useFlujo();
  const [comandoId] = useState(nuevoComandoId);
  const [texto, setTexto] = useState("");
  const fecha = useFechaEfectiva();
  const { pendiente, error, setError, enviar } = useEnvio();
  const errores = erroresDe(error, "texto");
  return (
    <Dialogo titulo="Agregar nota" descripcion={`${datos.numero} · queda en el historial`} onCerrar={cerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim() === "") return setError({ ok: false, codigo: "validacion", mensaje: "Falta la nota", errores: [{ ruta: "texto", mensaje: "Escribí la nota" }] });
          enviar(() => accionNota({ numero: datos.numero, versionVista: version, comandoId, texto, fechaEfectiva: fecha.valor }), hecho);
        }}
      >
        <Campo ruta="texto" etiqueta="Nota" obligatorio errores={errores} ayuda="Por ejemplo, una llamada al concesionario. No anotes teléfonos ni correos: van en los datos de la persona.">
          <textarea {...atributosCampo("texto", errores, "campo-texto-ayuda")} rows={4} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} data-autofocus className={CLASE_CONTROL} />
        </Campo>
        <CampoFecha fecha={fecha} error={error} />
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={RUTAS} /> : null}
        <Pie pendiente={pendiente} texto="Agregar nota" textoPendiente="Guardando…" onCancelar={cerrar} />
      </form>
    </Dialogo>
  );
}
