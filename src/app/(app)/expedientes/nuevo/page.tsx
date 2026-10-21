import type { Metadata } from "next";
import Form from "next/form";
import { headers } from "next/headers";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ArrowRight, CircleAlert, RotateCcw } from "lucide-react";
import { CLASE_BOTON_PRIMARIO, CLASE_CONTROL, CLASE_ENLACE } from "@/components/formulario";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type ContextoFormulario, type PrecargaAlta } from "@/lib/dominio/expedientes/servidor";
import { puede } from "@/lib/dominio/permisos";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { valoresDesdePrecarga, valoresInicialesAlta, type Precargados } from "@/lib/presentacion/formulario";
import { etiquetaEstado } from "@/lib/presentacion/textos";
import { FormularioExpediente } from "../_formulario/formulario-expediente";

export const metadata: Metadata = { title: "Nuevo expediente" };

const RE_ID = /^[1-9]\d{0,8}$/;
const RE_NUMERO = /^[A-Za-z0-9 /-]{1,30}$/;

function entero(valor: string | string[] | undefined): number | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v && RE_ID.test(v) ? Number(v) : null;
}

function texto(valor: string | string[] | undefined): string | null {
  const v = (Array.isArray(valor) ? valor[0] : valor)?.trim();
  return v && RE_NUMERO.test(v) ? v : null;
}

/**
 * Alta (sección 5, `/expedientes/nuevo`). Primero se eligen el trámite (la
 * plantilla publicada) y el cementerio, que viajan en la URL; con eso el
 * servidor arma el contexto (`contextoAlta`) y el formulario por secciones.
 *
 * Semana 4, `?desde=<numero>` (2.13(a), "Reiniciar con otra plantilla"): el
 * formulario abre precargado con el expediente anterior (`precargaAlta`, que
 * registra el acceso porque trae el contacto): datos, personas vigentes,
 * ubicación, padrón y N° municipal, en su mismo cementerio. Si el anterior
 * quedó anulado por el reinicio, el alta lo continúa (`expedienteAnteriorId`)
 * y las dos fichas se enlazan.
 *
 * El `comandoId` se genera acá, al abrir el formulario: cada vez que se abre,
 * uno nuevo; mientras se reintenta el envío, el mismo.
 */
export default async function PaginaNuevoExpediente(props: PageProps<"/expedientes/nuevo">) {
  const usuario = await exigirPantalla("expedientes_nuevo");
  const parametros = await props.searchParams;
  const opciones = await expedientes.opcionesAlta();
  const desde = texto(parametros.desde);
  const plantillaId = entero(parametros.plantilla);

  let precarga: PrecargaAlta | null = null;
  let problema: string | null = null;
  if (desde !== null) {
    try {
      precarga = await expedientes.precargaAlta(usuario, desde, { ip: ipDeSolicitud(await headers()) });
    } catch (e) {
      if (!(e instanceof ErrorDominio)) throw e;
      problema = e.codigo === "no_encontrado" ? `No existe el expediente ${desde}.` : e.message;
    }
  }
  // Con `?desde=`, el cementerio es el del expediente anterior.
  const cementerioId = precarga ? precarga.datos.cementerioId : entero(parametros.cementerio);

  let contexto: ContextoFormulario | null = null;
  // `cambiar=1`: volver al primer paso con lo elegido, para cambiarlo.
  const cambiar = parametros.cambiar === "1";
  if (plantillaId !== null && cementerioId !== null && !cambiar && (desde === null || precarga !== null)) {
    try {
      contexto = await expedientes.contextoAlta(usuario, plantillaId, cementerioId);
    } catch (e) {
      if (!(e instanceof ErrorDominio)) throw e;
      problema = e.errores[0]?.mensaje ?? e.message;
    }
  }

  const tipos = [...new Map(opciones.plantillas.map((p) => [p.tipoTramite.id, p.tipoTramite])).values()];
  const consulta = new URLSearchParams({ plantilla: String(plantillaId ?? ""), cementerio: String(cementerioId ?? ""), cambiar: "1" });
  if (precarga) consulta.set("desde", precarga.desde.numero);
  const urlCambiar = `/expedientes/nuevo?${consulta.toString()}`;

  let precargados: Precargados | null = null;
  if (precarga && contexto && contexto.problemas.length === 0) {
    precargados = valoresDesdePrecarga(precarga.datos, contexto.definicion, {
      hoy: contexto.hoy,
      tiposMonumento: contexto.tiposMonumento.map((t) => t.codigo),
      clavesUbicacion: contexto.camposUbicacion.map((c) => c.clave),
    });
  }
  const cementerioPrecarga = precarga ? opciones.cementerios.find((c) => c.id === precarga.datos.cementerioId) : undefined;

  return (
    <section aria-labelledby="titulo-pantalla" className="space-y-5">
      <h1 id="titulo-pantalla" className="text-xl font-semibold text-slate-900">
        Nuevo expediente
      </h1>

      {precarga ? (
        <div role="status" className="flex items-start gap-2 rounded border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">
              Reinicio de{" "}
              <Link href={rutaFicha(precarga.desde.numero)} prefetch={false} className={CLASE_ENLACE}>
                {precarga.desde.numero}
              </Link>{" "}
              ({precarga.desde.plantilla.nombre}, {etiquetaEstado(precarga.desde.estado).toLowerCase()})
            </p>
            <p>
              Se precargan los datos, las personas, la ubicación, el padrón y el N° municipal. Revisalos antes de guardar: el expediente nuevo arranca en el primer paso de su
              trámite.
            </p>
            {precarga.desde.reiniciable ? (
              <p>Al guardar, las dos fichas quedan enlazadas.</p>
            ) : (
              <p className="font-medium text-amber-950">
                {precarga.desde.numero} no está anulado por un reinicio pendiente: el expediente nuevo se precarga pero no queda enlazado.
              </p>
            )}
            {precargados && precargados.rolesQueNoPasan.length > 0 ? (
              <p>No pasan las personas con rol {precargados.rolesQueNoPasan.join(", ")}: el trámite nuevo no lo tiene.</p>
            ) : null}
            {precargados && precargados.personasDeMas > 0 ? (
              <p>{precargados.personasDeMas === 1 ? "Una persona no pasó" : `${precargados.personasDeMas} personas no pasaron`}: el trámite nuevo admite menos de ese rol.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {contexto === null || contexto.problemas.length > 0 ? (
        <Form action="/expedientes/nuevo" className="space-y-4 rounded border border-slate-300 bg-white p-4">
          <p className="text-sm text-slate-700">
            {precarga ? "Elegí el trámite nuevo. El cementerio es el del expediente anterior." : "Elegí el trámite y el cementerio. Con eso se arma el resto del formulario."}
          </p>
          {precarga ? <input type="hidden" name="desde" value={precarga.desde.numero} /> : null}
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
            {precarga ? (
              <div>
                <p className="mb-1 block text-sm font-medium text-slate-800">Cementerio</p>
                <p className="py-1.5 text-sm text-slate-900">{cementerioPrecarga?.nombre ?? "—"}</p>
              </div>
            ) : (
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
            )}
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
          // Otra plantilla, otro cementerio u otro anterior: formulario nuevo, sin restos del anterior.
          key={`${contexto.plantilla.id}-${contexto.cementerio.id}-${precarga?.desde.numero ?? ""}`}
          modo="alta"
          comandoId={randomUUID()}
          definicion={contexto.definicion}
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
          valoresIniciales={
            precargados?.valores ??
            valoresInicialesAlta(contexto.definicion, {
              hoy: contexto.hoy,
              tiposMonumento: contexto.tiposMonumento.map((t) => t.codigo),
            })
          }
          puedeCargaHistorica={puede("carga_historica", null, usuario) && precarga === null}
          urlCambiar={urlCambiar}
          expedienteAnteriorId={precarga?.datos.expedienteAnteriorId ?? null}
        />
      )}
    </section>
  );
}
