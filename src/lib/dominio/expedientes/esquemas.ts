import { z } from "zod";
import { esFechaValida, FECHA_MINIMA_INICIO, sumarDias, type FechaISO } from "@/lib/fechas";
import { cuitJuridicaValido } from "../cuil";
import { colapsarEspacios, normalizarCuit, normalizarDni } from "../normalizar";
import {
  rutaComoTexto,
  type CampoExtraPlantilla,
  type DefinicionPlantilla,
  type PersonaPlantilla,
} from "../plantillas/esquema";
import { aplicaPorPersonas, resolverPorCementerio } from "../plantillas/resolver";
import { errorValidacion, type ErrorCampo } from "./errores";
import { validarUbicacion, type CampoUbicacion, type Ubicacion } from "./ubicacion";

/**
 * Esquemas zod del alta y de la edición, ARMADOS EN TIEMPO DE EJECUCIÓN a
 * partir de la plantilla publicada y del cementerio (docs/propuesta-mvp.md,
 * 2.5, 2.7, 2.13(d) y sección 6: "esquemas armados en tiempo de ejecución").
 *
 * Son puros: no leen la base. Quien los arma le pasa el contexto
 * (`cargarContexto()` en ./contexto.ts). La pantalla puede usar los mismos
 * esquemas en el navegador para validar antes de enviar; el servidor vuelve a
 * validar siempre.
 *
 * Qué valida:
 * - Personas: roles de la plantilla; cantidad entre `min` y `max` por rol;
 *   `fallecido` según la plantilla (`no`, `si`, `opcional`); fecha de defunción
 *   solo si falleció; vínculo obligatorio si `pide_vinculo`; DNI de 6 a 9
 *   dígitos (sin puntos ni ceros a la izquierda). Persona física (apellido y
 *   nombres) o, si el rol tiene `admite_juridica`, jurídica: razón social y
 *   CUIT válido de persona jurídica (30, 33 o 34), sin DNI ni fallecimiento.
 * - Documentos recibidos en el alta: los de la plantilla que corresponden al
 *   cementerio y, si dependen de una persona jurídica, a las personas cargadas.
 * - Contacto: si `requiere_contacto`, exactamente una persona; nunca un
 *   fallecido; tiene que tener teléfono o correo. Si no se marcó ninguna y hay
 *   una sola persona que puede serlo, se la marca sola.
 * - Ubicación: campos activos del cementerio, obligatorios si la plantilla dice
 *   `ubicacion_obligatoria`, patrón, normalización.
 * - Forma de pago: fija si la plantilla la fija; se elige si es `a_elegir`;
 *   nula si es `no_aplica`.
 * - Tipo de monumento: los de la plantilla (o todos si es `[]`) que el
 *   cementerio tiene habilitados.
 * - Campos extra: tipo, opciones y cementerios. En el alta no se exige ninguno:
 *   los obligatorios se exigen al dar el pase (`exigir_al_salir_de`, 3.3).
 * - Fecha de inicio: hasta 30 días atrás, o entre 1950 y hoy con carga
 *   histórica, que además exige fuente.
 */

/** `PASE_RETRO_MAX_DIAS` (2.13(c)): cuánto puede ir para atrás una fecha sin carga histórica. */
export const DIAS_RETROACTIVOS_MAX = 30;

// ---------------------------------------------------------------------------
// Tipos de entrada y de salida (para la pantalla)
// ---------------------------------------------------------------------------

export const TIPOS_PERSONA = ["fisica", "juridica"] as const;
export type TipoPersona = (typeof TIPOS_PERSONA)[number];

/** Una persona tal como la manda el formulario. */
export interface PersonaEntrada {
  /** Solo en la edición: el id de la versión vigente que se edita. Sin id = persona nueva. */
  id?: string | null;
  /** Rol de `definicion.personas` (titular, solicitante, difunto…). */
  rol: string;
  /** Por defecto `fisica`. `juridica` solo en los roles con `admite_juridica`. */
  tipo?: TipoPersona;
  /** Obligatorios en una persona física; una jurídica no los lleva. */
  apellido?: string | null;
  nombres?: string | null;
  /** Con o sin puntos; se guarda solo con dígitos y sin ceros a la izquierda. Solo física. */
  dni?: string | null;
  /** Obligatorios en una persona jurídica. El CUIT, con o sin guiones. */
  razonSocial?: string | null;
  cuit?: string | null;
  /** Si la plantilla dice `fallecido: si` o `no`, se puede omitir. */
  fallecido?: boolean;
  /** YYYY-MM-DD; solo si falleció. */
  fechaDefuncion?: string | null;
  /** Obligatorio si la plantilla dice `pide_vinculo`; si no, se ignora. */
  vinculo?: string | null;
  telefono?: string | null;
  telefonoWhatsapp?: boolean;
  email?: string | null;
  domicilio?: string | null;
  esContacto?: boolean;
}

/** Una persona validada y normalizada. */
export interface PersonaValidada {
  id: string | null;
  rol: string;
  /** 1, 2, 3… dentro del rol, en el orden en que vinieron. */
  orden: number;
  tipo: TipoPersona;
  /** Con valor en una física, null en una jurídica (y al revés razón social y CUIT). */
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  razonSocial: string | null;
  /** 11 dígitos, sin guiones. */
  cuit: string | null;
  fallecido: boolean;
  fechaDefuncion: FechaISO | null;
  vinculo: string | null;
  telefono: string | null;
  telefonoWhatsapp: boolean;
  email: string | null;
  domicilio: string | null;
  esContacto: boolean;
}

/** Valor de un campo extra: texto, número, fecha YYYY-MM-DD, opción o código de cementerio. */
export type ValorCampoExtra = string | number;

/** Lo que manda el formulario del alta. */
export interface DatosAlta {
  /** Id de la versión PUBLICADA de la plantilla (la de `opcionesAlta()`). */
  plantillaId: number;
  cementerioId: number;
  /** Código de `tipos_monumento`. */
  tipoMonumento: string;
  /** Valor de cada campo de ubicación del cementerio, por clave. */
  ubicacion?: Record<string, string | null>;
  padron?: string | null;
  numeroMunicipal?: string | null;
  /** Solo si la plantilla dice `a_elegir`; si la fija, se puede omitir. */
  formaPago?: "contado" | "plan_pagos" | null;
  personas: PersonaEntrada[];
  /** Por clave de `definicion.campos_extra`. Vacío o null = sin valor. */
  datosExtra?: Record<string, ValorCampoExtra | null>;
  /** Claves de `definicion.documentos` que se recibieron con el alta. */
  documentosRecibidos?: string[];
  observaciones?: string | null;
  /** YYYY-MM-DD. */
  fechaInicio: string;
  /** "Expediente iniciado antes del sistema" (2.13(c)). */
  cargaHistorica?: boolean;
  /** Obligatoria con carga histórica: "Ficha papel", "Libro de pases de Legal". */
  fuente?: string | null;
  /**
   * Semana 4, "Reiniciar con otra plantilla" (2.13(a)): el id del expediente
   * anulado por el reinicio (lo trae `precargaAlta().datos`).
   */
  expedienteAnteriorId?: string | null;
}

export interface AltaValidada {
  plantillaId: number;
  cementerioId: number;
  tipoMonumento: string;
  ubicacion: Ubicacion;
  padron: string | null;
  numeroMunicipal: string | null;
  formaPago: "contado" | "plan_pagos" | null;
  personas: PersonaValidada[];
  datosExtra: Record<string, ValorCampoExtra>;
  documentosRecibidos: string[];
  observaciones: string | null;
  fechaInicio: FechaISO;
  cargaHistorica: boolean;
  fuente: string | null;
  expedienteAnteriorId: string | null;
}

/**
 * Lo que manda el formulario de edición. Cada campo ausente (`undefined`) queda
 * como está; `null` o vacío borra el valor (donde se puede).
 */
export interface CambiosEdicion {
  tipoMonumento?: string;
  /** La ubicación completa (los campos que no vienen quedan vacíos). */
  ubicacion?: Record<string, string | null>;
  padron?: string | null;
  numeroMunicipal?: string | null;
  fechaInicio?: string;
  observaciones?: string | null;
  /** Solo las claves que cambian; `null` borra. */
  datosExtra?: Record<string, ValorCampoExtra | null>;
  /**
   * La lista COMPLETA de personas vigentes, como queda después de editar: con
   * `id` las que ya estaban (cambiadas o no), sin `id` las nuevas. Las vigentes
   * que no vienen se dan de baja.
   */
  personas?: PersonaEntrada[];
}

export interface EdicionValidada {
  tipoMonumento?: string;
  ubicacion?: Ubicacion;
  padron?: string | null;
  numeroMunicipal?: string | null;
  fechaInicio?: FechaISO;
  observaciones?: string | null;
  datosExtra?: Record<string, ValorCampoExtra | null>;
  personas?: PersonaValidada[];
}

/** Lo que los esquemas necesitan saber (lo arma `cargarContexto()`). */
export interface ContextoEsquema {
  plantilla: { id: number; definicion: DefinicionPlantilla };
  /** El código decide qué documentos de la plantilla corresponden (`solo_cementerios`…). */
  cementerio: { id: number; codigo: string; camposUbicacion: readonly CampoUbicacion[] };
  /** Códigos de tipo de monumento admitidos: los de la plantilla (o todos) habilitados en el cementerio y activos. */
  tiposMonumento: readonly string[];
  /** Códigos de cementerios activos, para los campos extra de tipo `cementerio`. */
  cementerios: readonly string[];
  /** Hoy en Tucumán. */
  hoy: FechaISO;
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

type Ctx = z.RefinementCtx;

function problema(ctx: Ctx, ruta: PropertyKey[], mensaje: string): void {
  ctx.addIssue({ code: "custom", message: mensaje, path: ruta });
}

/** Texto opcional: espacios colapsados; vacío = null. */
function textoOpcional(etiqueta: string, max: number) {
  return z
    .string({ error: `${etiqueta}: tiene que ser texto` })
    .nullish()
    .transform((v) => {
      const c = colapsarEspacios(v ?? "");
      return c === "" ? null : c;
    })
    .refine((v) => v === null || v.length <= max, `${etiqueta}: ${max} caracteres como máximo`);
}

function fechaOpcional(etiqueta: string) {
  return z
    .string({ error: `${etiqueta}: fecha inválida` })
    .nullish()
    .transform((v) => (v === null || v === undefined || v.trim() === "" ? null : v.trim()))
    .refine((v) => v === null || esFechaValida(v), `${etiqueta}: fecha inválida (AAAA-MM-DD)`);
}

/** Un `z.enum` que también funciona con la lista vacía (que zod no acepta). */
function unoDe(valores: readonly string[], mensaje: string) {
  return z.string({ error: mensaje }).refine((v) => valores.includes(v), mensaje);
}

const RE_ID = /^[1-9]\d*$/;

function esquemaPersona(conId: boolean) {
  return z.strictObject({
    id: conId
      ? z
          .string()
          .regex(RE_ID, "Persona inválida")
          .nullish()
          .transform((v) => v ?? null)
      : z
          .null({ error: "Una persona nueva no lleva id" })
          .optional()
          .transform(() => null),
    rol: z.string({ error: "Falta el rol de la persona" }),
    tipo: z.enum(TIPOS_PERSONA, { error: "Elegí persona física o jurídica" }).default("fisica"),
    // Obligatorios según el tipo: lo controla el superRefine de abajo.
    apellido: textoOpcional("Apellido", 100),
    nombres: textoOpcional("Nombres", 100),
    dni: z
      .string({ error: "DNI: tiene que ser texto" })
      .nullish()
      .transform((v) => normalizarDni(v))
      .refine((v) => v === null || /^\d{6,9}$/.test(v), "DNI: tiene que tener entre 6 y 9 dígitos"),
    razonSocial: textoOpcional("Razón social", 200),
    cuit: z
      .string({ error: "CUIT: tiene que ser texto" })
      .nullish()
      .transform((v) => normalizarCuit(v)),
    fallecido: z.boolean().optional(),
    fechaDefuncion: fechaOpcional("Fecha de defunción"),
    vinculo: textoOpcional("Vínculo", 60),
    telefono: textoOpcional("Teléfono", 40).refine(
      (v) => v === null || (/^[0-9+()\-\s./]+$/.test(v) && v.replace(/\D/g, "").length >= 6),
      "Teléfono: solo números (al menos 6), espacios y + - ( )",
    ),
    telefonoWhatsapp: z.boolean().default(false),
    email: textoOpcional("Correo", 120)
      .transform((v) => v?.toLowerCase() ?? null)
      .refine((v) => v === null || z.email().safeParse(v).success, "Correo: no es una dirección válida"),
    domicilio: textoOpcional("Domicilio", 200),
    esContacto: z.boolean().default(false),
  })
    // Los datos de cada tipo. Va en el objeto y no en la lista para que el
    // error salga junto con los demás de la persona (los de formato de cada
    // campo no cortan la validación).
    .superRefine((p, ctx) => {
      if (p.tipo === "fisica") {
        if (p.apellido === null) problema(ctx, ["apellido"], "Apellido: es obligatorio");
        if (p.nombres === null) problema(ctx, ["nombres"], "Nombres: es obligatorio");
        if (p.razonSocial !== null) problema(ctx, ["razonSocial"], "Razón social: solo para una persona jurídica");
        if (p.cuit !== null) problema(ctx, ["cuit"], "CUIT: solo para una persona jurídica (de una persona física va el DNI)");
        return;
      }
      if (p.razonSocial === null) problema(ctx, ["razonSocial"], "Razón social: es obligatoria");
      if (p.cuit === null) problema(ctx, ["cuit"], "CUIT: es obligatorio");
      else if (!cuitJuridicaValido(p.cuit)) {
        problema(ctx, ["cuit"], "CUIT: no es válido (11 dígitos, empieza con 30, 33 o 34 y el último es el verificador)");
      }
      if (p.apellido !== null || p.nombres !== null) {
        problema(ctx, ["apellido"], "Una persona jurídica no lleva apellido ni nombres: va la razón social");
      }
      if (p.dni !== null) problema(ctx, ["dni"], "Una persona jurídica no lleva DNI: va el CUIT");
      if (p.fallecido === true) problema(ctx, ["fallecido"], "Una persona jurídica no puede figurar como fallecida");
      if (p.fechaDefuncion !== null) problema(ctx, ["fechaDefuncion"], "Una persona jurídica no tiene fecha de defunción");
    });
}

type PersonaParseada = z.output<ReturnType<typeof esquemaPersona>>;

/** Quién puede ser contacto: vive y tiene teléfono o correo. */
function puedeSerContacto(p: { fallecido: boolean; telefono: string | null; email: string | null }): boolean {
  return !p.fallecido && (p.telefono !== null || p.email !== null);
}

/**
 * Completa lo que la plantilla decide (fallecido, vínculo), numera dentro de
 * cada rol y, si hace falta un contacto y no se marcó ninguno, marca al único
 * posible.
 */
function completarPersonas(def: DefinicionPlantilla, lista: PersonaParseada[]): PersonaValidada[] {
  const roles = new Map(def.personas.map((r) => [r.rol, r]));
  const contadores = new Map<string, number>();
  const personas: PersonaValidada[] = lista.map((p) => {
    const rol = roles.get(p.rol);
    const orden = (contadores.get(p.rol) ?? 0) + 1;
    contadores.set(p.rol, orden);
    const juridica = p.tipo === "juridica";
    // Una jurídica no fallece; si llegó marcada, el esquema de la persona ya lo marcó como error.
    const fallecido = juridica ? false : (p.fallecido ?? rol?.fallecido === "si");
    return {
      id: p.id,
      rol: p.rol,
      orden,
      tipo: p.tipo,
      // Lo del otro tipo no se guarda (también lo exige el CHECK de la base).
      apellido: juridica ? null : p.apellido,
      nombres: juridica ? null : p.nombres,
      dni: juridica ? null : p.dni,
      razonSocial: juridica ? p.razonSocial : null,
      cuit: juridica ? p.cuit : null,
      fallecido,
      fechaDefuncion: juridica ? null : p.fechaDefuncion,
      vinculo: rol?.pide_vinculo ? p.vinculo : null,
      telefono: p.telefono,
      telefonoWhatsapp: p.telefono !== null && p.telefonoWhatsapp,
      email: p.email,
      domicilio: p.domicilio,
      esContacto: p.esContacto,
    };
  });
  if (def.requiere_contacto && !personas.some((p) => p.esContacto)) {
    const posibles = personas.filter(puedeSerContacto);
    if (posibles.length === 1) posibles[0].esContacto = true;
  }
  return personas;
}

function etiquetaRol(rol: PersonaPlantilla): string {
  return rol.etiqueta;
}

/** Las reglas que cruzan personas entre sí y con la plantilla. */
function reglasPersonas(def: DefinicionPlantilla, personas: PersonaValidada[], hoy: FechaISO, ctx: Ctx): void {
  const roles = new Map(def.personas.map((r) => [r.rol, r]));

  personas.forEach((p, i) => {
    const rol = roles.get(p.rol);
    if (!rol) {
      problema(ctx, [i, "rol"], `Este trámite no tiene personas con el rol "${p.rol}"`);
      return;
    }
    if (p.tipo === "juridica" && !rol.admite_juridica) {
      problema(ctx, [i, "tipo"], `${etiquetaRol(rol)}: tiene que ser una persona física`);
    }
    if (rol.fallecido === "no" && p.fallecido) problema(ctx, [i, "fallecido"], `${etiquetaRol(rol)}: no puede figurar como fallecido`);
    // Una jurídica en un rol de fallecidos ya tiene el error de arriba (validar.ts no deja combinar los dos).
    if (rol.fallecido === "si" && !p.fallecido && p.tipo === "fisica") {
      problema(ctx, [i, "fallecido"], `${etiquetaRol(rol)}: tiene que figurar como fallecido`);
    }
    if (p.fechaDefuncion !== null) {
      if (!p.fallecido) problema(ctx, [i, "fechaDefuncion"], "Fecha de defunción: solo si la persona falleció");
      else if (p.fechaDefuncion > hoy) problema(ctx, [i, "fechaDefuncion"], "Fecha de defunción: no puede ser posterior a hoy");
    }
    if (rol.pide_vinculo && p.vinculo === null) problema(ctx, [i, "vinculo"], `${etiquetaRol(rol)}: indicá el vínculo con el titular`);
    if (p.esContacto) {
      if (p.fallecido) problema(ctx, [i, "esContacto"], "Una persona fallecida no puede ser el contacto");
      else if (p.telefono === null && p.email === null) problema(ctx, [i, "telefono"], "El contacto tiene que tener teléfono o correo");
    }
  });

  for (const rol of def.personas) {
    const cantidad = personas.filter((p) => p.rol === rol.rol).length;
    if (cantidad < rol.min || cantidad > rol.max) {
      const rango =
        rol.min === rol.max ? `${rol.min}` : rol.min === 0 ? `como máximo ${rol.max}` : `entre ${rol.min} y ${rol.max}`;
      problema(ctx, [], `${etiquetaRol(rol)}: tiene que haber ${rango} (hay ${cantidad})`);
    }
  }

  const contactos = personas.filter((p) => p.esContacto).length;
  if (contactos > 1) problema(ctx, [], "Solo una persona puede ser el contacto");
  if (def.requiere_contacto && contactos === 0) problema(ctx, [], "Marcá qué persona es el contacto (tiene que tener teléfono o correo)");
}

function esquemaPersonas(def: DefinicionPlantilla, hoy: FechaISO, conId: boolean) {
  return z
    .array(esquemaPersona(conId), { error: "Faltan las personas" })
    .transform((lista) => completarPersonas(def, lista))
    .superRefine((personas, ctx) => reglasPersonas(def, personas, hoy, ctx));
}

function esquemaCampoExtra(campo: CampoExtraPlantilla, cementerios: readonly string[]) {
  const etiqueta = campo.etiqueta;
  const vacio = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  switch (campo.tipo) {
    case "texto":
      return textoOpcional(etiqueta, 500);
    case "numero":
      return z
        .union([z.number(), z.string()], { error: `${etiqueta}: tiene que ser un número` })
        .nullish()
        .transform((v) => (vacio(v) ? null : typeof v === "number" ? v : Number(String(v).trim().replace(",", "."))))
        .refine((v) => v === null || Number.isFinite(v), `${etiqueta}: tiene que ser un número`);
    case "fecha":
      return fechaOpcional(etiqueta);
    case "opcion":
    case "cementerio": {
      const validos = campo.tipo === "opcion" ? (campo.opciones ?? []) : cementerios;
      return z
        .string({ error: `${etiqueta}: elegí una opción` })
        .nullish()
        .transform((v) => (vacio(v) ? null : String(v).trim()))
        .refine((v) => v === null || validos.includes(v), `${etiqueta}: elegí una de las opciones`);
    }
    default: {
      const sinTipo: never = campo.tipo;
      throw new Error(`Tipo de campo extra sin esquema: ${String(sinTipo)}`);
    }
  }
}

/** Los campos extra que vinieron, sin los vacíos (en el alta) o con null para borrar (en la edición). */
function esquemaDatosExtra(def: DefinicionPlantilla, cementerios: readonly string[]) {
  const forma = Object.fromEntries(def.campos_extra.map((c) => [c.clave, esquemaCampoExtra(c, cementerios).optional()]));
  return z.strictObject(forma, { error: "Campo extra que el trámite no tiene" });
}

function sinVacios(valores: Record<string, ValorCampoExtra | null | undefined>): Record<string, ValorCampoExtra> {
  const r: Record<string, ValorCampoExtra> = {};
  for (const [clave, valor] of Object.entries(valores)) if (valor !== null && valor !== undefined) r[clave] = valor;
  return r;
}

function esquemaUbicacion(ctx: ContextoEsquema, anterior?: Ubicacion) {
  return z
    .record(z.string(), z.string().nullable(), { error: "Ubicación inválida" })
    .transform((entrada, zctx) => {
      const r = validarUbicacion(ctx.cementerio.camposUbicacion, entrada, {
        obligatoria: ctx.plantilla.definicion.ubicacion_obligatoria,
        anterior,
      });
      if (r.ok) return r.ubicacion;
      for (const e of r.errores) problema(zctx, [e.ruta.replace(/^ubicacion\./, "")], e.mensaje);
      return z.NEVER;
    });
}

function esquemaTipoMonumento(ctx: ContextoEsquema) {
  return ctx.tiposMonumento.length === 0
    ? z.string().refine(() => false, "Falta configurar el cementerio: no tiene tipos de monumento habilitados para este trámite")
    : unoDe(ctx.tiposMonumento, "Elegí un tipo de monumento habilitado en el cementerio para este trámite");
}

function esquemaFormaPago(def: DefinicionPlantilla) {
  switch (def.forma_pago) {
    case "contado":
    case "plan_pagos": {
      const fija = def.forma_pago;
      return z
        .enum(["contado", "plan_pagos"])
        .nullish()
        .refine((v) => v === null || v === undefined || v === fija, "La forma de pago la fija el trámite")
        .transform((): "contado" | "plan_pagos" => fija);
    }
    case "a_elegir":
      return z.enum(["contado", "plan_pagos"], { error: "Elegí la forma de pago" });
    case "no_aplica":
      return z
        .null({ error: "Este trámite no tiene forma de pago" })
        .optional()
        .transform(() => null);
    default: {
      const sinCaso: never = def.forma_pago;
      throw new Error(`forma_pago sin esquema: ${String(sinCaso)}`);
    }
  }
}

/** Reglas de `fecha_inicio` (2.6 y 2.13(c)). Devuelve el mensaje de error, o null. */
export function errorFechaInicio(fecha: FechaISO, hoy: FechaISO, cargaHistorica: boolean): string | null {
  if (fecha > hoy) return "Fecha de inicio: no puede ser posterior a hoy";
  if (cargaHistorica) {
    if (fecha < FECHA_MINIMA_INICIO) return "Fecha de inicio: no puede ser anterior a 1950";
    return null;
  }
  if (fecha < sumarDias(hoy, -DIAS_RETROACTIVOS_MAX)) {
    return `Fecha de inicio: hasta ${DIAS_RETROACTIVOS_MAX} días atrás. Para un expediente más viejo, marcá "Iniciado antes del sistema"`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Esquemas públicos
// ---------------------------------------------------------------------------

/** El esquema del alta para esa plantilla y ese cementerio. Ver el comentario del módulo. */
export function construirEsquemaAlta(ctx: ContextoEsquema): z.ZodType<AltaValidada> {
  const def = ctx.plantilla.definicion;
  // Los documentos que no corresponden al cementerio no se pueden recibir: el
  // expediente no los va a mostrar ni a pedir.
  const documentos = resolverPorCementerio(def, ctx.cementerio.codigo).documentos;
  const claves = documentos.map((d) => d.clave);
  const etiquetas = new Map(def.personas.map((r) => [r.rol, r.etiqueta]));
  return z
    .strictObject({
      plantillaId: z.literal(ctx.plantilla.id, { error: "La plantilla cambió: recargá el formulario" }),
      cementerioId: z.literal(ctx.cementerio.id, { error: "El cementerio cambió: recargá el formulario" }),
      tipoMonumento: esquemaTipoMonumento(ctx),
      ubicacion: esquemaUbicacion(ctx).default({}),
      padron: textoOpcional("Padrón", 60),
      numeroMunicipal: textoOpcional("N° municipal", 60),
      formaPago: esquemaFormaPago(def),
      personas: esquemaPersonas(def, ctx.hoy, false),
      datosExtra: esquemaDatosExtra(def, ctx.cementerios)
        .default({})
        .transform((v) => sinVacios(v)),
      documentosRecibidos: z
        .array(unoDe(claves, "Documento que el trámite no pide"))
        .default([])
        .transform((v) => [...new Set(v)]),
      observaciones: textoOpcional("Observaciones", 2000),
      fechaInicio: z
        .string({ error: "Fecha de inicio: es obligatoria" })
        .refine(esFechaValida, "Fecha de inicio: fecha inválida (AAAA-MM-DD)"),
      cargaHistorica: z.boolean().default(false),
      fuente: textoOpcional("Fuente", 200),
      expedienteAnteriorId: z
        .string({ error: "Expediente anterior inválido" })
        .regex(/^\d{1,18}$/, "Expediente anterior inválido")
        .nullable()
        .default(null),
    })
    .superRefine((d, zctx) => {
      const error = errorFechaInicio(d.fechaInicio, ctx.hoy, d.cargaHistorica);
      if (error) problema(zctx, ["fechaInicio"], error);
      if (d.cargaHistorica && d.fuente === null) {
        problema(zctx, ["fuente"], 'Fuente: es obligatoria en un expediente iniciado antes del sistema (ej. "Ficha papel")');
      }
      // La personería y la designación de asamblea, solo con una persona jurídica en ese rol.
      const rolesJuridicos = new Set(d.personas.filter((p) => p.tipo === "juridica").map((p) => p.rol));
      for (const doc of documentos) {
        if (d.documentosRecibidos.includes(doc.clave) && !aplicaPorPersonas(doc, rolesJuridicos)) {
          const rol = doc.solo_si_juridica ?? "";
          problema(zctx, ["documentosRecibidos"], `${doc.nombre}: corresponde solo si ${etiquetas.get(rol) ?? rol} es una persona jurídica`);
        }
      }
    })
    .transform((d) => ({ ...d, fuente: d.cargaHistorica ? d.fuente : null }));
}

export interface ContextoEdicion extends ContextoEsquema {
  /** Ubicación actual del expediente (para conservar los campos desactivados). */
  ubicacionAnterior: Ubicacion;
  /** `expedientes.carga_historica`: cambia el rango admitido para la fecha de inicio. */
  cargaHistorica: boolean;
}

/** El esquema de la edición. Ver `CambiosEdicion`. */
export function construirEsquemaEdicion(ctx: ContextoEdicion): z.ZodType<EdicionValidada> {
  const def = ctx.plantilla.definicion;
  return z
    .strictObject({
      tipoMonumento: esquemaTipoMonumento(ctx).optional(),
      ubicacion: esquemaUbicacion(ctx, ctx.ubicacionAnterior).optional(),
      padron: textoOpcional("Padrón", 60).optional(),
      numeroMunicipal: textoOpcional("N° municipal", 60).optional(),
      fechaInicio: z
        .string()
        .refine(esFechaValida, "Fecha de inicio: fecha inválida (AAAA-MM-DD)")
        .optional(),
      observaciones: textoOpcional("Observaciones", 2000).optional(),
      datosExtra: esquemaDatosExtra(def, ctx.cementerios).optional(),
      personas: esquemaPersonas(def, ctx.hoy, true).optional(),
    })
    .superRefine((d, zctx) => {
      if (d.fechaInicio !== undefined) {
        const error = errorFechaInicio(d.fechaInicio, ctx.hoy, ctx.cargaHistorica);
        if (error) problema(zctx, ["fechaInicio"], error);
      }
      d.personas?.forEach((p, i) => {
        if (p.id !== null && d.personas?.some((q, j) => j < i && q.id === p.id)) {
          problema(zctx, ["personas", i, "id"], "La misma persona está dos veces");
        }
      });
    })
    .transform((d) => {
      // `undefined` = sin cambios; se sacan para que no aparezcan como claves.
      const r: EdicionValidada = {};
      if (d.tipoMonumento !== undefined) r.tipoMonumento = d.tipoMonumento;
      if (d.ubicacion !== undefined) r.ubicacion = d.ubicacion;
      if (d.padron !== undefined) r.padron = d.padron;
      if (d.numeroMunicipal !== undefined) r.numeroMunicipal = d.numeroMunicipal;
      if (d.fechaInicio !== undefined) r.fechaInicio = d.fechaInicio;
      if (d.observaciones !== undefined) r.observaciones = d.observaciones;
      if (d.datosExtra !== undefined) {
        r.datosExtra = Object.fromEntries(
          Object.entries(d.datosExtra).filter(([, v]) => v !== undefined),
        ) as Record<string, ValorCampoExtra | null>;
      }
      if (d.personas !== undefined) r.personas = d.personas;
      return r;
    });
}

/**
 * Corre un esquema y devuelve el resultado, o tira `ErrorDominio("validacion")`
 * con un error por campo (`personas[1].dni`). Los mensajes que no fija el
 * esquema salen en castellano (locale `es` de zod).
 */
export function validarCon<T>(esquema: z.ZodType<T>, datos: unknown): T {
  const r = esquema.safeParse(datos, { error: z.locales.es().localeError });
  if (r.success) return r.data;
  throw errorValidacion(erroresDeZod(r.error));
}

/**
 * Lo mismo que `validarCon()`, sin tirar: los errores por campo (vacío si
 * pasa). Es lo que usa el formulario en el navegador antes de enviar, con los
 * mismos mensajes que dará el servidor.
 */
export function erroresDe(esquema: z.ZodType<unknown>, datos: unknown): ErrorCampo[] {
  const r = esquema.safeParse(datos, { error: z.locales.es().localeError });
  return r.success ? [] : erroresDeZod(r.error);
}

/** Los issues de zod como errores por campo. */
export function erroresDeZod(error: z.ZodError): ErrorCampo[] {
  return error.issues.map((issue) => ({ ruta: rutaComoTexto(issue.path), mensaje: issue.message }));
}
