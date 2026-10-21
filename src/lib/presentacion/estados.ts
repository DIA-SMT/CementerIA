import type { TipoCorreccion } from "@/lib/dominio/expedientes/correcciones";
import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import type { SemaforoPlazo } from "@/lib/dominio/expedientes/flujo";
import { comoDatetimeLocal, formatearSegunPrecision, hoyEnTucuman } from "@/lib/fechas";
import { etiquetaMovimiento } from "./textos";

/**
 * Lógica de las pantallas de la semana 4 en la ficha: el semáforo del plazo
 * DIM (3.6), los botones de cambio de estado (3.1) y el menú "Corregir" de
 * cada movimiento del historial (2.13(b)). Pura: la usan los Server y los
 * Client Components y los tests.
 *
 * No decide reglas: qué se puede hacer lo dicen `ficha.acciones` y
 * `historial[i].correcciones`, con las mismas reglas que exige el dominio.
 * Acá solo se ordena, se rotula y se elige el color.
 */

// ---------------------------------------------------------------------------
// Plazo DIM (3.6)
// ---------------------------------------------------------------------------

export const ETIQUETA_SEMAFORO: Record<SemaforoPlazo, string> = {
  sin_iniciar: "Sin iniciar",
  en_termino: "En término",
  por_vencer: "Por vencer",
  vencido: "Vencido",
  cumplido: "Cumplido",
};

/**
 * Clases de Tailwind de cada color, con los tokens semánticos de globals.css:
 * advertencia (ámbar) por vencer, error (rojo) vencido. Siempre con el texto:
 * el color no es la única señal. Contrastes en docs/diseno.md.
 */
export const CLASE_SEMAFORO: Record<SemaforoPlazo, string> = {
  sin_iniciar: "bg-fondo text-texto ring-borde",
  en_termino: "bg-exito-fondo text-exito ring-exito-borde",
  por_vencer: "bg-advertencia-fondo text-advertencia ring-advertencia-borde",
  vencido: "bg-error-fondo text-error ring-error-borde",
  cumplido: "bg-fondo text-texto-secundario ring-borde",
};

export interface PlazoMostrado {
  semaforo: SemaforoPlazo;
  /** "Por vencer", "Vencido"… */
  etiqueta: string;
  clase: string;
  /** "Vence 30/11 · faltan 3 días hábiles (provisorio)", con mayúscula. */
  texto: string;
  /** Ámbar o rojo: la fila o la ficha lo resaltan. */
  alerta: boolean;
  /** "Provisorio: falta cerrar los feriados de 2027." o null. */
  aviso: string | null;
}

function conMayuscula(t: string): string {
  return t === "" ? t : t.charAt(0).toUpperCase() + t.slice(1);
}

/** Cómo se muestra un plazo (`ficha.plazo`, la etiqueta `plazo` de la bandeja, las filas del panel). */
export function mostrarPlazo(p: { semaforo: SemaforoPlazo; texto: string; provisorio: boolean; aniosSinCerrar: readonly number[] }): PlazoMostrado {
  const anios = [...p.aniosSinCerrar].sort((a, b) => a - b);
  const aviso = p.provisorio
    ? anios.length === 0
      ? "Provisorio: puede faltar cargar algún feriado."
      : `Provisorio: ${anios.length === 1 ? "falta cerrar los feriados de" : "faltan cerrar los feriados de"} ${anios.join(" y ")}.`
    : null;
  return {
    semaforo: p.semaforo,
    etiqueta: ETIQUETA_SEMAFORO[p.semaforo],
    clase: CLASE_SEMAFORO[p.semaforo],
    texto: conMayuscula(p.texto),
    alerta: p.semaforo === "por_vencer" || p.semaforo === "vencido",
    aviso,
  };
}

// ---------------------------------------------------------------------------
// Estados (3.1)
// ---------------------------------------------------------------------------

/** "Caja o estante desconocido": lo admite la transcripción (y cambiar la ubicación si ya lo era). Igual que `UBICACION_ARCHIVO_DESCONOCIDA` del dominio. */
export const UBICACION_DESCONOCIDA = "DESCONOCIDA";

/** Largo máximo de la ubicación de archivo (el dominio controla 120). */
export const LARGO_MAXIMO_UBICACION = 120;

/** El texto del botón: "Concluir" o "Concluir · Faltan 2". */
export function textoBotonConcluir(faltan: number): string {
  return faltan > 0 ? `Concluir · Faltan ${faltan}` : "Concluir";
}

/** Los diálogos de la barra "Estado del expediente". */
export type AccionEstado =
  | "concluir"
  | "archivar"
  | "archivarSinConcluir"
  | "vinculado"
  | "desarchivar"
  | "anular"
  | "reabrir"
  | "ubicacionArchivo"
  | "reiniciar"
  | "nota";

/** Lo que permite la ficha (`ficha.acciones[x].permitido`) para cada botón. */
export interface PermisosEstado {
  concluir: boolean;
  archivar: boolean;
  archivarSinConcluir: boolean;
  desarchivar: boolean;
  anular: boolean;
  reabrir: boolean;
  reiniciar: boolean;
  cambiarUbicacionArchivo: boolean;
  nota: boolean;
}

export interface BotonEstado {
  accion: AccionEstado;
  etiqueta: string;
  /** El botón principal (concluir sin faltantes, archivar un concluido). */
  principal: boolean;
}

/**
 * Los botones de estado que van en la ficha, en orden: lo que hace avanzar
 * primero (concluir, archivar), después lo que lo saca del circuito (archivar
 * sin concluir, archivar y abrir vinculado, anular, reiniciar) y al final la
 * nota. "Archivar y abrir vinculado" (la caducidad) pide lo mismo que
 * archivar sin concluir más el alta: los dos son de Mesa de Entradas y el
 * admin. Reiniciar y vincular necesitan alguna plantilla publicada.
 */
export function botonesEstado(p: PermisosEstado, o: { faltanConcluir: number; hayPlantillas: boolean }): BotonEstado[] {
  const b: BotonEstado[] = [];
  if (p.concluir) b.push({ accion: "concluir", etiqueta: textoBotonConcluir(o.faltanConcluir), principal: o.faltanConcluir === 0 });
  if (p.archivar) b.push({ accion: "archivar", etiqueta: "Archivar", principal: true });
  if (p.desarchivar) b.push({ accion: "desarchivar", etiqueta: "Desarchivar", principal: false });
  if (p.cambiarUbicacionArchivo) b.push({ accion: "ubicacionArchivo", etiqueta: "Cambiar ubicación de archivo", principal: false });
  if (p.reabrir) b.push({ accion: "reabrir", etiqueta: "Reabrir", principal: false });
  if (p.archivarSinConcluir) b.push({ accion: "archivarSinConcluir", etiqueta: "Archivar sin concluir", principal: false });
  if (p.archivarSinConcluir && o.hayPlantillas) b.push({ accion: "vinculado", etiqueta: "Archivar y abrir vinculado", principal: false });
  if (p.reiniciar && o.hayPlantillas) b.push({ accion: "reiniciar", etiqueta: "Reiniciar con otra plantilla", principal: false });
  if (p.anular) b.push({ accion: "anular", etiqueta: "Anular", principal: false });
  if (p.nota) b.push({ accion: "nota", etiqueta: "Agregar nota", principal: false });
  return b;
}

/** Lo que se manda como ubicación de archivo: "No se sabe" es `DESCONOCIDA`. */
export function valorUbicacion(texto: string, desconocida: boolean): string {
  return desconocida ? UBICACION_DESCONOCIDA : texto.trim();
}

/** Para mostrar la ubicación guardada. */
export function textoUbicacion(ubicacion: string | null): string {
  if (ubicacion === null || ubicacion.trim() === "") return "—";
  return ubicacion === UBICACION_DESCONOCIDA ? "Desconocida (carga histórica)" : ubicacion;
}

/** `/expedientes/nuevo?desde=<numero>&plantilla=<id>`: el alta precargada después de reiniciar (2.13(a)). */
export function rutaReinicio(numero: string, plantillaId?: number | null): string {
  const q = new URLSearchParams({ desde: numero });
  if (plantillaId) q.set("plantilla", String(plantillaId));
  return `/expedientes/nuevo?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Correcciones (2.13(b))
// ---------------------------------------------------------------------------

/** Una entrada del menú "Corregir": las correcciones del dominio, con la de subtarea partida en dato y tilde. */
export type OpcionMenuCorreccion =
  | "revertir"
  | "fecha"
  | "observacion"
  | "subtarea_dato"
  | "subtarea_destildar"
  | "retirar_adjunto"
  | "purgar_adjunto";

export interface ItemMenuCorreccion {
  opcion: OpcionMenuCorreccion;
  etiqueta: string;
  /** Borra o deshace: el diálogo pide confirmación explícita. */
  delicada: boolean;
  /** Solo el admin (Ley 25.326). */
  soloAdmin: boolean;
}

const QUE_SE_REVIERTE: Record<string, string> = {
  pase: "el pase",
  devolucion: "la devolución",
  estado: "el cambio de estado",
  subtarea: "el tilde",
};

/**
 * El menú "Corregir" de un movimiento: lo que el dominio dice que el usuario
 * puede corregir (`movimiento.correcciones`), en un orden fijo y con su
 * rótulo. La corrección de subtarea se parte en "Corregir el dato" (si la
 * subtarea lleva dato) y "Destildar".
 */
export function menuCorreccion(
  m: { tipo: string; correcciones: readonly TipoCorreccion[]; observacion: string | null },
  subtarea: { dato: "fecha" | "texto" | null; hecha: boolean } | null,
): ItemMenuCorreccion[] {
  const tiene = (t: TipoCorreccion) => m.correcciones.includes(t);
  const items: ItemMenuCorreccion[] = [];
  if (tiene("revertir")) items.push({ opcion: "revertir", etiqueta: `Revertir ${QUE_SE_REVIERTE[m.tipo] ?? "el movimiento"}`, delicada: true, soloAdmin: false });
  if (tiene("fecha")) items.push({ opcion: "fecha", etiqueta: "Corregir la fecha", delicada: false, soloAdmin: false });
  if (tiene("observacion")) {
    items.push({ opcion: "observacion", etiqueta: m.observacion ? "Corregir la observación" : "Agregar una observación", delicada: false, soloAdmin: false });
  }
  if (tiene("subtarea") && subtarea?.hecha) {
    if (subtarea.dato !== null) items.push({ opcion: "subtarea_dato", etiqueta: "Corregir el dato de la subtarea", delicada: false, soloAdmin: false });
    items.push({ opcion: "subtarea_destildar", etiqueta: "Destildar la subtarea", delicada: false, soloAdmin: false });
  }
  if (tiene("retirar_adjunto")) items.push({ opcion: "retirar_adjunto", etiqueta: "Retirar el adjunto", delicada: false, soloAdmin: false });
  if (tiene("purgar_adjunto")) items.push({ opcion: "purgar_adjunto", etiqueta: "Purgar el adjunto (borra el archivo)", delicada: true, soloAdmin: true });
  return items;
}

/** El tipo de corrección del dominio detrás de una opción del menú. */
export function tipoDeOpcion(o: OpcionMenuCorreccion): TipoCorreccion {
  return o === "subtarea_dato" || o === "subtarea_destildar" ? "subtarea" : o;
}

/** Lo que dice el historial de un movimiento `correccion`, según su `datos`. */
export function resumenCorreccion(datos: unknown, nombreSubtarea: (clave: string) => string = (c) => c): string {
  if (datos === null || typeof datos !== "object" || Array.isArray(datos)) return "Corrección";
  const d = datos as Record<string, unknown>;
  if (d.revertir === true) {
    const n = Array.isArray(d.arrastra) ? d.arrastra.length : 0;
    return n > 0 ? `Revierte el movimiento y ${n === 1 ? "1 movimiento posterior" : `${n} movimientos posteriores`} (recepciones y notas)` : "Revierte el movimiento";
  }
  if (d.fecha_efectiva !== undefined) return "Corrige la fecha";
  if (d.observacion !== undefined) return "Corrige la observación";
  if (typeof d.subtarea === "string") {
    const nombre = nombreSubtarea(d.subtarea);
    if (d.hecha === false) return `Destilda "${nombre}"`;
    const par = Array.isArray(d.dato) ? d.dato : [];
    return `Corrige el dato de "${nombre}"${par.length === 2 ? `: ${par[0] ?? "(vacío)"} → ${par[1] ?? "(vacío)"}` : ""}`;
  }
  if (d.retirar_adjunto !== undefined) return d.purgar === true ? "Purga el adjunto: el archivo se borró (Ley 25.326)" : "Retira el adjunto (el archivo se conserva)";
  if (d.suprimir_persona !== undefined) return "Suprime los datos de una persona (Ley 25.326)";
  return "Corrección";
}

/** Un movimiento del historial con lo que necesita su menú "Corregir" (sin datos personales). */
export interface MovimientoCorregible {
  id: string;
  tipo: string;
  /** "Pase del 15/03/2026 14:05", para el título del diálogo y el nombre accesible del botón. */
  descripcion: string;
  correcciones: TipoCorreccion[];
  /** La fecha que vale hoy (la corregida si la hay), para precargar el control. */
  fecha: { dia: string; momento: string; precision: "dia" | "minuto" };
  /** La observación que vale hoy. */
  observacion: string | null;
  /** Si es un tilde: la subtarea, su dato y si sigue tildada. */
  subtarea: { clave: string; nombre: string; dato: "fecha" | "texto" | null; valor: string | null; hecha: boolean } | null;
  /** Si es un adjunto: su nombre (null si está enmascarado). */
  adjunto: string | null;
}

export interface SubtareaConocida {
  nombre: string;
  dato: "fecha" | "texto" | null;
  valor: string | null;
  hecha: boolean;
}

/** Lo que el menú "Corregir" necesita de un movimiento de la ficha. */
export function movimientoCorregible(
  m: Pick<MovimientoFicha, "id" | "tipo" | "fechaEfectiva" | "precisionFecha" | "fechaCorregida" | "observacion" | "observacionCorregida" | "datos" | "correcciones">,
  subtareas: ReadonlyMap<string, SubtareaConocida>,
): MovimientoCorregible {
  const vigente = m.fechaCorregida ?? { fechaEfectiva: m.fechaEfectiva, precisionFecha: m.precisionFecha };
  const d = m.datos !== null && typeof m.datos === "object" && !Array.isArray(m.datos) ? (m.datos as Record<string, unknown>) : {};
  const clave = m.tipo === "subtarea" && typeof d.subtarea === "string" ? d.subtarea : null;
  const s = clave ? subtareas.get(clave) : undefined;
  return {
    id: m.id,
    tipo: m.tipo,
    descripcion: `${etiquetaMovimiento(m.tipo)} del ${formatearSegunPrecision(vigente.fechaEfectiva, vigente.precisionFecha)}`,
    correcciones: [...m.correcciones],
    fecha: { dia: hoyEnTucuman(vigente.fechaEfectiva), momento: comoDatetimeLocal(vigente.fechaEfectiva), precision: vigente.precisionFecha },
    observacion: m.observacionCorregida ? m.observacionCorregida.valor : m.observacion,
    subtarea: clave ? { clave, nombre: s?.nombre ?? clave, dato: s?.dato ?? null, valor: s?.valor ?? null, hecha: s?.hecha ?? false } : null,
    adjunto: m.tipo === "adjunto" && typeof d.nombre === "string" ? d.nombre : null,
  };
}
