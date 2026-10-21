import type { CambiosEdicion, DatosAlta, PersonaEntrada, TipoPersona, ValorCampoExtra } from "@/lib/dominio/expedientes/esquemas";
import type { DefinicionPlantilla, DocumentoPlantilla, PersonaPlantilla } from "@/lib/dominio/plantillas/esquema";
import { aplicaPorPersonas } from "@/lib/dominio/plantillas/resolver";

/**
 * El modelo del formulario de alta y de edición (sección 5): lo que el
 * navegador guarda mientras se carga (todo texto, como los `<input>`) y cómo
 * se convierte en lo que pide el dominio (`DatosAlta`, `CambiosEdicion`).
 * Puro: lo usan el Client Component y los tests.
 *
 * No valida: eso lo hacen los esquemas zod del dominio (en el navegador y otra
 * vez en el servidor). Acá solo se arma la entrada: vacío pasa a `null`, lo
 * que la plantilla no pide no se manda, y en la edición viaja solo lo que
 * cambió.
 */

export interface PersonaFormulario {
  /** Clave estable para React (no se manda). */
  clave: string;
  /** Edición: la versión vigente que se edita. `null` = persona nueva. */
  id: string | null;
  rol: string;
  /** Física o jurídica: el selector aparece solo en los roles con `admite_juridica`. */
  tipo: TipoPersona;
  apellido: string;
  nombres: string;
  dni: string;
  razonSocial: string;
  cuit: string;
  fallecido: boolean;
  fechaDefuncion: string;
  vinculo: string;
  telefono: string;
  telefonoWhatsapp: boolean;
  email: string;
  domicilio: string;
  esContacto: boolean;
}

export type FormaPagoElegida = "" | "contado" | "plan_pagos";

export interface ValoresFormulario {
  tipoMonumento: string;
  /** Por clave de campo de ubicación. */
  ubicacion: Record<string, string>;
  padron: string;
  numeroMunicipal: string;
  /** Solo si la plantilla dice `a_elegir`. */
  formaPago: FormaPagoElegida;
  /** En el orden en que se muestran: agrupadas por rol, en el orden de la plantilla. */
  personas: PersonaFormulario[];
  datosExtra: Record<string, string>;
  documentosRecibidos: string[];
  observaciones: string;
  fechaInicio: string;
  cargaHistorica: boolean;
  fuente: string;
}

let secuencia = 0;
/** Una clave nueva para una persona agregada en el navegador. */
export function claveNueva(prefijo = "p"): string {
  secuencia += 1;
  return `${prefijo}-${secuencia}`;
}

export function personaVacia(rol: PersonaPlantilla, clave: string): PersonaFormulario {
  return {
    clave,
    id: null,
    rol: rol.rol,
    tipo: "fisica",
    apellido: "",
    nombres: "",
    dni: "",
    razonSocial: "",
    cuit: "",
    fallecido: rol.fallecido === "si",
    fechaDefuncion: "",
    vinculo: "",
    telefono: "",
    telefonoWhatsapp: false,
    email: "",
    domicilio: "",
    esContacto: false,
  };
}

/** Los valores con que abre el alta: cada rol con su mínimo de personas, hoy como fecha de inicio. */
export function valoresInicialesAlta(def: DefinicionPlantilla, opciones: { hoy: string; tiposMonumento: readonly string[] }): ValoresFormulario {
  const personas: PersonaFormulario[] = [];
  def.personas.forEach((rol, i) => {
    for (let k = 0; k < rol.min; k += 1) personas.push(personaVacia(rol, `inicial-${i}-${k}`));
  });
  return {
    tipoMonumento: opciones.tiposMonumento.length === 1 ? opciones.tiposMonumento[0] : "",
    ubicacion: {},
    padron: "",
    numeroMunicipal: "",
    formaPago: "",
    personas,
    datosExtra: {},
    documentosRecibidos: [],
    observaciones: "",
    fechaInicio: opciones.hoy,
    cargaHistorica: false,
    fuente: "",
  };
}

/** Los valores actuales de un expediente (de `formularioEdicion().valores`) como valores del formulario. */
export function valoresDesdeEdicion(v: {
  tipoMonumento: string;
  ubicacion: Record<string, string>;
  padron: string | null;
  numeroMunicipal: string | null;
  fechaInicio: string;
  observaciones: string | null;
  datosExtra: Record<string, ValorCampoExtra>;
  personas: PersonaEntrada[];
}): ValoresFormulario {
  return {
    tipoMonumento: v.tipoMonumento,
    ubicacion: { ...v.ubicacion },
    padron: v.padron ?? "",
    numeroMunicipal: v.numeroMunicipal ?? "",
    formaPago: "",
    personas: v.personas.map((p, i) => ({
      clave: p.id ? `persona-${p.id}` : `persona-${i}`,
      id: p.id ?? null,
      rol: p.rol,
      tipo: p.tipo ?? "fisica",
      apellido: p.apellido ?? "",
      nombres: p.nombres ?? "",
      dni: p.dni ?? "",
      razonSocial: p.razonSocial ?? "",
      cuit: p.cuit ?? "",
      fallecido: p.fallecido ?? false,
      fechaDefuncion: p.fechaDefuncion ?? "",
      vinculo: p.vinculo ?? "",
      telefono: p.telefono ?? "",
      telefonoWhatsapp: p.telefonoWhatsapp ?? false,
      email: p.email ?? "",
      domicilio: p.domicilio ?? "",
      esContacto: p.esContacto ?? false,
    })),
    datosExtra: Object.fromEntries(Object.entries(v.datosExtra).map(([k, valor]) => [k, String(valor)])),
    documentosRecibidos: [],
    observaciones: v.observaciones ?? "",
    fechaInicio: v.fechaInicio,
    cargaHistorica: false,
    fuente: "",
  };
}

// ---------------------------------------------------------------------------
// Personas: agregar, quitar, contacto
// ---------------------------------------------------------------------------

export function cantidadDelRol(personas: readonly PersonaFormulario[], rol: string): number {
  return personas.filter((p) => p.rol === rol).length;
}

export function puedeAgregar(rol: PersonaPlantilla, personas: readonly PersonaFormulario[]): boolean {
  return cantidadDelRol(personas, rol.rol) < rol.max;
}

export function puedeQuitar(rol: PersonaPlantilla, personas: readonly PersonaFormulario[]): boolean {
  return cantidadDelRol(personas, rol.rol) > rol.min;
}

/** Agrega una persona del rol después de la última de ese rol (o en el lugar del rol según la plantilla). */
export function agregarPersona(
  def: DefinicionPlantilla,
  personas: readonly PersonaFormulario[],
  rol: PersonaPlantilla,
  clave: string,
): PersonaFormulario[] {
  const ordenRol = new Map(def.personas.map((r, i) => [r.rol, i]));
  const mio = ordenRol.get(rol.rol) ?? 99;
  // Después de todas las de roles que van antes o del mismo rol.
  let lugar = 0;
  personas.forEach((p, i) => {
    if ((ordenRol.get(p.rol) ?? 99) <= mio) lugar = i + 1;
  });
  return [...personas.slice(0, lugar), personaVacia(rol, clave), ...personas.slice(lugar)];
}

/** Marca a una persona como el contacto (y desmarca a las demás), o la desmarca. */
export function marcarContacto(personas: readonly PersonaFormulario[], clave: string, marcado: boolean): PersonaFormulario[] {
  return personas.map((p) => ({ ...p, esContacto: p.clave === clave ? marcado : marcado ? false : p.esContacto }));
}

// ---------------------------------------------------------------------------
// Conversión a lo que pide el dominio
// ---------------------------------------------------------------------------

function textoONull(v: string): string | null {
  return v.trim() === "" ? null : v;
}

/**
 * Una persona del formulario como `PersonaEntrada`, sin lo que su rol no pide
 * ni lo del otro tipo: si se cargó el apellido y después se eligió "Persona
 * jurídica", el apellido no viaja (quedó escondido en la pantalla).
 */
export function personaEntrada(p: PersonaFormulario, def: DefinicionPlantilla, conId: boolean): PersonaEntrada {
  const rol = def.personas.find((r) => r.rol === p.rol);
  // Si el rol ya no admite jurídica, la persona va como física y el servidor pide lo que falte.
  const juridica = p.tipo === "juridica" && rol?.admite_juridica === true;
  const fallecido = juridica ? false : rol?.fallecido === "si" ? true : rol?.fallecido === "no" ? false : p.fallecido;
  const telefono = textoONull(p.telefono);
  const identidad: Pick<PersonaEntrada, "tipo" | "apellido" | "nombres" | "dni" | "razonSocial" | "cuit"> = juridica
    ? { tipo: "juridica", razonSocial: textoONull(p.razonSocial), cuit: textoONull(p.cuit) }
    : { tipo: "fisica", apellido: p.apellido, nombres: p.nombres, dni: textoONull(p.dni) };
  const entrada: PersonaEntrada = {
    rol: p.rol,
    ...identidad,
    fallecido,
    fechaDefuncion: fallecido ? textoONull(p.fechaDefuncion) : null,
    vinculo: rol?.pide_vinculo ? textoONull(p.vinculo) : null,
    telefono,
    telefonoWhatsapp: telefono !== null && p.telefonoWhatsapp,
    email: textoONull(p.email),
    domicilio: textoONull(p.domicilio),
    esContacto: p.esContacto,
  };
  if (conId) entrada.id = p.id;
  return entrada;
}

/**
 * Los documentos que el alta ofrece marcar como recibidos: los de la
 * definición (ya filtrada por cementerio) que corresponden a las personas que
 * se están cargando. Elegir "Persona jurídica" en el titular hace aparecer la
 * personería y la designación de asamblea.
 */
export function documentosDelAlta(def: DefinicionPlantilla, personas: readonly PersonaFormulario[]): DocumentoPlantilla[] {
  const roles = new Set(
    personas.filter((p) => p.tipo === "juridica" && def.personas.some((r) => r.rol === p.rol && r.admite_juridica)).map((p) => p.rol),
  );
  return def.documentos.filter((d) => aplicaPorPersonas(d, roles));
}

/** La ubicación con los campos que muestra el formulario: vacío = `null`. */
function ubicacionEntrada(ubicacion: Record<string, string>, claves: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(claves.map((c) => [c, textoONull(ubicacion[c] ?? "")]));
}

export interface ContextoConversion {
  plantillaId: number;
  cementerioId: number;
  definicion: DefinicionPlantilla;
  /** Claves de los campos de ubicación activos (los que muestra el formulario). */
  clavesUbicacion: readonly string[];
}

/** Los valores del alta como `DatosAlta`. */
export function datosAltaDesde(v: ValoresFormulario, ctx: ContextoConversion): DatosAlta {
  const def = ctx.definicion;
  const datosExtra: Record<string, ValorCampoExtra | null> = {};
  for (const campo of def.campos_extra) {
    const valor = textoONull(v.datosExtra[campo.clave] ?? "");
    if (valor !== null) datosExtra[campo.clave] = valor;
  }
  // Un documento marcado que dejó de corresponder (se volvió a persona física) no viaja.
  const claves = new Set(documentosDelAlta(def, v.personas).map((d) => d.clave));
  return {
    plantillaId: ctx.plantillaId,
    cementerioId: ctx.cementerioId,
    tipoMonumento: v.tipoMonumento,
    ubicacion: ubicacionEntrada(v.ubicacion, ctx.clavesUbicacion),
    padron: textoONull(v.padron),
    numeroMunicipal: textoONull(v.numeroMunicipal),
    formaPago: def.forma_pago === "a_elegir" ? (v.formaPago === "" ? null : v.formaPago) : null,
    personas: v.personas.map((p) => personaEntrada(p, def, false)),
    datosExtra,
    documentosRecibidos: v.documentosRecibidos.filter((d) => claves.has(d)),
    observaciones: textoONull(v.observaciones),
    fechaInicio: v.fechaInicio,
    cargaHistorica: v.cargaHistorica,
    fuente: v.cargaHistorica ? textoONull(v.fuente) : null,
  };
}

const PERSONA_IDENTIFICATORIOS = ["tipo", "apellido", "nombres", "dni", "razonSocial", "cuit", "fallecido", "fechaDefuncion", "vinculo"] as const;
const PERSONA_CONTACTO = ["telefono", "telefonoWhatsapp", "email", "domicilio", "esContacto"] as const;

function mismaLista(a: readonly PersonaFormulario[], b: readonly PersonaFormulario[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id !== null && p.id === b[i].id);
}

function ubicacionCambio(original: ValoresFormulario, actual: ValoresFormulario, claves: readonly string[]): boolean {
  return claves.some((c) => (original.ubicacion[c] ?? "").trim() !== (actual.ubicacion[c] ?? "").trim());
}

/** Qué cambió en las personas: altas o bajas, datos identificatorios, contacto. */
export function cambiosDePersonas(
  original: readonly PersonaFormulario[],
  actual: readonly PersonaFormulario[],
  def: DefinicionPlantilla,
): { altasOBajas: boolean; identificatorios: boolean; contacto: boolean } {
  const antes = new Map(original.map((p) => [p.id, personaEntrada(p, def, true)]));
  const altasOBajas = !mismaLista(original, actual) && (actual.some((p) => p.id === null) || original.some((p) => !actual.some((q) => q.id === p.id)));
  let identificatorios = altasOBajas;
  let contacto = false;
  for (const p of actual) {
    const vieja = p.id === null ? undefined : antes.get(p.id);
    if (!vieja) continue;
    const nueva = personaEntrada(p, def, true);
    if (PERSONA_IDENTIFICATORIOS.some((c) => (vieja[c] ?? null) !== (nueva[c] ?? null))) identificatorios = true;
    if (PERSONA_CONTACTO.some((c) => (vieja[c] ?? null) !== (nueva[c] ?? null))) contacto = true;
  }
  return { altasOBajas, identificatorios, contacto };
}

export interface PermisosEdicion {
  identificatorios: boolean;
  contacto: boolean;
  extras: boolean;
}

/**
 * ¿Cambia algún dato identificatorio (3.2)? Después del primer pase, eso pide
 * motivo: la pantalla muestra el campo cuando esto da true.
 */
export function cambiaIdentificatorios(
  original: ValoresFormulario,
  actual: ValoresFormulario,
  def: DefinicionPlantilla,
  clavesUbicacion: readonly string[],
): boolean {
  return (
    original.tipoMonumento !== actual.tipoMonumento ||
    ubicacionCambio(original, actual, clavesUbicacion) ||
    original.padron.trim() !== actual.padron.trim() ||
    original.numeroMunicipal.trim() !== actual.numeroMunicipal.trim() ||
    original.fechaInicio !== actual.fechaInicio ||
    cambiosDePersonas(original.personas, actual.personas, def).identificatorios
  );
}

/**
 * Lo que cambió, como `CambiosEdicion`: solo las claves que cambian y que el
 * usuario puede editar (lo demás está deshabilitado en la pantalla y, si
 * llegara, el dominio lo rechaza igual). Las personas van completas si cambió
 * cualquiera; la ubicación, completa si cambió un campo.
 */
export function cambiosEdicionDesde(
  original: ValoresFormulario,
  actual: ValoresFormulario,
  def: DefinicionPlantilla,
  clavesUbicacion: readonly string[],
  permisos: PermisosEdicion,
): CambiosEdicion {
  const c: CambiosEdicion = {};
  if (permisos.identificatorios) {
    if (original.tipoMonumento !== actual.tipoMonumento) c.tipoMonumento = actual.tipoMonumento;
    if (ubicacionCambio(original, actual, clavesUbicacion)) c.ubicacion = ubicacionEntrada(actual.ubicacion, clavesUbicacion);
    if (original.padron.trim() !== actual.padron.trim()) c.padron = textoONull(actual.padron);
    if (original.numeroMunicipal.trim() !== actual.numeroMunicipal.trim()) c.numeroMunicipal = textoONull(actual.numeroMunicipal);
    if (original.fechaInicio !== actual.fechaInicio) c.fechaInicio = actual.fechaInicio;
  }
  if (permisos.contacto && original.observaciones.trim() !== actual.observaciones.trim()) {
    c.observaciones = textoONull(actual.observaciones);
  }
  if (permisos.extras) {
    const extras: Record<string, ValorCampoExtra | null> = {};
    for (const campo of def.campos_extra) {
      const antes = (original.datosExtra[campo.clave] ?? "").trim();
      const despues = (actual.datosExtra[campo.clave] ?? "").trim();
      if (antes !== despues) extras[campo.clave] = despues === "" ? null : despues;
    }
    if (Object.keys(extras).length > 0) c.datosExtra = extras;
  }
  const personas = cambiosDePersonas(original.personas, actual.personas, def);
  const cambian = personas.altasOBajas || personas.identificatorios || personas.contacto;
  const puede = (!personas.identificatorios || permisos.identificatorios) && (!personas.contacto || permisos.contacto);
  if (cambian && puede) c.personas = actual.personas.map((p) => personaEntrada(p, def, true));
  return c;
}

// ---------------------------------------------------------------------------
// Semana 4: el alta precargada desde otro expediente (2.13(a))
// ---------------------------------------------------------------------------

/** Lo que trae `precargaAlta().datos` (o `ResultadoReinicio.precarga.datos`). */
export interface DatosPrecarga {
  cementerioId: number;
  tipoMonumento: string;
  ubicacion?: Record<string, string | null>;
  padron?: string | null;
  numeroMunicipal?: string | null;
  formaPago?: "contado" | "plan_pagos" | null;
  personas: PersonaEntrada[];
  datosExtra?: Record<string, ValorCampoExtra | null>;
  observaciones?: string | null;
}

export interface Precargados {
  valores: ValoresFormulario;
  /** Etiquetas de los roles del expediente anterior que la plantilla nueva no tiene (sus personas no pasan). */
  rolesQueNoPasan: string[];
  /** Personas que no entraron porque el rol ya tenía su máximo. */
  personasDeMas: number;
}

/**
 * Los valores con que abre `/expedientes/nuevo?desde=<numero>` (y el alta de
 * "archivar y abrir vinculado"): datos, personas vigentes, ubicación, padrón
 * y N° municipal del expediente anterior, acomodados a la plantilla nueva.
 * Las personas de roles que la plantilla no tiene no pasan (lo pide
 * `precargaAlta`) y cada rol completa su mínimo con personas vacías. Lo que la
 * plantilla o el cementerio no piden (un campo extra, un tipo de monumento) se
 * deja afuera; el formulario y el dominio validan el resto. La fecha de inicio
 * es hoy y no se marca ningún documento como recibido.
 */
export function valoresDesdePrecarga(
  datos: DatosPrecarga,
  def: DefinicionPlantilla,
  opciones: { hoy: string; tiposMonumento: readonly string[]; clavesUbicacion: readonly string[]; etiquetasRoles?: Record<string, string> },
): Precargados {
  const rolesQueNoPasan = new Set<string>();
  let personasDeMas = 0;
  const personas: PersonaFormulario[] = [];
  def.personas.forEach((rol, r) => {
    const delRol = datos.personas.filter((p) => p.rol === rol.rol);
    delRol.slice(0, rol.max).forEach((p, i) => {
      const juridica = p.tipo === "juridica" && rol.admite_juridica;
      personas.push({
        clave: `precarga-${r}-${i}`,
        id: null,
        rol: rol.rol,
        tipo: juridica ? "juridica" : "fisica",
        apellido: p.apellido ?? "",
        nombres: p.nombres ?? "",
        dni: p.dni ?? "",
        razonSocial: p.razonSocial ?? "",
        cuit: p.cuit ?? "",
        fallecido: rol.fallecido === "si" ? true : rol.fallecido === "no" ? false : (p.fallecido ?? false),
        fechaDefuncion: p.fechaDefuncion ?? "",
        vinculo: p.vinculo ?? "",
        telefono: p.telefono ?? "",
        telefonoWhatsapp: p.telefonoWhatsapp ?? false,
        email: p.email ?? "",
        domicilio: p.domicilio ?? "",
        esContacto: p.esContacto ?? false,
      });
    });
    personasDeMas += Math.max(0, delRol.length - rol.max);
    for (let k = delRol.length; k < rol.min; k += 1) personas.push(personaVacia(rol, `precarga-${r}-vacia-${k}`));
  });
  for (const p of datos.personas) {
    if (!def.personas.some((r) => r.rol === p.rol)) rolesQueNoPasan.add(opciones.etiquetasRoles?.[p.rol] ?? p.rol);
  }
  // Un solo contacto: si quedaron dos marcados (no debería), el primero.
  let hayContacto = false;
  for (const p of personas) {
    if (p.esContacto && !hayContacto) hayContacto = true;
    else p.esContacto = false;
  }

  const ubicacion: Record<string, string> = {};
  for (const c of opciones.clavesUbicacion) {
    const v = datos.ubicacion?.[c];
    if (v !== undefined && v !== null && v !== "") ubicacion[c] = v;
  }
  const datosExtra: Record<string, string> = {};
  for (const c of def.campos_extra) {
    const v = datos.datosExtra?.[c.clave];
    if (v !== undefined && v !== null && v !== "") datosExtra[c.clave] = String(v);
  }
  const tipoMonumento = opciones.tiposMonumento.includes(datos.tipoMonumento)
    ? datos.tipoMonumento
    : opciones.tiposMonumento.length === 1
      ? opciones.tiposMonumento[0]
      : "";

  return {
    valores: {
      tipoMonumento,
      ubicacion,
      padron: datos.padron ?? "",
      numeroMunicipal: datos.numeroMunicipal ?? "",
      formaPago: def.forma_pago === "a_elegir" && datos.formaPago ? datos.formaPago : "",
      personas,
      datosExtra,
      documentosRecibidos: [],
      observaciones: datos.observaciones ?? "",
      fechaInicio: opciones.hoy,
      cargaHistorica: false,
      fuente: "",
    },
    rolesQueNoPasan: [...rolesQueNoPasan],
    personasDeMas,
  };
}

/**
 * El alta del expediente vinculado de "archivar y abrir vinculado" (la
 * caducidad), sin pasar por el formulario: la precarga acomodada a la
 * plantilla elegida. `expedienteAnteriorId` no va: lo pone el dominio.
 */
export function datosAltaVinculado(
  datos: DatosPrecarga,
  ctx: { plantillaId: number; definicion: DefinicionPlantilla; hoy: string; tiposMonumento: readonly string[]; clavesUbicacion: readonly string[] },
): DatosAlta {
  const { valores } = valoresDesdePrecarga(datos, ctx.definicion, ctx);
  // Las personas vacías que completan un mínimo no viajan: el dominio dice qué falta.
  const conDatos = { ...valores, personas: valores.personas.filter((p) => !p.clave.includes("-vacia-")) };
  return datosAltaDesde(conDatos, { plantillaId: ctx.plantillaId, cementerioId: datos.cementerioId, definicion: ctx.definicion, clavesUbicacion: ctx.clavesUbicacion });
}
