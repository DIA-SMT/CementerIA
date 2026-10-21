"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL, MensajeError } from "@/components/formulario";
import {
  ADJUNTO_DOCUMENTO,
  FALLECIDO,
  FORMAS_PAGO,
  ORIGENES_DOCUMENTO,
  TIPOS_CAMPO_EXTRA,
  VIAS_CONCEPTO,
} from "@/lib/dominio/plantillas/esquema";
import {
  agregarCampoExtra,
  agregarConcepto,
  agregarDocumento,
  agregarPersona,
  alternarMonumento,
  cambiarCampoExtra,
  cambiarConcepto,
  cambiarDocumento,
  cambiarGeneral,
  cambiarPersona,
  moverCampoExtra,
  moverConcepto,
  moverDocumento,
  moverPersona,
  opcionesDesdeTexto,
  quitarCampoExtra,
  quitarConcepto,
  quitarDocumento,
  quitarPersona,
  vistaPrevia,
} from "@/lib/presentacion/editor-plantilla";
import { idDeCampo } from "@/lib/presentacion/errores";
import { ETIQUETA_FORMA_PAGO } from "@/lib/presentacion/textos";
import { BotonesOrden, CampoClave, CampoNumero, CampoTexto, Casilla, ErroresDe, FiltroCementerios, idTrasMover, Selector, useEditor, useErrores } from "./controles";

/**
 * Las pestañas General, Personas, Documentación, Conceptos, Campos extra y
 * Vista previa del editor de plantillas. Todo sale del esquema
 * `DefinicionPlantilla`: cada lista se edita igual (agregar, ↑↓, quitar) y
 * cada campo lleva la ruta del esquema, que es la de sus errores.
 */

const FORMAS_PAGO_TEXTO: Record<string, string> = { ...ETIQUETA_FORMA_PAGO, a_elegir: "A elegir en el alta", no_aplica: "No aplica (trámite de oficio)" };
const FALLECIDO_TEXTO: Record<string, string> = { no: "Vive", si: "Fallecida", opcional: "Puede estar fallecida" };
const ORIGEN_TEXTO: Record<string, string> = { direccion: "La Dirección (lo genera una oficina)", concesionario: "El concesionario (lo trae)" };
const ADJUNTO_TEXTO: Record<string, string> = { no: "Sin adjunto", sugerido: "Adjunto sugerido", obligatorio: "Adjunto obligatorio" };
const VIA_TEXTO: Record<string, string> = { boleta: "Boleta", plan_dim: "Plan de pagos de la DIM" };
const TIPO_CAMPO_TEXTO: Record<string, string> = { texto: "Texto", numero: "Número", fecha: "Fecha", opcion: "Opción (lista)", cementerio: "Cementerio" };

function Elemento({ ruta, titulo, children }: { ruta: string; titulo: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset id={idDeCampo(ruta)} tabIndex={-1} className="space-y-3 rounded-control border border-borde bg-white px-3 pb-3 pt-1">
      <legend className="px-1 text-sm font-medium text-texto">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function BotonAgregar({ texto, onClick }: { texto: string; onClick: () => void }) {
  const { soloLectura } = useEditor();
  if (soloLectura) return null;
  return (
    <button type="button" onClick={onClick} className={CLASE_BOTON_SECUNDARIO}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      {texto}
    </button>
  );
}

const sinNombre = <span className="italic text-texto-secundario">(sin nombre)</span>;

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

export function PestanaGeneral({ nombre, ponerNombre }: { nombre: string; ponerNombre: (v: string) => void }) {
  const { def, cambiar, catalogos, errores } = useEditor();
  const erroresMonumentos = errores.filter((e) => e.ruta.startsWith("tipos_monumento")).map((e) => e.mensaje);
  const conocidos = catalogos.tiposMonumento.map((t) => t.codigo);
  return (
    <div className="space-y-4">
      <ErroresDe ruta="" />
      <CampoTexto ruta="nombre" etiqueta="Nombre del trámite" obligatorio valor={nombre} poner={ponerNombre} ayuda="Como se ve en el alta, la ficha y la carátula" />
      <Selector
        ruta="forma_pago"
        etiqueta="Forma de pago"
        valor={def.forma_pago}
        opciones={FORMAS_PAGO.map((f) => ({ valor: f, etiqueta: FORMAS_PAGO_TEXTO[f] ?? f }))}
        poner={(v) => cambiar((d) => cambiarGeneral(d, { forma_pago: FORMAS_PAGO.find((f) => f === v) ?? "contado" }))}
        className="max-w-sm"
      />
      <fieldset id={idDeCampo("tipos_monumento")} tabIndex={-1} className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium text-texto">Tipos de monumento</legend>
        <p className="text-xs text-texto-secundario">Ninguno marcado: todos los que cada cementerio tiene habilitados.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {catalogos.tiposMonumento.map((t) => (
            <label key={t.codigo} className="inline-flex items-center gap-1.5 text-sm text-texto">
              <input type="checkbox" checked={def.tipos_monumento.includes(t.codigo)} onChange={(e) => cambiar((d) => alternarMonumento(d, t.codigo, e.target.checked))} className={CLASE_CASILLA} />
              {t.nombre}
              {t.activo ? null : " (inactivo)"}
            </label>
          ))}
          {def.tipos_monumento
            .filter((c) => !conocidos.includes(c))
            .map((c) => (
              <label key={c} className="inline-flex items-center gap-1.5 text-sm text-error">
                <input type="checkbox" checked onChange={() => cambiar((d) => alternarMonumento(d, c, false))} className={CLASE_CASILLA} />
                {c} (no existe)
              </label>
            ))}
        </div>
        <MensajeError ruta="tipos_monumento" errores={erroresMonumentos.length > 0 ? erroresMonumentos : undefined} />
      </fieldset>
      <Casilla
        ruta="ubicacion_obligatoria"
        etiqueta="La ubicación es obligatoria"
        ayuda="Sin marcar (cinerario común), los campos de ubicación pueden quedar vacíos"
        marcado={def.ubicacion_obligatoria}
        poner={(v) => cambiar((d) => cambiarGeneral(d, { ubicacion_obligatoria: v }))}
      />
      <Casilla
        ruta="requiere_contacto"
        etiqueta="Requiere una persona de contacto"
        ayuda="Sin marcar para los trámites de oficio"
        marcado={def.requiere_contacto}
        poner={(v) => cambiar((d) => cambiarGeneral(d, { requiere_contacto: v }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export function PestanaPersonas() {
  const { def, cambiar, estructura } = useEditor();
  const total = def.personas.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-secundario">Los roles de las personas del trámite. Un rol nuevo (cesionario, difunto) se define acá, sin código.</p>
      <ErroresDe ruta="personas" />
      {def.personas.map((p, i) => {
        const ruta = `personas[${i}]`;
        const poner = (c: Parameters<typeof cambiarPersona>[2]) => cambiar((d) => cambiarPersona(d, i, c));
        return (
          <Elemento key={`${p.rol}#${i}`} ruta={ruta} titulo={<>Rol {i + 1}: {p.etiqueta || sinNombre}</>}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <ErroresDe ruta={ruta} />
              <BotonesOrden
                ruta={ruta}
                nombre={`el rol ${p.etiqueta || p.rol}`}
                indice={i}
                total={total}
                onMover={(delta) => estructura((d) => moverPersona(d, i, delta), idTrasMover("personas", i + delta, total, delta))}
                onQuitar={() => estructura((d) => quitarPersona(d, i))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <CampoClave ruta={`${ruta}.rol`} etiqueta="Rol" referencia={{ tipo: "rol", indice: i }} valor={p.rol} ayuda="Minúsculas y _ (ej. cesionario)" />
              <CampoTexto ruta={`${ruta}.etiqueta`} etiqueta="Etiqueta" obligatorio valor={p.etiqueta} poner={(v) => poner({ etiqueta: v })} />
            </div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <CampoNumero ruta={`${ruta}.min`} etiqueta="Mínimo" valor={p.min} poner={(v) => poner({ min: v })} />
              <CampoNumero ruta={`${ruta}.max`} etiqueta="Máximo" min={1} valor={p.max} poner={(v) => poner({ max: v })} />
              <Selector
                ruta={`${ruta}.fallecido`}
                etiqueta="¿Fallecida?"
                valor={p.fallecido}
                opciones={FALLECIDO.map((f) => ({ valor: f, etiqueta: FALLECIDO_TEXTO[f] }))}
                poner={(v) => poner({ fallecido: FALLECIDO.find((f) => f === v) ?? "no" })}
                className="min-w-48"
              />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Casilla ruta={`${ruta}.pide_vinculo`} etiqueta="Pide el vínculo con el titular" marcado={p.pide_vinculo} poner={(v) => poner({ pide_vinculo: v })} />
              <Casilla ruta={`${ruta}.admite_juridica`} etiqueta="Puede ser una persona jurídica (razón social y CUIT)" marcado={p.admite_juridica} poner={(v) => poner({ admite_juridica: v })} />
            </div>
          </Elemento>
        );
      })}
      <BotonAgregar texto="Agregar rol" onClick={() => estructura((d) => agregarPersona(d), idDeCampo(`personas[${def.personas.length}].etiqueta`))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documentación
// ---------------------------------------------------------------------------

function opcionesSalida(pasos: ReturnType<typeof useEditor>["def"]["pasos"]) {
  return [{ valor: "", etiqueta: "Al concluir" }, ...pasos.map((p, i) => ({ valor: p.clave, etiqueta: `Al salir de ${i + 1}. ${p.nombre || p.clave}` }))];
}

export function PestanaDocumentacion() {
  const { def, cambiar, estructura } = useEditor();
  const total = def.documentos.length;
  const rolesJuridicos = def.personas.filter((p) => p.admite_juridica);
  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-secundario">Lo que se controla del papel: quién lo aporta, cuándo se exige y si va con adjunto.</p>
      <ErroresDe ruta="documentos" />
      {def.documentos.map((doc, i) => {
        const ruta = `documentos[${i}]`;
        const poner = (c: Parameters<typeof cambiarDocumento>[2]) => cambiar((d) => cambiarDocumento(d, i, c));
        return (
          <Elemento key={`${doc.clave}#${i}`} ruta={ruta} titulo={<>Documento {i + 1}: {doc.nombre || sinNombre}</>}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <ErroresDe ruta={ruta} />
              <BotonesOrden
                ruta={ruta}
                nombre={`el documento ${doc.nombre || doc.clave}`}
                indice={i}
                total={total}
                onMover={(delta) => estructura((d) => moverDocumento(d, i, delta), idTrasMover("documentos", i + delta, total, delta))}
                onQuitar={() => estructura((d) => quitarDocumento(d, i))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <CampoClave ruta={`${ruta}.clave`} referencia={{ tipo: "documento", indice: i }} valor={doc.clave} />
              <CampoTexto ruta={`${ruta}.nombre`} etiqueta="Nombre" obligatorio valor={doc.nombre} poner={(v) => poner({ nombre: v })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Selector ruta={`${ruta}.origen`} etiqueta="Lo aporta" valor={doc.origen} opciones={ORIGENES_DOCUMENTO.map((o) => ({ valor: o, etiqueta: ORIGEN_TEXTO[o] }))} poner={(v) => poner({ origen: v === "direccion" ? "direccion" : "concesionario" })} />
              <Selector ruta={`${ruta}.exigir_al_salir_de`} etiqueta="Se exige" valor={doc.exigir_al_salir_de ?? ""} opciones={opcionesSalida(def.pasos)} poner={(v) => poner({ exigir_al_salir_de: v === "" ? null : v })} />
              <Selector ruta={`${ruta}.adjunto`} etiqueta="Adjunto" valor={doc.adjunto} opciones={ADJUNTO_DOCUMENTO.map((a) => ({ valor: a, etiqueta: ADJUNTO_TEXTO[a] }))} poner={(v) => poner({ adjunto: ADJUNTO_DOCUMENTO.find((a) => a === v) ?? "no" })} />
            </div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <Casilla ruta={`${ruta}.obligatorio`} etiqueta="Obligatorio" marcado={doc.obligatorio} poner={(v) => poner({ obligatorio: v })} />
              <Selector
                ruta={`${ruta}.solo_si_juridica`}
                etiqueta="Corresponde"
                valor={doc.solo_si_juridica ?? ""}
                opciones={[{ valor: "", etiqueta: "Siempre" }, ...rolesJuridicos.map((p) => ({ valor: p.rol, etiqueta: `Solo si ${p.etiqueta || p.rol} es persona jurídica` }))]}
                poner={(v) => poner({ solo_si_juridica: v === "" ? null : v })}
                className="min-w-64"
              />
            </div>
            <FiltroCementerios ruta={ruta} filtro={doc} poner={(f) => poner(f)} />
          </Elemento>
        );
      })}
      <BotonAgregar texto="Agregar documento" onClick={() => estructura((d) => agregarDocumento(d), idDeCampo(`documentos[${def.documentos.length}].nombre`))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conceptos
// ---------------------------------------------------------------------------

export function PestanaConceptos() {
  const { def, cambiar, estructura } = useEditor();
  const total = def.conceptos.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-secundario">Lo que se cobra: por boleta o por el plan de pagos de la DIM, y en qué paso se liquida.</p>
      <ErroresDe ruta="conceptos" />
      {def.conceptos.map((c, i) => {
        const ruta = `conceptos[${i}]`;
        const poner = (x: Parameters<typeof cambiarConcepto>[2]) => cambiar((d) => cambiarConcepto(d, i, x));
        return (
          <Elemento key={`${c.clave}#${i}`} ruta={ruta} titulo={<>Concepto {i + 1}: {c.nombre || sinNombre}</>}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <ErroresDe ruta={ruta} />
              <BotonesOrden
                ruta={ruta}
                nombre={`el concepto ${c.nombre || c.clave}`}
                indice={i}
                total={total}
                onMover={(delta) => estructura((d) => moverConcepto(d, i, delta), idTrasMover("conceptos", i + delta, total, delta))}
                onQuitar={() => estructura((d) => quitarConcepto(d, i))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <CampoClave ruta={`${ruta}.clave`} referencia={{ tipo: "concepto", indice: i }} valor={c.clave} />
              <CampoTexto ruta={`${ruta}.nombre`} etiqueta="Nombre" obligatorio valor={c.nombre} poner={(v) => poner({ nombre: v })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Selector ruta={`${ruta}.via`} etiqueta="Vía" valor={c.via} opciones={VIAS_CONCEPTO.map((v) => ({ valor: v, etiqueta: VIA_TEXTO[v] }))} poner={(v) => poner({ via: v === "plan_dim" ? "plan_dim" : "boleta" })} />
              <Selector
                ruta={`${ruta}.paso`}
                etiqueta="Se liquida en"
                valor={c.paso}
                opciones={[{ valor: "", etiqueta: "Elegí el paso…" }, ...def.pasos.map((p, j) => ({ valor: p.clave, etiqueta: `${j + 1}. ${p.nombre || p.clave}` }))]}
                poner={(v) => poner({ paso: v })}
              />
            </div>
            <FiltroCementerios ruta={ruta} filtro={c} poner={(f) => poner(f)} />
          </Elemento>
        );
      })}
      <BotonAgregar texto="Agregar concepto" onClick={() => estructura((d) => agregarConcepto(d), idDeCampo(`conceptos[${def.conceptos.length}].nombre`))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campos extra
// ---------------------------------------------------------------------------

/** Las opciones de un campo `opcion`, una por renglón (se aplican al salir del campo). */
function Opciones({ ruta, opciones, poner }: { ruta: string; opciones: string[]; poner: (v: string[]) => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const errores = useErrores(ruta);
  return (
    <div>
      <label htmlFor={idDeCampo(ruta)} className="mb-1 block text-sm font-medium text-texto">
        Opciones (una por renglón)
      </label>
      <textarea
        id={idDeCampo(ruta)}
        aria-invalid={errores ? true : undefined}
        aria-describedby={errores ? `${idDeCampo(ruta)}-error` : undefined}
        rows={4}
        value={texto ?? opciones.join("\n")}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          if (texto !== null) poner(opcionesDesdeTexto(texto));
          setTexto(null);
        }}
        className={CLASE_CONTROL}
      />
      <MensajeError ruta={ruta} errores={errores} />
    </div>
  );
}

export function PestanaCamposExtra() {
  const { def, cambiar, estructura } = useEditor();
  const total = def.campos_extra.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-secundario">
        Datos propios del trámite (vencimiento de la concesión, cementerio de destino…). Un campo de tipo cementerio se puede usar como área de un paso ($CAMPO).
      </p>
      <ErroresDe ruta="campos_extra" />
      {def.campos_extra.map((c, i) => {
        const ruta = `campos_extra[${i}]`;
        const poner = (x: Parameters<typeof cambiarCampoExtra>[2]) => cambiar((d) => cambiarCampoExtra(d, i, x));
        return (
          <Elemento key={`${c.clave}#${i}`} ruta={ruta} titulo={<>Campo {i + 1}: {c.etiqueta || sinNombre}</>}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <ErroresDe ruta={ruta} />
              <BotonesOrden
                ruta={ruta}
                nombre={`el campo ${c.etiqueta || c.clave}`}
                indice={i}
                total={total}
                onMover={(delta) => estructura((d) => moverCampoExtra(d, i, delta), idTrasMover("campos_extra", i + delta, total, delta))}
                onQuitar={() => estructura((d) => quitarCampoExtra(d, i))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <CampoClave ruta={`${ruta}.clave`} referencia={{ tipo: "campo", indice: i }} valor={c.clave} ayuda="Minúsculas y _ (ej. concesion_hasta)" />
              <CampoTexto ruta={`${ruta}.etiqueta`} etiqueta="Etiqueta" obligatorio valor={c.etiqueta} poner={(v) => poner({ etiqueta: v })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Selector ruta={`${ruta}.tipo`} etiqueta="Tipo" valor={c.tipo} opciones={TIPOS_CAMPO_EXTRA.map((t) => ({ valor: t, etiqueta: TIPO_CAMPO_TEXTO[t] }))} poner={(v) => poner({ tipo: TIPOS_CAMPO_EXTRA.find((t) => t === v) ?? "texto" })} />
              <Selector ruta={`${ruta}.exigir_al_salir_de`} etiqueta="Se exige" valor={c.exigir_al_salir_de ?? ""} opciones={opcionesSalida(def.pasos)} poner={(v) => poner({ exigir_al_salir_de: v === "" ? null : v })} />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Casilla ruta={`${ruta}.obligatorio`} etiqueta="Obligatorio" marcado={c.obligatorio} poner={(v) => poner({ obligatorio: v })} />
              <Casilla ruta={`${ruta}.buscable`} etiqueta="Entra en la búsqueda" marcado={c.buscable} poner={(v) => poner({ buscable: v })} />
            </div>
            {c.opciones !== null || c.tipo === "opcion" ? <Opciones ruta={`${ruta}.opciones`} opciones={c.opciones ?? []} poner={(v) => poner({ opciones: v })} /> : null}
          </Elemento>
        );
      })}
      <BotonAgregar texto="Agregar campo" onClick={() => estructura((d) => agregarCampoExtra(d), idDeCampo(`campos_extra[${def.campos_extra.length}].etiqueta`))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

export function PestanaVistaPrevia() {
  const { def, catalogos } = useEditor();
  const id = useId();
  const [codigo, setCodigo] = useState(catalogos.cementerios.find((c) => c.activo)?.codigo ?? catalogos.cementerios[0]?.codigo ?? "");
  const cementerio = catalogos.cementerios.find((c) => c.codigo === codigo);
  if (!cementerio) return <p className="text-sm text-texto-secundario">No hay cementerios cargados.</p>;
  const v = vistaPrevia(def, cementerio, { areas: catalogos.areas, tiposMonumento: catalogos.tiposMonumento });
  return (
    <div className="space-y-4">
      <p className="text-sm text-texto-secundario">Cómo queda lo que está en pantalla (aunque no esté guardado) para un expediente de cada cementerio: lo mismo que verán el alta y la ficha.</p>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-texto">Cementerio</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {catalogos.cementerios.map((c) => (
            <label key={c.codigo} className="inline-flex items-center gap-1.5 text-sm text-texto">
              <input type="radio" name={`${id}-cementerio`} checked={c.codigo === codigo} onChange={() => setCodigo(c.codigo)} className="h-4 w-4 accent-primario" />
              {c.nombre}
              {c.activo ? null : " (inactivo)"}
            </label>
          ))}
        </div>
      </fieldset>
      <div aria-live="polite" className="space-y-4">
        <section aria-label={`Recorrido en ${v.cementerio}`}>
          <h3 className="text-base font-semibold text-texto">Recorrido en {v.cementerio}</h3>
          <p className="text-sm text-texto-secundario">Monumentos: {v.monumentos.length > 0 ? v.monumentos.join(", ") : "ninguno (el alta no se podría cargar acá)"}</p>
          <ol className="mt-2 space-y-2">
            {v.pasos.map((p) => (
              <li key={`${p.clave}#${p.numero}`} className="rounded-control border border-borde bg-white px-3 py-2 text-sm">
                <p className="font-medium text-texto">
                  {p.numero}. {p.nombre} <span className="font-normal text-texto-secundario">→ {p.destino}</span>
                </p>
                {p.custodia || p.omitible || p.plazo ? (
                  <p className="text-xs text-texto-secundario">
                    {[p.custodia ? `custodia: ${p.custodia}` : null, p.omitible ? "omitible" : null, p.plazo ? `plazo: ${p.plazo}` : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {p.subtareas.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-texto">
                    {p.subtareas.map((s) => (
                      <li key={s.clave}>
                        {s.nombre}
                        {s.obligatoria ? "" : " (opcional)"}
                        {s.dato ? ` · pide ${s.dato}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
        <section aria-label="Documentación">
          <h3 className="text-base font-semibold text-texto">Documentación</h3>
          <ul className="list-disc pl-5 text-sm text-texto">
            {v.documentos.map((d) => (
              <li key={d.clave}>
                {d.nombre} <span className="text-texto-secundario">({d.origen === "direccion" ? "Dirección" : "concesionario"}{d.obligatorio ? "" : ", opcional"}{d.soloSiJuridica ? `, solo si ${d.soloSiJuridica} es persona jurídica` : ""})</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Conceptos">
          <h3 className="text-base font-semibold text-texto">Conceptos</h3>
          <ul className="list-disc pl-5 text-sm text-texto">
            {v.conceptos.map((c) => (
              <li key={c.clave}>
                {c.nombre} <span className="text-texto-secundario">({VIA_TEXTO[c.via] ?? c.via}, en {c.paso})</span>
              </li>
            ))}
          </ul>
        </section>
        {v.excluidos.length > 0 ? (
          <section aria-label="Lo que no corresponde en este cementerio">
            <h3 className="text-base font-semibold text-texto">No corresponde en {v.cementerio}</h3>
            <ul className="list-disc pl-5 text-sm text-texto-secundario">
              {v.excluidos.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
