import { diaEnTucuman, inicioDelDiaEnTucuman, sumarDias, type FechaISO } from "@/lib/fechas";
import type { FiltrosBusqueda } from "../busqueda";
import { normalizar } from "../normalizar";
import { agruparPor, RESUMEN_VACIO, resumir, tasa, unDecimal, type Resumen } from "./estadisticas";
import { hojasDeFicha, type ParametrosPapel } from "./papel";
import { periodosEntre, type FiltrosMetricas, type Periodo } from "./periodos";
import type { Estadia, PasoMetricas, Recorrido } from "./recorrido";

/**
 * Las métricas de gestión calculadas con los recorridos de los expedientes.
 * Puro: los días hábiles vienen de un `Calendario`, que en la app responde
 * `f_dias_habiles_entre` y `f_sumar_dias_habiles` de la base (los mismos
 * feriados que el plazo DIM y la bandeja) y en los tests es uno de prueba.
 *
 * Definiciones (docs/api-dominio.md, sección 20):
 *
 * - **Con el sistema**: los expedientes dados de alta en el sistema. Con
 *   `historicos: "incluir"`, también los de carga histórica terminada. Las
 *   cargas históricas **abiertas** no se miden nunca (como en el panel): su
 *   historial todavía se está pasando.
 * - **Antes del sistema (línea de base)**: los tiempos que salen de la ficha
 *   de papel transcripta: las estadías que salieron con un movimiento de la
 *   transcripción y los expedientes cuya conclusión se transcribió. No se
 *   filtran por período (son de antes), sí por trámite, plantilla y
 *   cementerio.
 * - **Tiempos**: días hábiles entre el día de la fecha efectiva de la llegada
 *   y el de la salida (`f_dias_habiles_entre`: el mismo día es 0). Una estadía
 *   entra en el período si **salió** dentro de él; un expediente concluido, si
 *   se concluyó dentro de él. Punta a punta: de la fecha de inicio a la
 *   conclusión.
 */

export interface Calendario {
  /** `f_dias_habiles_entre(desde, hasta)`: los días hábiles en (desde, hasta]. */
  diasHabiles(desde: FechaISO, hasta: FechaISO): number;
  /** `f_sumar_dias_habiles(desde, n)`. */
  sumarHabiles(desde: FechaISO, n: number): FechaISO;
}

export interface ExpedienteMetricas {
  id: string;
  numero: string;
  fechaInicio: FechaISO;
  estado: string;
  plantillaId: number;
  plantillaCodigo: string;
  plantillaNombre: string;
  tipoTramiteId: number;
  tipoTramiteNombre: string;
  cementerioId: number;
  /** La carga histórica sigue abierta (`expedientes.carga_historica`). */
  cargaHistoricaAbierta: boolean;
  /** `historico` si el alta fue una carga histórica (transcripción de la ficha). */
  origen: "sistema" | "historico";
  areaActualId: number;
  pasoClave: string;
  enAreaDesde: Date;
}

export interface AreaMetricas {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  orden: number;
}

export interface EntradaCalculo {
  filtros: FiltrosMetricas;
  hoy: FechaISO;
  ahora: Date;
  expedientes: readonly ExpedienteMetricas[];
  recorridos: ReadonlyMap<string, Recorrido>;
  /** Los pasos de cada plantilla (por id), por clave. */
  pasos: ReadonlyMap<number, ReadonlyMap<string, PasoMetricas>>;
  areas: ReadonlyMap<number, AreaMetricas>;
  /** Conteos de toda la historia (con los filtros de trámite, plantilla y cementerio). */
  acumulados: { altasSistema: number; cargasHistoricas: number };
  papel: ParametrosPapel;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** Debajo de esto la pantalla avisa que la muestra es chica. */
export const MUESTRA_MINIMA = 10;

export interface FilaTiempos {
  clave: string;
  etiqueta: string;
  conSistema: Resumen;
  antes: Resumen;
}

export interface Ref {
  id: number;
  nombre: string;
}

export interface FilaPaso {
  /** `<paso>|<área>`. */
  clave: string;
  pasoClave: string;
  paso: string;
  orden: number;
  area: Ref & { externa: boolean };
  /** Estadías que salieron en el período. */
  tiempos: Resumen;
  /** Las que llegaron o pasaron los días de alerta del paso. */
  superaronAlerta: number;
  /** Los días de alerta (si todas las plantillas dicen lo mismo; si no, el menor). */
  diasAlerta: number | null;
  devoluciones: number;
  tasaDevolucion: number | null;
  /** Los que están hoy en ese paso y área. */
  hoy: number;
  /** Línea de base: las estadías de la ficha de papel. */
  antes: Resumen;
}

export interface FilaRecepcion {
  area: Ref;
  /** Días hábiles hasta "Confirmar recepción" (las confirmadas en el período). */
  confirmadas: Resumen;
  /** Las que se confirmaron al operar (recepción implícita) entre las estadías que salieron en el período. */
  implicitas: number;
  /** Las que están hoy sin confirmar. */
  sinConfirmarHoy: number;
}

export interface FilaCarga {
  area: Ref & { externa: boolean };
  hoy: number;
  /** La búsqueda que trae exactamente esos `hoy`, o null si no hay una equivalente. */
  busquedaHoy: FiltrosBusqueda | null;
  /** Promedio de expedientes presentes por día corrido del período. */
  promedioPeriodo: number;
  /** Hoy, con días hábiles en el área >= `dias_alerta` del paso (como el panel). */
  demoradosHoy: number;
  /** Estadías que salieron en el período. */
  tiempos: Resumen;
}

export interface FilaPeriodo {
  periodo: Periodo;
  ingresados: number;
  busquedaIngresados: FiltrosBusqueda | null;
  concluidos: number;
  archivados: number;
  anulados: number;
  /** En trámite al final del período (o ahora, si el período llega a hoy). */
  stockFinal: number;
}

export interface FilaRuta {
  origen: { area: Ref; paso: string };
  destino: { area: Ref | null; paso: string | null };
  cantidad: number;
}

export const MOTIVOS_DEVOLUCION = ["Falta firma", "Error en boleta", "Falta documentación", "Otros"] as const;
export type MotivoDevolucion = (typeof MOTIVOS_DEVOLUCION)[number];

export interface Metricas {
  hoy: FechaISO;
  filtros: FiltrosMetricas;
  resumen: {
    ingresados: number;
    /** La búsqueda que trae exactamente esos ingresados (por fecha de inicio), o null. */
    busquedaIngresados: FiltrosBusqueda | null;
    concluidos: number;
    puntaAPunta: { conSistema: Resumen; antes: Resumen };
    enTramiteHoy: number;
    busquedaEnTramiteHoy: FiltrosBusqueda | null;
    demoradosHoy: number;
    devoluciones: number;
    salidas: number;
    tasaDevolucion: number | null;
    /** El paso con mayor mediana (desempata el acumulado). */
    cuelloMediana: FilaPaso | null;
    /** El paso con más días hábiles acumulados. */
    cuelloAcumulado: FilaPaso | null;
    fichasReemplazadas: number;
  };
  puntaAPunta: { total: FilaTiempos; porTipo: FilaTiempos[]; porPlantilla: FilaTiempos[] };
  pasos: FilaPaso[];
  recepcion: FilaRecepcion[];
  flujo: FilaPeriodo[];
  devoluciones: {
    total: number;
    rutas: FilaRuta[];
    motivos: Array<{ motivo: MotivoDevolucion; cantidad: number; proporcion: number | null }>;
  };
  carga: FilaCarga[];
  dim: {
    /** Los pasos con plazo que se midieron (en las plantillas de la semilla, la DIM). */
    pasos: string[];
    total: number;
    enTermino: number;
    cumplidoVencido: number;
    vencidoSinCumplir: number;
    salioAntesDeVencer: number;
    enCurso: number;
    sinNotificacion: number;
    /** Días hábiles desde la notificación hasta que el papel volvió de la DIM. */
    demora: Resumen;
  };
  lineaBase: {
    puntaAPunta: FilaTiempos;
    pasos: Array<{ clave: string; paso: string; area: Ref; conSistema: Resumen; antes: Resumen }>;
    expedientes: number;
    minimo: number;
    muestraChica: boolean;
  };
  papel: {
    fichasReemplazadas: number;
    anotaciones: number;
    hojasEstimadas: number;
    acumuladoSistema: number;
    cargasHistoricas: number;
    parametros: ParametrosPapel;
  };
}

// ---------------------------------------------------------------------------
// Motivos
// ---------------------------------------------------------------------------

/**
 * Agrupa un motivo de devolución por los atajos del diálogo ("Falta firma",
 * "Error en boleta", "Falta documentación": `ATAJOS_DEVOLUCION`, que los pone
 * al comienzo). Sin acentos ni mayúsculas; lo demás es "Otros".
 */
export function grupoDeMotivo(motivo: string | null): MotivoDevolucion {
  const m = normalizar(motivo ?? "");
  for (const grupo of MOTIVOS_DEVOLUCION) {
    if (grupo !== "Otros" && m.startsWith(normalizar(grupo))) return grupo;
  }
  return "Otros";
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

const ACTIVOS = new Set(["en_tramite", "espera_pago_dim"]);
const MS_DIA = 24 * 60 * 60 * 1000;

function finDelDia(fecha: FechaISO): Date {
  return new Date(inicioDelDiaEnTucuman(sumarDias(fecha, 1)).getTime() - 1);
}

/**
 * Las métricas. Ver el comentario del módulo y docs/api-dominio.md, sección 20.
 */
export function calcularMetricas(e: EntradaCalculo, cal: Calendario): Metricas {
  const { filtros, hoy, ahora } = e;
  const dia = (d: Date) => diaEnTucuman(d);
  const enPeriodo = (d: Date | FechaISO) => {
    const x = typeof d === "string" ? d : dia(d);
    return x >= filtros.desde && x <= filtros.hasta;
  };
  const dias = (desde: Date | FechaISO, hasta: Date | FechaISO) =>
    cal.diasHabiles(typeof desde === "string" ? desde : dia(desde), typeof hasta === "string" ? hasta : dia(hasta));

  const medibles = e.expedientes.filter((x) => !x.cargaHistoricaAbierta);
  const incluidos = medibles.filter((x) => filtros.historicos === "incluir" || x.origen === "sistema");
  const historicos = e.expedientes.filter((x) => x.origen === "historico");
  const recorrido = (x: ExpedienteMetricas): Recorrido => e.recorridos.get(x.id) ?? { estadias: [], eventos: [], enTramite: [], anotaciones: 0 };
  const pasosDe = (x: ExpedienteMetricas) => e.pasos.get(x.plantillaId) ?? new Map<string, PasoMetricas>();
  const area = (id: number): AreaMetricas => e.areas.get(id) ?? { id, codigo: String(id), nombre: `Área ${id}`, tipo: "interna", orden: 999 };
  const ref = (id: number): Ref => ({ id, nombre: area(id).nombre });

  const filtrosBusqueda: FiltrosBusqueda = {
    ...(filtros.tipoTramiteId !== undefined ? { tipoTramiteId: filtros.tipoTramiteId } : {}),
    ...(filtros.plantillaCodigo !== undefined ? { plantillaCodigo: filtros.plantillaCodigo } : {}),
    ...(filtros.cementerioId !== undefined ? { cementerioId: filtros.cementerioId } : {}),
  };

  // --- Estadías -----------------------------------------------------------------
  interface EstadiaCon {
    estadia: Estadia;
    exp: ExpedienteMetricas;
    paso: PasoMetricas | undefined;
  }
  const conPaso = (x: ExpedienteMetricas) => recorrido(x).estadias.map((s): EstadiaCon => ({ estadia: s, exp: x, paso: pasosDe(x).get(s.pasoClave) }));
  const todasIncluidas = incluidos.flatMap(conPaso);
  // Las del período "con el sistema": salieron en el período (y, si se excluye la carga histórica, todas son de sistema).
  const delPeriodo = todasIncluidas.filter((s) => s.estadia.salida !== null && enPeriodo(s.estadia.salida));
  const dePapel = historicos.flatMap(conPaso).filter((s) => s.estadia.origen === "papel" && s.estadia.salida !== null);
  const duracion = (s: EstadiaCon) => dias(s.estadia.llegada, s.estadia.salida ?? ahora);

  // --- Por paso y área --------------------------------------------------------
  const clavePaso = (s: EstadiaCon) => `${s.estadia.pasoClave}|${s.estadia.areaId}`;
  const idsIncluidos = new Set(incluidos.map((x) => x.id));
  const abiertasHoy = medibles.filter((x) => ACTIVOS.has(x.estado) && idsIncluidos.has(x.id));
  const clavesPaso = new Map<string, { pasoClave: string; paso: string; orden: number; areaId: number; alertas: Set<number> }>();
  const registrarClave = (s: EstadiaCon) => {
    const k = clavePaso(s);
    const previa = clavesPaso.get(k);
    const alerta = s.paso?.diasAlerta ?? null;
    if (previa) {
      previa.orden = Math.min(previa.orden, s.estadia.pasoOrden || previa.orden);
      if (alerta !== null) previa.alertas.add(alerta);
    } else {
      clavesPaso.set(k, {
        pasoClave: s.estadia.pasoClave,
        paso: s.paso?.nombre ?? s.estadia.pasoClave,
        orden: s.estadia.pasoOrden || 99,
        areaId: s.estadia.areaId,
        alertas: new Set(alerta !== null ? [alerta] : []),
      });
    }
  };
  delPeriodo.forEach(registrarClave);
  const abiertasEstadias = todasIncluidas.filter((s) => s.estadia.salida === null && ACTIVOS.has(s.exp.estado));
  abiertasEstadias.forEach(registrarClave);

  const porClave = agruparPor(delPeriodo, clavePaso);
  const papelPorClave = agruparPor(dePapel, clavePaso);
  const abiertasPorClave = agruparPor(abiertasEstadias, clavePaso);
  const ordenArea = (id: number) => area(id).orden;
  const pasos: FilaPaso[] = [...clavesPaso.entries()]
    .map(([k, c]): FilaPaso => {
      const lista = porClave.get(k) ?? [];
      const duraciones = lista.map(duracion);
      const devoluciones = lista.filter((s) => s.estadia.salidaTipo === "devolucion").length;
      const superaron = lista.filter((s) => {
        const alerta = s.paso?.diasAlerta;
        return alerta !== null && alerta !== undefined && duracion(s) >= alerta;
      }).length;
      return {
        clave: k,
        pasoClave: c.pasoClave,
        paso: c.paso,
        orden: c.orden,
        area: { ...ref(c.areaId), externa: area(c.areaId).tipo === "externa" },
        tiempos: resumir(duraciones),
        superaronAlerta: superaron,
        diasAlerta: c.alertas.size > 0 ? Math.min(...c.alertas) : null,
        devoluciones,
        tasaDevolucion: tasa(devoluciones, lista.length),
        hoy: (abiertasPorClave.get(k) ?? []).length,
        antes: resumir((papelPorClave.get(k) ?? []).map(duracion)),
      };
    })
    .sort((a, b) => a.orden - b.orden || ordenArea(a.area.id) - ordenArea(b.area.id) || a.paso.localeCompare(b.paso, "es"));

  const conCasos = pasos.filter((p) => p.tiempos.n > 0);
  const cuelloMediana =
    conCasos.length === 0
      ? null
      : conCasos.reduce((m, p) => ((p.tiempos.mediana ?? 0) > (m.tiempos.mediana ?? 0) || ((p.tiempos.mediana ?? 0) === (m.tiempos.mediana ?? 0) && p.tiempos.total > m.tiempos.total) ? p : m));
  const cuelloAcumulado = conCasos.length === 0 ? null : conCasos.reduce((m, p) => (p.tiempos.total > m.tiempos.total ? p : m));

  // --- Punta a punta ----------------------------------------------------------
  interface Conclusion {
    exp: ExpedienteMetricas;
    dias: number;
  }
  const conclusionesSistema: Conclusion[] = incluidos.flatMap((x) =>
    recorrido(x)
      .eventos.filter((ev) => ev.tipo === "concluido" && enPeriodo(ev.fecha))
      .map((ev) => ({ exp: x, dias: dias(x.fechaInicio, ev.fecha) })),
  );
  const conclusionesAntes: Conclusion[] = historicos.flatMap((x) =>
    recorrido(x)
      .eventos.filter((ev) => ev.tipo === "concluido" && ev.transcripto)
      .map((ev) => ({ exp: x, dias: dias(x.fechaInicio, ev.fecha) })),
  );
  const filasTiempos = (clave: (c: Conclusion) => string, etiqueta: (c: Conclusion) => string): FilaTiempos[] => {
    const sistema = agruparPor(conclusionesSistema, clave);
    const antes = agruparPor(conclusionesAntes, clave);
    const nombres = new Map<string, string>();
    for (const c of [...conclusionesSistema, ...conclusionesAntes]) if (!nombres.has(clave(c))) nombres.set(clave(c), etiqueta(c));
    return [...nombres.entries()]
      .map(([k, nombre]) => ({
        clave: k,
        etiqueta: nombre,
        conSistema: resumir((sistema.get(k) ?? []).map((c) => c.dias)),
        antes: resumir((antes.get(k) ?? []).map((c) => c.dias)),
      }))
      .sort((a, b) => b.conSistema.n - a.conSistema.n || a.etiqueta.localeCompare(b.etiqueta, "es"));
  };
  const totalPuntaAPunta: FilaTiempos = {
    clave: "total",
    etiqueta: "Todos los trámites",
    conSistema: resumir(conclusionesSistema.map((c) => c.dias)),
    antes: resumir(conclusionesAntes.map((c) => c.dias)),
  };

  // --- Recepción --------------------------------------------------------------
  const internas = todasIncluidas.filter((s) => area(s.estadia.areaId).tipo !== "externa" && s.estadia.origen !== "papel");
  const recepcionPorArea = agruparPor(internas, (s) => s.estadia.areaId);
  const recepcion: FilaRecepcion[] = [...recepcionPorArea.entries()]
    .map(([areaId, lista]) => {
      const confirmadas = lista.flatMap((s) => {
        const r = s.estadia.recepcion;
        return r?.tipo === "explicita" && enPeriodo(r.fecha) ? [dias(s.estadia.llegada, r.fecha)] : [];
      });
      return {
        area: ref(areaId),
        confirmadas: resumir(confirmadas),
        implicitas: lista.filter((s) => s.estadia.recepcion?.tipo === "implicita" && s.estadia.salida !== null && enPeriodo(s.estadia.salida)).length,
        sinConfirmarHoy: lista.filter((s) => s.estadia.salida === null && s.estadia.recepcion === null && ACTIVOS.has(s.exp.estado)).length,
      };
    })
    .filter((f) => f.confirmadas.n + f.implicitas + f.sinConfirmarHoy > 0)
    .sort((a, b) => ordenArea(a.area.id) - ordenArea(b.area.id));

  // --- Carga por área -----------------------------------------------------------
  const inicioPeriodo = inicioDelDiaEnTucuman(filtros.desde).getTime();
  const finPeriodo = Math.min(finDelDia(filtros.hasta).getTime(), ahora.getTime());
  const largoPeriodo = Math.max(finPeriodo - inicioPeriodo, MS_DIA);
  const presencia = new Map<number, number>();
  for (const s of todasIncluidas) {
    const desde = Math.max(s.estadia.llegada.getTime(), inicioPeriodo);
    const hasta = Math.min((s.estadia.salida ?? ahora).getTime(), finPeriodo);
    if (hasta > desde) presencia.set(s.estadia.areaId, (presencia.get(s.estadia.areaId) ?? 0) + (hasta - desde));
  }
  const activosMedibles = medibles.filter((x) => ACTIVOS.has(x.estado));
  const hoyPorArea = agruparPor(abiertasHoy, (x) => x.areaActualId);
  const busquedaPorArea = agruparPor(activosMedibles, (x) => x.areaActualId);
  const tiemposPorArea = agruparPor(delPeriodo, (s) => s.estadia.areaId);
  const demorado = (x: ExpedienteMetricas) => {
    const alerta = pasosDe(x).get(x.pasoClave)?.diasAlerta;
    return alerta !== null && alerta !== undefined && dias(x.enAreaDesde, hoy) >= alerta;
  };
  const idsCarga = new Set<number>([...hoyPorArea.keys(), ...presencia.keys(), ...tiemposPorArea.keys()]);
  const carga: FilaCarga[] = [...idsCarga]
    .map((id): FilaCarga => {
      const hoyLista = hoyPorArea.get(id) ?? [];
      const equivalentes = busquedaPorArea.get(id) ?? [];
      return {
        area: { ...ref(id), externa: area(id).tipo === "externa" },
        hoy: hoyLista.length,
        busquedaHoy:
          hoyLista.length > 0 && equivalentes.length === hoyLista.length
            ? { ...filtrosBusqueda, areaActualId: id, estados: ["en_tramite", "espera_pago_dim"], cargaHistorica: false }
            : null,
        promedioPeriodo: unDecimal((presencia.get(id) ?? 0) / largoPeriodo),
        demoradosHoy: hoyLista.filter(demorado).length,
        tiempos: resumir((tiemposPorArea.get(id) ?? []).map(duracion)),
      };
    })
    .sort((a, b) => ordenArea(a.area.id) - ordenArea(b.area.id));

  // --- Flujo ----------------------------------------------------------------------
  const periodos = periodosEntre(filtros.desde, filtros.hasta, filtros.agrupar);
  const eventosIncluidos = incluidos.flatMap((x) => recorrido(x).eventos);
  const flujo: FilaPeriodo[] = periodos.map((p) => {
    const dentro = (d: Date | FechaISO) => {
      const x = typeof d === "string" ? d : dia(d);
      return x >= p.desde && x <= p.hasta;
    };
    const ingresados = incluidos.filter((x) => dentro(x.fechaInicio)).length;
    const equivalentes = medibles.filter((x) => dentro(x.fechaInicio)).length;
    const corte = Math.min(finDelDia(p.hasta).getTime(), ahora.getTime());
    const stock = incluidos.filter((x) =>
      recorrido(x).enTramite.some((i) => i.desde.getTime() <= corte && (i.hasta === null || i.hasta.getTime() > corte)),
    ).length;
    const contar = (tipo: string) => eventosIncluidos.filter((ev) => ev.tipo === tipo && dentro(ev.fecha)).length;
    return {
      periodo: p,
      ingresados,
      busquedaIngresados:
        ingresados > 0 && ingresados === equivalentes
          ? { ...filtrosBusqueda, fechaInicioDesde: p.desde, fechaInicioHasta: p.hasta, incluirAnulados: true, cargaHistorica: false }
          : null,
      concluidos: contar("concluido"),
      archivados: contar("archivado"),
      anulados: contar("anulado"),
      stockFinal: stock,
    };
  });

  // --- Devoluciones -------------------------------------------------------------
  const devueltas = delPeriodo.filter((s) => s.estadia.salidaTipo === "devolucion");
  const rutasMap = new Map<string, FilaRuta>();
  for (const s of devueltas) {
    const d = s.estadia.devolucion;
    const destinoPaso = d?.pasoDestino ? (pasosDe(s.exp).get(d.pasoDestino)?.nombre ?? d.pasoDestino) : null;
    const k = `${s.estadia.areaId}|${s.paso?.nombre ?? s.estadia.pasoClave}|${d?.areaDestinoId ?? ""}|${destinoPaso ?? ""}`;
    const previa = rutasMap.get(k);
    if (previa) previa.cantidad += 1;
    else {
      rutasMap.set(k, {
        origen: { area: ref(s.estadia.areaId), paso: s.paso?.nombre ?? s.estadia.pasoClave },
        destino: { area: d?.areaDestinoId != null ? ref(d.areaDestinoId) : null, paso: destinoPaso },
        cantidad: 1,
      });
    }
  }
  const motivos = MOTIVOS_DEVOLUCION.map((motivo) => {
    const cantidad = devueltas.filter((s) => grupoDeMotivo(s.estadia.devolucion?.motivo ?? null) === motivo).length;
    return { motivo, cantidad, proporcion: tasa(cantidad, devueltas.length) };
  });

  // --- Plazo DIM ------------------------------------------------------------------
  const conPlazo = todasIncluidas.filter(
    (s) => s.estadia.plazo !== null && ((s.estadia.salida !== null && enPeriodo(s.estadia.salida)) || (s.estadia.salida === null && ACTIVOS.has(s.exp.estado) && filtros.hasta >= hoy)),
  );
  const dim = {
    pasos: [...new Set(conPlazo.map((s) => s.paso?.nombre ?? s.estadia.pasoClave))],
    total: conPlazo.length,
    enTermino: 0,
    cumplidoVencido: 0,
    vencidoSinCumplir: 0,
    salioAntesDeVencer: 0,
    enCurso: 0,
    sinNotificacion: 0,
    demora: RESUMEN_VACIO,
  };
  const demoras: number[] = [];
  for (const s of conPlazo) {
    const p = s.estadia.plazo;
    if (!p) continue;
    if (p.desde === null) {
      dim.sinNotificacion += 1;
      continue;
    }
    const vence = cal.sumarHabiles(p.desde, p.diasHabiles);
    const salida = s.estadia.salida;
    if (salida !== null) demoras.push(dias(p.desde, salida));
    if (p.cumplidoEn !== null) {
      if (p.cumplidoEn <= vence) dim.enTermino += 1;
      else dim.cumplidoVencido += 1;
    } else if ((salida !== null ? dia(salida) : hoy) > vence) {
      dim.vencidoSinCumplir += 1;
    } else if (salida !== null) {
      dim.salioAntesDeVencer += 1;
    } else {
      dim.enCurso += 1;
    }
  }
  dim.demora = resumir(demoras);

  // --- Línea de base ---------------------------------------------------------------
  const claveLB = new Map<string, { paso: string; areaId: number; orden: number }>();
  for (const s of [...dePapel, ...delPeriodo]) {
    const k = clavePaso(s);
    if (!claveLB.has(k)) claveLB.set(k, { paso: s.paso?.nombre ?? s.estadia.pasoClave, areaId: s.estadia.areaId, orden: s.estadia.pasoOrden || 99 });
  }
  const lineaBasePasos = [...claveLB.entries()]
    .map(([k, c]) => ({
      clave: k,
      paso: c.paso,
      area: ref(c.areaId),
      orden: c.orden,
      conSistema: resumir((porClave.get(k) ?? []).map(duracion)),
      antes: resumir((papelPorClave.get(k) ?? []).map(duracion)),
    }))
    .filter((f) => f.antes.n > 0)
    .sort((a, b) => a.orden - b.orden || ordenArea(a.area.id) - ordenArea(b.area.id))
    .map((f) => ({ clave: f.clave, paso: f.paso, area: f.area, conSistema: f.conSistema, antes: f.antes }));

  // --- Papel -------------------------------------------------------------------------
  const altasDelPeriodo = medibles.filter((x) => x.origen === "sistema" && enPeriodo(x.fechaInicio));
  const anotaciones = altasDelPeriodo.reduce((s, x) => s + recorrido(x).anotaciones, 0);
  const hojas = altasDelPeriodo.reduce((s, x) => s + hojasDeFicha(recorrido(x).anotaciones, e.papel), 0);

  // --- Resumen ---------------------------------------------------------------------
  const enTramiteHoy = abiertasHoy.length;
  const ingresados = incluidos.filter((x) => enPeriodo(x.fechaInicio)).length;
  const ingresadosEquivalentes = medibles.filter((x) => enPeriodo(x.fechaInicio)).length;
  const salidas = delPeriodo.length;
  return {
    hoy,
    filtros,
    resumen: {
      ingresados,
      busquedaIngresados:
        ingresados > 0 && ingresados === ingresadosEquivalentes
          ? { ...filtrosBusqueda, fechaInicioDesde: filtros.desde, fechaInicioHasta: filtros.hasta, incluirAnulados: true, cargaHistorica: false }
          : null,
      concluidos: flujo.reduce((s, f) => s + f.concluidos, 0),
      puntaAPunta: { conSistema: totalPuntaAPunta.conSistema, antes: totalPuntaAPunta.antes },
      enTramiteHoy,
      busquedaEnTramiteHoy:
        enTramiteHoy > 0 && enTramiteHoy === activosMedibles.length
          ? { ...filtrosBusqueda, estados: ["en_tramite", "espera_pago_dim"], cargaHistorica: false }
          : null,
      demoradosHoy: abiertasHoy.filter(demorado).length,
      devoluciones: devueltas.length,
      salidas,
      tasaDevolucion: tasa(devueltas.length, salidas),
      cuelloMediana,
      cuelloAcumulado,
      fichasReemplazadas: altasDelPeriodo.length,
    },
    puntaAPunta: {
      total: totalPuntaAPunta,
      porTipo: filasTiempos(
        (c) => String(c.exp.tipoTramiteId),
        (c) => c.exp.tipoTramiteNombre,
      ),
      porPlantilla: filasTiempos(
        (c) => c.exp.plantillaCodigo,
        (c) => c.exp.plantillaNombre,
      ),
    },
    pasos,
    recepcion,
    flujo,
    devoluciones: { total: devueltas.length, rutas: [...rutasMap.values()].sort((a, b) => b.cantidad - a.cantidad), motivos },
    carga,
    dim,
    lineaBase: {
      puntaAPunta: totalPuntaAPunta,
      pasos: lineaBasePasos,
      expedientes: historicos.length,
      minimo: MUESTRA_MINIMA,
      muestraChica: totalPuntaAPunta.antes.n < MUESTRA_MINIMA || lineaBasePasos.some((p) => p.antes.n < MUESTRA_MINIMA) || lineaBasePasos.length === 0,
    },
    papel: {
      fichasReemplazadas: altasDelPeriodo.length,
      anotaciones,
      hojasEstimadas: hojas,
      acumuladoSistema: e.acumulados.altasSistema,
      cargasHistoricas: e.acumulados.cargasHistoricas,
      parametros: e.papel,
    },
  };
}

/**
 * Un calendario que anota lo que se le pide y responde cualquier cosa: la
 * primera pasada del cálculo junta los pares que hay que mandar a la base de
 * una sola vez (los pedidos no dependen de las respuestas).
 */
export function calendarioQueAnota(): Calendario & { pares: Map<string, [FechaISO, FechaISO]>; sumas: Map<string, [FechaISO, number]> } {
  const pares = new Map<string, [FechaISO, FechaISO]>();
  const sumas = new Map<string, [FechaISO, number]>();
  return {
    pares,
    sumas,
    diasHabiles(desde, hasta) {
      pares.set(`${desde}|${hasta}`, [desde, hasta]);
      return 0;
    },
    sumarHabiles(desde, n) {
      sumas.set(`${desde}|${n}`, [desde, n]);
      return desde;
    },
  };
}

/** Un calendario con las respuestas ya calculadas (las de la base). */
export function calendarioDe(dias: ReadonlyMap<string, number>, sumas: ReadonlyMap<string, FechaISO>): Calendario {
  return {
    diasHabiles(desde, hasta) {
      const r = dias.get(`${desde}|${hasta}`);
      if (r === undefined) throw new Error(`Falta el cálculo de días hábiles de ${desde} a ${hasta}`);
      return r;
    },
    sumarHabiles(desde, n) {
      const r = sumas.get(`${desde}|${n}`);
      if (r === undefined) throw new Error(`Falta el cálculo de ${n} días hábiles desde ${desde}`);
      return r;
    },
  };
}
