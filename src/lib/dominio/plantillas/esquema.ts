import { z } from "zod";

/**
 * Esquema de `plantillas.definicion` (docs/propuesta-mvp.md, sección 2.5).
 *
 * Valida la FORMA y los valores admitidos de cada campo por separado. Lo que
 * cruza campos o necesita los catálogos de la base (claves únicas, áreas
 * existentes, custodia, referencias entre pasos, `opcion` con `opciones`…) está
 * en ./validar.ts, porque un esquema no ve la tabla `areas`. Publicar corre las
 * dos cosas: `validarPublicacion()`.
 *
 * Todas las claves de cada objeto son obligatorias y no se admiten claves de
 * más: la definición se congela al publicarse y no puede llevar datos que nadie
 * lea. Las excepciones tienen valor por defecto: `requiere_contacto` (true) e
 * `instrucciones` (null), de la propuesta, y las que agregó la semana 4 según
 * docs/fuentes (`admite_juridica`, `solo_cementerios`, `excepto_cementerios`,
 * `solo_si_juridica`): con el valor por defecto, una definición escrita antes
 * se lee igual que antes.
 *
 * Lo que depende del expediente (el cementerio, si el titular es persona
 * jurídica) no se resuelve acá: `resolverDefinicion()` (./resolver.ts) arma la
 * definición que vale para un expediente concreto.
 */

// ---------------------------------------------------------------------------
// Valores admitidos (tabla de la sección 2.5)
// ---------------------------------------------------------------------------

export const FORMAS_PAGO = ["contado", "plan_pagos", "a_elegir", "no_aplica"] as const;
export const FALLECIDO = ["no", "si", "opcional"] as const;
export const TIPOS_CAMPO_EXTRA = ["texto", "numero", "fecha", "opcion", "cementerio"] as const;
export const ORIGENES_DOCUMENTO = ["direccion", "concesionario"] as const;
export const ADJUNTO_DOCUMENTO = ["no", "sugerido", "obligatorio"] as const;
export const VIAS_CONCEPTO = ["boleta", "plan_dim"] as const;
export const ESTADOS_PASO = ["en_tramite", "espera_pago_dim"] as const;
export const DATOS_SUBTAREA = ["fecha", "texto"] as const;

/** `pasos[].area`: el cementerio del expediente. */
export const COMODIN_CEMENTERIO = "$CEMENTERIO";
/** `pasos[].area`: `$CAMPO:<clave>`, el cementerio elegido en un campo extra. */
export const PREFIJO_CAMPO = "$CAMPO:";

// Las claves de pasos, subtareas, documentos y conceptos van en mayúsculas (como
// en la sección 4) y las de campos extra en minúsculas, porque son las claves de
// `expedientes.datos_extra` y de `$CAMPO:<clave>`. La propuesta no fija patrón;
// sin uno, una clave con espacios o acentos rompería `items` y las URLs.
const RE_CLAVE = /^[A-Z][A-Z0-9_]*$/;
const RE_CLAVE_CAMPO = /^[a-z][a-z0-9_]*$/;
// Igual que el CHECK de expediente_personas.rol.
const RE_ROL = /^[a-z_]+$/;
const RE_CODIGO_AREA = /^[A-Z][A-Z0-9_]*$/;
// Igual que el CHECK de tipos_monumento.codigo.
const RE_CODIGO_MONUMENTO = /^[A-Z_]+$/;
const RE_AREA_PASO = /^(?:[A-Z][A-Z0-9_]*|\$CEMENTERIO|\$CAMPO:[a-z][a-z0-9_]*)$/;
// Los códigos de cementerios de la semilla (OESTE, JARDIN_NORTE). La tabla no
// tiene CHECK; validar.ts controla que existan.
const RE_CODIGO_CEMENTERIO = /^[A-Z][A-Z0-9_]*$/;

const texto = () => z.string().trim().min(1, "No puede quedar vacío");

const clave = () =>
  z.string().regex(RE_CLAVE, "Clave inválida: mayúsculas, números y _, empezando con una letra (ej. LIQ_PAGO)");

const claveCampo = () =>
  z.string().regex(RE_CLAVE_CAMPO, "Clave inválida: minúsculas, números y _, empezando con una letra (ej. concesion_hasta)");

const codigoArea = () =>
  z.string().regex(RE_CODIGO_AREA, "Código de área inválido: mayúsculas, números y _ (ej. MESA_ENTRADAS)");

const enteroPositivo = () => z.int("Tiene que ser un número entero").min(1, "Tiene que ser 1 o más");

/**
 * Filtro opcional por cementerio de conceptos, documentos y subtareas (semana
 * 4, docs/fuentes: Jardín no cobra inspección técnica). `null` = en todos.
 * Uno u otro, no los dos (lo controla validar.ts, junto con que los códigos
 * existan).
 */
const listaCementerios = () =>
  z
    .array(z.string().regex(RE_CODIGO_CEMENTERIO, "Código de cementerio inválido: mayúsculas, números y _ (ej. JARDIN_NORTE)"))
    .min(1, "Si se filtra por cementerio, tiene que haber al menos uno")
    .nullable()
    .default(null);

const FILTRO_CEMENTERIOS = {
  /** Solo en estos cementerios (códigos de `cementerios`). */
  solo_cementerios: listaCementerios(),
  /** En todos menos estos. */
  excepto_cementerios: listaCementerios(),
};

// ---------------------------------------------------------------------------
// Partes de la definición
// ---------------------------------------------------------------------------

export const PersonaPlantilla = z.strictObject({
  rol: z.string().regex(RE_ROL, "Rol inválido: minúsculas y _ (ej. titular, cesionario)"),
  etiqueta: texto(),
  min: z.int("Tiene que ser un número entero").min(0, "No puede ser negativo"),
  max: enteroPositivo(),
  fallecido: z.enum(FALLECIDO),
  pide_vinculo: z.boolean(),
  /**
   * El rol puede ser una persona jurídica (razón social y CUIT): las
   * asociaciones con panteón (docs/fuentes). Por defecto, solo personas físicas.
   */
  admite_juridica: z.boolean().default(false),
});

export const CampoExtraPlantilla = z.strictObject({
  clave: claveCampo(),
  etiqueta: texto(),
  tipo: z.enum(TIPOS_CAMPO_EXTRA),
  obligatorio: z.boolean(),
  /** Clave de un paso, o null: se exige al concluir. */
  exigir_al_salir_de: clave().nullable(),
  /** Si es true, el valor entra en `expedientes.busqueda`. */
  buscable: z.boolean(),
  /** Solo para `tipo: opcion` (lo controla validar.ts). */
  opciones: z.array(texto()).min(1, "Si hay opciones, tiene que haber al menos una").nullable(),
});

export const DocumentoPlantilla = z.strictObject({
  clave: clave(),
  nombre: texto(),
  origen: z.enum(ORIGENES_DOCUMENTO),
  obligatorio: z.boolean(),
  /** Clave de un paso, o null: se exige al concluir. */
  exigir_al_salir_de: clave().nullable(),
  adjunto: z.enum(ADJUNTO_DOCUMENTO),
  ...FILTRO_CEMENTERIOS,
  /**
   * Rol de persona: el documento corresponde solo si alguna persona vigente de
   * ese rol es jurídica (personería y designación de asamblea). `null` =
   * siempre. El rol tiene que tener `admite_juridica` (validar.ts).
   */
  solo_si_juridica: z.string().regex(RE_ROL, "Rol inválido: minúsculas y _ (ej. titular)").nullable().default(null),
});

export const ConceptoPlantilla = z.strictObject({
  clave: clave(),
  nombre: texto(),
  via: z.enum(VIAS_CONCEPTO),
  /** Clave del paso en que se liquida. */
  paso: clave(),
  ...FILTRO_CEMENTERIOS,
});

export const SubtareaPlantilla = z.strictObject({
  clave: clave(),
  nombre: texto(),
  obligatoria: z.boolean(),
  dato: z.enum(DATOS_SUBTAREA).nullable(),
  dato_obligatorio: z.boolean(),
  // Por ejemplo, la boleta cuyo texto nombra la inspección técnica, que Jardín no cobra.
  ...FILTRO_CEMENTERIOS,
});

/** Plazo en días hábiles mientras el expediente está en el paso (sección 3.6). */
export const PlazoPlantilla = z.strictObject({
  dias_habiles: enteroPositivo(),
  /** Subtarea con `dato: fecha` de este paso o de uno anterior: su fecha inicia el plazo. */
  desde_subtarea: clave(),
  /** Subtarea de este paso que, tildada, da el plazo por cumplido. */
  hasta_subtarea: clave(),
});

export const PasoPlantilla = z.strictObject({
  clave: clave(),
  nombre: texto(),
  /** Código de área, `$CEMENTERIO` o `$CAMPO:<clave>`. */
  area: z
    .string()
    .regex(RE_AREA_PASO, "Área inválida: un código de área, $CEMENTERIO o $CAMPO:<clave de un campo extra>"),
  /** Área interna que opera el paso cuando el área es externa o un comodín; si no, null. */
  custodia: codigoArea().nullable(),
  estado: z.enum(ESTADOS_PASO),
  omitible: z.boolean(),
  /** Días hábiles en el área a partir de los cuales la bandeja lo marca demorado. */
  dias_alerta: enteroPositivo(),
  instrucciones: texto().nullable().default(null),
  plazo: PlazoPlantilla.nullable(),
  subtareas: z.array(SubtareaPlantilla),
});

export const DefinicionPlantilla = z.strictObject({
  /** `a_elegir`: se elige en el alta. `no_aplica`: trámites de oficio. */
  forma_pago: z.enum(FORMAS_PAGO),
  /** Códigos de `tipos_monumento`; `[]` = todos los habilitados en el cementerio. */
  tipos_monumento: z.array(z.string().regex(RE_CODIGO_MONUMENTO, "Código de monumento inválido: mayúsculas y _")),
  ubicacion_obligatoria: z.boolean(),
  /** true exige una persona marcada como contacto; false para trámites de oficio. */
  requiere_contacto: z.boolean().default(true),
  personas: z.array(PersonaPlantilla),
  campos_extra: z.array(CampoExtraPlantilla),
  documentos: z.array(DocumentoPlantilla),
  conceptos: z.array(ConceptoPlantilla),
  pasos: z.array(PasoPlantilla).min(1, "La plantilla tiene que tener al menos un paso"),
});

export type PersonaPlantilla = z.infer<typeof PersonaPlantilla>;
export type CampoExtraPlantilla = z.infer<typeof CampoExtraPlantilla>;
export type DocumentoPlantilla = z.infer<typeof DocumentoPlantilla>;
export type ConceptoPlantilla = z.infer<typeof ConceptoPlantilla>;
export type SubtareaPlantilla = z.infer<typeof SubtareaPlantilla>;
export type PlazoPlantilla = z.infer<typeof PlazoPlantilla>;
export type PasoPlantilla = z.infer<typeof PasoPlantilla>;
/** La definición ya validada, tal como se guarda en `plantillas.definicion`. */
export type DefinicionPlantilla = z.infer<typeof DefinicionPlantilla>;
/** Lo que acepta el esquema: igual, pero sin las claves que tienen valor por defecto. */
export type DefinicionPlantillaEntrada = z.input<typeof DefinicionPlantilla>;
/** El filtro por cementerio de conceptos, documentos y subtareas. */
export type FiltroCementerios = Pick<ConceptoPlantilla, "solo_cementerios" | "excepto_cementerios">;

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

/** A dónde va el papel en un paso, según `pasos[].area`. */
export type DestinoPaso =
  | { tipo: "area"; codigo: string }
  | { tipo: "cementerio" }
  | { tipo: "campo"; clave: string };

export function destinoDePaso(area: string): DestinoPaso {
  if (area === COMODIN_CEMENTERIO) return { tipo: "cementerio" };
  if (area.startsWith(PREFIJO_CAMPO)) return { tipo: "campo", clave: area.slice(PREFIJO_CAMPO.length) };
  return { tipo: "area", codigo: area };
}

/** Un error de una plantilla, para mostrar junto al campo en el editor. */
export interface ErrorPlantilla {
  /** Qué regla falló: `esquema` para la forma; las de integridad, en validar.ts. */
  regla: string;
  /** Dónde: `pasos[6].custodia`. Vacía si el error es de la definición entera. */
  ruta: string;
  mensaje: string;
}

export type ResultadoDefinicion =
  | { ok: true; definicion: DefinicionPlantilla }
  | { ok: false; errores: ErrorPlantilla[] };

/** `["pasos", 6, "custodia"]` → `pasos[6].custodia`. */
export function rutaComoTexto(ruta: readonly PropertyKey[]): string {
  return ruta.reduce<string>((acc, parte) => {
    if (typeof parte === "number") return `${acc}[${parte}]`;
    const nombre = String(parte);
    return acc === "" ? nombre : `${acc}.${nombre}`;
  }, "");
}

/**
 * Valida la forma de una definición. Los mensajes que no fija el esquema salen
 * del locale `es` de zod, pasado en cada llamada y no con `z.config()`, para
 * no cambiar el idioma de todos los esquemas de la app al importar este módulo.
 */
export function analizarDefinicion(valor: unknown): ResultadoDefinicion {
  const r = DefinicionPlantilla.safeParse(valor, { error: z.locales.es().localeError });
  if (r.success) return { ok: true, definicion: r.data };
  return {
    ok: false,
    errores: r.error.issues.map((issue) => ({
      regla: "esquema",
      ruta: rutaComoTexto(issue.path),
      mensaje: issue.message,
    })),
  };
}
