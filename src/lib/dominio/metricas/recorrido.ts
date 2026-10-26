import { diaEnTucuman, esFechaValida, type FechaISO } from "@/lib/fechas";
import {
  datosDe,
  esRecepcionImplicita,
  movimientosVigentes,
  type MovimientoReconstruible,
} from "../expedientes/reconstruccion";

/**
 * El recorrido de un expediente leído desde su historial, para medir. Puro.
 *
 * Recorre los movimientos **como cuentan hoy** (`movimientosVigentes()` de la
 * reconstrucción: sin los revertidos y con la fecha efectiva corregida), en el
 * orden en que se registraron, y arma:
 *
 * - las **estadías**: cada vez que el papel llegó a un paso (alta, pase,
 *   devolución, desarchivar o reabrir) hasta que salió (pase, devolución,
 *   concluir, archivar o anular), con la fecha efectiva de los dos movimientos,
 *   la recepción y, en un paso con plazo (la DIM), cómo estaba el plazo al
 *   salir;
 * - los **eventos de estado** (concluido, archivado, anulado) con su fecha;
 * - los **intervalos en trámite** (para el stock al final de cada período);
 * - las **anotaciones** que habría tenido la ficha de papel (alta, pases,
 *   devoluciones y cambios de estado), para estimar las hojas.
 *
 * No cambia ninguna regla: aplica a cada movimiento el mismo efecto que la
 * reconstrucción de la proyección (`reconstruccion.ts`), pero guarda la
 * historia en vez de quedarse con el último estado.
 */

export interface MovimientoMetricas extends MovimientoReconstruible {
  expedienteId: string;
}

/** Lo que las métricas necesitan de cada paso de la plantilla del expediente. */
export interface PasoMetricas {
  clave: string;
  nombre: string;
  orden: number;
  diasAlerta: number | null;
  plazo: { diasHabiles: number; desdeSubtarea: string; hastaSubtarea: string } | null;
}

export type TipoSalida = "pase" | "devolucion" | "concluido" | "archivado" | "anulado";

/**
 * - `sistema`: llegó y salió con movimientos del sistema.
 * - `papel`: salió con un movimiento transcripto de la ficha (carga histórica):
 *   es un tiempo de antes del sistema.
 * - `mixta`: llegó por la transcripción y salió (o sigue) con el sistema: no es
 *   ni una cosa ni la otra, y no entra en la comparación.
 */
export type OrigenEstadia = "sistema" | "papel" | "mixta";

export type Recepcion =
  /** Llegó recibido: área externa, el área de quien dio el pase o transcripción. */
  | { tipo: "al_llegar" }
  /** "Confirmar recepción" (con su fecha efectiva). */
  | { tipo: "explicita"; fecha: Date }
  /** La confirmó el área al operar (recepción implícita, 3.3): no hay fecha propia. */
  | { tipo: "implicita" };

export interface Estadia {
  expedienteId: string;
  pasoClave: string;
  pasoOrden: number;
  areaId: number;
  llegada: Date;
  llegadaTranscripta: boolean;
  salida: Date | null;
  salidaTipo: TipoSalida | null;
  salidaTranscripta: boolean;
  origen: OrigenEstadia;
  recepcion: Recepcion | null;
  /** Si salió por una devolución: a dónde y por qué. */
  devolucion: { areaDestinoId: number | null; pasoDestino: string | null; motivo: string | null } | null;
  /** En un paso con plazo: el plazo como quedó al salir (o como está, si sigue ahí). */
  plazo: { diasHabiles: number; desde: FechaISO | null; cumplidoEn: FechaISO | null } | null;
}

export interface EventoEstado {
  expedienteId: string;
  tipo: "concluido" | "archivado" | "anulado";
  fecha: Date;
  transcripto: boolean;
}

export interface Recorrido {
  estadias: Estadia[];
  eventos: EventoEstado[];
  /** Intervalos en estado activo (en trámite o en espera de pago); `hasta` null si sigue. */
  enTramite: Array<{ desde: Date; hasta: Date | null }>;
  /** Alta, pases, devoluciones y cambios de estado vigentes: los renglones de la ficha de papel. */
  anotaciones: number;
}

const ACTIVOS = new Set(["en_tramite", "espera_pago_dim"]);
const SALIDAS_DE_ESTADO = new Set(["concluido", "archivado", "anulado"]);

function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

interface EstadoSubtarea {
  hecha: boolean;
  dato: string | null;
  fecha: Date;
}

/**
 * El recorrido de UN expediente.
 *
 * @param movimientos todos los suyos (o al menos los de ubicación, subtareas y
 *   correcciones), en cualquier orden.
 * @param pasos los pasos de su plantilla, por clave.
 * @param areasExternas los ids de las áreas externas (llegan recibidas).
 */
export function recorrer(
  movimientos: readonly MovimientoMetricas[],
  pasos: ReadonlyMap<string, PasoMetricas>,
  areasExternas: ReadonlySet<number>,
): Recorrido {
  const estadias: Estadia[] = [];
  const eventos: EventoEstado[] = [];
  const enTramite: Array<{ desde: Date; hasta: Date | null }> = [];
  const subtareas = new Map<string, EstadoSubtarea>();
  let anotaciones = 0;
  let estado: string | null = null;
  let abierta: Estadia | null = null;
  let pasoClave: string | null = null;
  let pasoOrden = 0;
  let areaId: number | null = null;

  const plazoDe = (clave: string): Estadia["plazo"] => {
    const p = pasos.get(clave)?.plazo;
    if (!p) return null;
    const desde = subtareas.get(p.desdeSubtarea);
    const hasta = subtareas.get(p.hastaSubtarea);
    // Como plazoPorSubtarea(): el inicio es la fecha cargada en la notificación;
    // el cumplimiento, la del tilde de cierre (o el día del movimiento si no trae fecha).
    return {
      diasHabiles: p.diasHabiles,
      desde: desde?.hecha && esFechaValida(desde.dato) ? desde.dato : null,
      cumplidoEn: hasta?.hecha ? (esFechaValida(hasta.dato) ? hasta.dato : diaEnTucuman(hasta.fecha)) : null,
    };
  };

  const cerrar = (fecha: Date, tipo: TipoSalida, m: MovimientoMetricas) => {
    if (!abierta) return;
    abierta.salida = fecha;
    abierta.salidaTipo = tipo;
    abierta.salidaTranscripta = m.cargaHistorica;
    abierta.origen = m.cargaHistorica ? "papel" : abierta.llegadaTranscripta ? "mixta" : "sistema";
    abierta.plazo = plazoDe(abierta.pasoClave);
    if (tipo === "devolucion") {
      abierta.devolucion = { areaDestinoId: m.areaDestinoId, pasoDestino: m.pasoDestino, motivo: m.motivo };
    }
    abierta = null;
  };

  const abrir = (clave: string, orden: number, area: number, m: MovimientoMetricas) => {
    const alLlegar = areasExternas.has(area) || m.areaUsuarioId === area || m.cargaHistorica;
    abierta = {
      expedienteId: m.expedienteId,
      pasoClave: clave,
      pasoOrden: orden,
      areaId: area,
      llegada: m.fechaEfectiva,
      llegadaTranscripta: m.cargaHistorica,
      salida: null,
      salidaTipo: null,
      salidaTranscripta: false,
      origen: m.cargaHistorica ? "mixta" : "sistema",
      recepcion: alLlegar ? { tipo: "al_llegar" } : null,
      devolucion: null,
      plazo: null,
    };
    estadias.push(abierta);
    pasoClave = clave;
    pasoOrden = orden;
    areaId = area;
  };

  const ordenDe = (clave: string | null): number => (clave === null ? 0 : (pasos.get(clave)?.orden ?? 0));

  for (const m of movimientosVigentes(movimientos)) {
    const d = datosDe(m);
    switch (m.tipo) {
      case "alta": {
        anotaciones += 1;
        const clave = m.pasoDestino ?? [...pasos.values()].find((p) => p.orden === 1)?.clave ?? "";
        estado = m.estadoNuevo ?? "en_tramite";
        if (m.areaDestinoId !== null) abrir(clave, ordenDe(clave) || 1, m.areaDestinoId, m);
        if (ACTIVOS.has(estado)) enTramite.push({ desde: m.fechaEfectiva, hasta: null });
        break;
      }
      case "recepcion": {
        const actual = abierta as Estadia | null;
        if (actual && actual.recepcion === null) {
          actual.recepcion = esRecepcionImplicita(m) ? { tipo: "implicita" } : { tipo: "explicita", fecha: m.fechaEfectiva };
        }
        break;
      }
      case "pase":
      case "devolucion": {
        anotaciones += 1;
        cerrar(m.fechaEfectiva, m.tipo, m);
        if (m.tipo === "devolucion") {
          // Lo que se mandó a rehacer vuelve a estar sin hacer (3.4).
          const reiniciadas = Array.isArray(d.subtareas_reiniciadas) ? d.subtareas_reiniciadas : [];
          for (const clave of reiniciadas) if (typeof clave === "string") subtareas.set(clave, { hecha: false, dato: null, fecha: m.fechaEfectiva });
        }
        if (m.pasoDestino !== null && m.areaDestinoId !== null) abrir(m.pasoDestino, ordenDe(m.pasoDestino), m.areaDestinoId, m);
        break;
      }
      case "subtarea": {
        const clave = texto(d.subtarea);
        if (clave !== null) subtareas.set(clave, { hecha: d.hecha === true, dato: texto(d.dato), fecha: m.fechaEfectiva });
        break;
      }
      case "correccion": {
        // Corregir el dato o destildar una subtarea (2.13(b)); revertir ya lo
        // resolvió movimientosVigentes().
        const clave = texto(d.subtarea);
        if (clave === null) break;
        const previa = subtareas.get(clave) ?? { hecha: false, dato: null, fecha: m.fechaEfectiva };
        if (Array.isArray(d.dato)) subtareas.set(clave, { ...previa, dato: texto(d.dato[1]) });
        if (d.hecha === false) subtareas.set(clave, { ...previa, hecha: false, dato: null });
        break;
      }
      case "estado": {
        anotaciones += 1;
        const nuevo = m.estadoNuevo;
        if (nuevo === null) break;
        const eraActivo = estado !== null && ACTIVOS.has(estado);
        if (SALIDAS_DE_ESTADO.has(nuevo)) {
          if (eraActivo) {
            cerrar(m.fechaEfectiva, nuevo as TipoSalida, m);
            const ultimo = enTramite.at(-1);
            if (ultimo && ultimo.hasta === null) ultimo.hasta = m.fechaEfectiva;
          }
          eventos.push({ expedienteId: m.expedienteId, tipo: nuevo as EventoEstado["tipo"], fecha: m.fechaEfectiva, transcripto: m.cargaHistorica });
        } else if (ACTIVOS.has(nuevo) && !eraActivo && pasoClave !== null) {
          // Desarchivar o reabrir: el papel vuelve al paso en que estaba.
          const area = m.areaDestinoId ?? areaId;
          if (area !== null) abrir(pasoClave, pasoOrden, area, m);
          enTramite.push({ desde: m.fechaEfectiva, hasta: null });
        }
        estado = nuevo;
        break;
      }
      default:
        break;
    }
  }
  // La que sigue abierta: el plazo como está hoy.
  const ultima = abierta as Estadia | null;
  if (ultima) ultima.plazo = plazoDe(ultima.pasoClave);
  return { estadias, eventos, enTramite, anotaciones };
}
