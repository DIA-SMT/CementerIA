import { esFechaValida, sumarDias, diasEntre, type FechaISO } from "@/lib/fechas";
import { ErrorDominio, type ErrorCampo } from "../expedientes/errores";

/**
 * El período de las métricas y sus cortes (meses o semanas). Puro.
 *
 * Las fechas son días del calendario de Tucumán (`YYYY-MM-DD`), inclusive en
 * los dos extremos, como los filtros "desde" y "hasta" del buscador.
 */

export const AGRUPACIONES = ["mes", "semana"] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];

export const HISTORICOS = ["excluir", "incluir"] as const;
/**
 * Qué se hace con los expedientes de carga histórica (los transcriptos de la
 * ficha de papel): `excluir` (por defecto) mide "con el sistema" solo con los
 * que se dieron de alta en el sistema; `incluir` los suma.
 */
export type ModoHistoricos = (typeof HISTORICOS)[number];

/** Por defecto: los últimos 6 meses (el mes en curso y los 5 anteriores, enteros). */
export const MESES_POR_DEFECTO = 6;
/** El período más largo que se acepta: 3 años (el cálculo recorre cada estadía). */
export const DIAS_MAXIMOS_PERIODO = 3 * 366;
/** Con cortes por semana, hasta 26 (medio año): más columnas no se leen. */
export const SEMANAS_MAXIMAS = 26;

export interface FiltrosMetricas {
  desde: FechaISO;
  hasta: FechaISO;
  tipoTramiteId?: number;
  /** Código de plantilla: todas sus versiones, como el buscador. */
  plantillaCodigo?: string;
  cementerioId?: number;
  historicos: ModoHistoricos;
  agrupar: Agrupacion;
}

export interface Periodo {
  /** "2026-10" (mes) o "2026-10-05" (lunes de la semana). */
  clave: string;
  agrupacion: Agrupacion;
  /** Recortado al período pedido: el primer mes puede empezar a mitad. */
  desde: FechaISO;
  hasta: FechaISO;
}

/** El primer día del mes `meses` meses antes del de `fecha` ("2026-10-26", 5 → "2026-05-01"). */
export function inicioDeMesAnterior(fecha: FechaISO, meses: number): FechaISO {
  const [a, m] = fecha.split("-").map(Number);
  const total = a * 12 + (m - 1) - meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** Los filtros por defecto: los últimos 6 meses hasta hoy, por mes, sin la carga histórica. */
export function filtrosPorDefecto(hoy: FechaISO): FiltrosMetricas {
  return { desde: inicioDeMesAnterior(hoy, MESES_POR_DEFECTO - 1), hasta: hoy, historicos: "excluir", agrupar: "mes" };
}

/** El lunes de la semana de `fecha`. */
export function lunesDe(fecha: FechaISO): FechaISO {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado
  return sumarDias(fecha, -((dia + 6) % 7));
}

function finDeMes(fecha: FechaISO): FechaISO {
  const [a, m] = fecha.split("-").map(Number);
  const siguiente = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  return sumarDias(siguiente, -1);
}

/**
 * Los cortes del período, en orden. Cada uno recortado a [desde, hasta].
 */
export function periodosEntre(desde: FechaISO, hasta: FechaISO, agrupacion: Agrupacion): Periodo[] {
  const r: Periodo[] = [];
  let inicio = agrupacion === "mes" ? `${desde.slice(0, 7)}-01` : lunesDe(desde);
  while (inicio <= hasta) {
    const fin = agrupacion === "mes" ? finDeMes(inicio) : sumarDias(inicio, 6);
    r.push({
      clave: agrupacion === "mes" ? inicio.slice(0, 7) : inicio,
      agrupacion,
      desde: inicio < desde ? desde : inicio,
      hasta: fin > hasta ? hasta : fin,
    });
    inicio = sumarDias(fin, 1);
  }
  return r;
}

/**
 * Controla los filtros. Los errores van por campo (`desde`, `hasta`), como en
 * los formularios.
 *
 * @throws ErrorDominio `validacion`
 */
export function validarFiltros(f: FiltrosMetricas, hoy: FechaISO): FiltrosMetricas {
  const errores: ErrorCampo[] = [];
  if (!esFechaValida(f.desde)) errores.push({ ruta: "desde", mensaje: "La fecha desde no es válida" });
  if (!esFechaValida(f.hasta)) errores.push({ ruta: "hasta", mensaje: "La fecha hasta no es válida" });
  if (errores.length === 0) {
    if (f.desde > f.hasta) errores.push({ ruta: "desde", mensaje: "La fecha desde tiene que ser anterior o igual a la fecha hasta" });
    else if (f.hasta > hoy) errores.push({ ruta: "hasta", mensaje: "La fecha hasta no puede ser posterior a hoy" });
    else if (diasEntre(f.desde, f.hasta) > DIAS_MAXIMOS_PERIODO) errores.push({ ruta: "desde", mensaje: "El período puede ser de hasta 3 años" });
    else if (f.agrupar === "semana" && periodosEntre(f.desde, f.hasta, "semana").length > SEMANAS_MAXIMAS) {
      errores.push({ ruta: "agrupar", mensaje: `Por semana, el período puede tener hasta ${SEMANAS_MAXIMAS} semanas: elegí por mes o acortá el período` });
    }
  }
  if (!(AGRUPACIONES as readonly string[]).includes(f.agrupar)) errores.push({ ruta: "agrupar", mensaje: "Agrupación inválida" });
  if (!(HISTORICOS as readonly string[]).includes(f.historicos)) errores.push({ ruta: "historicos", mensaje: "Opción inválida" });
  if (errores.length > 0) throw new ErrorDominio("validacion", errores[0].mensaje, errores);
  return f;
}
