"use client";

import { useState } from "react";
import Link from "next/link";
import { FilePen, FilePlus2, PackageX } from "lucide-react";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import { RUTA_PLANTILLAS, rutaVersionPlantilla } from "@/lib/presentacion/rutas-admin";
import { normalizarClave } from "@/lib/presentacion/editor-plantilla";
import { accionEditarPlantilla, accionNuevaPlantilla, accionRetirar } from "../acciones";
import { AvisoHecho, DialogoConfirmar, erroresDe, useAccion } from "../piezas";

/** "Nueva plantilla": código, tipo de trámite y nombre; abre el editor del borrador v1. */
export function BotonNuevaPlantilla({ tiposTramite }: { tiposTramite: ReadonlyArray<{ id: number; nombre: string }> }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setAbierto(true)} className={CLASE_BOTON_PRIMARIO}>
        <FilePlus2 className="h-4 w-4" aria-hidden="true" />
        Nueva plantilla
      </button>
      {abierto ? <DialogoNueva tiposTramite={tiposTramite} onCerrar={() => setAbierto(false)} /> : null}
    </>
  );
}

function DialogoNueva({ tiposTramite, onCerrar }: { tiposTramite: ReadonlyArray<{ id: number; nombre: string }>; onCerrar: () => void }) {
  const { pendiente, error, enviar } = useAccion();
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<number | "">(tiposTramite[0]?.id ?? "");
  return (
    <Dialogo titulo="Nueva plantilla" descripcion="Nace como borrador v1: se completa en el editor y se publica cuando pasa la validación." onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(() => accionNuevaPlantilla({ codigo, nombre, tipoTramiteId: tipo === "" ? 0 : tipo }));
        }}
      >
        <Campo ruta="codigo" etiqueta="Código" obligatorio errores={erroresDe(error, "codigo")} ayuda="Mayúsculas, números y _ (ej. TRANSFERENCIA). No se cambia después.">
          <input
            {...atributosCampo("codigo", erroresDe(error, "codigo"), "campo-codigo-ayuda")}
            type="text"
            value={codigo}
            maxLength={60}
            onChange={(e) => setCodigo(e.target.value)}
            onBlur={() => setCodigo(normalizarClave(codigo, false))}
            className={`${CLASE_CONTROL} font-mono`}
            data-autofocus
          />
        </Campo>
        <Campo ruta="tipoTramiteId" etiqueta="Tipo de trámite" obligatorio errores={erroresDe(error, "tipoTramiteId")} ayuda="Si no está, se agrega en Catálogos.">
          <select {...atributosCampo("tipoTramiteId", erroresDe(error, "tipoTramiteId"), "campo-tipoTramiteId-ayuda")} value={tipo} onChange={(e) => setTipo(e.target.value === "" ? "" : Number(e.target.value))} className={CLASE_CONTROL}>
            {tiposTramite.length === 0 ? <option value="">No hay tipos de trámite activos</option> : null}
            {tiposTramite.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo ruta="nombre" etiqueta="Nombre" obligatorio errores={erroresDe(error, "nombre")}>
          <input {...atributosCampo("nombre", erroresDe(error, "nombre"))} type="text" value={nombre} maxLength={200} onChange={(e) => setNombre(e.target.value)} className={CLASE_CONTROL} />
        </Campo>
        {error ? <AvisoError error={error} recargar={RUTA_PLANTILLAS} yaMostradas={["codigo", "tipoTramiteId", "nombre"]} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={onCerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
            {pendiente ? "Creando…" : "Crear borrador"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Editar (o seguir el borrador) y Retirar, en la fila del catálogo. */
export function AccionesPlantilla({ codigo, publicada, borrador }: { codigo: string; publicada: { version: number; enCurso: number } | null; borrador: number | null }) {
  const { pendiente, error, enviar } = useAccion();
  const retiro = useAccion();
  const [retirando, setRetirando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1.5">
      {borrador !== null ? (
        <Link href={rutaVersionPlantilla(codigo, borrador)} className={`${CLASE_BOTON_SECUNDARIO} py-1`}>
          <FilePen className="h-4 w-4" aria-hidden="true" />
          Seguir el borrador<span className="sr-only"> de {codigo}</span>
        </Link>
      ) : (
        <button type="button" disabled={pendiente} onClick={() => enviar(() => accionEditarPlantilla(codigo))} className={`${CLASE_BOTON_SECUNDARIO} py-1`}>
          <FilePen className="h-4 w-4" aria-hidden="true" />
          {pendiente ? "Creando borrador…" : "Editar"}
          <span className="sr-only"> {codigo}</span>
        </button>
      )}
      {publicada ? (
        <button type="button" aria-haspopup="dialog" onClick={() => setRetirando(true)} className={`${CLASE_BOTON_SECUNDARIO} py-1`}>
          <PackageX className="h-4 w-4" aria-hidden="true" />
          Retirar<span className="sr-only"> {codigo} v{publicada.version}</span>
        </button>
      ) : null}
      {error ? <AvisoError error={error} recargar={RUTA_PLANTILLAS} /> : null}
      <AvisoHecho mensaje={hecho} />
      {retirando && publicada ? (
        <DialogoConfirmar
          titulo={`Retirar ${codigo} v${publicada.version}`}
          textoBoton="Retirar"
          motivo="obligatorio"
          pendiente={retiro.pendiente}
          error={retiro.error}
          recargar={RUTA_PLANTILLAS}
          onCerrar={() => setRetirando(false)}
          onConfirmar={(motivo) =>
            retiro.enviar(
              () => accionRetirar({ codigo, version: publicada.version, motivo }),
              (r) => {
                setRetirando(false);
                setHecho(r.mensaje);
              },
            )
          }
        >
          <p>El trámite deja de ofrecerse en el alta hasta que se publique otra versión.</p>
          <p className="mt-1">
            {publicada.enCurso === 0
              ? "No tiene expedientes en curso."
              : `Sus ${publicada.enCurso === 1 ? "1 expediente en curso sigue" : `${publicada.enCurso} expedientes en curso siguen`} con esta versión hasta terminar.`}
          </p>
        </DialogoConfirmar>
      ) : null}
    </div>
  );
}
