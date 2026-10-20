import type { Metadata } from "next";
import Form from "next/form";
import { randomUUID } from "node:crypto";
import { ArrowRight, CircleAlert } from "lucide-react";
import { CLASE_BOTON_PRIMARIO, CLASE_CONTROL } from "@/components/formulario";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type ContextoFormulario } from "@/lib/dominio/expedientes/servidor";
import { puede } from "@/lib/dominio/permisos";
import { valoresInicialesAlta } from "@/lib/presentacion/formulario";
import { FormularioExpediente } from "../_formulario/formulario-expediente";

export const metadata: Metadata = { title: "Nuevo expediente" };

const RE_ID = /^[1-9]\d{0,8}$/;

function entero(valor: string | string[] | undefined): number | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v && RE_ID.test(v) ? Number(v) : null;
}

/**
 * Alta (sección 5, `/expedientes/nuevo`). Primero se eligen el trámite (la
 * plantilla publicada) y el cementerio, que viajan en la URL; con eso el
 * servidor arma el contexto (`contextoAlta`) y el formulario por secciones.
 *
 * El `comandoId` se genera acá, al abrir el formulario: cada vez que se abre,
 * uno nuevo; mientras se reintenta el envío, el mismo.
 */
export default async function PaginaNuevoExpediente(props: PageProps<"/expedientes/nuevo">) {
  const usuario = await exigirPantalla("expedientes_nuevo");
  const parametros = await props.searchParams;
  const opciones = await expedientes.opcionesAlta();
  const plantillaId = entero(parametros.plantilla);
  const cementerioId = entero(parametros.cementerio);

  let contexto: ContextoFormulario | null = null;
  let problema: string | null = null;
  // `cambiar=1`: volver al primer paso con lo elegido, para cambiarlo.
  const cambiar = parametros.cambiar === "1";
  if (plantillaId !== null && cementerioId !== null && !cambiar) {
    try {
      contexto = await expedientes.contextoAlta(usuario, plantillaId, cementerioId);
    } catch (e) {
      if (!(e instanceof ErrorDominio)) throw e;
      problema = e.errores[0]?.mensaje ?? e.message;
    }
  }

  const tipos = [...new Map(opciones.plantillas.map((p) => [p.tipoTramite.id, p.tipoTramite])).values()];
  const urlCambiar = `/expedientes/nuevo?plantilla=${plantillaId ?? ""}&cementerio=${cementerioId ?? ""}&cambiar=1`;

  return (
    <section aria-labelledby="titulo-pantalla" className="space-y-5">
      <h1 id="titulo-pantalla" className="text-xl font-semibold text-slate-900">
        Nuevo expediente
      </h1>

      {contexto === null || contexto.problemas.length > 0 ? (
        <Form action="/expedientes/nuevo" className="space-y-4 rounded border border-slate-300 bg-white p-4">
          <p className="text-sm text-slate-700">Elegí el trámite y el cementerio. Con eso se arma el resto del formulario.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="plantilla" className="mb-1 block text-sm font-medium text-slate-800">
                Tipo de trámite y plantilla
              </label>
              <select id="plantilla" name="plantilla" required defaultValue={plantillaId ?? ""} className={CLASE_CONTROL}>
                <option value="">Elegí…</option>
                {tipos.map((t) => (
                  <optgroup key={t.id} label={t.nombre}>
                    {opciones.plantillas
                      .filter((p) => p.tipoTramite.id === t.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre} (v{p.version})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cementerio" className="mb-1 block text-sm font-medium text-slate-800">
                Cementerio
              </label>
              <select id="cementerio" name="cementerio" required defaultValue={cementerioId ?? ""} className={CLASE_CONTROL}>
                <option value="">Elegí…</option>
                {opciones.cementerios.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {problema || (contexto && contexto.problemas.length > 0) ? (
            <div role="alert" className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                {problema ? <p>{problema}</p> : null}
                {contexto?.problemas.map((p) => <p key={p}>{p}</p>)}
              </div>
            </div>
          ) : null}
          <button type="submit" className={CLASE_BOTON_PRIMARIO}>
            Continuar
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </Form>
      ) : (
        <FormularioExpediente
          // Otra plantilla u otro cementerio: formulario nuevo, sin restos del anterior.
          key={`${contexto.plantilla.id}-${contexto.cementerio.id}`}
          modo="alta"
          comandoId={randomUUID()}
          definicion={contexto.plantilla.definicion}
          esquema={contexto.esquema}
          camposUbicacion={contexto.camposUbicacion}
          tiposMonumento={contexto.tiposMonumento}
          cementerios={contexto.cementerios}
          hoy={contexto.hoy}
          plantilla={{
            id: contexto.plantilla.id,
            nombre: contexto.plantilla.nombre,
            version: contexto.plantilla.version,
            tipoTramite: contexto.plantilla.tipoTramite.nombre,
          }}
          cementerio={{ id: contexto.cementerio.id, nombre: contexto.cementerio.nombre }}
          valoresIniciales={valoresInicialesAlta(contexto.plantilla.definicion, {
            hoy: contexto.hoy,
            tiposMonumento: contexto.tiposMonumento.map((t) => t.codigo),
          })}
          puedeCargaHistorica={puede("carga_historica", null, usuario)}
          urlCambiar={urlCambiar}
        />
      )}
    </section>
  );
}
