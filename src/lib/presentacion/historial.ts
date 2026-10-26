import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import { formatearFecha, formatearSegunPrecision } from "@/lib/fechas";
import { resumenCorreccion, textoUbicacion } from "./estados";
import { ETIQUETA_CAMPO_EDICION, ETIQUETA_DOCUMENTO, etiquetaEstado, nombreCompleto } from "./textos";

/**
 * Qué dice cada movimiento en la línea de tiempo de la ficha y en la hoja del
 * historial (2.13(c)). Puro.
 */

export interface PersonaReferida {
  etiquetaRol: string;
  apellido: string | null;
  nombres: string | null;
  /** Persona jurídica. */
  razonSocial?: string | null;
}

export interface ContextoResumen {
  /** Personas por id (vigentes e históricas). */
  personas: ReadonlyMap<string, PersonaReferida>;
  /** Etiqueta de cada campo extra por clave ("concesion_hasta" → "Concesión hasta"). */
  camposExtra: ReadonlyMap<string, string>;
  /** Semana 4: nombre de cada subtarea y documento por clave (si no están, se muestra la clave). */
  subtareas: ReadonlyMap<string, string>;
  documentos: ReadonlyMap<string, string>;
}

function objeto(datos: MovimientoFicha["datos"]): Record<string, unknown> {
  return datos !== null && typeof datos === "object" && !Array.isArray(datos) ? (datos as Record<string, unknown>) : {};
}

function quien(p: PersonaReferida | undefined, rol: string): string {
  return p ? `${p.etiquetaRol} ${nombreCompleto(p)}` : rol;
}

function camposDeEdicion(datos: MovimientoFicha["datos"], ctx: ContextoResumen): string[] {
  if (datos === null || typeof datos !== "object" || Array.isArray(datos)) return [];
  const cambios = datos.cambios;
  if (cambios === null || typeof cambios !== "object" || Array.isArray(cambios)) return [];
  return Object.keys(cambios).map((campo) => {
    if (campo.startsWith("datos_extra.")) {
      const clave = campo.slice("datos_extra.".length);
      return ctx.camposExtra.get(clave) ?? clave;
    }
    return ETIQUETA_CAMPO_EDICION[campo] ?? campo;
  });
}

/** Las líneas que describen el movimiento, además de su tipo, fecha y autor. */
export function resumenMovimiento(m: MovimientoFicha, ctx: ContextoResumen): string[] {
  const lineas: string[] = [];
  if (m.tipo === "pase" || m.tipo === "devolucion") {
    if (m.areaOrigen || m.areaDestino) lineas.push(`De ${m.areaOrigen?.nombre ?? "—"} a ${m.areaDestino?.nombre ?? "—"}`);
  } else if (m.tipo === "alta" && m.areaDestino) {
    lineas.push(`Ingresó en ${m.areaDestino.nombre}`);
  }
  if (m.pasoDestino && m.pasoOrigen?.clave !== m.pasoDestino.clave) {
    lineas.push(m.pasoOrigen ? `Paso: ${m.pasoOrigen.nombre} → ${m.pasoDestino.nombre}` : `Paso: ${m.pasoDestino.nombre}`);
  }
  if (m.estadoNuevo && m.estadoAnterior !== m.estadoNuevo) {
    lineas.push(m.estadoAnterior ? `Estado: ${etiquetaEstado(m.estadoAnterior)} → ${etiquetaEstado(m.estadoNuevo)}` : `Estado: ${etiquetaEstado(m.estadoNuevo)}`);
  }
  if (m.tipo === "edicion") {
    const campos = camposDeEdicion(m.datos, ctx).filter((c) => c !== "personas");
    if (campos.length > 0) lineas.push(`Cambió: ${campos.join(", ")}`);
  }
  const d = objeto(m.datos);
  if (m.tipo === "subtarea" && typeof d.subtarea === "string") {
    const nombre = ctx.subtareas.get(d.subtarea) ?? d.subtarea;
    const dato = typeof d.dato === "string" ? (/^\d{4}-\d{2}-\d{2}$/.test(d.dato) ? formatearFecha(d.dato) : d.dato) : null;
    lineas.push(d.hecha === false ? `${nombre}: destildada` : `${nombre}: tildada${dato ? ` (${dato})` : ""}`);
  }
  if (m.tipo === "documento" && typeof d.documento === "string") {
    const estado = typeof d.estado === "string" ? (ETIQUETA_DOCUMENTO[d.estado] ?? d.estado).toLowerCase() : "";
    lineas.push(`${ctx.documentos.get(d.documento) ?? d.documento}: ${estado}`);
  }
  if (m.tipo === "adjunto") {
    const doc = typeof d.documento === "string" ? (ctx.documentos.get(d.documento) ?? d.documento) : "suelto";
    lineas.push(typeof d.nombre === "string" ? `${d.nombre} (${doc})` : `Archivo (${doc})`);
  }
  if (m.tipo === "estado") {
    if (typeof d.ubicacion_archivo === "string") lineas.push(`Ubicación en el archivo: ${textoUbicacion(d.ubicacion_archivo)}`);
    if (d.regreso_papel) lineas.push(`El papel volvió a ${m.areaDestino?.nombre ?? "la custodia"}`);
    if (d.reinicio === true) lineas.push("Anulado para reiniciarlo con otra plantilla");
    if (d.abre_vinculado === true) lineas.push("Se archivó para abrir un expediente vinculado");
  }
  if (m.tipo === "correccion") lineas.push(resumenCorreccion(m.datos, (c) => ctx.subtareas.get(c) ?? c));
  for (const p of m.personasCreadas) {
    const persona = quien(ctx.personas.get(p.id), p.rol);
    lineas.push(m.tipo === "alta" ? `Persona: ${persona}` : p.reemplazaA ? `Datos nuevos de ${persona}` : `Persona agregada: ${persona}`);
  }
  if (m.tipo === "edicion" && m.datos !== null && typeof m.datos === "object" && !Array.isArray(m.datos)) {
    const personas = m.datos.personas;
    if (personas !== null && typeof personas === "object" && !Array.isArray(personas) && Array.isArray(personas.baja)) {
      for (const id of personas.baja) {
        const p = ctx.personas.get(String(id));
        lineas.push(`Persona quitada: ${quien(p, "persona")}`);
      }
    }
  }
  return lineas;
}

/** Para armar el contexto desde la ficha o la hoja del historial. */
export function contextoResumen(
  personas: ReadonlyArray<{ id: string } & PersonaReferida>,
  camposExtra: ReadonlyArray<{ clave: string; etiqueta: string }> = [],
  nombres: { subtareas?: ReadonlyArray<{ clave: string; nombre: string }>; documentos?: ReadonlyArray<{ clave: string; nombre: string }> } = {},
): ContextoResumen {
  return {
    personas: new Map(personas.map((p) => [p.id, p])),
    camposExtra: new Map(camposExtra.map((c) => [c.clave, c.etiqueta])),
    subtareas: new Map((nombres.subtareas ?? []).map((x) => [x.clave, x.nombre])),
    documentos: new Map((nombres.documentos ?? []).map((x) => [x.clave, x.nombre])),
  };
}

// ---------------------------------------------------------------------------
// 26/10/2026: filtros, agrupación e integridad del historial
// ---------------------------------------------------------------------------

/**
 * Los tipos de movimiento agrupados como los filtra la línea de tiempo de la
 * ficha. "Pases y devoluciones" suma el alta y las recepciones: todo lo que
 * dice dónde está el papel.
 */
export const CATEGORIAS_HISTORIAL = [
  { clave: "pases", etiqueta: "Pases y devoluciones", tipos: ["alta", "recepcion", "pase", "devolucion"] },
  { clave: "subtareas", etiqueta: "Subtareas", tipos: ["subtarea"] },
  { clave: "documentos", etiqueta: "Documentos", tipos: ["documento"] },
  { clave: "adjuntos", etiqueta: "Adjuntos", tipos: ["adjunto"] },
  { clave: "ediciones", etiqueta: "Ediciones", tipos: ["edicion"] },
  { clave: "estados", etiqueta: "Estados", tipos: ["estado"] },
  { clave: "notas", etiqueta: "Notas", tipos: ["nota"] },
  { clave: "correcciones", etiqueta: "Correcciones", tipos: ["correccion"] },
] as const;

export type CategoriaHistorial = (typeof CATEGORIAS_HISTORIAL)[number]["clave"];

export const TODAS_LAS_CATEGORIAS: readonly CategoriaHistorial[] = CATEGORIAS_HISTORIAL.map((c) => c.clave);

/** "Solo lo importante": pases, devoluciones (con el alta y las recepciones) y cambios de estado. */
export const CATEGORIAS_IMPORTANTES: readonly CategoriaHistorial[] = ["pases", "estados"];

/** Con más movimientos que esto, la ficha abre el historial en "Solo lo importante". */
export const HISTORIAL_LARGO = 15;

const CATEGORIA_POR_TIPO: ReadonlyMap<string, CategoriaHistorial> = new Map(
  CATEGORIAS_HISTORIAL.flatMap((c) => c.tipos.map((t) => [t, c.clave] as const)),
);

/** La categoría de un tipo de movimiento (un tipo desconocido cuenta como nota: no se pierde). */
export function categoriaDe(tipo: string): CategoriaHistorial {
  return CATEGORIA_POR_TIPO.get(tipo) ?? "notas";
}

export type AgrupacionHistorial = "paso" | "dia";

export interface FiltroHistorial {
  categorias: ReadonlySet<CategoriaHistorial>;
  /** Clave del paso, o null para todos. */
  paso: string | null;
  agrupar: AgrupacionHistorial;
}

/** Cómo abre la ficha: todo, o solo lo importante si el historial es largo. */
export function filtroInicial(cantidad: number): FiltroHistorial {
  return { categorias: new Set(cantidad > HISTORIAL_LARGO ? CATEGORIAS_IMPORTANTES : TODAS_LAS_CATEGORIAS), paso: null, agrupar: "paso" };
}

function mismasCategorias(a: ReadonlySet<CategoriaHistorial>, b: readonly CategoriaHistorial[]): boolean {
  return a.size === b.length && b.every((c) => a.has(c));
}

/** Qué atajo está apretado: "todo", "importante" o ninguno (una elección a mano). */
export function atajoDe(filtro: FiltroHistorial): "todo" | "importante" | null {
  if (filtro.paso !== null) return null;
  if (mismasCategorias(filtro.categorias, TODAS_LAS_CATEGORIAS)) return "todo";
  if (mismasCategorias(filtro.categorias, CATEGORIAS_IMPORTANTES)) return "importante";
  return null;
}

/** Prende o apaga una categoría. */
export function alternarCategoria(filtro: FiltroHistorial, categoria: CategoriaHistorial): FiltroHistorial {
  const categorias = new Set(filtro.categorias);
  if (categorias.has(categoria)) categorias.delete(categoria);
  else categorias.add(categoria);
  return { ...filtro, categorias };
}

/** Lo que el filtro necesita saber de cada movimiento. */
export interface MovimientoFiltrable {
  categoria: CategoriaHistorial;
  /** El paso del tramo en que está (no el del movimiento: una nota no tiene paso). */
  paso: string | null;
}

export function pasaFiltro(m: MovimientoFiltrable, filtro: FiltroHistorial): boolean {
  return filtro.categorias.has(m.categoria) && (filtro.paso === null || m.paso === filtro.paso);
}

/** Lo que el encabezado de un tramo necesita (`TramoHistorial` lo cumple). */
export interface TramoMostrable {
  orden: number;
  paso: { nombre: string } | null;
  area: { nombre: string } | null;
  desde: Date;
  desdePrecision: "dia" | "minuto";
  hasta: Date | null;
  hastaPrecision: "dia" | "minuto";
  actual: boolean;
  diasHabiles: number | null;
}

/** "3. Asesoría Legal · Legal". */
export function tituloTramo(t: TramoMostrable): string {
  const paso = t.paso?.nombre ?? "Sin paso";
  return t.area && t.area.nombre !== paso ? `${t.orden}. ${paso} · ${t.area.nombre}` : `${t.orden}. ${paso}`;
}

function dias(n: number | null): string {
  if (n === null) return "";
  return n === 1 ? "1 día hábil" : `${n} días hábiles`;
}

/**
 * "Del 01/10/2026 al 15/10/2026 · 10 días hábiles", o, el tramo en curso,
 * "Desde el 20/10/2026 · 4 días hábiles hasta hoy".
 */
export function detalleTramo(t: TramoMostrable): string {
  const desde = formatearSegunPrecision(t.desde, t.desdePrecision);
  const n = dias(t.diasHabiles);
  if (t.hasta === null) return `Desde el ${desde}${n ? ` · ${n} hasta hoy` : ""}`;
  const hasta = formatearSegunPrecision(t.hasta, t.hastaPrecision);
  return `Del ${desde} al ${hasta}${n ? ` · ${n}` : ""}`;
}

/** Lo que muestra "Verificar integridad" y lo que dice la hoja impresa (`ResultadoIntegridad` lo cumple). */
export interface IntegridadMostrable {
  integra: boolean;
  movimientos: number;
  hashFinal: string | null;
  huella: string | null;
  secuenciaRota: number | null;
  motivo: string | null;
}

const TEXTO_ROTURA: Record<string, (n: number | null) => string> = {
  secuencia_faltante: (n) => `falta el movimiento ${n} (se borró de la base)`,
  hash_anterior_distinto: (n) => `el movimiento ${n} no encadena con el anterior`,
  hash_distinto: (n) => `el movimiento ${n} cambió después de registrarse`,
  sin_movimientos: () => "el expediente no tiene movimientos, ni siquiera el alta",
};

/**
 * "Historial íntegro: 23 movimientos." o "La cadena del historial está rota:
 * el movimiento 5 cambió después de registrarse." Los movimientos se cuentan
 * por su número de registro (la secuencia), no por su lugar en la línea de
 * tiempo, que va por fecha efectiva.
 */
export function textoIntegridad(r: IntegridadMostrable): string {
  if (r.integra) return `Historial íntegro: ${r.movimientos === 1 ? "1 movimiento" : `${r.movimientos} movimientos`}.`;
  const texto = TEXTO_ROTURA[r.motivo ?? ""] ?? ((n: number | null) => `hay un problema en el movimiento ${n}`);
  return `La cadena del historial está rota: ${texto(r.secuenciaRota)}.`;
}

/** El contador de la línea de tiempo filtrada: "Se ven 8 de 23 movimientos." */
export function textoConteo(visibles: number, total: number): string {
  if (total === 1) return visibles === 1 ? "Se ve el único movimiento." : "No se ve el único movimiento.";
  if (visibles === total) return `Se ven los ${total} movimientos.`;
  if (visibles === 0) return `No se ve ninguno de los ${total} movimientos.`;
  return `Se ve${visibles === 1 ? "" : "n"} ${visibles} de ${total} movimientos.`;
}
