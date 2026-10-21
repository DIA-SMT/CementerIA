import type { ErrorCampo } from "@/lib/dominio/expedientes/errores";
import type { FilaTranscripcion } from "@/lib/dominio/expedientes/transcripcion";

/**
 * La grilla de `/expedientes/[numero]/transcribir` (2.13(c)): pasar la ficha
 * de papel de un expediente "iniciado antes del sistema". Cada fila es un
 * pase (hacia adelante) o una devolución (hacia atrás, con motivo); lo decide
 * el paso destino respecto del paso en que dejó el expediente la fila
 * anterior. Puro: lo usan el Client Component de la grilla y los tests.
 *
 * El dominio controla todo de nuevo (fechas que no retroceden, motivo de la
 * devolución, el paso). Acá: el modelo de la fila, qué se manda, qué error va
 * en qué celda y cómo se mueve el foco con el teclado.
 */

export type PrecisionFila = "dia" | "minuto";

export interface FilaGrilla {
  /** El `comandoId` de la fila: se genera al agregarla y no cambia en los reintentos. */
  id: string;
  /** `YYYY-MM-DD` (precisión de día) o `YYYY-MM-DDTHH:MM` (con hora). */
  fecha: string;
  precision: PrecisionFila;
  pasoDestino: string;
  observacion: string;
  fuente: string;
  /** Solo para una devolución. */
  motivo: string;
}

/** Las columnas, en el orden de la pantalla (y del Tab). */
export const COLUMNAS_GRILLA = ["fecha", "precision", "pasoDestino", "observacion", "fuente", "motivo"] as const;
export type ColumnaGrilla = (typeof COLUMNAS_GRILLA)[number];

export const ETIQUETA_COLUMNA: Record<ColumnaGrilla, string> = {
  fecha: "Fecha",
  precision: "Precisión",
  pasoDestino: "Paso al que llegó",
  observacion: "Observación",
  fuente: "Fuente",
  motivo: "Motivo (devolución)",
};

/** La fuente que se propone en la primera fila. */
export const FUENTE_POR_DEFECTO = "Ficha papel";

/** Filas por lote como máximo (una ficha de papel tiene unas pocas decenas). */
export const MAXIMO_FILAS_LOTE = 100;

/**
 * Una fila nueva. Copia de la anterior lo que suele repetirse: la fuente, la
 * precisión y el día (se corrige sobre esa fecha, que no puede ser anterior).
 */
export function filaNueva(id: string, anterior?: FilaGrilla | null): FilaGrilla {
  return {
    id,
    fecha: anterior ? anterior.fecha : "",
    precision: anterior?.precision ?? "dia",
    pasoDestino: "",
    observacion: "",
    fuente: anterior?.fuente ?? FUENTE_POR_DEFECTO,
    motivo: "",
  };
}

/** Cambia la precisión de una fila llevando la fecha al formato del control (`date` ↔ `datetime-local`). */
export function cambiarPrecision(f: FilaGrilla, precision: PrecisionFila): FilaGrilla {
  if (precision === f.precision) return f;
  const dia = f.fecha.slice(0, 10);
  const fecha = f.fecha === "" ? "" : precision === "minuto" ? `${dia}T${f.fecha.length > 10 ? f.fecha.slice(11, 16) : "00:00"}` : dia;
  return { ...f, precision, fecha };
}

/** Sin nada propio cargado (la fuente y la precisión vienen copiadas): no se manda. */
export function filaVacia(f: FilaGrilla): boolean {
  return f.fecha.trim() === "" && f.pasoDestino === "" && f.observacion.trim() === "" && f.motivo.trim() === "";
}

export type TipoFila = "pase" | "devolucion" | "mismo_paso" | "sin_paso";

export interface FilaRecorrida {
  tipo: TipoFila;
  /** El paso en que queda el expediente después de la fila (el mismo si la fila no tiene paso válido). */
  ordenFinal: number;
}

/**
 * Qué es cada fila (pase, devolución o un error) recorriéndolas desde el paso
 * actual del expediente: la que va a un paso anterior al que dejó la fila
 * previa es una devolución y pide motivo.
 */
export function recorrerFilas(filas: readonly FilaGrilla[], ordenInicial: number, ordenDe: (clave: string) => number | null): FilaRecorrida[] {
  let actual = ordenInicial;
  return filas.map((f) => {
    const orden = f.pasoDestino === "" ? null : ordenDe(f.pasoDestino);
    if (orden === null) return { tipo: "sin_paso", ordenFinal: actual };
    if (orden === actual) return { tipo: "mismo_paso", ordenFinal: actual };
    const tipo: TipoFila = orden > actual ? "pase" : "devolucion";
    actual = orden;
    return { tipo, ordenFinal: orden };
  });
}

function textoONull(v: string): string | null {
  return v.trim() === "" ? null : v.trim();
}

export interface Lote {
  filas: FilaTranscripcion[];
  /** Para cada fila enviada, su índice en la grilla (las vacías no se mandan). */
  indices: number[];
}

/**
 * Lo que se manda a `transcribir()`: las filas no vacías, con la fecha según
 * la precisión y el motivo solo en las devoluciones.
 */
export function loteParaEnviar(filas: readonly FilaGrilla[], recorrido: readonly FilaRecorrida[]): Lote {
  const lote: Lote = { filas: [], indices: [] };
  filas.forEach((f, i) => {
    if (filaVacia(f)) return;
    const fecha = f.precision === "dia" ? f.fecha.trim().slice(0, 10) : f.fecha.trim();
    lote.filas.push({
      comandoId: f.id,
      fecha,
      precision: f.precision,
      pasoDestino: f.pasoDestino,
      observacion: textoONull(f.observacion),
      fuente: textoONull(f.fuente),
      motivo: recorrido[i]?.tipo === "devolucion" ? textoONull(f.motivo) : null,
    });
    lote.indices.push(i);
  });
  return lote;
}

/** Errores por fila (por `id`) y columna, y los que no son de una celda. */
export interface ErroresGrilla {
  celdas: Map<string, Partial<Record<ColumnaGrilla, string[]>>>;
  generales: string[];
}

const RE_RUTA_FILA = /^filas\[(\d+)\]\.(\w+)$/;

/**
 * Reparte los errores del dominio (`filas[i].campo`, con `i` el índice en el
 * lote enviado) en las celdas de la grilla. `comandoId` y lo que no es de una
 * columna van a los generales.
 */
export function erroresDeGrilla(errores: readonly ErrorCampo[], filas: readonly FilaGrilla[], indices: readonly number[]): ErroresGrilla {
  const r: ErroresGrilla = { celdas: new Map(), generales: [] };
  for (const e of errores) {
    const m = RE_RUTA_FILA.exec(e.ruta);
    const columna = m?.[2] as ColumnaGrilla | undefined;
    const fila = m ? filas[indices[Number(m[1])] ?? -1] : undefined;
    if (!fila || !columna || !(COLUMNAS_GRILLA as readonly string[]).includes(columna)) {
      r.generales.push(e.mensaje);
      continue;
    }
    const celdas = r.celdas.get(fila.id) ?? {};
    celdas[columna] = [...(celdas[columna] ?? []), e.mensaje];
    r.celdas.set(fila.id, celdas);
  }
  return r;
}

/** El `id` del control de una celda, para mover el foco y para `aria-describedby`. */
export function idCelda(fila: number, columna: ColumnaGrilla): string {
  return `grilla-${fila}-${columna}`;
}

export type TeclaGrilla = "abajo" | "arriba";

/**
 * A dónde va el foco con Enter (abajo) o Mayús+Enter (arriba): la misma
 * columna en la fila de al lado. Enter en la última fila agrega una (como en
 * una planilla). Tab y Mayús+Tab recorren las celdas de la fila como siempre.
 */
export function siguienteCelda(
  pos: { fila: number; columna: ColumnaGrilla },
  tecla: TeclaGrilla,
  cantidadFilas: number,
): { fila: number; columna: ColumnaGrilla; agregarFila: boolean } {
  if (tecla === "arriba") return { fila: Math.max(0, pos.fila - 1), columna: pos.columna, agregarFila: false };
  if (pos.fila + 1 < cantidadFilas) return { fila: pos.fila + 1, columna: pos.columna, agregarFila: false };
  return { fila: cantidadFilas, columna: pos.columna, agregarFila: cantidadFilas < MAXIMO_FILAS_LOTE };
}

/** "Se registraron 3 filas." / "Se registró 1 fila (1 ya estaba registrada)." */
export function resumenTranscripcion(filas: ReadonlyArray<{ repetida: boolean }>, paso: string): string {
  const nuevas = filas.filter((f) => !f.repetida).length;
  const repetidas = filas.length - nuevas;
  if (nuevas === 0) return `No había filas nuevas: ${repetidas === 1 ? "ya estaba registrada" : `las ${repetidas} ya estaban registradas`}. El expediente está en ${paso}.`;
  const partes = nuevas === 1 ? "Se registró 1 fila" : `Se registraron ${nuevas} filas`;
  const extra = repetidas > 0 ? ` (${repetidas === 1 ? "1 ya estaba registrada" : `${repetidas} ya estaban registradas`})` : "";
  return `${partes}${extra}. El expediente quedó en ${paso}.`;
}
