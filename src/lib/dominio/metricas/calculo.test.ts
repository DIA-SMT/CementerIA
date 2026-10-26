import { describe, expect, it } from "vitest";
import { sumarDias, type FechaISO } from "@/lib/fechas";
import { calcularMetricas, calendarioQueAnota, type AreaMetricas, type Calendario, type EntradaCalculo, type ExpedienteMetricas } from "./calculo";
import type { FiltrosMetricas } from "./periodos";
import { recorrer, type MovimientoMetricas, type PasoMetricas } from "./recorrido";

// ---------------------------------------------------------------------------
// Datos de prueba: fechas conocidas (marzo y abril de 2026; la línea de base
// en 2025) y un calendario de lunes a viernes, sin feriados. Los días hábiles
// esperados están contados a mano en cada comentario.
// ---------------------------------------------------------------------------

/** f_dias_habiles_entre sin feriados: días de lunes a viernes en (desde, hasta]. */
const semana: Calendario = {
  diasHabiles(desde, hasta) {
    const signo = hasta >= desde ? 1 : -1;
    const [a, b] = hasta >= desde ? [desde, hasta] : [hasta, desde];
    let n = 0;
    for (let d = sumarDias(a, 1); d <= b; d = sumarDias(d, 1)) {
      const dia = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dia !== 0 && dia !== 6) n += 1;
    }
    return signo * n;
  },
  sumarHabiles(desde, n) {
    let d = desde;
    let contados = 0;
    while (contados < n) {
      d = sumarDias(d, 1);
      const dia = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dia !== 0 && dia !== 6) contados += 1;
    }
    return d;
  },
};

const MESA = 1;
const COMP = 2;
const DIM = 3;
const FIN = 4;
const AREAS = new Map<number, AreaMetricas>([
  [MESA, { id: MESA, codigo: "MESA", nombre: "Mesa de Entradas", tipo: "interna", orden: 1 }],
  [COMP, { id: COMP, codigo: "COMP", nombre: "Cómputo", tipo: "interna", orden: 2 }],
  [DIM, { id: DIM, codigo: "DIM", nombre: "DIM", tipo: "externa", orden: 3 }],
  [FIN, { id: FIN, codigo: "ADM", nombre: "Administrativo", tipo: "interna", orden: 4 }],
]);
const EXTERNAS = new Set([DIM]);

const PASOS = new Map<string, PasoMetricas>([
  ["MESA", { clave: "MESA", nombre: "Mesa de Entradas", orden: 1, diasAlerta: 2, plazo: null }],
  ["COMP", { clave: "COMP", nombre: "Cómputo", orden: 2, diasAlerta: 5, plazo: null }],
  ["DIM", { clave: "DIM", nombre: "Pago en la DIM", orden: 3, diasAlerta: 60, plazo: { diasHabiles: 30, desdeSubtarea: "TRIB_NOT", hastaSubtarea: "DIM_PLAN" } }],
  ["FIN", { clave: "FIN", nombre: "Título", orden: 4, diasAlerta: 15, plazo: null }],
]);
const PLANTILLA = 7;

const AREA_DE_PASO: Record<string, number> = { MESA, COMP, DIM, FIN };

let siguienteId = BigInt(1);

/** Un movimiento con todo lo que la reconstrucción lee. `fecha`: "2026-03-02" (10 h de Tucumán). */
function mov(expedienteId: string, tipo: string, fecha: string, extra: Partial<MovimientoMetricas> = {}): MovimientoMetricas {
  const id = siguienteId;
  siguienteId += BigInt(1);
  return {
    id,
    expedienteId,
    secuencia: Number(id),
    tipo,
    fechaEfectiva: new Date(`${fecha}T10:00:00-03:00`),
    precisionFecha: "minuto",
    usuarioId: 10,
    areaUsuarioId: MESA,
    pasoOrigen: null,
    pasoDestino: null,
    areaOrigenId: null,
    areaDestinoId: null,
    estadoAnterior: null,
    estadoNuevo: null,
    observacion: null,
    motivo: null,
    datos: {},
    corrigeMovimientoId: null,
    cargaHistorica: false,
    comandoId: `c-${id}`,
    registradoEn: new Date(`${fecha}T10:00:00-03:00`),
    ...extra,
  };
}
const alta = (e: string, fecha: string, extra: Partial<MovimientoMetricas> = {}) =>
  mov(e, "alta", fecha, { pasoDestino: "MESA", areaDestinoId: MESA, estadoNuevo: "en_tramite", ...extra });
const pase = (e: string, fecha: string, de: string, a: string, extra: Partial<MovimientoMetricas> = {}) =>
  mov(e, "pase", fecha, { pasoOrigen: de, pasoDestino: a, areaOrigenId: AREA_DE_PASO[de], areaDestinoId: AREA_DE_PASO[a], areaUsuarioId: AREA_DE_PASO[de] === DIM ? COMP : AREA_DE_PASO[de], ...extra });

function expediente(id: string, fechaInicio: FechaISO, cambios: Partial<ExpedienteMetricas> = {}): ExpedienteMetricas {
  return {
    id,
    numero: `CEM-2026-0000${id}`,
    fechaInicio,
    estado: "en_tramite",
    plantillaId: PLANTILLA,
    plantillaCodigo: "RENOV_PRUEBA",
    plantillaNombre: "Renovación de prueba",
    tipoTramiteId: 1,
    tipoTramiteNombre: "Renovación",
    cementerioId: 1,
    cargaHistoricaAbierta: false,
    origen: "sistema",
    areaActualId: MESA,
    pasoClave: "MESA",
    enAreaDesde: new Date(`${fechaInicio}T10:00:00-03:00`),
    ...cambios,
  };
}

// 1: el circuito entero en el sistema, con una devolución y el plazo DIM cumplido.
const MOV_1 = [
  alta("1", "2026-03-02"),
  pase("1", "2026-03-04", "MESA", "COMP"),
  mov("1", "recepcion", "2026-03-05", { areaUsuarioId: COMP, pasoDestino: "COMP", areaDestinoId: COMP, datos: { implicita: false } }),
  mov("1", "devolucion", "2026-03-09", {
    pasoOrigen: "COMP",
    pasoDestino: "MESA",
    areaOrigenId: COMP,
    areaDestinoId: MESA,
    areaUsuarioId: COMP,
    motivo: "Falta firma: del titular en la solicitud",
    datos: { subtareas_reiniciadas: [] },
  }),
  mov("1", "recepcion", "2026-03-09", { pasoDestino: "MESA", areaDestinoId: MESA, datos: { implicita: true } }),
  pase("1", "2026-03-10", "MESA", "COMP"),
  mov("1", "subtarea", "2026-03-11", { areaUsuarioId: COMP, datos: { subtarea: "TRIB_NOT", hecha: true, dato: "2026-03-11", paso: "COMP" } }),
  pase("1", "2026-03-12", "COMP", "DIM"),
  mov("1", "subtarea", "2026-04-01", { areaUsuarioId: COMP, datos: { subtarea: "DIM_PLAN", hecha: true, dato: "2026-04-01", paso: "DIM" } }),
  pase("1", "2026-04-06", "DIM", "FIN"),
  mov("1", "estado", "2026-04-08", { areaUsuarioId: FIN, estadoAnterior: "en_tramite", estadoNuevo: "concluido" }),
  mov("1", "estado", "2026-04-09", { areaUsuarioId: FIN, estadoAnterior: "concluido", estadoNuevo: "archivado", datos: { ubicacion_archivo: "Caja 1" } }),
];
// 2: en Cómputo desde el 18/3, recepción confirmada el 20/3 (sigue ahí: demorado).
const MOV_2 = [
  alta("2", "2026-03-16"),
  pase("2", "2026-03-18", "MESA", "COMP"),
  mov("2", "recepcion", "2026-03-20", { areaUsuarioId: COMP, pasoDestino: "COMP", areaDestinoId: COMP, datos: { implicita: false } }),
];
// 3: carga histórica terminada, todo transcripto de la ficha (2025).
const hist = { cargaHistorica: true };
const MOV_3 = [
  alta("3", "2025-05-05", hist),
  pase("3", "2025-05-12", "MESA", "COMP", hist),
  pase("3", "2025-05-26", "COMP", "DIM", hist),
  pase("3", "2025-07-07", "DIM", "FIN", hist),
  mov("3", "estado", "2025-07-09", { ...hist, estadoAnterior: "en_tramite", estadoNuevo: "concluido" }),
];
// 4: carga histórica abierta: no se mide.
const MOV_4 = [alta("4", "2026-03-23", hist)];
// 5: anulado al día siguiente.
const MOV_5 = [alta("5", "2026-04-01"), mov("5", "estado", "2026-04-02", { estadoAnterior: "en_tramite", estadoNuevo: "anulado", motivo: "Alta duplicada por error" })];
// 6: iniciado antes del sistema en marzo (carga terminada), transcripto hasta Cómputo; sigue en Cómputo.
const MOV_6 = [alta("6", "2026-03-20", hist), pase("6", "2026-03-25", "MESA", "COMP", hist)];

const EXPEDIENTES: ExpedienteMetricas[] = [
  expediente("1", "2026-03-02", { estado: "archivado", areaActualId: FIN, pasoClave: "FIN" }),
  expediente("2", "2026-03-16", { areaActualId: COMP, pasoClave: "COMP", enAreaDesde: new Date("2026-03-18T10:00:00-03:00") }),
  expediente("3", "2025-05-05", { estado: "concluido", origen: "historico", areaActualId: FIN, pasoClave: "FIN" }),
  expediente("4", "2026-03-23", { origen: "historico", cargaHistoricaAbierta: true }),
  expediente("5", "2026-04-01", { estado: "anulado" }),
  expediente("6", "2026-03-20", { origen: "historico", areaActualId: COMP, pasoClave: "COMP", enAreaDesde: new Date("2026-03-25T10:00:00-03:00") }),
];
const MOVIMIENTOS: Record<string, MovimientoMetricas[]> = { "1": MOV_1, "2": MOV_2, "3": MOV_3, "4": MOV_4, "5": MOV_5, "6": MOV_6 };

function entrada(cambios: Partial<FiltrosMetricas> = {}): EntradaCalculo {
  const recorridos = new Map(EXPEDIENTES.map((x) => [x.id, recorrer(MOVIMIENTOS[x.id], PASOS, EXTERNAS)]));
  return {
    filtros: { desde: "2026-03-01", hasta: "2026-04-30", historicos: "excluir", agrupar: "mes", ...cambios },
    hoy: "2026-04-30",
    ahora: new Date("2026-04-30T15:00:00-03:00"),
    expedientes: EXPEDIENTES,
    recorridos,
    pasos: new Map([[PLANTILLA, PASOS]]),
    areas: AREAS,
    acumulados: { altasSistema: 40, cargasHistoricas: 3 },
    papel: { anotacionesPorHoja: 12 },
  };
}

// ---------------------------------------------------------------------------

describe("recorrido de un expediente", () => {
  it("arma las estadías con su llegada, salida, recepción y plazo", () => {
    const r = recorrer(MOV_1, PASOS, EXTERNAS);
    expect(
      r.estadias.map((s) => [s.pasoClave, s.areaId, s.llegada.toISOString().slice(0, 10), s.salida?.toISOString().slice(0, 10), s.salidaTipo, s.recepcion?.tipo ?? null, s.origen]),
    ).toEqual([
      ["MESA", MESA, "2026-03-02", "2026-03-04", "pase", "al_llegar", "sistema"],
      ["COMP", COMP, "2026-03-04", "2026-03-09", "devolucion", "explicita", "sistema"],
      ["MESA", MESA, "2026-03-09", "2026-03-10", "pase", "implicita", "sistema"],
      ["COMP", COMP, "2026-03-10", "2026-03-12", "pase", null, "sistema"],
      ["DIM", DIM, "2026-03-12", "2026-04-06", "pase", "al_llegar", "sistema"],
      ["FIN", FIN, "2026-04-06", "2026-04-08", "concluido", null, "sistema"],
    ]);
    expect(r.estadias[1].devolucion).toEqual({ areaDestinoId: MESA, pasoDestino: "MESA", motivo: "Falta firma: del titular en la solicitud" });
    expect(r.estadias[4].plazo).toEqual({ diasHabiles: 30, desde: "2026-03-11", cumplidoEn: "2026-04-01" });
    expect(r.estadias[0].plazo).toBeNull();
    expect(r.eventos.map((e) => [e.tipo, e.fecha.toISOString().slice(0, 10)])).toEqual([
      ["concluido", "2026-04-08"],
      ["archivado", "2026-04-09"],
    ]);
    expect(r.enTramite).toEqual([{ desde: new Date("2026-03-02T10:00:00-03:00"), hasta: new Date("2026-04-08T10:00:00-03:00") }]);
    // Alta, 5 pases o devoluciones y 2 cambios de estado.
    expect(r.anotaciones).toBe(8);
  });

  it("usa los movimientos como cuentan hoy: sin los revertidos y con la fecha corregida", () => {
    const a = alta("9", "2026-03-02");
    const p1 = pase("9", "2026-03-06", "MESA", "COMP");
    const corregida = mov("9", "correccion", "2026-03-06", {
      corrigeMovimientoId: p1.id,
      motivo: "Fecha mal cargada en el pase",
      datos: { fecha_efectiva: [p1.fechaEfectiva.toISOString(), "2026-03-04T13:00:00.000Z"], precision: ["minuto", "minuto"] },
    });
    const p2 = pase("9", "2026-03-09", "COMP", "DIM");
    const revertido = mov("9", "correccion", "2026-03-09", { corrigeMovimientoId: p2.id, motivo: "Pase dado por error", datos: { revertir: true, arrastra: [] } });
    const r = recorrer([revertido, p2, corregida, p1, a], PASOS, EXTERNAS);
    expect(r.estadias.map((s) => [s.pasoClave, s.llegada.toISOString(), s.salida?.toISOString() ?? null])).toEqual([
      ["MESA", "2026-03-02T13:00:00.000Z", "2026-03-04T13:00:00.000Z"],
      ["COMP", "2026-03-04T13:00:00.000Z", null],
    ]);
    expect(r.anotaciones).toBe(2);
  });

  it("transcripción: estadías de papel y, si la carga sigue con el sistema, mixtas", () => {
    expect(recorrer(MOV_3, PASOS, EXTERNAS).estadias.map((s) => s.origen)).toEqual(["papel", "papel", "papel", "papel"]);
    const seis = recorrer(MOV_6, PASOS, EXTERNAS).estadias;
    expect(seis.map((s) => [s.origen, s.recepcion?.tipo])).toEqual([
      ["papel", "al_llegar"],
      ["mixta", "al_llegar"],
    ]);
  });

  it("una devolución reinicia lo que manda rehacer, y el plazo lo sigue", () => {
    const ms = [
      alta("8", "2026-03-02"),
      pase("8", "2026-03-03", "MESA", "COMP"),
      mov("8", "subtarea", "2026-03-04", { datos: { subtarea: "TRIB_NOT", hecha: true, dato: "2026-03-04" } }),
      pase("8", "2026-03-05", "COMP", "DIM"),
      mov("8", "devolucion", "2026-03-10", { pasoDestino: "COMP", areaDestinoId: COMP, areaUsuarioId: COMP, motivo: "Error en boleta del período", datos: { subtareas_reiniciadas: ["TRIB_NOT"] } }),
      pase("8", "2026-03-12", "COMP", "DIM"),
    ];
    const r = recorrer(ms, PASOS, EXTERNAS);
    expect(r.estadias[2].plazo).toEqual({ diasHabiles: 30, desde: "2026-03-04", cumplidoEn: null });
    // Volvió a la DIM sin notificación nueva: el plazo no tiene inicio.
    expect(r.estadias[4].plazo).toEqual({ diasHabiles: 30, desde: null, cumplidoEn: null });
  });
});

describe("calcularMetricas", () => {
  const m = calcularMetricas(entrada(), semana);

  it("punta a punta: de la fecha de inicio a la conclusión, con la línea de base aparte", () => {
    // (2/3, 8/4]: 21 días hábiles de marzo + 6 de abril.
    expect(m.puntaAPunta.total.conSistema).toMatchObject({ n: 1, mediana: 27, p90: 27 });
    // (5/5/2025, 9/7/2025]: 47.
    expect(m.puntaAPunta.total.antes).toMatchObject({ n: 1, mediana: 47 });
    expect(m.puntaAPunta.porTipo).toEqual([expect.objectContaining({ etiqueta: "Renovación", conSistema: expect.objectContaining({ n: 1 }) })]);
    expect(m.puntaAPunta.porPlantilla[0].clave).toBe("RENOV_PRUEBA");
  });

  it("por paso y área: mediana, p90, acumulado, cuello de botella y devoluciones", () => {
    const fila = (clave: string) => m.pasos.find((p) => p.clave === clave);
    // Mesa: 2 (exp. 1), 1 (exp. 1, después de la devolución) y 2 (exp. 2); y el anulado salió el mismo día siguiente: 1.
    expect(fila(`MESA|${MESA}`)?.tiempos).toMatchObject({ n: 4, mediana: 1.5, p90: 2, total: 6 });
    // Cómputo: 3 (con la devolución) y 2.
    expect(fila(`COMP|${COMP}`)).toMatchObject({ tiempos: { n: 2, mediana: 2.5, total: 5 }, devoluciones: 1, tasaDevolucion: 0.5, hoy: 1 });
    // DIM: (12/3, 6/4] = 17.
    expect(fila(`DIM|${DIM}`)?.tiempos.mediana).toBe(17);
    expect(fila(`DIM|${DIM}`)?.area.externa).toBe(true);
    expect(m.resumen.cuelloMediana?.clave).toBe(`DIM|${DIM}`);
    expect(m.resumen.cuelloAcumulado?.clave).toBe(`DIM|${DIM}`);
    // La línea de base del paso: Mesa 5 (2025) y 3 (exp. 6, transcripto en marzo).
    expect(fila(`MESA|${MESA}`)?.antes).toMatchObject({ n: 2, mediana: 4 });
    expect(m.pasos.map((p) => p.pasoClave)).toEqual(["MESA", "COMP", "DIM", "FIN"]);
  });

  it("recepción: solo las confirmaciones explícitas tienen tiempo", () => {
    expect(m.recepcion).toEqual([
      { area: { id: MESA, nombre: "Mesa de Entradas" }, confirmadas: expect.objectContaining({ n: 0 }), implicitas: 1, sinConfirmarHoy: 0 },
      // (4/3, 5/3] = 1 y (18/3, 20/3] = 2.
      { area: { id: COMP, nombre: "Cómputo" }, confirmadas: expect.objectContaining({ n: 2, mediana: 1.5 }), implicitas: 0, sinConfirmarHoy: 0 },
    ]);
  });

  it("flujo por mes y stock al cierre", () => {
    expect(m.flujo.map((f) => [f.periodo.clave, f.ingresados, f.concluidos, f.archivados, f.anulados, f.stockFinal])).toEqual([
      ["2026-03", 2, 0, 0, 0, 2],
      ["2026-04", 1, 1, 1, 1, 1],
    ]);
    expect(m.resumen).toMatchObject({ ingresados: 3, concluidos: 1, enTramiteHoy: 1, demoradosHoy: 1, devoluciones: 1, salidas: 8, tasaDevolucion: 0.125 });
  });

  it("un número se enlaza a la búsqueda solo si la búsqueda trae exactamente eso", () => {
    // Marzo: la búsqueda por fecha de inicio traería también el 6 (iniciado antes del sistema).
    expect(m.flujo[0].busquedaIngresados).toBeNull();
    expect(m.flujo[1].busquedaIngresados).toEqual({ fechaInicioDesde: "2026-04-01", fechaInicioHasta: "2026-04-30", incluirAnulados: true, cargaHistorica: false });
    // Cómputo hoy: el 2 (y el 6, que no se cuenta).
    expect(m.carga.find((c) => c.area.id === COMP)).toMatchObject({ hoy: 1, busquedaHoy: null, demoradosHoy: 1 });
    expect(m.resumen.busquedaEnTramiteHoy).toBeNull();

    const conHistoricos = calcularMetricas(entrada({ historicos: "incluir", tipoTramiteId: 1 }), semana);
    expect(conHistoricos.flujo[0]).toMatchObject({ ingresados: 3, busquedaIngresados: { tipoTramiteId: 1, fechaInicioDesde: "2026-03-01", fechaInicioHasta: "2026-03-31" } });
    expect(conHistoricos.carga.find((c) => c.area.id === COMP)).toMatchObject({
      hoy: 2,
      busquedaHoy: { tipoTramiteId: 1, areaActualId: COMP, estados: ["en_tramite", "espera_pago_dim"], cargaHistorica: false },
    });
    expect(conHistoricos.resumen.busquedaEnTramiteHoy).toEqual({ tipoTramiteId: 1, estados: ["en_tramite", "espera_pago_dim"], cargaHistorica: false });
  });

  it("devoluciones: de qué área a qué área y motivos agrupados", () => {
    expect(m.devoluciones.rutas).toEqual([
      { origen: { area: { id: COMP, nombre: "Cómputo" }, paso: "Cómputo" }, destino: { area: { id: MESA, nombre: "Mesa de Entradas" }, paso: "Mesa de Entradas" }, cantidad: 1 },
    ]);
    expect(m.devoluciones.motivos).toEqual([
      { motivo: "Falta firma", cantidad: 1, proporcion: 1 },
      { motivo: "Error en boleta", cantidad: 0, proporcion: 0 },
      { motivo: "Falta documentación", cantidad: 0, proporcion: 0 },
      { motivo: "Otros", cantidad: 0, proporcion: 0 },
    ]);
  });

  it("plazo DIM: vence a los 30 días hábiles de la notificación", () => {
    // Notificado el 11/3: vence el 22/4; plan iniciado el 1/4 → en término. Volvió el 6/4: 18 días hábiles.
    expect(m.dim).toMatchObject({ pasos: ["Pago en la DIM"], total: 1, enTermino: 1, cumplidoVencido: 0, vencidoSinCumplir: 0, demora: { n: 1, mediana: 18 } });
  });

  it("carga por área: hoy, promedio por día corrido y demorados", () => {
    const comp = m.carga.find((c) => c.area.id === COMP);
    // El 2 estuvo en Cómputo del 18/3 a hoy y el 1, unos días: más de 0,5 en promedio en dos meses.
    expect(comp?.promedioPeriodo).toBeGreaterThan(0.5);
    expect(comp?.promedioPeriodo).toBeLessThan(1);
    expect(m.carga.find((c) => c.area.id === DIM)).toMatchObject({ hoy: 0, demoradosHoy: 0 });
  });

  it("línea de base y muestra chica", () => {
    expect(m.lineaBase).toMatchObject({ expedientes: 3, minimo: 10, muestraChica: true });
    expect(m.lineaBase.pasos.map((p) => [p.paso, p.antes.n, p.antes.mediana, p.conSistema.mediana])).toEqual([
      ["Mesa de Entradas", 2, 4, 1.5],
      ["Cómputo", 1, 10, 2.5],
      ["Pago en la DIM", 1, 30, 17],
      ["Título", 1, 2, 2],
    ]);
  });

  it("papel: fichas reemplazadas (altas en el sistema del período) y hojas estimadas", () => {
    expect(m.papel).toEqual({
      fichasReemplazadas: 3,
      anotaciones: 12, // 8 + 2 + 2
      hojasEstimadas: 3,
      acumuladoSistema: 40,
      cargasHistoricas: 3,
      parametros: { anotacionesPorHoja: 12 },
    });
  });

  it("el período filtra: abril solo", () => {
    const abril = calcularMetricas(entrada({ desde: "2026-04-01" }), semana);
    expect(abril.resumen.ingresados).toBe(1);
    expect(abril.pasos.find((p) => p.clave === `COMP|${COMP}`)?.tiempos.n ?? 0).toBe(0);
    expect(abril.puntaAPunta.total.conSistema.n).toBe(1);
  });

  it("la primera pasada pide a la base todos los días hábiles que la segunda usa", () => {
    const anotador = calendarioQueAnota();
    const e = entrada();
    calcularMetricas(e, anotador);
    const dias = new Map([...anotador.pares].map(([k, [a, b]]) => [k, semana.diasHabiles(a, b)]));
    const sumas = new Map([...anotador.sumas].map(([k, [a, n]]) => [k, semana.sumarHabiles(a, n)]));
    const conRespuestas: Calendario = {
      diasHabiles: (a, b) => {
        const r = dias.get(`${a}|${b}`);
        if (r === undefined) throw new Error(`no se pidió ${a} → ${b}`);
        return r;
      },
      sumarHabiles: (a, n) => {
        const r = sumas.get(`${a}|${n}`);
        if (r === undefined) throw new Error(`no se pidió ${a} + ${n}`);
        return r;
      },
    };
    expect(calcularMetricas(e, conRespuestas)).toEqual(m);
  });
});
