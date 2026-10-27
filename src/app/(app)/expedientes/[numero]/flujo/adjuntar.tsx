"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import type { EstadoError } from "@/lib/presentacion/errores";
import { formatearBytes, nuevoComandoId } from "@/lib/presentacion/flujo";
import { ACCEPT_ADJUNTO, mensajeRespuestaSubida, prepararArchivo } from "@/lib/presentacion/imagen";
import { subirDirecto, type RespuestaSubida } from "@/lib/presentacion/subida-directa";
import { dialogoDeVuelta, useFlujo } from "./estado";

/**
 * Adjuntar un archivo a un documento o suelto (sección 6, "Adjuntos"). En el
 * navegador: tipo y tamaño, y las fotos se reducen a 2000 px y se recomprimen
 * como JPEG 0,8 antes de subir. La subida es un `fetch` al Route Handler
 * `POST /api/expedientes/[numero]/adjuntos` con el archivo como cuerpo (no
 * pasa por una Server Action: su límite es 1 MB y no hace streaming).
 *
 * Con el almacén de Supabase Storage (`datos.subidaAdjuntos === "directa"`,
 * el despliegue en Vercel) la pantalla es la misma y solo cambia el
 * transporte: autorizar, subir directo a Storage y confirmar
 * (src/lib/presentacion/subida-directa.ts).
 */

/** La URL de subida con los metadatos en la query (el cuerpo es el archivo). */
export function rutaSubida(numero: string, p: { nombre: string; documento: string | null; version: number; comando: string }): string {
  const q = new URLSearchParams({ nombre: p.nombre, version: String(p.version), comando: p.comando });
  if (p.documento) q.set("documento", p.documento);
  return `/api/expedientes/${encodeURIComponent(numero)}/adjuntos?${q.toString()}`;
}

export function DialogoAdjuntar({ documento, volverA }: { documento: string | null; volverA: "pase" | "concluir" | null }) {
  const { datos, version, cerrar, hecho } = useFlujo();
  const router = useRouter();
  const [comandoId] = useState(nuevoComandoId);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<EstadoError | null>(null);
  const [etapa, setEtapa] = useState<"elegir" | "preparando" | "subiendo">("elegir");
  const [, iniciar] = useTransition();
  const ocupado = etapa !== "elegir";
  const nombreDocumento = documento ? (datos.documentos.find((d) => d.clave === documento)?.nombre ?? documento) : null;
  // El mensaje principal ya lo muestra el aviso: junto al campo, solo el detalle si es otro ("Máximo 10 MB").
  const detalle = error?.errores.filter((e) => e.ruta === "archivo" && e.mensaje !== error.mensaje).map((e) => e.mensaje) ?? [];
  const erroresArchivo = detalle.length > 0 ? detalle : undefined;

  function fallar(mensaje: string, codigo = "adjunto_invalido") {
    setError({ ok: false, codigo, mensaje, errores: [] });
    setEtapa("elegir");
  }

  async function subir(elegido: File) {
    setError(null);
    setEtapa("preparando");
    const preparado = await prepararArchivo(elegido);
    if (!preparado.ok) return fallar(preparado.mensaje);

    setEtapa("subiendo");
    let cuerpo: RespuestaSubida;
    if (datos.subidaAdjuntos === "directa") {
      // Supabase Storage (Vercel): autorizar, subir directo y confirmar.
      cuerpo = await subirDirecto(datos.numero, preparado.archivo, { documento, version, comando: comandoId });
    } else {
      let respuesta: Response;
      try {
        respuesta = await fetch(rutaSubida(datos.numero, { nombre: preparado.archivo.nombre, documento, version, comando: comandoId }), {
          method: "POST",
          body: preparado.archivo.contenido,
          headers: { "Content-Type": preparado.archivo.contenido.type || "application/octet-stream" },
        });
      } catch {
        return fallar("No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.", "red");
      }
      const json = (await respuesta.json().catch(() => null)) as RespuestaSubida | null;
      if (!json || typeof json !== "object" || !("ok" in json)) return fallar(mensajeRespuestaSubida(respuesta.status), String(respuesta.status));
      cuerpo = json;
    }
    if (!cuerpo.ok) {
      setError(cuerpo);
      setEtapa("elegir");
      return;
    }
    // El Route Handler no puede pedir el refresco como una Server Action: se pide acá.
    iniciar(() => router.refresh());
    hecho({ version: cuerpo.version, mensaje: `Se adjuntó ${cuerpo.nombre}.` }, dialogoDeVuelta(volverA));
  }

  return (
    <Dialogo titulo="Adjuntar archivo" descripcion={nombreDocumento ? `Al documento: ${nombreDocumento}` : "Adjunto suelto (sin documento)"} onCerrar={cerrar} ocupado={ocupado}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!archivo) return setError({ ok: false, codigo: "validacion", mensaje: "Elegí un archivo", errores: [] });
          void subir(archivo);
        }}
      >
        <Campo ruta="archivo" etiqueta="Archivo" obligatorio errores={erroresArchivo} ayuda="PDF, JPG o PNG de hasta 10 MB. Las fotos se achican antes de subir.">
          <input
            {...atributosCampo("archivo", erroresArchivo, "campo-archivo-ayuda")}
            type="file"
            accept={ACCEPT_ADJUNTO}
            onChange={(e) => {
              setError(null);
              setArchivo(e.target.files?.[0] ?? null);
            }}
            data-autofocus
            className={`${CLASE_CONTROL} file:mr-3 file:rounded-control file:border-0 file:bg-superficie-azul file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-primario-oscuro`}
          />
        </Campo>
        {archivo ? (
          <p className="text-xs text-texto-secundario">
            {archivo.name} · {formatearBytes(archivo.size)}
          </p>
        ) : null}
        <p className="text-xs text-texto-secundario">Adjuntar no marca el documento como presentado: eso se hace con &quot;Marcar&quot;.</p>
        {error ? <AvisoError error={error} recargar={datos.rutaFicha} yaMostradas={["archivo"]} /> : null}
        <p role="status" aria-live="polite" className="text-sm text-texto-secundario">
          {etapa === "preparando" ? "Preparando el archivo…" : etapa === "subiendo" ? "Subiendo…" : ""}
        </p>
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-3">
          <button type="button" onClick={cerrar} disabled={ocupado} className={CLASE_BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={ocupado} className={CLASE_BOTON_PRIMARIO}>
            {ocupado ? "Subiendo…" : "Subir"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
