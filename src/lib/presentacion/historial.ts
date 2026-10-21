import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import { formatearFecha } from "@/lib/fechas";
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
    const dato = typeof d.dato === "string" ? (/^d{4}-d{2}-d{2}$/.test(d.dato) ? formatearFecha(d.dato) : d.dato) : null;
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
