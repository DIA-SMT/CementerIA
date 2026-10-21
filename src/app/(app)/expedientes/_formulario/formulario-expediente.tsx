"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CircleAlert, FileText, Layers, Lock, MapPin, Plus, Printer, Save, Trash2, UserRound, type LucideIcon } from "lucide-react";
import { Aviso } from "@/components/aviso";
import {
  atributosCampo,
  Campo,
  CLASE_BOTON_COMPACTO_PELIGRO,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CASILLA,
  CLASE_CONTROL,
  CLASE_ENLACE,
  MensajeError,
  Seccion,
} from "@/components/formulario";
import type { CodigoNombre } from "@/lib/dominio/expedientes/contexto";
import type { AvisoDuplicado } from "@/lib/dominio/expedientes/duplicados";
import { LARGO_MINIMO_MOTIVO, type ErrorCampo } from "@/lib/dominio/expedientes/errores";
import {
  construirEsquemaAlta,
  construirEsquemaEdicion,
  DIAS_RETROACTIVOS_MAX,
  erroresDe,
  type ContextoEdicion,
  type ContextoEsquema,
} from "@/lib/dominio/expedientes/esquemas";
import type { CampoUbicacion } from "@/lib/dominio/expedientes/ubicacion";
import type { DefinicionPlantilla, PersonaPlantilla } from "@/lib/dominio/plantillas/esquema";
import { FECHA_MINIMA_INICIO, sumarDias } from "@/lib/fechas";
import { rutaFicha } from "@/lib/presentacion/enlaces";
import { erroresPorRuta, idDeCampo } from "@/lib/presentacion/errores";
import {
  agregarPersona,
  cambiaIdentificatorios,
  cambiosEdicionDesde,
  claveNueva,
  datosAltaDesde,
  documentosDelAlta,
  marcarContacto,
  puedeAgregar,
  puedeQuitar,
  type PermisosEdicion,
  type PersonaFormulario,
  type ValoresFormulario,
} from "@/lib/presentacion/formulario";
import { consultarDuplicados, guardarAlta, guardarEdicion } from "../acciones";

/**
 * El formulario del alta (`/expedientes/nuevo`) y de la edición
 * (`/expedientes/[numero]/editar`), sección 5: el mismo formulario por
 * secciones, armado con la plantilla y el cementerio.
 *
 * - Valida en el navegador con los esquemas zod del dominio (los mismos
 *   mensajes que el servidor) y el servidor vuelve a validar siempre.
 * - El `comandoId` lo genera el servidor al abrir el formulario y viaja en cada
 *   envío: un doble clic o un reintento no duplica el alta.
 * - Los errores van junto a cada campo (`aria-invalid`, `aria-describedby`) y
 *   en un resumen arriba que recibe el foco.
 * - Avisa posibles duplicados al salir de la ubicación, el padrón o el N°
 *   municipal; es un aviso, no un bloqueo.
 * - `definicion` llega ya filtrada por el cementerio (contexto.definicion): los
 *   documentos que se ofrecen son los de ese cementerio y, los que dependen de
 *   una persona jurídica, aparecen al elegirla (`documentosDelAlta`).
 */

interface Comunes {
  comandoId: string;
  definicion: DefinicionPlantilla;
  camposUbicacion: CampoUbicacion[];
  tiposMonumento: CodigoNombre[];
  cementerios: CodigoNombre[];
  hoy: string;
  plantilla: { id: number; nombre: string; version: number; tipoTramite: string };
  cementerio: { id: number; nombre: string };
  valoresIniciales: ValoresFormulario;
}

export interface PropsAlta extends Comunes {
  modo: "alta";
  esquema: ContextoEsquema;
  puedeCargaHistorica: boolean;
  /** A dónde ir para elegir otro trámite o cementerio. */
  urlCambiar: string;
  /** Semana 4: el alta continúa un expediente anulado por "Reiniciar con otra plantilla" (`?desde=`). */
  expedienteAnteriorId?: string | null;
}

export interface PropsEdicion extends Comunes {
  modo: "edicion";
  esquema: ContextoEdicion;
  numero: string;
  version: number;
  permisos: PermisosEdicion;
  /** Ya hubo un pase: cambiar datos identificatorios pide motivo. */
  requiereMotivo: boolean;
  /** Por qué no se pueden editar algunas partes (para decirlo). */
  avisosPermiso: string[];
}

type LocalError = { mensaje: string; errores: ErrorCampo[] } | null;

const ETIQUETA_FORMA_PAGO = { contado: "Contado", plan_pagos: "Plan de pagos" } as const;

export function FormularioExpediente(props: PropsAlta | PropsEdicion) {
  const { definicion: def, camposUbicacion, hoy, comandoId } = props;
  const edicion = props.modo === "edicion" ? props : null;
  const alta = props.modo === "alta" ? props : null;

  const [valores, setValores] = useState<ValoresFormulario>(props.valoresIniciales);
  const [motivo, setMotivo] = useState("");
  const [local, setLocal] = useState<LocalError>(null);
  // Rutas que se cambiaron desde el último envío: su error deja de mostrarse.
  // "personas*" = todas las que empiezan así (al agregar o quitar, los índices cambian).
  const [corregidas, setCorregidas] = useState<ReadonlySet<string>>(new Set());
  const [avisos, setAvisos] = useState<AvisoDuplicado[]>([]);
  const consulta = useRef(0);
  const resumen = useRef<HTMLDivElement>(null);

  const numero = edicion?.numero ?? null;
  const accion = useMemo(() => (numero === null ? guardarAlta : guardarEdicion.bind(null, numero)), [numero]);
  const [estado, enviar, pendiente] = useActionState(accion, null);

  const clavesUbicacion = useMemo(() => camposUbicacion.map((c) => c.clave), [camposUbicacion]);
  const permisos: PermisosEdicion = edicion?.permisos ?? { identificatorios: true, contacto: true, extras: true };
  const bloqueadoIdent = !permisos.identificatorios;
  const bloqueadoContacto = !permisos.contacto;
  const bloqueadoExtras = !permisos.extras;

  // Lo que se muestra: los errores del navegador, o si no, los del servidor.
  const mostrado = useMemo(
    () => local ?? (estado && !pendiente ? { mensaje: estado.mensaje, errores: estado.errores } : null),
    [local, estado, pendiente],
  );
  const pendientes = useMemo(
    () => (mostrado?.errores ?? []).filter((e) => ![...corregidas].some((r) => (r.endsWith("*") ? e.ruta.startsWith(r.slice(0, -1)) : e.ruta === r))),
    [mostrado, corregidas],
  );
  const errores = useMemo(() => erroresPorRuta(pendientes), [pendientes]);
  const err = (ruta: string) => errores.get(ruta);

  // El resumen recibe el foco cada vez que aparece un error nuevo.
  useEffect(() => {
    if (mostrado) resumen.current?.focus();
  }, [mostrado]);

  const motivoVisible =
    edicion !== null && edicion.requiereMotivo && cambiaIdentificatorios(props.valoresIniciales, valores, def, clavesUbicacion);

  function corregir(...rutas: string[]) {
    setCorregidas((c) => (rutas.every((r) => c.has(r)) ? c : new Set([...c, ...rutas])));
  }

  function poner<K extends keyof ValoresFormulario>(clave: K, valor: ValoresFormulario[K], ruta: string = clave) {
    setValores((v) => ({ ...v, [clave]: valor }));
    corregir(ruta);
  }

  function ponerPersona(clave: string, cambios: Partial<PersonaFormulario>) {
    const i = valores.personas.findIndex((p) => p.clave === clave);
    corregir(...Object.keys(cambios).map((campo) => `personas[${i}].${campo}`), `personas[${i}]`);
    setValores((v) => ({ ...v, personas: v.personas.map((p) => (p.clave === clave ? { ...p, ...cambios } : p)) }));
  }

  async function revisarDuplicados() {
    const ubicacion = Object.fromEntries(clavesUbicacion.map((c) => [c, valores.ubicacion[c]?.trim() || null]));
    const hayAlgo = Object.values(ubicacion).some(Boolean) || valores.padron.trim() !== "" || valores.numeroMunicipal.trim() !== "";
    const n = ++consulta.current;
    if (!hayAlgo) {
      setAvisos([]);
      return;
    }
    try {
      const r = await consultarDuplicados({
        cementerioId: props.cementerio.id,
        ubicacion,
        padron: valores.padron.trim() || null,
        numeroMunicipal: valores.numeroMunicipal.trim() || null,
        excluirNumero: numero,
      });
      if (n === consulta.current) setAvisos(r);
    } catch {
      // Es un aviso: si la consulta falla, se sigue sin él (al guardar se vuelve a mirar).
    }
  }

  function alEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (pendiente) return;
    // Cada envío empieza de cero: "corregidas" son las rutas cambiadas desde
    // el envío anterior. Sin esto, el error de un campo que se tocó antes del
    // primer envío (una sección mal escrita) no se mostraba nunca.
    setCorregidas(new Set());
    const boton = (evento.nativeEvent as SubmitEvent).submitter;
    const destino = boton instanceof HTMLButtonElement && boton.value === "ficha" ? "ficha" : "caratula";
    const form = new FormData();
    form.set("comandoId", comandoId);

    if (alta) {
      const datos = datosAltaDesde(valores, {
        plantillaId: alta.plantilla.id,
        cementerioId: alta.cementerio.id,
        definicion: def,
        clavesUbicacion,
      });
      if (alta.expedienteAnteriorId) datos.expedienteAnteriorId = alta.expedienteAnteriorId;
      const problemas = erroresDe(construirEsquemaAlta(alta.esquema), datos);
      if (problemas.length > 0) {
        setLocal({ mensaje: "Revisá los datos marcados", errores: problemas });
        return;
      }
      form.set("datos", JSON.stringify(datos));
      form.set("destino", destino);
    } else if (edicion) {
      const cambios = cambiosEdicionDesde(edicion.valoresIniciales, valores, def, clavesUbicacion, permisos);
      if (Object.keys(cambios).length === 0) {
        setLocal({ mensaje: "No hay cambios para guardar", errores: [] });
        return;
      }
      const problemas = erroresDe(construirEsquemaEdicion(edicion.esquema), cambios);
      if (motivoVisible && motivo.trim().length < LARGO_MINIMO_MOTIVO) {
        problemas.push({ ruta: "motivo", mensaje: `Escribí el motivo (${LARGO_MINIMO_MOTIVO} caracteres o más)` });
      }
      if (problemas.length > 0) {
        setLocal({ mensaje: "Revisá los datos marcados", errores: problemas });
        return;
      }
      form.set("datos", JSON.stringify(cambios));
      form.set("versionVista", String(edicion.version));
      form.set("motivo", motivo);
    }
    setLocal(null);
    startTransition(() => enviar(form));
  }

  const minimoInicio = valores.cargaHistorica ? FECHA_MINIMA_INICIO : sumarDias(hoy, -DIAS_RETROACTIVOS_MAX);
  const documentosAlta = documentosDelAlta(def, valores.personas);
  const nombrePaso = (clave: string | null) => (clave === null ? "concluir" : (def.pasos.find((p) => p.clave === clave)?.nombre ?? clave));

  // El número de cada bloque, contando solo los que se muestran.
  const bloques = [
    "tramite",
    "monumento",
    "personas",
    ...(def.campos_extra.length > 0 ? ["extras"] : []),
    ...(alta && documentosAlta.length > 0 ? ["documentos"] : []),
    "observaciones",
    ...(motivoVisible ? ["motivo"] : []),
  ];
  const numeroDe = (bloque: string) => bloques.indexOf(bloque) + 1;

  return (
    <form onSubmit={alEnviar} noValidate className="space-y-5" aria-busy={pendiente}>
      {mostrado ? (
        <div
          ref={resumen}
          tabIndex={-1}
          role="alert"
          id="campo-formulario"
          className="rounded-tarjeta border border-error-borde border-l-4 border-l-error bg-error-fondo px-4 py-3 text-sm text-error shadow-tarjeta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error"
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {mostrado.mensaje}
            {pendientes.length > 0 ? (
              <span className="insignia bg-error text-white">
                {pendientes.length === 1 ? "1 dato" : `${pendientes.length} datos`}
              </span>
            ) : null}
          </p>
          {estado?.codigo === "conflicto_version" && !local && edicion ? (
            <p className="mt-1">
              <a href={`${rutaFicha(edicion.numero)}/editar`} className={CLASE_ENLACE}>
                Recargar el formulario con los datos actuales
              </a>{" "}
              (se pierden los cambios sin guardar).
            </p>
          ) : null}
          {estado?.codigo === "plantilla_no_publicada" && !local && alta ? (
            <p className="mt-1">
              <a href={alta.urlCambiar} className={CLASE_ENLACE}>
                Volver a elegir el trámite
              </a>
            </p>
          ) : null}
          {pendientes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-6">
              {pendientes.map((e, i) => (
                <li key={`${e.ruta}-${i}`}>
                  <a
                    href={`#${idDeCampo(e.ruta)}`}
                    className="rounded-sm underline decoration-error/50 underline-offset-2 hover:decoration-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario"
                  >
                    {e.mensaje}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {edicion && edicion.avisosPermiso.length > 0 ? (
        <Aviso tono="neutro" icono={Lock}>
          {edicion.avisosPermiso.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </Aviso>
      ) : null}

      <Seccion numero={numeroDe("tramite")} titulo="Información del trámite">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <DatoTramite icono={FileText} titulo="Tipo de trámite" valor={props.plantilla.tipoTramite} />
          <DatoTramite icono={Layers} titulo="Plantilla" valor={`${props.plantilla.nombre} · v${props.plantilla.version}`} />
          <DatoTramite icono={MapPin} titulo="Cementerio" valor={props.cementerio.nombre} />
        </dl>
        {alta ? (
          <p className="text-sm">
            <Link href={alta.urlCambiar} className={CLASE_ENLACE}>
              Elegir otro trámite o cementerio
            </Link>{" "}
            <span className="text-texto-secundario">(se pierde lo cargado)</span>
          </p>
        ) : null}
        {alta && def.forma_pago === "a_elegir" ? (
          <fieldset id={idDeCampo("formaPago")} aria-invalid={err("formaPago") ? true : undefined} aria-describedby={err("formaPago") ? `${idDeCampo("formaPago")}-error` : undefined}>
            <legend className="mb-1.5 text-sm font-medium text-texto">
              Forma de pago <span className="text-error" aria-hidden="true">*</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {(["contado", "plan_pagos"] as const).map((forma) => (
                <label
                  key={forma}
                  className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control border border-borde-control bg-white px-3 text-sm transition-colors duration-150 hover:border-primario has-checked:border-primario has-checked:bg-superficie-azul has-checked:font-medium"
                >
                  <input
                    type="radio"
                    name="formaPago"
                    value={forma}
                    checked={valores.formaPago === forma}
                    onChange={() => poner("formaPago", forma)}
                    className={CLASE_CASILLA}
                  />
                  {ETIQUETA_FORMA_PAGO[forma]}
                </label>
              ))}
            </div>
            <MensajeError ruta="formaPago" errores={err("formaPago")} />
          </fieldset>
        ) : null}
      </Seccion>

      <Seccion numero={numeroDe("monumento")} titulo="Monumento y ubicación">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo ruta="tipoMonumento" etiqueta="Tipo de monumento" obligatorio errores={err("tipoMonumento")}>
            <select
              {...atributosCampo("tipoMonumento", err("tipoMonumento"))}
              value={valores.tipoMonumento}
              onChange={(e) => poner("tipoMonumento", e.target.value)}
              disabled={bloqueadoIdent}
              className={CLASE_CONTROL}
            >
              <option value="">Elegí…</option>
              {props.tiposMonumento.map((t) => (
                <option key={t.codigo} value={t.codigo}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        {camposUbicacion.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-control border border-borde bg-fondo/60 p-3 sm:grid-cols-4 sm:p-4">
            <p className="col-span-full -mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-texto-secundario">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Ubicación · {props.cementerio.nombre}
            </p>
            {camposUbicacion.map((c) => {
              const ruta = `ubicacion.${c.clave}`;
              return (
                <Campo
                  key={c.clave}
                  ruta={ruta}
                  etiqueta={c.etiqueta}
                  obligatorio={def.ubicacion_obligatoria && c.obligatorio}
                  errores={err(ruta)}
                  ayuda={c.ayuda ? `Se escribe ${c.ayuda}` : undefined}
                >
                  <input
                    {...atributosCampo(ruta, err(ruta), c.ayuda ? `${idDeCampo(ruta)}-ayuda` : undefined)}
                    type="text"
                    inputMode={c.tipo === "entero" ? "numeric" : undefined}
                    autoComplete="off"
                    value={valores.ubicacion[c.clave] ?? ""}
                    onChange={(e) => poner("ubicacion", { ...valores.ubicacion, [c.clave]: e.target.value }, ruta)}
                    onBlur={revisarDuplicados}
                    disabled={bloqueadoIdent}
                    className={CLASE_CONTROL}
                  />
                </Campo>
              );
            })}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo ruta="padron" etiqueta="Padrón" errores={err("padron")}>
            <input
              {...atributosCampo("padron", err("padron"))}
              type="text"
              autoComplete="off"
              value={valores.padron}
              onChange={(e) => poner("padron", e.target.value)}
              onBlur={revisarDuplicados}
              disabled={bloqueadoIdent}
              className={CLASE_CONTROL}
            />
          </Campo>
          <Campo ruta="numeroMunicipal" etiqueta="N° municipal" errores={err("numeroMunicipal")} ayuda="Como figura en el papel, por ejemplo 12.345/2026">
            <input
              {...atributosCampo("numeroMunicipal", err("numeroMunicipal"), `${idDeCampo("numeroMunicipal")}-ayuda`)}
              type="text"
              autoComplete="off"
              value={valores.numeroMunicipal}
              onChange={(e) => poner("numeroMunicipal", e.target.value)}
              onBlur={revisarDuplicados}
              disabled={bloqueadoIdent}
              className={CLASE_CONTROL}
            />
          </Campo>
        </div>
        <div aria-live="polite">
          {avisos.length > 0 ? (
            <Aviso tono="advertencia" titulo="Posible duplicado: revisá antes de guardar (se puede guardar igual)">
              <ul className="list-disc pl-5">
                {avisos.map((a) => (
                  <li key={a.numero}>
                    <a href={rutaFicha(a.numero)} target="_blank" rel="noopener" className={CLASE_ENLACE}>
                      {a.mensaje}
                    </a>{" "}
                    <span>(se abre en otra pestaña)</span>
                  </li>
                ))}
              </ul>
            </Aviso>
          ) : null}
        </div>
      </Seccion>

      <Seccion numero={numeroDe("personas")} titulo="Personas" descripcion={def.requiere_contacto ? "Marcá qué persona es el contacto: tiene que tener teléfono o correo." : undefined}>
        <div id={idDeCampo("personas")} tabIndex={-1}>
          <MensajeError ruta="personas" errores={err("personas")} />
        </div>
        {def.personas.map((rol) => (
          <GrupoRol
            key={rol.rol}
            rol={rol}
            valores={valores}
            err={err}
            bloqueadoIdent={bloqueadoIdent}
            bloqueadoContacto={bloqueadoContacto}
            hoy={hoy}
            onCambiar={ponerPersona}
            onContacto={(clave, marcado) => poner("personas", marcarContacto(valores.personas, clave, marcado), "personas")}
            onAgregar={() => poner("personas", agregarPersona(def, valores.personas, rol, claveNueva()), "personas*")}
            onQuitar={(clave) => poner("personas", valores.personas.filter((p) => p.clave !== clave), "personas*")}
          />
        ))}
      </Seccion>

      {def.campos_extra.length > 0 ? (
        <Seccion numero={numeroDe("extras")} titulo="Datos del trámite" descripcion="Ninguno es obligatorio en el alta; los marcados se piden para avanzar.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {def.campos_extra.map((c) => {
              const ruta = `datosExtra.${c.clave}`;
              const valor = valores.datosExtra[c.clave] ?? "";
              const cambiar = (v: string) => poner("datosExtra", { ...valores.datosExtra, [c.clave]: v }, ruta);
              const ayuda = c.obligatorio ? `Se pide para avanzar: al salir de ${nombrePaso(c.exigir_al_salir_de)}` : undefined;
              const atributos = atributosCampo(ruta, err(ruta), ayuda ? `${idDeCampo(ruta)}-ayuda` : undefined);
              return (
                <Campo key={c.clave} ruta={ruta} etiqueta={c.etiqueta} errores={err(ruta)} ayuda={ayuda}>
                  {c.tipo === "opcion" || c.tipo === "cementerio" ? (
                    <select {...atributos} value={valor} onChange={(e) => cambiar(e.target.value)} disabled={bloqueadoExtras} className={CLASE_CONTROL}>
                      <option value="">Sin dato</option>
                      {(c.tipo === "opcion" ? (c.opciones ?? []).map((o) => ({ codigo: o, nombre: o })) : props.cementerios).map((o) => (
                        <option key={o.codigo} value={o.codigo}>
                          {o.nombre}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      {...atributos}
                      type={c.tipo === "fecha" ? "date" : "text"}
                      inputMode={c.tipo === "numero" ? "decimal" : undefined}
                      value={valor}
                      onChange={(e) => cambiar(e.target.value)}
                      disabled={bloqueadoExtras}
                      className={CLASE_CONTROL}
                    />
                  )}
                </Campo>
              );
            })}
          </div>
        </Seccion>
      ) : null}

      {alta && documentosAlta.length > 0 ? (
        <Seccion
          numero={numeroDe("documentos")}
          titulo="Documentación recibida con el alta"
          descripcion="Marcá lo que se entrega hoy en el mostrador. Lo demás queda pendiente."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(["direccion", "concesionario"] as const).map((origen) => {
              const docs = documentosAlta.filter((d) => d.origen === origen);
              const Icono = origen === "direccion" ? Building2 : UserRound;
              const recibidos = docs.filter((d) => valores.documentosRecibidos.includes(d.clave)).length;
              return (
                <fieldset key={origen} className="min-w-0 rounded-control border border-borde bg-fondo/60 px-3 pb-3 pt-2.5">
                  <legend className="float-left mb-2 flex w-full items-center gap-2 text-sm font-semibold text-texto">
                    <Icono className="h-4 w-4 text-primario-oscuro" aria-hidden="true" />
                    {origen === "direccion" ? "Dirección" : "Concesionario"}
                    {docs.length > 0 ? (
                      <span className="ml-auto text-xs font-normal text-texto-secundario tabular-nums">
                        {recibidos} de {docs.length}
                        <span className="sr-only"> marcados</span>
                      </span>
                    ) : null}
                  </legend>
                  <div className="clear-both">
                    {docs.length === 0 ? <p className="px-1 text-sm text-texto-secundario">Ninguno</p> : null}
                    <ul className="space-y-0.5">
                      {docs.map((d) => (
                        <li key={d.clave}>
                          <label className="flex cursor-pointer items-start gap-2.5 rounded-control px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-white has-checked:bg-white">
                            <input
                              type="checkbox"
                              checked={valores.documentosRecibidos.includes(d.clave)}
                              onChange={(e) =>
                                poner(
                                  "documentosRecibidos",
                                  e.target.checked ? [...valores.documentosRecibidos, d.clave] : valores.documentosRecibidos.filter((x) => x !== d.clave),
                                )
                              }
                              className={`${CLASE_CASILLA} mt-0.5 shrink-0`}
                            />
                            <span>
                              {d.nombre}
                              {d.obligatorio ? <span className="text-texto-secundario"> (obligatorio)</span> : null}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <MensajeError ruta="documentosRecibidos" errores={err("documentosRecibidos")} />
        </Seccion>
      ) : null}

      <Seccion numero={numeroDe("observaciones")} titulo="Observaciones y fecha de inicio">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Campo ruta="observaciones" etiqueta="Observaciones" errores={err("observaciones")} className="lg:col-span-2">
            <textarea
              {...atributosCampo("observaciones", err("observaciones"))}
              rows={3}
              value={valores.observaciones}
              onChange={(e) => poner("observaciones", e.target.value)}
              disabled={bloqueadoContacto}
              className={CLASE_CONTROL}
            />
          </Campo>
          <div className="space-y-4">
            <Campo
              ruta="fechaInicio"
              etiqueta="Fecha de inicio"
              obligatorio
              errores={err("fechaInicio")}
              ayuda={valores.cargaHistorica ? "Desde 1950 hasta hoy" : `Hasta ${DIAS_RETROACTIVOS_MAX} días atrás`}
            >
              <input
                {...atributosCampo("fechaInicio", err("fechaInicio"), `${idDeCampo("fechaInicio")}-ayuda`)}
                type="date"
                min={minimoInicio}
                max={hoy}
                value={valores.fechaInicio}
                onChange={(e) => poner("fechaInicio", e.target.value)}
                disabled={bloqueadoIdent}
                className={CLASE_CONTROL}
              />
            </Campo>
            {alta && alta.puedeCargaHistorica ? (
              <label className="flex items-center gap-2 text-sm font-medium text-texto">
                <input
                  type="checkbox"
                  checked={valores.cargaHistorica}
                  onChange={(e) => poner("cargaHistorica", e.target.checked)}
                  className={CLASE_CASILLA}
                />
                Expediente iniciado antes del sistema
              </label>
            ) : null}
          </div>
        </div>
        {alta && alta.puedeCargaHistorica && valores.cargaHistorica ? (
          <Campo
            ruta="fuente"
            etiqueta="Fuente"
            obligatorio
            errores={err("fuente")}
            ayuda='De dónde sale la fecha: por ejemplo "Ficha papel" o "Libro de pases de Legal"'
            className="lg:w-2/3"
          >
            <input
              {...atributosCampo("fuente", err("fuente"), `${idDeCampo("fuente")}-ayuda`)}
              type="text"
              value={valores.fuente}
              onChange={(e) => poner("fuente", e.target.value)}
              className={CLASE_CONTROL}
            />
          </Campo>
        ) : null}
      </Seccion>

      {motivoVisible ? (
        <Seccion
          numero={numeroDe("motivo")}
          titulo="Motivo del cambio"
          descripcion="El expediente ya tuvo un pase: para cambiar datos identificatorios hace falta el motivo. Queda en el historial."
        >
          <Campo ruta="motivo" etiqueta="Motivo" obligatorio errores={err("motivo")} ayuda={`${LARGO_MINIMO_MOTIVO} caracteres o más`}>
            <textarea
              {...atributosCampo("motivo", err("motivo"), `${idDeCampo("motivo")}-ayuda`)}
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className={CLASE_CONTROL}
            />
          </Campo>
        </Seccion>
      ) : null}

      {/* Barra de acciones al pie, fija abajo mientras se recorre el formulario
          (globals.css reserva su alto con scroll-padding: el foco no queda tapado).
          El primer botón de envío es "Guardar e imprimir carátula": Enter en un
          campo envía con ese, como antes. */}
      <div className="barra-acciones sticky bottom-0 z-10 -mx-4 border-t border-borde bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgb(15_47_93/0.06)] backdrop-blur-sm lg:-mx-8 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {alta ? (
            <>
              <button type="submit" value="caratula" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Guardar e imprimir carátula
              </button>
              <button type="submit" value="ficha" disabled={pendiente} className={CLASE_BOTON_SECUNDARIO}>
                <Save className="h-4 w-4" aria-hidden="true" />
                Guardar
              </button>
              <Link href="/expedientes" className={`${CLASE_ENLACE} px-1 text-sm`}>
                Cancelar
              </Link>
            </>
          ) : edicion ? (
            <>
              <button type="submit" disabled={pendiente} className={CLASE_BOTON_PRIMARIO}>
                <Save className="h-4 w-4" aria-hidden="true" />
                Guardar cambios
              </button>
              <Link href={rutaFicha(edicion.numero)} prefetch={false} className={`${CLASE_ENLACE} px-1 text-sm`}>
                Cancelar
              </Link>
            </>
          ) : null}
          <span aria-live="polite" className="text-sm text-texto-secundario empty:hidden">
            {pendiente ? "Guardando…" : ""}
          </span>
          {/* El resumen de errores queda arriba: desde la barra se vuelve a él. */}
          {mostrado && pendientes.length > 0 && !pendiente ? (
            <a href="#campo-formulario" className={`${CLASE_ENLACE} inline-flex items-center gap-1 text-sm font-medium sm:ml-auto`}>
              <CircleAlert className="h-4 w-4 text-error" aria-hidden="true" />
              {pendientes.length === 1 ? "1 dato para corregir" : `${pendientes.length} datos para corregir`}
            </a>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** Un dato fijo del trámite (tipo, plantilla, cementerio) con su ícono: los indicadores del bloque 1. */
function DatoTramite({ icono: Icono, titulo, valor }: { icono: LucideIcon; titulo: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-control border border-borde bg-fondo/60 px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-xs text-texto-secundario">
        <Icono className="h-3.5 w-3.5 text-primario-oscuro" aria-hidden="true" />
        {titulo}
      </dt>
      <dd className="mt-0.5 font-medium text-texto">{valor}</dd>
    </div>
  );
}

function GrupoRol({
  rol,
  valores,
  err,
  bloqueadoIdent,
  bloqueadoContacto,
  hoy,
  onCambiar,
  onContacto,
  onAgregar,
  onQuitar,
}: {
  rol: PersonaPlantilla;
  valores: ValoresFormulario;
  err: (ruta: string) => string[] | undefined;
  bloqueadoIdent: boolean;
  bloqueadoContacto: boolean;
  hoy: string;
  onCambiar: (clave: string, cambios: Partial<PersonaFormulario>) => void;
  onContacto: (clave: string, marcado: boolean) => void;
  onAgregar: () => void;
  onQuitar: (clave: string) => void;
}) {
  const delRol = valores.personas.map((p, indice) => ({ p, indice })).filter(({ p }) => p.rol === rol.rol);
  const cantidad = rol.min === rol.max ? `${rol.min}` : rol.min === 0 ? `hasta ${rol.max}` : `de ${rol.min} a ${rol.max}`;
  return (
    <fieldset className="min-w-0 rounded-control border border-borde px-3 pb-3 pt-1 sm:px-4">
      <legend className="px-1.5 text-sm font-semibold text-texto">
        {rol.etiqueta} <span className="font-normal text-texto-secundario">({cantidad})</span>
      </legend>
      {delRol.length === 0 ? <p className="py-1 text-sm text-texto-secundario">Ninguna cargada.</p> : null}
      <div className="space-y-3">
        {delRol.map(({ p, indice }, n) => (
          <Persona
            key={p.clave}
            rol={rol}
            persona={p}
            indice={indice}
            titulo={rol.max > 1 ? `${rol.etiqueta} ${n + 1}` : rol.etiqueta}
            err={err}
            bloqueadoIdent={bloqueadoIdent}
            bloqueadoContacto={bloqueadoContacto}
            hoy={hoy}
            puedeQuitar={!bloqueadoIdent && puedeQuitar(rol, valores.personas)}
            onCambiar={(cambios) => onCambiar(p.clave, cambios)}
            onContacto={(marcado) => onContacto(p.clave, marcado)}
            onQuitar={() => onQuitar(p.clave)}
          />
        ))}
      </div>
      {!bloqueadoIdent && puedeAgregar(rol, valores.personas) ? (
        <button type="button" onClick={onAgregar} className={`${CLASE_BOTON_SECUNDARIO} mt-3`}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Agregar {rol.etiqueta.toLowerCase()}
        </button>
      ) : null}
    </fieldset>
  );
}

function Persona({
  rol,
  persona: p,
  indice,
  titulo,
  err,
  bloqueadoIdent,
  bloqueadoContacto,
  hoy,
  puedeQuitar,
  onCambiar,
  onContacto,
  onQuitar,
}: {
  rol: PersonaPlantilla;
  persona: PersonaFormulario;
  indice: number;
  titulo: string;
  err: (ruta: string) => string[] | undefined;
  bloqueadoIdent: boolean;
  bloqueadoContacto: boolean;
  hoy: string;
  puedeQuitar: boolean;
  onCambiar: (cambios: Partial<PersonaFormulario>) => void;
  onContacto: (marcado: boolean) => void;
  onQuitar: () => void;
}) {
  const r = (campo: string) => `personas[${indice}].${campo}`;
  const idTitulo = `${idDeCampo(`personas[${indice}]`)}-titulo`;
  // Una asociación con panteón (docs/fuentes): razón social y CUIT en vez de
  // apellido, nombres y DNI, y no fallece. Solo en los roles que la admiten.
  const juridica = rol.admite_juridica && p.tipo === "juridica";
  const fallecido = juridica ? false : rol.fallecido === "si" ? true : rol.fallecido === "no" ? false : p.fallecido;
  const texto = (
    campo: "apellido" | "nombres" | "dni" | "razonSocial" | "cuit" | "vinculo" | "telefono" | "email" | "domicilio",
    etiqueta: string,
    opciones: { obligatorio?: boolean; tipo?: string; bloqueado: boolean; autoComplete?: string; inputMode?: "numeric" | "tel" | "email"; ayuda?: string },
  ) => (
    <Campo ruta={r(campo)} etiqueta={etiqueta} obligatorio={opciones.obligatorio} errores={err(r(campo))} ayuda={opciones.ayuda}>
      <input
        {...atributosCampo(r(campo), err(r(campo)), opciones.ayuda ? `${idDeCampo(r(campo))}-ayuda` : undefined)}
        type={opciones.tipo ?? "text"}
        inputMode={opciones.inputMode}
        autoComplete={opciones.autoComplete ?? "off"}
        value={p[campo]}
        onChange={(e) => onCambiar({ [campo]: e.target.value })}
        disabled={opciones.bloqueado}
        className={CLASE_CONTROL}
      />
    </Campo>
  );

  return (
    <div role="group" aria-labelledby={idTitulo} className="rounded-control bg-fondo p-3 sm:p-4">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
        <h3 id={idTitulo} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-texto">
          {titulo}
          {p.esContacto ? <span className="insignia bg-info-fondo text-info ring-1 ring-inset ring-info-borde">Contacto</span> : null}
        </h3>
        {puedeQuitar ? (
          <button type="button" onClick={onQuitar} className={CLASE_BOTON_COMPACTO_PELIGRO}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Quitar<span className="sr-only"> {titulo}</span>
          </button>
        ) : null}
      </div>
      <MensajeError ruta={`personas[${indice}]`} errores={[...(err(`personas[${indice}]`) ?? []), ...(err(r("rol")) ?? []), ...(err(r("id")) ?? [])]} />
      {rol.admite_juridica ? (
        <fieldset
          id={idDeCampo(r("tipo"))}
          className="mb-3"
          aria-invalid={err(r("tipo")) ? true : undefined}
          aria-describedby={err(r("tipo")) ? `${idDeCampo(r("tipo"))}-error` : undefined}
        >
          <legend className="sr-only">Tipo de persona de {titulo}</legend>
          <div className="flex flex-wrap gap-4">
            {([
              ["fisica", "Persona física"],
              ["juridica", "Persona jurídica"],
            ] as const).map(([tipo, etiqueta]) => (
              <label key={tipo} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`tipo-${p.clave}`}
                  value={tipo}
                  checked={p.tipo === tipo}
                  onChange={() => onCambiar(tipo === "juridica" ? { tipo, fallecido: false } : { tipo })}
                  disabled={bloqueadoIdent}
                  className={CLASE_CASILLA}
                />
                {etiqueta}
              </label>
            ))}
          </div>
          <MensajeError ruta={r("tipo")} errores={err(r("tipo"))} />
        </fieldset>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {juridica ? (
          <>
            <div className="sm:col-span-2">{texto("razonSocial", "Razón social", { obligatorio: true, bloqueado: bloqueadoIdent })}</div>
            {texto("cuit", "CUIT", { obligatorio: true, bloqueado: bloqueadoIdent, inputMode: "numeric", ayuda: "11 dígitos, con o sin guiones" })}
          </>
        ) : (
          <>
            {texto("apellido", "Apellido", { obligatorio: true, bloqueado: bloqueadoIdent })}
            {texto("nombres", "Nombres", { obligatorio: true, bloqueado: bloqueadoIdent })}
            {texto("dni", "DNI", { bloqueado: bloqueadoIdent, inputMode: "numeric" })}
          </>
        )}
        {!juridica && rol.fallecido === "opcional" ? (
          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                id={idDeCampo(r("fallecido"))}
                type="checkbox"
                checked={p.fallecido}
                onChange={(e) => onCambiar({ fallecido: e.target.checked, esContacto: e.target.checked ? false : p.esContacto })}
                disabled={bloqueadoIdent}
                aria-invalid={err(r("fallecido")) ? true : undefined}
                className={CLASE_CASILLA}
              />
              Falleció
            </label>
            <MensajeError ruta={r("fallecido")} errores={err(r("fallecido"))} />
          </div>
        ) : null}
        {fallecido ? (
          <Campo ruta={r("fechaDefuncion")} etiqueta="Fecha de defunción" errores={err(r("fechaDefuncion"))}>
            <input
              {...atributosCampo(r("fechaDefuncion"), err(r("fechaDefuncion")))}
              type="date"
              max={hoy}
              value={p.fechaDefuncion}
              onChange={(e) => onCambiar({ fechaDefuncion: e.target.value })}
              disabled={bloqueadoIdent}
              className={CLASE_CONTROL}
            />
          </Campo>
        ) : null}
        {rol.pide_vinculo ? texto("vinculo", "Vínculo con el titular", { obligatorio: true, bloqueado: bloqueadoIdent }) : null}
      </div>
      {!fallecido ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            {texto("telefono", "Teléfono", { tipo: "tel", bloqueado: bloqueadoContacto, inputMode: "tel" })}
            <label className="mt-1.5 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={p.telefonoWhatsapp}
                onChange={(e) => onCambiar({ telefonoWhatsapp: e.target.checked })}
                disabled={bloqueadoContacto || p.telefono.trim() === ""}
                className={CLASE_CASILLA}
              />
              Tiene WhatsApp
            </label>
          </div>
          {texto("email", "Correo", { tipo: "email", bloqueado: bloqueadoContacto, inputMode: "email" })}
          {texto("domicilio", "Domicilio", { bloqueado: bloqueadoContacto })}
          <div className="sm:col-span-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                id={idDeCampo(r("esContacto"))}
                type="checkbox"
                checked={p.esContacto}
                onChange={(e) => onContacto(e.target.checked)}
                disabled={bloqueadoContacto}
                aria-invalid={err(r("esContacto")) ? true : undefined}
                className={CLASE_CASILLA}
              />
              Es el contacto del trámite
            </label>
            <MensajeError ruta={r("esContacto")} errores={err(r("esContacto"))} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
