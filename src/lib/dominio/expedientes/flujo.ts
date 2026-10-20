import {
  diaEnTucuman,
  diasEntre,
  esFechaValida,
  formatearFecha,
  formatearSegunPrecision,
  hoyEnTucuman,
  inicioDelDiaEnTucuman,
  interpretarDatetimeLocal,
  type FechaISO,
} from "@/lib/fechas";
import type { DefinicionPlantilla, PasoPlantilla } from "../plantillas/esquema";
import { ErrorDominio, type ErrorCampo } from "./errores";
import { DIAS_RETROACTIVOS_MAX } from "./esquemas";
import type { ItemsExpediente } from "./items";

/**
 * Reglas del flujo que no tocan la base (docs/propuesta-mvp.md, 3.3 a 3.6):
 * qué falta para salir de un paso ("Faltan N"), a qué pasos se puede dar el
 * pase, qué subtareas se pueden reiniciar al devolver, cómo se lee y se
 * controla una fecha efectiva y qué plazo corresponde al entrar a un paso.
 *
 * Son funciones puras: las usan las acciones (pase.ts, devolucion.ts…) dentro
 * de su transacción y la ficha para mostrar lo mismo que después se exige.
 * Una sola regla para las dos cosas: si la ficha dice "no falta nada", el pase
 * no puede fallar por lo que falta.
 */

/** Un paso de la plantilla, como referencia (orden desde 1). */
export interface RefPaso {
  clave: string;
  nombre: string;
  orden: number;
}

/** Algo que impide salir del paso (3.3, puntos 4 a 6). */
export type Faltante =
  | {
      tipo: "subtarea";
      clave: string;
      nombre: string;
      paso: RefPaso;
      /** `sin_tildar`; `sin_dato` si está tildada sin el dato que pide; `reiniciada` si la destildó una devolución. */
      motivo: "sin_tildar" | "sin_dato" | "reiniciada";
      mensaje: string;
    }
  | {
      tipo: "documento";
      clave: string;
      nombre: string;
      exigirAlSalirDe: RefPaso;
      /** `pendiente`; `sin_observacion` (no corresponde sin observación); `sin_adjunto` (adjunto obligatorio). */
      motivo: "pendiente" | "sin_observacion" | "sin_adjunto";
      mensaje: string;
    }
  | {
      tipo: "campo_extra";
      clave: string;
      etiqueta: string;
      exigirAlSalirDe: RefPaso;
      mensaje: string;
    };

/** La ruta de un faltante para `ErrorCampo`: `subtareas.LIQ_PAGO`, `documentos.DNI`, `datosExtra.concesion_hasta`. */
export function rutaDeFaltante(f: Faltante): string {
  if (f.tipo === "subtarea") return `subtareas.${f.clave}`;
  if (f.tipo === "documento") return `documentos.${f.clave}`;
  return `datosExtra.${f.clave}`;
}

export function refPaso(def: DefinicionPlantilla, orden: number): RefPaso {
  const p = def.pasos[orden - 1];
  if (!p) throw new ErrorDominio("configuracion_incompleta", `La plantilla no tiene el paso ${orden}`);
  return { clave: p.clave, nombre: p.nombre, orden };
}

/** El orden (desde 1) de un paso por su clave, o null si no existe. */
export function ordenDePaso(def: DefinicionPlantilla, clave: string): number | null {
  const i = def.pasos.findIndex((p) => p.clave === clave);
  return i < 0 ? null : i + 1;
}

/** ¿La subtarea cuenta como hecha? Las `historica` (carga histórica cerrada) también. */
function cumplida(items: ItemsExpediente, clave: string): boolean {
  const item = items.subtareas[clave];
  return item !== undefined && (item.hecha || item.historica);
}

/** Ids de los adjuntos vigentes de un documento. */
export function adjuntosVigentes(items: ItemsExpediente, documento: string): string[] {
  return (items.documentos[documento]?.adjuntos ?? []).map(String).filter((id) => items.adjuntos[id]?.vigente !== false);
}

function vacio(valor: unknown): boolean {
  return valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "");
}

export interface AlcanceFaltantes {
  /** Órdenes de los pasos cuyas subtareas se exigen (el actual y, en un reenvío directo, los intermedios). */
  pasosConSubtareas: readonly number[];
  /** Se exigen los documentos y campos extra con `exigir_al_salir_de` en este paso o en uno anterior (regla acumulativa). */
  hastaOrden: number;
  /**
   * Exigir también las subtareas NO obligatorias que reinició una devolución:
   * el reenvío directo pide que lo reiniciado se haya rehecho (3.4).
   */
  exigirReiniciadas?: boolean;
}

/**
 * Lo que falta para salir de un paso (3.3, puntos 4 a 6). Vacío = se puede.
 *
 * - Subtareas `obligatoria` de los pasos indicados sin tildar, o tildadas sin
 *   el dato que pide `dato_obligatorio`.
 * - Documentos `obligatorio` con `exigir_al_salir_de` en el paso o en uno
 *   anterior que no están `presentado`, `no_corresponde` (con observación) o
 *   `historico`; si `adjunto: obligatorio`, presentado con un adjunto vigente.
 * - Campos extra `obligatorio` exigibles hasta ese paso, sin valor.
 *
 * Los documentos y campos con `exigir_al_salir_de: null` se exigen al concluir
 * (semana 4), no acá.
 */
export function faltantesParaSalir(
  def: DefinicionPlantilla,
  items: ItemsExpediente,
  datosExtra: Readonly<Record<string, unknown>>,
  alcance: AlcanceFaltantes,
): Faltante[] {
  const faltan: Faltante[] = [];

  for (const orden of alcance.pasosConSubtareas) {
    const paso = refPaso(def, orden);
    for (const s of def.pasos[orden - 1].subtareas) {
      const item = items.subtareas[s.clave];
      const reiniciada = item !== undefined && !item.hecha && item.reiniciada_por_mov !== null;
      if (!cumplida(items, s.clave)) {
        if (s.obligatoria || (alcance.exigirReiniciadas && reiniciada)) {
          faltan.push({
            tipo: "subtarea",
            clave: s.clave,
            nombre: s.nombre,
            paso,
            motivo: reiniciada ? "reiniciada" : "sin_tildar",
            mensaje: reiniciada ? `${s.nombre}: hay que rehacerla (la reinició una devolución)` : `${s.nombre}: falta tildarla`,
          });
        }
        continue;
      }
      if (item?.hecha && s.dato !== null && s.dato_obligatorio && vacio(item.dato)) {
        faltan.push({
          tipo: "subtarea",
          clave: s.clave,
          nombre: s.nombre,
          paso,
          motivo: "sin_dato",
          mensaje: `${s.nombre}: falta ${s.dato === "fecha" ? "la fecha" : "el dato"}`,
        });
      }
    }
  }

  for (const d of def.documentos) {
    if (!d.obligatorio || d.exigir_al_salir_de === null) continue;
    const orden = ordenDePaso(def, d.exigir_al_salir_de);
    if (orden === null || orden > alcance.hastaOrden) continue;
    const item = items.documentos[d.clave];
    const estado = item?.estado ?? "pendiente";
    const exigirAlSalirDe = refPaso(def, orden);
    if (estado === "pendiente") {
      faltan.push({ tipo: "documento", clave: d.clave, nombre: d.nombre, exigirAlSalirDe, motivo: "pendiente", mensaje: `${d.nombre}: pendiente` });
    } else if (estado === "no_corresponde" && vacio(item?.obs)) {
      faltan.push({
        tipo: "documento",
        clave: d.clave,
        nombre: d.nombre,
        exigirAlSalirDe,
        motivo: "sin_observacion",
        mensaje: `${d.nombre}: "no corresponde" necesita una observación`,
      });
    } else if (estado === "presentado" && d.adjunto === "obligatorio" && adjuntosVigentes(items, d.clave).length === 0) {
      faltan.push({
        tipo: "documento",
        clave: d.clave,
        nombre: d.nombre,
        exigirAlSalirDe,
        motivo: "sin_adjunto",
        mensaje: `${d.nombre}: falta adjuntar el archivo`,
      });
    }
  }

  for (const c of def.campos_extra) {
    if (!c.obligatorio || c.exigir_al_salir_de === null) continue;
    const orden = ordenDePaso(def, c.exigir_al_salir_de);
    if (orden === null || orden > alcance.hastaOrden) continue;
    if (vacio(datosExtra[c.clave])) {
      faltan.push({
        tipo: "campo_extra",
        clave: c.clave,
        etiqueta: c.etiqueta,
        exigirAlSalirDe: refPaso(def, orden),
        mensaje: `${c.etiqueta}: falta completarlo`,
      });
    }
  }
  return faltan;
}

/** Lo que falta para un pase al paso siguiente desde `ordenActual` (lo que muestra "Faltan N"). */
export function faltantesDelPaso(
  def: DefinicionPlantilla,
  items: ItemsExpediente,
  datosExtra: Readonly<Record<string, unknown>>,
  ordenActual: number,
): Faltante[] {
  return faltantesParaSalir(def, items, datosExtra, { pasosConSubtareas: [ordenActual], hastaOrden: ordenActual });
}

/** Un destino posible del pase (3.3, punto 8). */
export interface DestinoPase extends RefPaso {
  /**
   * - `siguiente`: el paso que sigue.
   * - `reenvio`: el paso que devolvió (`paso_retorno_clave`), salteando los
   *   intermedios, que tienen que estar completos (`pasosSalteados`).
   * - `omitiendo`: un paso posterior salteando solo pasos `omitible`, con motivo
   *   (`pasosOmitidos`).
   */
  tipo: "siguiente" | "reenvio" | "omitiendo";
  /** Es el paso que devolvió el expediente: al llegar, `paso_retorno_clave` vuelve a null. */
  esRetorno: boolean;
  pasosSalteados: string[];
  pasosOmitidos: string[];
  /** Saltear omitibles exige motivo (10 caracteres o más; CHECK de movimientos). */
  requiereMotivo: boolean;
  /** Lo que falta para este destino; vacío = disponible. */
  faltan: Faltante[];
}

/**
 * A qué pasos se puede dar el pase desde `ordenActual`. El último paso no
 * tiene destinos (se sale con Concluir, semana 4).
 */
export function destinosPosibles(
  def: DefinicionPlantilla,
  items: ItemsExpediente,
  datosExtra: Readonly<Record<string, unknown>>,
  ordenActual: number,
  pasoRetornoClave: string | null,
): DestinoPase[] {
  const total = def.pasos.length;
  if (ordenActual >= total) return [];
  const ordenRetorno = pasoRetornoClave === null ? null : ordenDePaso(def, pasoRetornoClave);
  const base = faltantesDelPaso(def, items, datosExtra, ordenActual);
  const destinos: DestinoPase[] = [];

  const siguiente = refPaso(def, ordenActual + 1);
  destinos.push({
    ...siguiente,
    tipo: "siguiente",
    esRetorno: ordenRetorno === siguiente.orden,
    pasosSalteados: [],
    pasosOmitidos: [],
    requiereMotivo: false,
    faltan: base,
  });

  if (ordenRetorno !== null && ordenRetorno > ordenActual + 1) {
    const intermedios: number[] = [];
    for (let o = ordenActual + 1; o < ordenRetorno; o++) intermedios.push(o);
    destinos.push({
      ...refPaso(def, ordenRetorno),
      tipo: "reenvio",
      esRetorno: true,
      pasosSalteados: intermedios.map((o) => def.pasos[o - 1].clave),
      pasosOmitidos: [],
      requiereMotivo: false,
      // El paso actual y los intermedios completos, incluso lo que reinició la
      // devolución aunque no sea obligatorio; documentos y campos, hasta el
      // paso anterior al de retorno.
      faltan: faltantesParaSalir(def, items, datosExtra, {
        pasosConSubtareas: [ordenActual, ...intermedios],
        hastaOrden: ordenRetorno - 1,
        exigirReiniciadas: true,
      }),
    });
  }

  // Posteriores salteando solo omitibles: mientras el paso que se saltea sea
  // omitible, el que sigue es un destino.
  const omitidos: string[] = [];
  for (let o = ordenActual + 1; o < total && def.pasos[o - 1].omitible; o++) {
    omitidos.push(def.pasos[o - 1].clave);
    const destino = refPaso(def, o + 1);
    if (destino.orden === ordenRetorno) continue; // ya está como reenvío directo, sin motivo
    destinos.push({
      ...destino,
      tipo: "omitiendo",
      esRetorno: false,
      pasosSalteados: [],
      pasosOmitidos: [...omitidos],
      requiereMotivo: true,
      faltan: base,
    });
  }
  return destinos;
}

/** Una subtarea tildada que una devolución puede mandar a rehacer (3.4). */
export interface SubtareaReiniciable {
  clave: string;
  nombre: string;
  paso: RefPaso;
}

/**
 * Las subtareas tildadas de los pasos anteriores al actual. Al devolver a un
 * paso, se pueden reiniciar las de ese paso en adelante (`paso.orden` mayor o
 * igual al del destino): son las que el papel vuelve a recorrer.
 */
export function subtareasReiniciables(def: DefinicionPlantilla, items: ItemsExpediente, ordenActual: number): SubtareaReiniciable[] {
  const r: SubtareaReiniciable[] = [];
  for (let o = 1; o < ordenActual && o <= def.pasos.length; o++) {
    const paso = refPaso(def, o);
    for (const s of def.pasos[o - 1].subtareas) {
      if (items.subtareas[s.clave]?.hecha) r.push({ clave: s.clave, nombre: s.nombre, paso });
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Fechas efectivas (2.8, 2.13(c) y 3.3 punto 7)
// ---------------------------------------------------------------------------

export type PrecisionFecha = "dia" | "minuto";

/** Una fecha efectiva ya interpretada: el instante y su precisión. */
export interface FechaEfectiva {
  instante: Date;
  precision: PrecisionFecha;
}

/**
 * Lo que puede mandar un formulario como fecha efectiva:
 * - nada (`undefined`, `null`, `""`): ahora, con precisión de minuto;
 * - `"2026-10-15"`: ese día, con precisión de día (las 00:00 de Tucumán);
 * - `"2026-10-15T14:30"` (`datetime-local`): esa hora en Tucumán, precisión de minuto;
 * - un `Date`: ese instante, precisión de minuto.
 */
export type EntradaFechaEfectiva = string | Date | null | undefined;

const RUTA_FECHA = "fechaEfectiva";

function errorFecha(mensaje: string): ErrorDominio {
  return new ErrorDominio("validacion", "Revisá la fecha", [{ ruta: RUTA_FECHA, mensaje }]);
}

/** @throws ErrorDominio `validacion` (ruta `fechaEfectiva`) si no se puede leer. */
export function interpretarFechaEfectiva(valor: EntradaFechaEfectiva, ahora: Date): FechaEfectiva {
  if (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "")) {
    return { instante: ahora, precision: "minuto" };
  }
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) throw errorFecha("Fecha inválida");
    return { instante: valor, precision: "minuto" };
  }
  const texto = valor.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    if (!esFechaValida(texto)) throw errorFecha("Fecha inválida");
    return { instante: inicioDelDiaEnTucuman(texto), precision: "dia" };
  }
  try {
    return { instante: interpretarDatetimeLocal(texto), precision: "minuto" };
  } catch {
    throw errorFecha("Fecha inválida: se espera AAAA-MM-DD o AAAA-MM-DDTHH:MM");
  }
}

/** La fecha de un movimiento en el día o el minuto, según su precisión. */
export function textoFechaEfectiva(f: FechaEfectiva): string {
  return formatearSegunPrecision(f.instante, f.precision);
}

/**
 * ¿`a` es anterior a `b`? Si alguna tiene precisión de día, se comparan los
 * días (decisión 6): un pase cargado "el 15" no es anterior a una recepción
 * del 15 a las 10:00.
 */
export function esAnterior(a: FechaEfectiva, b: FechaEfectiva): boolean {
  if (a.precision === "dia" || b.precision === "dia") return diaEnTucuman(a.instante) < diaEnTucuman(b.instante);
  return a.instante.getTime() < b.instante.getTime();
}

/** Margen para un `datetime-local` escrito con el minuto en curso (el reloj del navegador puede ir adelantado). */
const TOLERANCIA_FUTURO_MS = 60_000;

export interface LimitesFecha {
  ahora: Date;
  /** `fecha_inicio` del expediente. */
  fechaInicio: FechaISO;
  /**
   * El último movimiento que cambió la ubicación del papel (alta, recepción
   * explícita, pase, devolución o estado). Solo para pase, devolución y
   * recepción: las subtareas, documentos y notas no entran en la regla de no
   * retroceso (decisión 6).
   */
  ultimoDeUbicacion?: FechaEfectiva | null;
  /** Días hacia atrás que se admiten (30, `DIAS_RETROACTIVOS_MAX`). `null`: sin límite. */
  diasAtras?: number | null;
}

/**
 * Controla una fecha efectiva (3.3, punto 7): no futura, de hasta 30 días
 * atrás, no anterior a `fecha_inicio` y, si se pasa, no anterior al último
 * movimiento de ubicación.
 *
 * @throws ErrorDominio `validacion` con ruta `fechaEfectiva`.
 */
export function validarFechaEfectiva(f: FechaEfectiva, limites: LimitesFecha): void {
  const hoy = hoyEnTucuman(limites.ahora);
  const dia = diaEnTucuman(f.instante);
  const futura = f.precision === "dia" ? dia > hoy : f.instante.getTime() > limites.ahora.getTime() + TOLERANCIA_FUTURO_MS;
  if (futura) throw errorFecha("La fecha no puede ser posterior a ahora");
  const diasAtras = limites.diasAtras === undefined ? DIAS_RETROACTIVOS_MAX : limites.diasAtras;
  if (diasAtras !== null && diasEntre(dia, hoy) > diasAtras) {
    throw errorFecha(`La fecha no puede tener más de ${diasAtras} días (para algo más viejo está la carga histórica)`);
  }
  if (dia < limites.fechaInicio) {
    throw errorFecha(`La fecha no puede ser anterior al inicio del expediente (${formatearFecha(limites.fechaInicio)})`);
  }
  const ultimo = limites.ultimoDeUbicacion;
  if (ultimo && esAnterior(f, ultimo)) {
    throw errorFecha(`La fecha no puede ser anterior al último movimiento del papel (${textoFechaEfectiva(ultimo)})`);
  }
}

// ---------------------------------------------------------------------------
// Plazo del paso (3.6): los campos se cargan al entrar y se limpian al salir
// ---------------------------------------------------------------------------

export interface CamposPlazo {
  plazoDesde: FechaISO | null;
  plazoDiasHabiles: number | null;
  plazoCumplidoEn: FechaISO | null;
}

export const SIN_PLAZO: CamposPlazo = { plazoDesde: null, plazoDiasHabiles: null, plazoCumplidoEn: null };

function fechaDeSubtarea(items: ItemsExpediente, clave: string): FechaISO | null {
  const item = items.subtareas[clave];
  if (!item?.hecha) return null;
  return esFechaValida(item.dato) ? item.dato : null;
}

/**
 * Los `plazo_*` del expediente al entrar a `paso`: sin plazo, todo null (así,
 * salir de un paso con plazo por cualquier vía lo limpia). Con plazo, los días
 * hábiles y, si la subtarea de inicio ya tiene fecha, `plazo_desde`; si la de
 * cierre ya está tildada (volvió por una devolución), `plazo_cumplido_en`.
 */
export function plazoAlEntrar(paso: PasoPlantilla, items: ItemsExpediente): CamposPlazo {
  if (paso.plazo === null) return SIN_PLAZO;
  return {
    plazoDiasHabiles: paso.plazo.dias_habiles,
    plazoDesde: fechaDeSubtarea(items, paso.plazo.desde_subtarea),
    plazoCumplidoEn: fechaDeSubtarea(items, paso.plazo.hasta_subtarea),
  };
}

/** Los errores de una lista de faltantes, para `ErrorDominio("faltan_requisitos")`. */
export function erroresDeFaltantes(faltan: readonly Faltante[]): ErrorCampo[] {
  return faltan.map((f) => ({ ruta: rutaDeFaltante(f), mensaje: f.mensaje }));
}
