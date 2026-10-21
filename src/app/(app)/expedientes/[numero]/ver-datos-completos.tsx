"use client";

import { useId, useState, useTransition } from "react";
import { Eye, MessageCircle } from "lucide-react";
import { atributosCampo, Campo, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL, CLASE_ENLACE } from "@/components/formulario";
import type { DatosCompletos } from "@/lib/dominio/expedientes/ficha";
import { LARGO_MINIMO_MOTIVO } from "@/lib/dominio/expedientes/errores";
import { enlaceWhatsapp, mensajeWhatsapp } from "@/lib/presentacion/enlaces";
import { erroresPorRuta, type EstadoError } from "@/lib/presentacion/errores";
import { nombreCompleto } from "@/lib/presentacion/textos";
import { verDatosCompletos } from "../acciones";

/**
 * "Ver datos completos" (decisión 13): quien no trabaja el expediente ve el
 * contacto enmascarado y, si lo necesita, lo pide con un motivo que queda en
 * auditoria.accesos. El dominio vuelve a decidir si hace falta el motivo.
 */
export function VerDatosCompletos({ numero, area, etiquetas }: { numero: string; area: string; etiquetas: Record<string, string> }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<EstadoError | null>(null);
  const [datos, setDatos] = useState<DatosCompletos | null>(null);
  const [pendiente, iniciar] = useTransition();
  const idTitulo = useId();

  if (datos) {
    const vigentes = datos.personas.filter((p) => p.vigente);
    return (
      <section aria-labelledby={idTitulo} className="rounded-control border border-advertencia-borde bg-advertencia-fondo p-3 text-sm">
        <h3 id={idTitulo} className="font-medium text-advertencia">
          Datos completos (tu consulta quedó registrada)
        </h3>
        <ul className="mt-2 space-y-2">
          {vigentes.map((p) => {
            const wa = p.telefonoWhatsapp ? enlaceWhatsapp(p.telefono, mensajeWhatsapp(numero, area)) : null;
            return (
              <li key={p.id}>
                <span className="font-medium">
                  {etiquetas[p.rol] ?? p.rol}: {nombreCompleto(p)}
                </span>
                <div className="text-texto">
                  Teléfono: {p.telefono ?? "—"}
                  {wa ? (
                    <>
                      {" · "}
                      <a href={wa} target="_blank" rel="noopener noreferrer" className={`${CLASE_ENLACE} inline-flex items-center gap-1`}>
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        WhatsApp
                      </a>
                    </>
                  ) : null}
                  {" · "}Correo: {p.email ?? "—"}
                  {" · "}Domicilio: {p.domicilio ?? "—"}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className={CLASE_BOTON_SECUNDARIO}>
        <Eye className="h-4 w-4" aria-hidden="true" />
        Ver datos completos
      </button>
    );
  }

  const errores = erroresPorRuta(error?.errores ?? []);
  const errMotivo = errores.get("motivo") ?? (error && error.errores.length === 0 ? [error.mensaje] : undefined);

  function confirmar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (motivo.trim().length < LARGO_MINIMO_MOTIVO) {
      setError({ ok: false, codigo: "motivo_requerido", mensaje: "", errores: [{ ruta: "motivo", mensaje: `Escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` }] });
      return;
    }
    iniciar(async () => {
      const r = await verDatosCompletos(numero, motivo);
      if (r.ok) {
        setDatos(r.datos);
        setError(null);
      } else {
        setError(r);
      }
    });
  }

  return (
    <form onSubmit={confirmar} className="space-y-3 rounded-control border border-borde bg-fondo p-3" aria-busy={pendiente}>
      <p className="text-sm text-texto-secundario">
        Tu área no trabaja este expediente: para ver teléfono, correo y domicilio, escribí por qué. Queda registrado.
      </p>
      <Campo ruta="motivo" etiqueta="Motivo" obligatorio errores={errMotivo} ayuda={`${LARGO_MINIMO_MOTIVO} caracteres o más`}>
        <textarea
          {...atributosCampo("motivo", errMotivo, "campo-motivo-ayuda")}
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          // Se abrió a pedido: el foco va a donde hay que escribir.
          autoFocus
          className={CLASE_CONTROL}
        />
      </Campo>
      <div className="flex gap-2">
        <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
          {pendiente ? "Consultando…" : "Ver datos"}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className={CLASE_BOTON_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
