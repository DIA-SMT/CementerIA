import { z } from "zod";
import { errorValidacion } from "../expedientes/errores";
import { esFechaValida, type FechaISO } from "@/lib/fechas";

/**
 * El contenido de la página pública (28/10/2026; docs/api-dominio.md, sección
 * 25): lo que valida la administración antes de guardar, puro y sin base. Los
 * mismos largos y las mismas URLs los repiten los CHECKs de la migración
 * *_sitio_publico: si se cambia uno, cambiar el otro.
 *
 * Todo es texto plano. La página lo muestra escapado (React), así que un `<b>`
 * o un `**` se ve tal cual: no hay HTML ni Markdown del usuario. Lo que se
 * controla acá es la forma: una línea sin caracteres de control, o párrafos con
 * saltos de línea; sin espacios de más; vacío es NULL ("no se muestra").
 */

// ---------------------------------------------------------------------------
// Largos (los de los CHECKs)
// ---------------------------------------------------------------------------

export const LARGOS = {
  domicilio: 160,
  descripcionCementerio: 400,
  queTiene: 200,
  horario: 120,
  horarioEspecial: 160,
  nombreRecorrido: 120,
  descripcionRecorrido: 600,
  diasHora: 120,
  duracion: 60,
  puntoEncuentro: 160,
  cupo: 60,
  inscripcion: 300,
  notaFecha: 120,
  tituloNovedad: 100,
  textoNovedad: 400,
  horarioContacto: 160,
  telefono: 80,
  correo: 120,
  pregunta: 160,
  respuesta: 800,
  url: 500,
} as const;

/** Como máximo, cuántas fechas próximas de recorridos muestra la página. */
export const MAXIMO_FECHAS_PROXIMAS = 6;

// ---------------------------------------------------------------------------
// Fotos: una lista cerrada de las imágenes de public/imagenes
// ---------------------------------------------------------------------------

export interface FotoSitio {
  clave: string;
  /** Para el selector de la administración. */
  etiqueta: string;
  /** El texto alternativo en la página (son ilustrativas, y lo dice). */
  alt: string;
  chica: string;
  grande: string;
  anchoGrande: number;
  altoGrande: number;
}

/**
 * Las fotos que se pueden elegir para un cementerio o un recorrido. Subir fotos
 * propias queda para más adelante (README, "Sitio público"): por ahora, una
 * de estas, que ya están en public/imagenes con su versión de 960 px.
 */
export const FOTOS_SITIO: readonly FotoSitio[] = [
  {
    clave: "panoramica",
    etiqueta: "Panorámica con cipreses",
    alt: "Paseo de mausoleos con cipreses y cielo despejado (foto ilustrativa)",
    chica: "/imagenes/landing-panoramica-960.webp",
    grande: "/imagenes/landing-panoramica-1916.webp",
    anchoGrande: 1916,
    altoGrande: 821,
  },
  {
    clave: "avenida-azul",
    etiqueta: "Avenida de mausoleos",
    alt: "Avenida de mausoleos (foto ilustrativa)",
    chica: "/imagenes/avenida-azul-960.webp",
    grande: "/imagenes/avenida-azul-1600.webp",
    anchoGrande: 1600,
    altoGrande: 900,
  },
  {
    clave: "avenida-memorial",
    etiqueta: "Avenida memorial",
    alt: "Avenida arbolada entre monumentos (foto ilustrativa)",
    chica: "/imagenes/panel-avenida-memorial-960.webp",
    grande: "/imagenes/panel-avenida-memorial-1600.webp",
    anchoGrande: 1600,
    altoGrande: 900,
  },
  {
    clave: "ingreso-paseo-sereno",
    etiqueta: "Ingreso con paseo arbolado",
    alt: "Ingreso con paseo arbolado (foto ilustrativa)",
    chica: "/imagenes/ingreso-paseo-sereno-960.webp",
    grande: "/imagenes/ingreso-paseo-sereno-1600.webp",
    anchoGrande: 1600,
    altoGrande: 900,
  },
  {
    clave: "parque-memorial",
    etiqueta: "Cementerio parque",
    alt: "Cementerio parque con césped y árboles (foto ilustrativa)",
    chica: "/imagenes/parque-memorial-960.webp",
    grande: "/imagenes/parque-memorial-1600.webp",
    anchoGrande: 1600,
    altoGrande: 900,
  },
];

export const CLAVES_FOTO = FOTOS_SITIO.map((f) => f.clave);

export function fotoSitio(clave: string | null | undefined): FotoSitio | null {
  return FOTOS_SITIO.find((f) => f.clave === clave) ?? null;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Caracteres que no van en una URL guardada (los mismos del CHECK). */
const RE_URL_PROHIBIDOS = /[\s\p{Cc}"'<>\\]/u;

function analizarHttps(valor: string): URL | null {
  if (valor.length > LARGOS.url || RE_URL_PROHIBIDOS.test(valor) || !/^https:\/\//i.test(valor)) return null;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  // Sin usuario, contraseña ni puerto: el host que se ve es el host al que va.
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  return url;
}

/**
 * Un enlace "Cómo llegar": https de Google Maps (`google.com/maps…`,
 * `maps.app.goo.gl/…`) o de OpenStreetMap. Nada de otros hosts ni de
 * `javascript:`. El texto tiene que empezar exactamente así (el CHECK lo mira
 * igual): `https://www.google.com/maps/place/...`.
 */
export function esUrlMapa(valor: string): boolean {
  const url = analizarHttps(valor);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  // Lo que se escribió, no lo que el navegador normaliza (mayúsculas, puntos de más).
  const texto = valor.slice("https://".length);
  if (host === "google.com" || host === "www.google.com") return /^(www\.)?google\.com\/maps([/?#]|$)/.test(texto);
  if (host === "maps.app.goo.gl") return /^maps\.app\.goo\.gl\/./.test(texto);
  if (host === "openstreetmap.org" || host === "www.openstreetmap.org") return /^(www\.)?openstreetmap\.org([/?#]|$)/.test(texto);
  return false;
}

/** Un enlace https cualquiera (el de inscripción a un recorrido): con dominio, sin usuario ni puerto. */
export function esUrlHttps(valor: string): boolean {
  const url = analizarHttps(valor);
  if (!url) return false;
  return /^https:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+([/?#]|$)/.test(valor);
}

/** Un correo con forma de correo (el CHECK de sitio_contacto). */
export function esCorreo(valor: string): boolean {
  return valor.length >= 3 && valor.length <= LARGOS.correo && /^[^\s\p{Cc}@<>"']+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/u.test(valor);
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** Control que no es espacio en blanco: lo que no puede quedar después de limpiar. */
const RE_CONTROL = /\p{Cc}/u;

/** Una línea: todos los espacios (también saltos de línea) como uno solo, sin bordes. Vacía, `null`. */
export function limpiarLinea(valor: string | null | undefined): string | null {
  const t = (valor ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/**
 * Uno o más párrafos: saltos de línea `\n` (sin `\r`), sin espacios al final de
 * cada renglón ni más de una línea en blanco seguida, sin bordes. Vacío, `null`.
 */
export function limpiarParrafos(valor: string | null | undefined): string | null {
  const t = (valor ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t === "" ? null : t;
}

/** Una línea opcional de hasta `max` caracteres. */
function linea(max: number) {
  return z
    .string()
    .nullish()
    .transform(limpiarLinea)
    .refine((v) => v === null || !RE_CONTROL.test(v), "Tiene caracteres que no se pueden mostrar")
    .refine((v) => v === null || v.length <= max, `Hasta ${max} caracteres`);
}

/** Una línea obligatoria. */
function lineaObligatoria(max: number, falta: string) {
  return linea(max).refine((v): v is string => v !== null, falta).transform((v) => v as string);
}

/** Párrafos opcionales de hasta `max` caracteres. */
function parrafos(max: number) {
  return z
    .string()
    .nullish()
    .transform(limpiarParrafos)
    .refine((v) => v === null || !RE_CONTROL.test(v.replaceAll("\n", "")), "Tiene caracteres que no se pueden mostrar")
    .refine((v) => v === null || v.length <= max, `Hasta ${max} caracteres`);
}

function parrafosObligatorios(max: number, falta: string) {
  return parrafos(max).refine((v): v is string => v !== null, falta).transform((v) => v as string);
}

const UrlMapa = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim() || null)
  .refine((v) => v === null || esUrlMapa(v), "Pegá el enlace https de Google Maps (google.com/maps o maps.app.goo.gl) o de OpenStreetMap");

const UrlHttps = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim() || null)
  .refine((v) => v === null || esUrlHttps(v), "Tiene que ser un enlace que empiece con https://");

const Foto = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim() || null)
  .refine((v) => v === null || CLAVES_FOTO.includes(v), "Elegí una de las fotos de la lista");

const Orden = z.int("Un número entero").min(0, "0 o más").max(999, "Hasta 999");
const Id = z.int().positive();
const Fecha = z
  .string("Elegí la fecha")
  .transform((v) => v.trim())
  .refine((v) => esFechaValida(v), "Elegí una fecha válida");

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export const EntradaCementerioSitio = z.object({
  cementerioId: Id,
  visible: z.boolean(),
  domicilio: linea(LARGOS.domicilio),
  mapaUrl: UrlMapa,
  descripcion: parrafos(LARGOS.descripcionCementerio),
  queTiene: linea(LARGOS.queTiene),
  horarioSemana: linea(LARGOS.horario),
  horarioFinDeSemana: linea(LARGOS.horario),
  horarioEspecial: linea(LARGOS.horarioEspecial),
  foto: Foto,
});
export type EntradaCementerioSitio = z.input<typeof EntradaCementerioSitio>;
export type DatosCementerioSitio = z.output<typeof EntradaCementerioSitio>;

export const EntradaRecorrido = z.object({
  id: Id.nullish(),
  nombre: lineaObligatoria(LARGOS.nombreRecorrido, "Escribí el nombre del recorrido"),
  descripcion: parrafos(LARGOS.descripcionRecorrido),
  cementerioId: Id.nullish().transform((v) => v ?? null),
  diasHora: linea(LARGOS.diasHora),
  duracion: linea(LARGOS.duracion),
  puntoEncuentro: linea(LARGOS.puntoEncuentro),
  cupo: linea(LARGOS.cupo),
  inscripcion: parrafos(LARGOS.inscripcion),
  inscripcionUrl: UrlHttps,
  foto: Foto,
  activo: z.boolean(),
  orden: Orden,
});
export type EntradaRecorrido = z.input<typeof EntradaRecorrido>;

export const EntradaFechaRecorrido = z.object({
  recorridoId: Id,
  /** `datetime-local` ("2026-11-14T10:00"), hora de Tucumán. */
  fecha: z.string("Elegí la fecha y la hora").max(40),
  nota: linea(LARGOS.notaFecha),
});
export type EntradaFechaRecorrido = z.input<typeof EntradaFechaRecorrido>;

export const EntradaNovedad = z
  .object({
    id: Id.nullish(),
    titulo: lineaObligatoria(LARGOS.tituloNovedad, "Escribí el título"),
    texto: parrafosObligatorios(LARGOS.textoNovedad, "Escribí el texto"),
    desde: Fecha,
    hasta: Fecha,
    activa: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (esFechaValida(d.desde) && esFechaValida(d.hasta) && d.hasta < d.desde) {
      ctx.addIssue({ code: "custom", path: ["hasta"], message: "Tiene que ser el mismo día que «Desde» o después" });
    }
  });
export type EntradaNovedad = z.input<typeof EntradaNovedad>;

export const EntradaContacto = z.object({
  domicilio: linea(LARGOS.domicilio),
  horario: linea(LARGOS.horarioContacto),
  telefono: linea(LARGOS.telefono),
  correo: z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim() || null)
    .refine((v) => v === null || esCorreo(v), "Escribí un correo válido (nombre@dominio)"),
  mapaUrl: UrlMapa,
});
export type EntradaContacto = z.input<typeof EntradaContacto>;
export type DatosContacto = z.output<typeof EntradaContacto>;

export const EntradaPregunta = z.object({
  id: Id.nullish(),
  pregunta: lineaObligatoria(LARGOS.pregunta, "Escribí la pregunta"),
  respuesta: parrafosObligatorios(LARGOS.respuesta, "Escribí la respuesta"),
  orden: Orden,
  activa: z.boolean(),
});
export type EntradaPregunta = z.input<typeof EntradaPregunta>;

/** Lee una entrada con su esquema; si no pasa, el error de validación con cada campo. */
export function leerEntradaSitio<T extends z.ZodType>(esquema: T, valor: unknown): z.output<T> {
  const r = esquema.safeParse(valor);
  if (r.success) return r.data;
  throw errorValidacion(
    r.error.issues.map((i) => ({
      ruta: i.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replace(/\.\[/g, "["),
      mensaje: i.message,
    })),
  );
}

// ---------------------------------------------------------------------------
// Qué se muestra
// ---------------------------------------------------------------------------

/** Una novedad está vigente si está activa y hoy (día de Tucumán) cae entre `desde` y `hasta`, inclusive. */
export function novedadVigente(n: { activa: boolean; desde: FechaISO; hasta: FechaISO }, hoy: FechaISO): boolean {
  return n.activa && n.desde <= hoy && hoy <= n.hasta;
}

/** Las fechas que vienen (después de `ahora`), de la más cercana a la más lejana, hasta `maximo`. */
export function fechasProximas<F extends { fecha: Date }>(fechas: readonly F[], ahora: Date, maximo = MAXIMO_FECHAS_PROXIMAS): F[] {
  return fechas
    .filter((f) => f.fecha.getTime() > ahora.getTime())
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
    .slice(0, maximo);
}
