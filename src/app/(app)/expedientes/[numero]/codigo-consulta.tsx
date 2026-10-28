"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Dialogo } from "@/components/dialogo";
import { atributosCampo, Campo, CLASE_BOTON_COMPACTO, CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CONTROL } from "@/components/formulario";
import { formatearCodigoConsulta } from "@/lib/dominio/expedientes/codigo-consulta";
import { LARGO_MINIMO_MOTIVO } from "@/lib/dominio/expedientes/errores";
import { erroresPorRuta, type EstadoError } from "@/lib/presentacion/errores";
import { regenerarCodigoConsulta } from "../acciones";

/**
 * "Regenerar código de consulta" (28/10/2026; Mesa de Entradas y admin): un
 * diálogo con el motivo, que queda en auditoria.accesos. El código anterior
 * deja de servir en el acto; el nuevo se muestra acá y la ficha se vuelve a
 * pintar con él (refresh() en la acción). Después hay que imprimir el
 * comprobante de nuevo.
 */
export function RegenerarCodigoConsulta({ numero }: { numero: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<EstadoError | null>(null);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function cerrar() {
    setAbierto(false);
    setMotivo("");
    setError(null);
    setNuevo(null);
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
      const r = await regenerarCodigoConsulta(numero, motivo);
      if (r.ok) {
        setNuevo(r.codigo);
        setError(null);
      } else {
        setError(r);
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={CLASE_BOTON_COMPACTO}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Regenerar código
      </button>
      {abierto ? (
        <Dialogo
          titulo="Regenerar código de consulta"
          descripcion="Si el concesionario perdió el comprobante o el código se filtró. El código actual deja de servir y queda registrado quién lo cambió y por qué."
          onCerrar={cerrar}
          ocupado={pendiente}
        >
          {nuevo ? (
            <div className="space-y-4">
              <p role="status" className="text-sm text-texto">
                Código nuevo:{" "}
                <strong data-codigo-nuevo="" className="font-mono text-lg tracking-wider text-institucional">
                  {formatearCodigoConsulta(nuevo)}
                </strong>
                . Imprimí el comprobante de nuevo para entregárselo al concesionario.
              </p>
              <div className="flex justify-end">
                <button type="button" data-autofocus onClick={cerrar} className={CLASE_BOTON_PRIMARIO}>
                  Listo
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={confirmar} className="space-y-4" aria-busy={pendiente}>
              <Campo ruta="motivo-codigo" etiqueta="Motivo" obligatorio errores={errMotivo} ayuda={`${LARGO_MINIMO_MOTIVO} caracteres o más`}>
                <textarea
                  {...atributosCampo("motivo-codigo", errMotivo, "campo-motivo-codigo-ayuda")}
                  rows={2}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  data-autofocus
                  className={CLASE_CONTROL}
                />
              </Campo>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={cerrar} disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
                  Cancelar
                </button>
                <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
                  {pendiente ? "Regenerando…" : "Regenerar"}
                </button>
              </div>
            </form>
          )}
        </Dialogo>
      ) : null}
    </>
  );
}
