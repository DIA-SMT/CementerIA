import { diaEnTucuman, esFechaValida } from "@/lib/fechas";
import type { DefinicionPlantilla, PasoPlantilla } from "../plantillas/esquema";
import { ErrorDominio } from "./errores";
import { ordenDePaso, plazoAlEntrar, SIN_PLAZO, type CamposPlazo, type FechaEfectiva, type PrecisionFecha } from "./flujo";
import { itemsIniciales, type ItemsExpediente } from "./items";

/**
 * La proyección del flujo reconstruida desde el historial (semana 4).
 *
 * `expedientes` es una proyección de `movimientos` (2.6): cada acción escribe
 * los dos en la misma transacción. Esta función hace el camino inverso, sin
 * base: recorre los movimientos en el orden en que se registraron
 * (`secuencia`) y aplica a cada uno el mismo efecto que su acción le aplicó a
 * la proyección. La usan:
 *
 * - las **correcciones** (2.13(b)): revertir el último movimiento es
 *   reconstruir sin él (y sin la recepción implícita y las notas que
 *   arrastra); corregir una fecha o una subtarea es reconstruir con el valor
 *   corregido. Así la proyección vuelve exactamente al estado que tendría si el
 *   error no hubiera pasado, sin una regla "inversa" por cada tipo;
 * - los tests, que comparan la reconstrucción con la proyección que escribió
 *   cada acción (es la "conciliación por replay" de la fase 2, en chico).
 *
 * Solo reconstruye las columnas del flujo (paso, áreas, estado, fechas de
 * ubicación, plazo, `items`, carga histórica). Los datos del expediente
 * (ubicación, padrón, campos extra) y las personas no dependen de esto.
 *
 * Las áreas salen de los movimientos (`area_destino_id` es siempre el área
 * concreta, también para `$CEMENTERIO`); el área responsable, de la custodia
 * del paso, como en el pase.
 */

/** Lo que la reconstrucción lee de cada movimiento (las columnas de `movimientos`). */
export interface MovimientoReconstruible {
  id: bigint;
  secuencia: number;
  tipo: string;
  fechaEfectiva: Date;
  precisionFecha: string;
  usuarioId: number;
  areaUsuarioId: number | null;
  pasoOrigen: string | null;
  pasoDestino: string | null;
  areaOrigenId: number | null;
  areaDestinoId: number | null;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  observacion: string | null;
  motivo: string | null;
  datos: unknown;
  corrigeMovimientoId: bigint | null;
  cargaHistorica: boolean;
  comandoId: string;
  registradoEn: Date;
}

/** Las columnas del flujo de `expedientes`. */
export interface ProyeccionFlujo extends CamposPlazo {
  estado: string;
  estadoPrevio: string | null;
  ubicacionArchivo: string | null;
  pasoClave: string;
  pasoOrden: number;
  pasoRetornoClave: string | null;
  areaActualId: number;
  areaResponsableId: number;
  enAreaDesde: Date;
  recibidoEn: Date | null;
  items: ItemsExpediente;
  cargaHistorica: boolean;
}

export interface AreaReconstruccion {
  id: number;
  codigo: string;
  tipo: string;
}

export interface EntornoReconstruccion {
  /** Todas las áreas, por id. */
  areas: ReadonlyMap<number, AreaReconstruccion>;
}

/** Los tipos que cambian la ubicación del papel (decisión 6). */
export const TIPOS_UBICACION: ReadonlySet<string> = new Set(["alta", "recepcion", "pase", "devolucion", "estado"]);

type Datos = Record<string, unknown>;

export function datosDe(m: Pick<MovimientoReconstruible, "datos">): Datos {
  return typeof m.datos === "object" && m.datos !== null && !Array.isArray(m.datos) ? (m.datos as Datos) : {};
}

function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function listaDeTextos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function listaDeIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" || typeof x === "number").map(String) : [];
}

export function esRecepcionImplicita(m: Pick<MovimientoReconstruible, "tipo" | "datos">): boolean {
  return m.tipo === "recepcion" && datosDe(m).implicita === true;
}

/** Una corrección `{revertir: true}`. */
export function esReversion(m: Pick<MovimientoReconstruible, "tipo" | "datos">): boolean {
  return m.tipo === "correccion" && datosDe(m).revertir === true;
}

/**
 * Los movimientos que dejaron de contar porque una corrección los revirtió:
 * el corregido y lo que arrastró (`datos.arrastra`: su recepción implícita y
 * las recepciones y notas posteriores). Ids como texto.
 */
export function movimientosRevertidos(movimientos: readonly MovimientoReconstruible[]): Set<string> {
  const r = new Set<string>();
  for (const m of movimientos) {
    if (!esReversion(m) || m.corrigeMovimientoId === null) continue;
    r.add(m.corrigeMovimientoId.toString());
    for (const id of listaDeIds(datosDe(m).arrastra)) r.add(id);
  }
  return r;
}

/** La fecha efectiva que vale de cada movimiento corregido (`correccion {fecha_efectiva: [a, b]}`). */
export function fechasCorregidas(movimientos: readonly MovimientoReconstruible[]): Map<string, FechaEfectiva> {
  const r = new Map<string, FechaEfectiva>();
  for (const m of [...movimientos].sort((a, b) => a.secuencia - b.secuencia)) {
    if (m.tipo !== "correccion" || m.corrigeMovimientoId === null) continue;
    const d = datosDe(m);
    const cambio = d.fecha_efectiva;
    if (!Array.isArray(cambio) || typeof cambio[1] !== "string") continue;
    const precision = Array.isArray(d.precision) && d.precision[1] === "dia" ? "dia" : "minuto";
    r.set(m.corrigeMovimientoId.toString(), { instante: new Date(cambio[1]), precision });
  }
  return r;
}

/** La observación que vale de cada movimiento corregido (`correccion {observacion: [a, b]}`). */
export function observacionesCorregidas(movimientos: readonly MovimientoReconstruible[]): Map<string, string | null> {
  const r = new Map<string, string | null>();
  for (const m of [...movimientos].sort((a, b) => a.secuencia - b.secuencia)) {
    if (m.tipo !== "correccion" || m.corrigeMovimientoId === null) continue;
    const cambio = datosDe(m).observacion;
    if (Array.isArray(cambio)) r.set(m.corrigeMovimientoId.toString(), texto(cambio[1]));
  }
  return r;
}

/**
 * Los movimientos como cuentan hoy: sin los revertidos (ni las reversiones) y
 * con la fecha efectiva corregida. En orden de `secuencia`.
 */
export function movimientosVigentes<M extends MovimientoReconstruible>(movimientos: readonly M[]): M[] {
  const revertidos = movimientosRevertidos(movimientos);
  const fechas = fechasCorregidas(movimientos);
  return [...movimientos]
    .sort((a, b) => a.secuencia - b.secuencia)
    .filter((m) => !revertidos.has(m.id.toString()) && !esReversion(m))
    .map((m) => {
      const f = fechas.get(m.id.toString());
      return f ? { ...m, fechaEfectiva: f.instante, precisionFecha: f.precision } : m;
    });
}

function precisionDe(m: Pick<MovimientoReconstruible, "precisionFecha">): PrecisionFecha {
  return m.precisionFecha === "dia" ? "dia" : "minuto";
}

/** El último movimiento de ubicación vigente (sin la recepción implícita), para la regla de no retroceso. */
export function ultimaUbicacionVigente(movimientos: readonly MovimientoReconstruible[]): FechaEfectiva | null {
  const vigentes = movimientosVigentes(movimientos).filter((m) => TIPOS_UBICACION.has(m.tipo) && !esRecepcionImplicita(m));
  // Por fecha efectiva y después por secuencia, como en la semana 3.
  vigentes.sort((a, b) => a.fechaEfectiva.getTime() - b.fechaEfectiva.getTime() || a.secuencia - b.secuencia);
  const u = vigentes.at(-1);
  return u ? { instante: u.fechaEfectiva, precision: precisionDe(u) } : null;
}

function exigirArea(entorno: EntornoReconstruccion, id: number | null, m: MovimientoReconstruible): AreaReconstruccion {
  const a = id === null ? undefined : entorno.areas.get(id);
  if (!a) throw new ErrorDominio("configuracion_incompleta", `El movimiento ${m.id} (${m.tipo}) no tiene un área de destino conocida`);
  return a;
}

function responsableDe(entorno: EntornoReconstruccion, paso: PasoPlantilla, areaActualId: number): number {
  if (paso.custodia === null) return areaActualId;
  for (const a of entorno.areas.values()) if (a.codigo === paso.custodia) return a.id;
  throw new ErrorDominio("configuracion_incompleta", `La custodia ${paso.custodia} del paso ${paso.clave} no existe`);
}

function pasoDe(def: DefinicionPlantilla, clave: string | null, m: MovimientoReconstruible): { paso: PasoPlantilla; orden: number } {
  const orden = clave === null ? null : ordenDePaso(def, clave);
  if (orden === null) throw new ErrorDominio("configuracion_incompleta", `El movimiento ${m.id} va al paso ${clave ?? "(ninguno)"}, que no está en la plantilla`);
  return { paso: def.pasos[orden - 1], orden };
}

/** Los `plazo_*` que cambian al tildar, destildar o corregir la subtarea `clave` estando en `paso` (3.6). */
export function plazoPorSubtarea(paso: PasoPlantilla, clave: string, items: ItemsExpediente, fecha: Date, actual: CamposPlazo): CamposPlazo {
  if (paso.plazo === null) return actual;
  const item = items.subtareas[clave];
  const r = { ...actual };
  if (clave === paso.plazo.desde_subtarea) r.plazoDesde = item?.hecha && esFechaValida(item.dato) ? item.dato : null;
  if (clave === paso.plazo.hasta_subtarea) {
    r.plazoCumplidoEn = item?.hecha ? (esFechaValida(item.dato) ? item.dato : diaEnTucuman(fecha)) : null;
  }
  return r;
}

/**
 * El efecto de UN movimiento sobre la proyección: lo mismo que hizo su acción.
 * `estado` es null antes del alta.
 */
function aplicar(def: DefinicionPlantilla, entorno: EntornoReconstruccion, p: ProyeccionFlujo | null, m: MovimientoReconstruible): ProyeccionFlujo | null {
  const d = datosDe(m);
  const mov = Number(m.id);
  if (m.tipo === "alta") {
    const { paso } = pasoDe(def, m.pasoDestino ?? def.pasos[0]?.clave ?? null, m);
    const area = exigirArea(entorno, m.areaDestinoId, m);
    const recibido = area.tipo === "externa" || m.areaUsuarioId === area.id;
    return {
      estado: m.estadoNuevo ?? paso.estado,
      estadoPrevio: null,
      ubicacionArchivo: null,
      pasoClave: paso.clave,
      pasoOrden: 1,
      pasoRetornoClave: null,
      areaActualId: area.id,
      areaResponsableId: responsableDe(entorno, paso, area.id),
      enAreaDesde: m.fechaEfectiva,
      recibidoEn: recibido ? m.fechaEfectiva : null,
      plazoDesde: null,
      plazoDiasHabiles: paso.plazo?.dias_habiles ?? null,
      plazoCumplidoEn: null,
      items: itemsIniciales(listaDeTextos(d.documentos_recibidos), m.id),
      cargaHistorica: m.cargaHistorica,
    };
  }
  if (p === null) throw new ErrorDominio("configuracion_incompleta", `El movimiento ${m.id} (${m.tipo}) está antes del alta`);

  switch (m.tipo) {
    case "recepcion":
      return { ...p, recibidoEn: m.fechaEfectiva };

    case "pase":
    case "devolucion": {
      const { paso, orden } = pasoDe(def, m.pasoDestino, m);
      const area = exigirArea(entorno, m.areaDestinoId, m);
      // La transcripción (carga histórica) llega recibida: nadie confirma en la ficha de papel.
      const recibido = m.cargaHistorica || area.tipo === "externa" || m.areaUsuarioId === area.id;
      let items = p.items;
      let retorno: string | null;
      const ordenRetorno = p.pasoRetornoClave === null ? null : ordenDePaso(def, p.pasoRetornoClave);
      if (m.tipo === "pase") {
        // Llegar al paso que devolvió, o pasarlo, cierra el reenvío directo.
        retorno = p.pasoRetornoClave !== null && ordenRetorno !== null && orden < ordenRetorno ? p.pasoRetornoClave : null;
      } else {
        const subtareas = { ...items.subtareas };
        for (const clave of listaDeTextos(d.subtareas_reiniciadas)) {
          subtareas[clave] = { hecha: false, dato: null, mov, reiniciada_por_mov: mov, historica: false };
        }
        items = { ...items, subtareas };
        // Se conserva el paso más avanzado que devolvió (3.4).
        retorno = ordenRetorno !== null && ordenRetorno > p.pasoOrden ? p.pasoRetornoClave : p.pasoClave;
      }
      return {
        ...p,
        ...plazoAlEntrar(paso, items),
        estado: paso.estado,
        pasoClave: paso.clave,
        pasoOrden: orden,
        pasoRetornoClave: retorno,
        areaActualId: area.id,
        areaResponsableId: responsableDe(entorno, paso, area.id),
        enAreaDesde: m.fechaEfectiva,
        recibidoEn: recibido ? m.fechaEfectiva : null,
        items,
      };
    }

    case "subtarea": {
      const clave = texto(d.subtarea);
      if (clave === null) return p;
      const hecha = d.hecha === true;
      const items: ItemsExpediente = {
        ...p.items,
        subtareas: { ...p.items.subtareas, [clave]: { hecha, dato: texto(d.dato), mov, reiniciada_por_mov: null, historica: false } },
      };
      const paso = def.pasos[p.pasoOrden - 1];
      return { ...p, ...(paso ? plazoPorSubtarea(paso, clave, items, m.fechaEfectiva, p) : {}), items };
    }

    case "documento": {
      const clave = texto(d.documento);
      const estado = texto(d.estado);
      if (clave === null || (estado !== "pendiente" && estado !== "presentado" && estado !== "no_corresponde")) return p;
      const previo = p.items.documentos[clave];
      return {
        ...p,
        items: { ...p.items, documentos: { ...p.items.documentos, [clave]: { estado, obs: m.observacion, mov, adjuntos: previo?.adjuntos ?? [] } } },
      };
    }

    case "adjunto": {
      const documento = texto(d.documento);
      const items: ItemsExpediente = {
        ...p.items,
        adjuntos: { ...p.items.adjuntos, [String(mov)]: { documento, vigente: true, purgado: false } },
      };
      if (documento !== null) {
        const doc = p.items.documentos[documento];
        items.documentos = {
          ...p.items.documentos,
          [documento]: doc ? { ...doc, adjuntos: [...doc.adjuntos, mov] } : { estado: "pendiente", obs: null, mov: null, adjuntos: [mov] },
        };
      }
      return { ...p, items };
    }

    case "edicion": {
      const cambios = typeof d.cambios === "object" && d.cambios !== null ? (d.cambios as Datos) : {};
      let r = p;
      const ubicacion = cambios.ubicacion_archivo;
      if (Array.isArray(ubicacion)) r = { ...r, ubicacionArchivo: texto(ubicacion[1]) };
      const carga = cambios.carga_historica;
      if (Array.isArray(carga) && carga[1] === false) {
        // "Terminar carga histórica": lo pendiente de los pasos anteriores pasa a histórico.
        const historicos = typeof d.historicos === "object" && d.historicos !== null ? (d.historicos as Datos) : {};
        const subtareas = { ...r.items.subtareas };
        for (const clave of listaDeTextos(historicos.subtareas)) {
          const previa = subtareas[clave];
          subtareas[clave] = { hecha: previa?.hecha ?? false, dato: previa?.dato ?? null, mov, reiniciada_por_mov: null, historica: true };
        }
        const documentos = { ...r.items.documentos };
        for (const clave of listaDeTextos(historicos.documentos)) {
          documentos[clave] = { estado: "historico", obs: null, mov, adjuntos: documentos[clave]?.adjuntos ?? [] };
        }
        r = { ...r, cargaHistorica: false, items: { ...r.items, subtareas, documentos } };
      }
      return r;
    }

    case "estado":
      return aplicarEstado(def, entorno, p, m, d);

    case "correccion":
      return aplicarCorreccion(def, p, m, d);

    default:
      // nota: no cambia la proyección.
      return p;
  }
}

function aplicarEstado(def: DefinicionPlantilla, entorno: EntornoReconstruccion, p: ProyeccionFlujo, m: MovimientoReconstruible, d: Datos): ProyeccionFlujo {
  const nuevo = m.estadoNuevo;
  const anterior = m.estadoAnterior ?? p.estado;
  if (nuevo === null) return p;
  // Desarchivar o reabrir: vuelve al estado previo y, si es activo, al paso en que estaba.
  if (anterior === "archivado" || anterior === "anulado") {
    let r: ProyeccionFlujo = { ...p, estado: nuevo, estadoPrevio: null, ubicacionArchivo: null };
    if (nuevo === "en_tramite" || nuevo === "espera_pago_dim") {
      const paso = def.pasos[p.pasoOrden - 1];
      if (paso) r = { ...r, ...plazoAlEntrar(paso, p.items) };
      if (m.areaDestinoId !== null && paso) {
        // Desarchivar mueve el papel del archivo al paso.
        const area = exigirArea(entorno, m.areaDestinoId, m);
        const recibido = area.tipo === "externa" || m.areaUsuarioId === area.id;
        r = {
          ...r,
          areaActualId: area.id,
          areaResponsableId: responsableDe(entorno, paso, area.id),
          enAreaDesde: m.fechaEfectiva,
          recibidoEn: recibido ? m.fechaEfectiva : null,
        };
      }
    }
    return r;
  }
  if (nuevo === "concluido") return { ...p, ...SIN_PLAZO, estado: "concluido" };
  if (nuevo === "anulado") return { ...p, ...SIN_PLAZO, estado: "anulado", estadoPrevio: anterior };
  if (nuevo === "archivado") {
    let r: ProyeccionFlujo = { ...p, ...SIN_PLAZO, estado: "archivado", estadoPrevio: anterior, ubicacionArchivo: texto(d.ubicacion_archivo) };
    const regreso = typeof d.regreso_papel === "object" && d.regreso_papel !== null ? (d.regreso_papel as Datos) : null;
    if (regreso && typeof regreso.area_id === "number") {
      // Archivar sin concluir desde un paso externo: el papel volvió a la custodia en ese momento.
      r = { ...r, areaActualId: regreso.area_id, enAreaDesde: m.fechaEfectiva, recibidoEn: m.fechaEfectiva };
    }
    return r;
  }
  return { ...p, estado: nuevo };
}

function aplicarCorreccion(def: DefinicionPlantilla, p: ProyeccionFlujo, m: MovimientoReconstruible, d: Datos): ProyeccionFlujo {
  const mov = Number(m.id);
  const clave = texto(d.subtarea);
  if (clave !== null) {
    const previa = p.items.subtareas[clave] ?? { hecha: false, dato: null, mov: null, reiniciada_por_mov: null, historica: false };
    let item = previa;
    if (Array.isArray(d.dato)) item = { ...previa, dato: texto(d.dato[1]), mov };
    if (d.hecha === false) item = { ...previa, hecha: false, dato: null, mov };
    const items: ItemsExpediente = { ...p.items, subtareas: { ...p.items.subtareas, [clave]: item } };
    // Si el paso actual mide su plazo con esa subtarea (la notificación es de
    // Tributario y el plazo corre en la DIM), el plazo sigue al dato corregido.
    const paso = def.pasos[p.pasoOrden - 1];
    const activo = p.estado === "en_tramite" || p.estado === "espera_pago_dim";
    return { ...p, ...(paso && activo ? plazoPorSubtarea(paso, clave, items, m.fechaEfectiva, p) : {}), items };
  }
  const retirado = d.retirar_adjunto;
  if (typeof retirado === "string" || typeof retirado === "number") {
    const id = String(retirado);
    const previo = p.items.adjuntos[id];
    if (!previo) return p;
    return {
      ...p,
      items: { ...p.items, adjuntos: { ...p.items.adjuntos, [id]: { ...previo, vigente: false, purgado: previo.purgado || d.purgar === true } } },
    };
  }
  return p;
}

/**
 * Reconstruye la proyección del flujo con todos los movimientos de un
 * expediente: sin los revertidos y con las fechas corregidas.
 *
 * @throws ErrorDominio `configuracion_incompleta` si el historial no cierra con la plantilla.
 */
export function reconstruirProyeccion(
  def: DefinicionPlantilla,
  movimientos: readonly MovimientoReconstruible[],
  entorno: EntornoReconstruccion,
): ProyeccionFlujo {
  let p: ProyeccionFlujo | null = null;
  for (const m of movimientosVigentes(movimientos)) p = aplicar(def, entorno, p, m);
  if (p === null) throw new ErrorDominio("configuracion_incompleta", "El expediente no tiene alta");
  return p;
}

/** Las columnas de la proyección como las comparan los tests y las escribe Prisma. */
export function proyeccionComparable(p: ProyeccionFlujo): Record<string, unknown> {
  return {
    ...p,
    enAreaDesde: p.enAreaDesde.toISOString(),
    recibidoEn: p.recibidoEn?.toISOString() ?? null,
  };
}

