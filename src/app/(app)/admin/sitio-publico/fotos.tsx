"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Pencil, ShieldAlert, Trash2 } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { AvisoError } from "@/components/aviso-error";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_COMPACTO, CLASE_BOTON_COMPACTO_PELIGRO, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import type { FilaFoto, UsoFoto } from "@/lib/dominio/sitio";
import { LARGOS, MINIMO_ALT_FOTO } from "@/lib/dominio/sitio/validacion";
import { formatearFechaHora } from "@/lib/fechas";
import { ACCEPT_FOTO, ANCHO_MINIMO_FOTO, MAXIMO_FOTOS_ACTIVAS } from "@/lib/imagenes/tipos";
import type { EstadoError } from "@/lib/presentacion/errores";
import { leerFotoElegida, subirFoto, type ModoSubidaFoto } from "@/lib/presentacion/subida-foto";
import { AvisoHecho, DialogoConfirmar, erroresDe, useAccion } from "../piezas";
import { accionSitio } from "./acciones";

/**
 * La pestaña Fotos de /admin/sitio-publico (30/10/2026; docs/api-dominio.md,
 * sección 25.7): subir una foto propia (JPG, PNG o WebP de hasta 15 MB, con
 * su texto alternativo), verlas con su miniatura y dónde se usa cada una,
 * corregir el texto y darlas de baja (no se borran; si están en uso, avisa
 * dónde y, al confirmar, esos quedan sin foto).
 *
 * La subida no es una Server Action (el cuerpo de una función de Vercel no
 * pasa de 4,5 MB): va por un Route Handler (`app`) o directo a Supabase
 * Storage (`directa`), según el almacén (src/lib/presentacion/subida-foto.ts).
 * El servidor procesa la foto: dos WebP sin metadatos.
 */

const RUTA = "/admin/sitio-publico?pestana=fotos";

function tamano(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function textoUsos(usos: readonly UsoFoto[]): string {
  return usos.map((u) => (u.tipo === "cementerio" ? u.nombre : `el recorrido «${u.nombre}»`)).join(", ");
}

export function PestanaFotos({ filas, dadasDeBaja, modo }: { filas: readonly FilaFoto[]; dadasDeBaja: number; modo: ModoSubidaFoto }) {
  const [hecho, setHecho] = useState<string | null>(null);
  const [editando, setEditando] = useState<FilaFoto | null>(null);
  const [dandoDeBaja, setDandoDeBaja] = useState<FilaFoto | null>(null);
  const baja = useAccion();
  const lleno = filas.length >= MAXIMO_FOTOS_ACTIVAS;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-texto-secundario">
        Fotos propias para los cementerios y los recorridos de la página pública. Se eligen en la pestaña de cada uno, junto a las ilustrativas. El
        sistema las achica y les quita los datos ocultos (ubicación, cámara, fecha) antes de publicarlas.
      </p>
      <Aviso tono="advertencia" icono={ShieldAlert} titulo="Las fotos del sitio son públicas">
        <p>No subas fotos donde se reconozcan personas ni nombres en lápidas sin autorización.</p>
      </Aviso>
      <AvisoHecho mensaje={hecho} />
      {lleno ? (
        <Aviso tono="info">
          <p>
            Ya hay {MAXIMO_FOTOS_ACTIVAS} fotos activas, el máximo. Para subir otra, dá de baja alguna que no se use.
          </p>
        </Aviso>
      ) : (
        <FormularioSubida
          modo={modo}
          onHecho={(m) => {
            setHecho(m);
          }}
        />
      )}

      <section aria-labelledby="titulo-fotos-subidas" className="space-y-3">
        <h2 id="titulo-fotos-subidas" className="titulo-seccion">
          Fotos subidas{" "}
          <span className="text-sm font-normal text-texto-secundario">
            ({filas.length} de {MAXIMO_FOTOS_ACTIVAS} activas{dadasDeBaja > 0 ? `; ${dadasDeBaja} dada${dadasDeBaja === 1 ? "" : "s"} de baja` : ""})
          </span>
        </h2>
        {filas.length === 0 ? (
          <p className="tarjeta px-4 py-3 text-sm text-texto-secundario">Todavía no hay fotos subidas. Mientras tanto, la página usa las ilustrativas.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Fotos subidas">
            {filas.map((f) => (
              <li key={f.id} className="tarjeta flex flex-col overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- la versión de 960 px que sirve /sitio/fotos (ya procesada). */}
                <img src={f.src} alt={f.alt} width={f.ancho} height={f.alto} loading="lazy" decoding="async" className="aspect-video w-full bg-fondo object-cover" />
                <div className="flex flex-1 flex-col gap-1.5 p-4 text-sm">
                  <p className="font-medium text-texto [overflow-wrap:anywhere]">{f.alt}</p>
                  {f.credito ? <p className="text-texto-secundario [overflow-wrap:anywhere]">Crédito: {f.credito}</p> : null}
                  <p className="text-xs text-texto-secundario">
                    Original de {f.ancho} × {f.alto} px, {tamano(f.bytes)}. Subida por {f.subidaPor} el {formatearFechaHora(new Date(f.creadoEn))}.
                  </p>
                  <p className="text-xs text-texto">{f.usos.length > 0 ? `En uso: ${textoUsos(f.usos)}.` : "Sin usar."}</p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                    <button type="button" aria-haspopup="dialog" onClick={() => setEditando(f)} className={CLASE_BOTON_COMPACTO}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Editar texto<span className="sr-only"> de la foto «{f.alt}»</span>
                    </button>
                    <button type="button" aria-haspopup="dialog" onClick={() => setDandoDeBaja(f)} className={CLASE_BOTON_COMPACTO_PELIGRO}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Dar de baja<span className="sr-only"> la foto «{f.alt}»</span>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editando ? (
        <DialogoTextoFoto
          f={editando}
          onCerrar={() => setEditando(null)}
          onHecho={(m) => {
            setEditando(null);
            setHecho(m);
          }}
        />
      ) : null}
      {dandoDeBaja ? (
        <DialogoConfirmar
          titulo="Dar de baja la foto"
          textoBoton={dandoDeBaja.usos.length > 0 ? "Dar de baja y dejarlos sin foto" : "Dar de baja"}
          motivo="opcional"
          peligro
          pendiente={baja.pendiente}
          error={baja.error}
          recargar={RUTA}
          onCerrar={() => {
            baja.setError(null);
            setDandoDeBaja(null);
          }}
          onConfirmar={(motivo) =>
            baja.enviar(
              () => accionSitio({ accion: "baja_foto", id: dandoDeBaja.id, confirmarUso: dandoDeBaja.usos.length > 0, motivo }),
              (r) => {
                setDandoDeBaja(null);
                setHecho(r.mensaje);
              },
            )
          }
        >
          <div className="space-y-2">
            <p>¿Dar de baja «{dandoDeBaja.alt}»? Deja de verse en la página y de ofrecerse para elegir. No se borra: queda registrada en la auditoría.</p>
            {dandoDeBaja.usos.length > 0 ? (
              <Aviso tono="advertencia" titulo="Está en uso">
                <p>
                  La usa{dandoDeBaja.usos.length > 1 ? "n" : ""}: {textoUsos(dandoDeBaja.usos)}. Al darla de baja, {dandoDeBaja.usos.length > 1 ? "quedan" : "queda"} sin foto
                  (después le podés elegir otra).
                </p>
              </Aviso>
            ) : null}
          </div>
        </DialogoConfirmar>
      ) : null}
    </div>
  );
}

/** Elegir la foto, escribir su texto alternativo (y el crédito, si hay) y subirla. */
function FormularioSubida({ modo, onHecho }: { modo: ModoSubidaFoto; onHecho: (m: string) => void }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [credito, setCredito] = useState("");
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<EstadoError | null>(null);

  // La vista previa local (antes de subir): un blob: que se libera al cambiar de foto o al salir.
  const previaActual = useRef<string | null>(null);
  function elegir(nuevo: File | null) {
    if (previaActual.current) URL.revokeObjectURL(previaActual.current);
    previaActual.current = nuevo ? URL.createObjectURL(nuevo) : null;
    setArchivo(nuevo);
    setPrevia(previaActual.current);
  }
  useEffect(
    () => () => {
      if (previaActual.current) URL.revokeObjectURL(previaActual.current);
    },
    [],
  );

  const erroresArchivo = erroresDe(error, "archivo");
  const erroresAlt = erroresDe(error, "alt");
  const erroresCredito = erroresDe(error, "credito");

  function local(ruta: string, mensaje: string): EstadoError {
    return { ok: false, codigo: "validacion", mensaje: "Revisá los datos marcados", errores: [{ ruta, mensaje }] };
  }

  async function enviar() {
    setError(null);
    if (!archivo) return setError(local("archivo", "Elegí la foto"));
    const textoAlt = alt.replace(/\s+/g, " ").trim();
    if (textoAlt.length < MINIMO_ALT_FOTO) return setError(local("alt", `Escribí qué se ve en la foto (al menos ${MINIMO_ALT_FOTO} caracteres)`));
    setPendiente(true);
    try {
      const revision = await leerFotoElegida(archivo);
      if (!revision.ok) return setError(local("archivo", revision.mensaje));
      const r = await subirFoto(archivo, revision.mime, { alt: textoAlt, credito }, modo);
      if (!r.ok) return setError(r);
      elegir(null);
      setAlt("");
      setCredito("");
      if (entrada.current) entrada.current.value = "";
      onHecho(`Foto subida: «${r.alt}». Ya se puede elegir en Cementerios y en Recorridos.`);
      router.refresh();
    } finally {
      setPendiente(false);
    }
  }

  return (
    <form
      className="tarjeta space-y-4 p-5"
      aria-labelledby="titulo-subir-foto"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      <h2 id="titulo-subir-foto" className="titulo-seccion">
        Subir una foto
      </h2>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:items-start">
        <div className="space-y-4">
          <Campo
            ruta="archivo"
            etiqueta="Foto"
            obligatorio
            errores={erroresArchivo}
            ayuda={`JPG, PNG o WebP, hasta 15 MB y de ${ANCHO_MINIMO_FOTO} px de ancho o más. Horizontal se ve mejor (las tarjetas son 16:9).`}
          >
            <input
              {...atributosCampo("archivo", erroresArchivo, "campo-archivo-ayuda")}
              ref={entrada}
              type="file"
              accept={ACCEPT_FOTO}
              onChange={(e) => {
                setError(null);
                elegir(e.target.files?.[0] ?? null);
              }}
              className={`${CLASE_CONTROL} file:mr-3 file:rounded-control file:border-0 file:bg-fondo file:px-3 file:py-1.5 file:text-sm file:font-medium`}
            />
          </Campo>
          <Campo
            ruta="alt"
            etiqueta="Texto alternativo"
            obligatorio
            errores={erroresAlt}
            ayuda={`Qué se ve en la foto, para quien no la puede ver (lo lee el lector de pantalla). Por ejemplo: «Portón de ingreso del Cementerio del Oeste». De ${MINIMO_ALT_FOTO} a ${LARGOS.altFoto} caracteres.`}
          >
            <input
              {...atributosCampo("alt", erroresAlt, "campo-alt-ayuda")}
              type="text"
              required
              minLength={MINIMO_ALT_FOTO}
              maxLength={LARGOS.altFoto}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              className={CLASE_CONTROL}
            />
          </Campo>
          <Campo ruta="credito" etiqueta="Crédito o descripción (opcional)" errores={erroresCredito} ayuda={`Se muestra chico debajo de la foto. Por ejemplo: «Archivo de la Dirección de Cementerios». Hasta ${LARGOS.creditoFoto} caracteres.`}>
            <input
              {...atributosCampo("credito", erroresCredito, "campo-credito-ayuda")}
              type="text"
              maxLength={LARGOS.creditoFoto}
              value={credito}
              onChange={(e) => setCredito(e.target.value)}
              className={CLASE_CONTROL}
            />
          </Campo>
        </div>
        <div aria-live="polite">
          {previa ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), antes de subir. */}
              <img src={previa} alt="" className="aspect-video w-full rounded-control bg-fondo object-cover ring-1 ring-borde" />
              <figcaption className="mt-1 text-xs text-texto-secundario">Vista previa (todavía no se subió)</figcaption>
            </figure>
          ) : (
            <div aria-hidden="true" className="flex aspect-video w-full items-center justify-center rounded-control border border-dashed border-borde text-texto-secundario">
              <ImagePlus className="h-8 w-8" />
            </div>
          )}
        </div>
      </div>
      {error ? <AvisoError error={error} recargar={RUTA} yaMostradas={["archivo", "alt", "credito"]} /> : null}
      <div className="flex justify-end border-t border-borde pt-3">
        <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {pendiente ? "Subiendo y procesando…" : "Subir foto"}
        </button>
      </div>
    </form>
  );
}

function DialogoTextoFoto({ f, onCerrar, onHecho }: { f: FilaFoto; onCerrar: () => void; onHecho: (m: string) => void }) {
  const { pendiente, error, enviar } = useAccion();
  const [alt, setAlt] = useState(f.alt);
  const [credito, setCredito] = useState(f.credito ?? "");
  const [motivo, setMotivo] = useState("");
  const erroresAlt = erroresDe(error, "alt");
  const erroresCredito = erroresDe(error, "credito");
  return (
    <Dialogo titulo="Editar el texto de la foto" onCerrar={onCerrar} ocupado={pendiente}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(() => accionSitio({ accion: "foto", datos: { id: f.id, alt, credito }, motivo }), (r) => onHecho(r.mensaje));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- la versión de 960 px, ya procesada. */}
        <img src={f.src} alt="" className="aspect-video w-full max-w-sm rounded-control object-cover ring-1 ring-borde" />
        <Campo ruta="alt" etiqueta="Texto alternativo" obligatorio errores={erroresAlt} ayuda={`Qué se ve en la foto. De ${MINIMO_ALT_FOTO} a ${LARGOS.altFoto} caracteres.`}>
          <input
            {...atributosCampo("alt", erroresAlt, "campo-alt-ayuda")}
            type="text"
            required
            maxLength={LARGOS.altFoto}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            className={CLASE_CONTROL}
            data-autofocus
          />
        </Campo>
        <Campo ruta="credito" etiqueta="Crédito o descripción (opcional)" errores={erroresCredito} ayuda={`Hasta ${LARGOS.creditoFoto} caracteres.`}>
          <input {...atributosCampo("credito", erroresCredito, "campo-credito-ayuda")} type="text" maxLength={LARGOS.creditoFoto} value={credito} onChange={(e) => setCredito(e.target.value)} className={CLASE_CONTROL} />
        </Campo>
        <Campo ruta="motivo" etiqueta="Motivo (opcional)" ayuda="Queda en la auditoría junto con el cambio">
          <input {...atributosCampo("motivo", undefined, "campo-motivo-ayuda")} type="text" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASE_CONTROL} />
        </Campo>
        {error ? <AvisoError error={error} recargar={RUTA} yaMostradas={["alt", "credito"]} /> : null}
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
