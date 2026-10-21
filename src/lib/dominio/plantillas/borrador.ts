import {
  ADJUNTO_DOCUMENTO,
  DATOS_SUBTAREA,
  ESTADOS_PASO,
  FALLECIDO,
  FORMAS_PAGO,
  ORIGENES_DOCUMENTO,
  TIPOS_CAMPO_EXTRA,
  VIAS_CONCEPTO,
  type CampoExtraPlantilla,
  type ConceptoPlantilla,
  type DefinicionPlantilla,
  type DocumentoPlantilla,
  type PasoPlantilla,
  type PersonaPlantilla,
  type PlazoPlantilla,
  type SubtareaPlantilla,
} from "./esquema";

/**
 * La definición de un BORRADOR, tal como la edita `/admin/plantillas/[codigo]/v/[version]`
 * (semana 5). Puro: lo usan el dominio (al leer y guardar un borrador) y el
 * editor del navegador.
 *
 * Un borrador se guarda a medio hacer: una clave vacía, un mínimo mayor que el
 * máximo o un paso sin custodia no impiden guardar, porque el editor tiene que
 * poder dejarlo y seguir otro día. Lo que exige "Publicar" (validar.ts) se
 * controla recién al validar o publicar. Pero la FORMA sí se garantiza: cada
 * objeto tiene todas sus claves con el tipo del esquema (`DefinicionPlantilla`),
 * así el editor no necesita adivinar nada y "Publicar" solo valida valores.
 *
 * `definicionEditable()` lleva cualquier valor a esa forma: completa lo que
 * falta con el valor por defecto, descarta las claves desconocidas y convierte
 * lo que vino con el tipo equivocado. Con una definición publicada no cambia
 * nada (ya tiene la forma); con un borrador viejo o roto, lo deja editable en
 * vez de romper la pantalla.
 */

type Objeto = Record<string, unknown>;

function objeto(v: unknown): Objeto {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Objeto) : {};
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function texto(v: unknown, porDefecto = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : porDefecto;
}

function textoONull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.trim() === "" ? null : v;
}

function booleano(v: unknown, porDefecto: boolean): boolean {
  return typeof v === "boolean" ? v : porDefecto;
}

function entero(v: unknown, porDefecto: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : porDefecto;
}

function enumerado<T extends string>(v: unknown, valores: readonly T[], porDefecto: T): T {
  return typeof v === "string" && (valores as readonly string[]).includes(v) ? (v as T) : porDefecto;
}

function enumeradoONull<T extends string>(v: unknown, valores: readonly T[]): T | null {
  return typeof v === "string" && (valores as readonly string[]).includes(v) ? (v as T) : null;
}

function textos(v: unknown): string[] {
  return lista(v).filter((x): x is string => typeof x === "string");
}

/**
 * `null` (en todos) o una lista de códigos. Una lista vacía se conserva: es
 * "Solo en…" sin ningún cementerio marcado todavía, y Validar lo señala; si se
 * convirtiera en null, el filtro desaparecería sin aviso.
 */
function codigosONull(v: unknown): string[] | null {
  return Array.isArray(v) ? textos(v) : null;
}

export function personaEditable(v: unknown): PersonaPlantilla {
  const o = objeto(v);
  return {
    rol: texto(o.rol),
    etiqueta: texto(o.etiqueta),
    min: entero(o.min, 0),
    max: entero(o.max, 1),
    fallecido: enumerado(o.fallecido, FALLECIDO, "no"),
    pide_vinculo: booleano(o.pide_vinculo, false),
    admite_juridica: booleano(o.admite_juridica, false),
  };
}

export function campoExtraEditable(v: unknown): CampoExtraPlantilla {
  const o = objeto(v);
  const tipo = enumerado(o.tipo, TIPOS_CAMPO_EXTRA, "texto");
  return {
    clave: texto(o.clave),
    etiqueta: texto(o.etiqueta),
    tipo,
    obligatorio: booleano(o.obligatorio, false),
    exigir_al_salir_de: textoONull(o.exigir_al_salir_de),
    buscable: booleano(o.buscable, false),
    opciones: Array.isArray(o.opciones) ? textos(o.opciones) : null,
  };
}

export function documentoEditable(v: unknown): DocumentoPlantilla {
  const o = objeto(v);
  return {
    clave: texto(o.clave),
    nombre: texto(o.nombre),
    origen: enumerado(o.origen, ORIGENES_DOCUMENTO, "concesionario"),
    obligatorio: booleano(o.obligatorio, true),
    exigir_al_salir_de: textoONull(o.exigir_al_salir_de),
    adjunto: enumerado(o.adjunto, ADJUNTO_DOCUMENTO, "no"),
    solo_cementerios: codigosONull(o.solo_cementerios),
    excepto_cementerios: codigosONull(o.excepto_cementerios),
    solo_si_juridica: textoONull(o.solo_si_juridica),
  };
}

export function conceptoEditable(v: unknown): ConceptoPlantilla {
  const o = objeto(v);
  return {
    clave: texto(o.clave),
    nombre: texto(o.nombre),
    via: enumerado(o.via, VIAS_CONCEPTO, "boleta"),
    paso: texto(o.paso),
    solo_cementerios: codigosONull(o.solo_cementerios),
    excepto_cementerios: codigosONull(o.excepto_cementerios),
  };
}

export function subtareaEditable(v: unknown): SubtareaPlantilla {
  const o = objeto(v);
  return {
    clave: texto(o.clave),
    nombre: texto(o.nombre),
    obligatoria: booleano(o.obligatoria, true),
    dato: enumeradoONull(o.dato, DATOS_SUBTAREA),
    dato_obligatorio: booleano(o.dato_obligatorio, false),
    solo_cementerios: codigosONull(o.solo_cementerios),
    excepto_cementerios: codigosONull(o.excepto_cementerios),
  };
}

function plazoEditable(v: unknown): PlazoPlantilla | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = objeto(v);
  return { dias_habiles: entero(o.dias_habiles, 30), desde_subtarea: texto(o.desde_subtarea), hasta_subtarea: texto(o.hasta_subtarea) };
}

export function pasoEditable(v: unknown): PasoPlantilla {
  const o = objeto(v);
  return {
    clave: texto(o.clave),
    nombre: texto(o.nombre),
    area: texto(o.area),
    custodia: textoONull(o.custodia),
    estado: enumerado(o.estado, ESTADOS_PASO, "en_tramite"),
    omitible: booleano(o.omitible, false),
    dias_alerta: entero(o.dias_alerta, 5),
    instrucciones: textoONull(o.instrucciones),
    plazo: plazoEditable(o.plazo),
    subtareas: lista(o.subtareas).map(subtareaEditable),
  };
}

/** Cualquier valor (la columna `definicion`, lo que manda el editor), con la forma de `DefinicionPlantilla`. */
export function definicionEditable(valor: unknown): DefinicionPlantilla {
  const o = objeto(valor);
  return {
    forma_pago: enumerado(o.forma_pago, FORMAS_PAGO, "contado"),
    tipos_monumento: textos(o.tipos_monumento),
    ubicacion_obligatoria: booleano(o.ubicacion_obligatoria, true),
    requiere_contacto: booleano(o.requiere_contacto, true),
    personas: lista(o.personas).map(personaEditable),
    campos_extra: lista(o.campos_extra).map(campoExtraEditable),
    documentos: lista(o.documentos).map(documentoEditable),
    conceptos: lista(o.conceptos).map(conceptoEditable),
    pasos: lista(o.pasos).map(pasoEditable),
  };
}

/**
 * La definición de una plantilla nueva: un titular vivo que es el contacto y
 * nada más. Sin pasos a propósito: inventar un recorrido sería peor que pedir
 * que se cargue (Validar avisa "al menos un paso").
 */
export function definicionInicial(): DefinicionPlantilla {
  return {
    forma_pago: "contado",
    tipos_monumento: [],
    ubicacion_obligatoria: true,
    requiere_contacto: true,
    personas: [
      { rol: "titular", etiqueta: "Titular de la concesión", min: 1, max: 1, fallecido: "no", pide_vinculo: false, admite_juridica: false },
    ],
    campos_extra: [],
    documentos: [],
    conceptos: [],
    pasos: [],
  };
}
