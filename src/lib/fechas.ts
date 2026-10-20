import { fromZonedTime } from "date-fns-tz";

/**
 * Fechas del dominio (docs/propuesta-mvp.md, sección 6, "Fechas").
 *
 * Dos clases de valores, que no se mezclan:
 *
 * - **Fecha** (`FechaISO`): un día del calendario, sin hora, como texto
 *   `YYYY-MM-DD`. Es lo que guardan las columnas `date` (`fecha_inicio`,
 *   `fecha_defuncion`, `plazo_desde`…). Nunca se representa con un `Date` a
 *   medianoche UTC en el dominio: un `Date` es un instante y, según la zona de
 *   quien lo mire, cae en otro día.
 * - **Instante**: un `Date` de JS (columnas `timestamptz`). Para mostrarlo o
 *   para saber "qué día es" se usa siempre la zona de Tucumán, nunca la del
 *   proceso: el servidor corre con `TZ=America/Argentina/Tucuman`, pero los
 *   tests corren con `TZ=UTC` justamente para que una dependencia se note.
 *
 * Prisma entrega una columna `date` como `Date` a medianoche UTC y escribe el
 * día UTC del `Date` que recibe (tests/integracion/fechas.test.ts): por eso las
 * únicas puertas entre los dos mundos son `fechaDesdeDb()` y `fechaParaDb()`.
 */

export const ZONA_TUCUMAN = "America/Argentina/Tucuman";

/** Un día del calendario, `YYYY-MM-DD`. Es un string: el tipo documenta la intención. */
export type FechaISO = string;

/** La fecha más vieja que admite `fecha_inicio` (CHECK de la base). */
export const FECHA_MINIMA_INICIO: FechaISO = "1950-01-01";

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
// `datetime-local` manda minutos y, según el navegador y el `step`, segundos.
const RE_DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

const MS_DIA = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fechas (días del calendario)
// ---------------------------------------------------------------------------

/** ¿Es `YYYY-MM-DD` y existe ese día (no 2026-02-30)? */
export function esFechaValida(valor: unknown): valor is FechaISO {
  if (typeof valor !== "string") return false;
  const m = RE_FECHA.exec(valor);
  if (!m) return false;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  // Date.UTC trata los años 0 a 99 como 1900+: se fija el año a mano.
  d.setUTCFullYear(anio);
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function exigirFecha(fecha: FechaISO, quien: string): void {
  if (!esFechaValida(fecha)) throw new RangeError(`${quien}: se esperaba una fecha YYYY-MM-DD y llegó "${fecha}"`);
}

/** El día como medianoche UTC: solo para aritmética interna y para Prisma. */
function comoUtc(fecha: FechaISO): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}

/**
 * Lo que entrega Prisma de una columna `date` (medianoche UTC) como fecha del
 * dominio. Usa el día UTC a propósito: es el día que guardó la base.
 */
export function fechaDesdeDb(valor: Date): FechaISO;
export function fechaDesdeDb(valor: Date | null): FechaISO | null;
export function fechaDesdeDb(valor: Date | null): FechaISO | null {
  if (valor === null) return null;
  if (Number.isNaN(valor.getTime())) throw new RangeError("fechaDesdeDb: Date inválido");
  return valor.toISOString().slice(0, 10);
}

/** Una fecha del dominio para escribirla en una columna `date` con Prisma. */
export function fechaParaDb(fecha: FechaISO): Date;
export function fechaParaDb(fecha: FechaISO | null): Date | null;
export function fechaParaDb(fecha: FechaISO | null): Date | null {
  if (fecha === null) return null;
  exigirFecha(fecha, "fechaParaDb");
  return comoUtc(fecha);
}

/** `fecha` más `dias` días corridos (negativo para restar). */
export function sumarDias(fecha: FechaISO, dias: number): FechaISO {
  exigirFecha(fecha, "sumarDias");
  if (!Number.isInteger(dias)) throw new RangeError(`sumarDias: ${dias} no es un entero`);
  return new Date(comoUtc(fecha).getTime() + dias * MS_DIA).toISOString().slice(0, 10);
}

/** Días corridos de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: FechaISO, hasta: FechaISO): number {
  exigirFecha(desde, "diasEntre");
  exigirFecha(hasta, "diasEntre");
  return Math.round((comoUtc(hasta).getTime() - comoUtc(desde).getTime()) / MS_DIA);
}

/** El año de una fecha. */
export function anioDe(fecha: FechaISO): number {
  exigirFecha(fecha, "anioDe");
  return Number(fecha.slice(0, 4));
}

// ---------------------------------------------------------------------------
// Instantes y la zona de Tucumán
// ---------------------------------------------------------------------------

const partesTucuman = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_TUCUMAN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partes(instante: Date): Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> {
  if (Number.isNaN(instante.getTime())) throw new RangeError("Date inválido");
  const r = { year: "", month: "", day: "", hour: "", minute: "", second: "" };
  for (const p of partesTucuman.formatToParts(instante)) {
    if (p.type in r) r[p.type as keyof typeof r] = p.value;
  }
  return r;
}

/** Qué día es `instante` en Tucumán. */
export function diaEnTucuman(instante: Date): FechaISO {
  const p = partes(instante);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hoy en Tucumán (es contra lo que la base controla `fecha_inicio`). */
export function hoyEnTucuman(ahora: Date = new Date()): FechaISO {
  return diaEnTucuman(ahora);
}

/** El año en curso en Tucumán: el del número interno (2.13(f)). */
export function anioEnTucuman(ahora: Date = new Date()): number {
  return Number(diaEnTucuman(ahora).slice(0, 4));
}

/**
 * Las 00:00 de ese día en Tucumán, como instante. Es la `fecha_efectiva` de un
 * movimiento con `precision_fecha = 'dia'` (2.8).
 */
export function inicioDelDiaEnTucuman(fecha: FechaISO): Date {
  exigirFecha(fecha, "inicioDelDiaEnTucuman");
  return fromZonedTime(`${fecha}T00:00:00`, ZONA_TUCUMAN);
}

/**
 * El valor de un `<input type="datetime-local">` ("2026-10-15T14:30"), leído
 * como hora de Tucumán, sea cual sea la zona del navegador o del servidor.
 *
 * @throws RangeError si no tiene la forma de datetime-local o la fecha no existe.
 */
export function interpretarDatetimeLocal(valor: string): Date {
  const m = RE_DATETIME_LOCAL.exec(valor.trim());
  if (!m || !esFechaValida(`${m[1]}-${m[2]}-${m[3]}`) || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59) {
    throw new RangeError(`Fecha y hora inválida: "${valor}" (se esperaba AAAA-MM-DDTHH:MM)`);
  }
  return fromZonedTime(valor.trim(), ZONA_TUCUMAN);
}

/** Lo contrario: el valor para precargar un `datetime-local` (minutos, hora de Tucumán). */
export function comoDatetimeLocal(instante: Date): string {
  const p = partes(instante);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// ---------------------------------------------------------------------------
// Formato para mostrar (es-AR, hora de Tucumán)
// ---------------------------------------------------------------------------

const formatoFecha = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_TUCUMAN,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const formatoHora = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_TUCUMAN,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "15/03/2019". Acepta una fecha del dominio o un instante (su día en Tucumán). */
export function formatearFecha(valor: FechaISO | Date): string {
  const instante = typeof valor === "string" ? inicioDelDiaEnTucuman(valor) : valor;
  return formatoFecha.format(instante);
}

/** "15/03/2026 14:05", en hora de Tucumán. */
export function formatearFechaHora(instante: Date): string {
  return `${formatoFecha.format(instante)} ${formatoHora.format(instante)}`;
}

/**
 * Una fecha efectiva según su precisión (2.8): con precisión de día no se
 * muestra la hora, que es la medianoche convencional y no un dato.
 */
export function formatearSegunPrecision(instante: Date, precision: "dia" | "minuto"): string {
  return precision === "dia" ? formatearFecha(instante) : formatearFechaHora(instante);
}
