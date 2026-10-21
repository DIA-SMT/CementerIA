import { describe, expect, it } from "vitest";
import { RENOV_PLAN as RENOV_PLAN_SEMILLA } from "../../../../prisma/semilla/plantillas/renov-plan";
import { resolverDefinicion } from "../plantillas/resolver";
import { objetivoDeReversion } from "./correcciones";
import {
  movimientosRevertidos,
  movimientosVigentes,
  reconstruirProyeccion,
  ultimaUbicacionVigente,
  type EntornoReconstruccion,
  type MovimientoReconstruible,
} from "./reconstruccion";

// La reconstrucción de la proyección desde el historial (semana 4), sin base.
// RENOV_PLAN en el Norte: TRIBUTARIO → DIM (externa, custodia Tributario,
// plazo de 30 días hábiles desde TRIB_NOTIFICADA hasta DIM_PLAN_INICIADO).
const DEF = resolverDefinicion(RENOV_PLAN_SEMILLA, { cementerio: "NORTE", rolesJuridicos: [] });

const AREAS = { MESA_ENTRADAS: 1, COMPUTO: 2, LIQUIDACION: 3, LEGAL: 4, ADMINISTRATIVO: 5, TRIBUTARIO: 6, DIM: 7 } as const;
const ENTORNO: EntornoReconstruccion = {
  areas: new Map(
    Object.entries(AREAS).map(([codigo, id]) => [id, { id, codigo, tipo: codigo === "DIM" ? "externa" : "interna" }]),
  ),
};

let secuencia = 0;
function mov(tipo: string, cambios: Partial<MovimientoReconstruible> = {}): MovimientoReconstruible {
  secuencia += 1;
  return {
    id: BigInt(1000 + secuencia),
    secuencia,
    tipo,
    fechaEfectiva: new Date(`2026-10-${String(secuencia).padStart(2, "0")}T13:00:00Z`),
    precisionFecha: "minuto",
    usuarioId: 10,
    areaUsuarioId: AREAS.MESA_ENTRADAS,
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
    comandoId: `c-${secuencia}`,
    registradoEn: new Date(`2026-10-${String(secuencia).padStart(2, "0")}T13:00:00Z`),
    ...cambios,
  };
}

function inicio(): MovimientoReconstruible[] {
  secuencia = 0;
  return [
    mov("alta", { pasoDestino: "MESA", areaDestinoId: AREAS.MESA_ENTRADAS, estadoNuevo: "en_tramite", datos: { documentos_recibidos: ["DNI"] } }),
    // Mesa da el pase a Tributario (la reconstrucción no valida el recorrido: lo hizo la acción).
    mov("pase", { pasoOrigen: "MESA", pasoDestino: "TRIBUTARIO", areaDestinoId: AREAS.TRIBUTARIO, datos: { pasos_omitidos: [], pasos_salteados: [] } }),
  ];
}

function hasta(movs: MovimientoReconstruible[]) {
  return reconstruirProyeccion(DEF, movs, ENTORNO);
}

describe("reconstruirProyeccion", () => {
  it("alta: primer paso, recibido por Mesa, documentos recibidos presentados", () => {
    const [alta] = inicio();
    const p = hasta([alta]);
    expect(p).toMatchObject({ estado: "en_tramite", pasoClave: "MESA", pasoOrden: 1, areaActualId: 1, areaResponsableId: 1, cargaHistorica: false });
    expect(p.recibidoEn).toEqual(alta.fechaEfectiva);
    expect(p.items.documentos.DNI).toMatchObject({ estado: "presentado", mov: Number(alta.id) });
  });

  it("pase a un área interna queda sin confirmar; la recepción lo confirma", () => {
    const movs = inicio();
    expect(hasta(movs)).toMatchObject({ pasoClave: "TRIBUTARIO", areaActualId: 6, recibidoEn: null, enAreaDesde: movs[1].fechaEfectiva });
    const r = mov("recepcion", { areaUsuarioId: 6, pasoDestino: "TRIBUTARIO", areaDestinoId: 6, datos: { implicita: false } });
    expect(hasta([...movs, r]).recibidoEn).toEqual(r.fechaEfectiva);
  });

  it("entrar a la DIM: externa, custodia de Tributario, espera de pago y plazo desde la notificación", () => {
    const movs = inicio();
    movs.push(mov("subtarea", { areaUsuarioId: 6, datos: { subtarea: "TRIB_NOTIFICADA", hecha: true, dato: "2026-10-01", paso: "TRIBUTARIO" } }));
    movs.push(mov("pase", { areaUsuarioId: 6, pasoOrigen: "TRIBUTARIO", pasoDestino: "DIM", areaDestinoId: 7 }));
    const p = hasta(movs);
    expect(p).toMatchObject({
      estado: "espera_pago_dim",
      pasoClave: "DIM",
      areaActualId: 7,
      areaResponsableId: 6,
      plazoDesde: "2026-10-01",
      plazoDiasHabiles: 30,
      plazoCumplidoEn: null,
    });
    expect(p.recibidoEn).toEqual(movs.at(-1)?.fechaEfectiva);

    // DIM_PLAN_INICIADO sin fecha cumple el plazo el día del movimiento.
    const cumple = mov("subtarea", { areaUsuarioId: 6, datos: { subtarea: "DIM_PLAN_INICIADO", hecha: true, dato: null, paso: "DIM" } });
    expect(hasta([...movs, cumple]).plazoCumplidoEn).toBe(cumple.fechaEfectiva.toISOString().slice(0, 10));
  });

  it("revertir el pase a la DIM deja la proyección como antes del pase", () => {
    const movs = inicio();
    movs.push(mov("subtarea", { areaUsuarioId: 6, datos: { subtarea: "TRIB_NOTIFICADA", hecha: true, dato: "2026-10-01", paso: "TRIBUTARIO" } }));
    const antes = hasta(movs);
    const pase = mov("pase", { areaUsuarioId: 6, pasoOrigen: "TRIBUTARIO", pasoDestino: "DIM", areaDestinoId: 7 });
    const nota = mov("nota", { observacion: "llamó el concesionario" });
    const reversion = mov("correccion", { corrigeMovimientoId: pase.id, motivo: "Pase dado por error", datos: { revertir: true, arrastra: [nota.id.toString()] } });
    const despues = hasta([...movs, pase, nota, reversion]);
    expect(despues).toEqual(antes);
    expect(movimientosRevertidos([...movs, pase, nota, reversion])).toEqual(new Set([pase.id.toString(), nota.id.toString()]));
  });

  it("devolución: reinicia subtareas, guarda el paso de retorno y limpia el plazo", () => {
    const movs = inicio();
    movs.push(mov("subtarea", { areaUsuarioId: 6, datos: { subtarea: "TRIB_NOTIFICADA", hecha: true, dato: "2026-10-01", paso: "TRIBUTARIO" } }));
    movs.push(mov("pase", { areaUsuarioId: 6, pasoOrigen: "TRIBUTARIO", pasoDestino: "DIM", areaDestinoId: 7 }));
    const dev = mov("devolucion", {
      areaUsuarioId: 6,
      pasoOrigen: "DIM",
      pasoDestino: "TRIBUTARIO",
      areaDestinoId: 6,
      motivo: "No abonó: notificar de nuevo",
      datos: { subtareas_reiniciadas: ["TRIB_NOTIFICADA"] },
    });
    const p = hasta([...movs, dev]);
    expect(p).toMatchObject({ estado: "en_tramite", pasoClave: "TRIBUTARIO", pasoRetornoClave: "DIM", plazoDesde: null, plazoDiasHabiles: null });
    expect(p.items.subtareas.TRIB_NOTIFICADA).toMatchObject({ hecha: false, reiniciada_por_mov: Number(dev.id) });
    // Tributario recibe lo que devuelve él mismo.
    expect(p.recibidoEn).toEqual(dev.fechaEfectiva);
  });

  it("corregir el dato de la notificación con el expediente en la DIM mueve el inicio del plazo", () => {
    const movs = inicio();
    const notificada = mov("subtarea", { areaUsuarioId: 6, datos: { subtarea: "TRIB_NOTIFICADA", hecha: true, dato: "2026-10-01", paso: "TRIBUTARIO" } });
    movs.push(notificada, mov("pase", { areaUsuarioId: 6, pasoOrigen: "TRIBUTARIO", pasoDestino: "DIM", areaDestinoId: 7 }));
    const c = mov("correccion", { corrigeMovimientoId: notificada.id, motivo: "La fecha era otra", datos: { subtarea: "TRIB_NOTIFICADA", dato: ["2026-10-01", "2026-10-02"] } });
    const p = hasta([...movs, c]);
    expect(p.plazoDesde).toBe("2026-10-02");
    expect(p.items.subtareas.TRIB_NOTIFICADA).toMatchObject({ hecha: true, dato: "2026-10-02", mov: Number(c.id) });
  });

  it("corregir la fecha de un pase cambia en_area_desde y la regla de no retroceso", () => {
    const movs = inicio();
    const nueva = new Date("2026-10-02T09:00:00Z");
    const c = mov("correccion", {
      corrigeMovimientoId: movs[1].id,
      motivo: "Se cargó con la fecha mal",
      datos: { fecha_efectiva: [movs[1].fechaEfectiva.toISOString(), nueva.toISOString()], precision: ["minuto", "dia"] },
    });
    const todos = [...movs, c];
    expect(hasta(todos).enAreaDesde).toEqual(nueva);
    expect(movimientosVigentes(todos)[1]).toMatchObject({ fechaEfectiva: nueva, precisionFecha: "dia" });
    expect(ultimaUbicacionVigente(todos)).toEqual({ instante: nueva, precision: "dia" });
  });

  it("archivar sin concluir desde la DIM trae el papel a la custodia; desarchivar vuelve al paso con su plazo", () => {
    const movs = inicio();
    movs.push(mov("subtarea", { areaUsuarioId: 6, datos: { subtarea: "TRIB_NOTIFICADA", hecha: true, dato: "2026-10-01", paso: "TRIBUTARIO" } }));
    movs.push(mov("pase", { areaUsuarioId: 6, pasoOrigen: "TRIBUTARIO", pasoDestino: "DIM", areaDestinoId: 7 }));
    const archivo = mov("estado", {
      estadoAnterior: "espera_pago_dim",
      estadoNuevo: "archivado",
      motivo: "No pagó después de la notificación",
      areaDestinoId: 6,
      datos: { ubicacion_archivo: "Caja 7", regreso_papel: { fecha: "2026-10-10T13:00:00.000Z", area_id: 6 } },
    });
    const a = hasta([...movs, archivo]);
    expect(a).toMatchObject({
      estado: "archivado",
      estadoPrevio: "espera_pago_dim",
      ubicacionArchivo: "Caja 7",
      areaActualId: 6,
      areaResponsableId: 6,
      plazoDiasHabiles: null,
    });
    expect(a.enAreaDesde).toEqual(archivo.fechaEfectiva);
    const desarchivo = mov("estado", {
      estadoAnterior: "archivado",
      estadoNuevo: "espera_pago_dim",
      motivo: "Pagó, se retoma",
      areaDestinoId: 7,
      pasoDestino: "DIM",
    });
    expect(hasta([...movs, archivo, desarchivo])).toMatchObject({
      estado: "espera_pago_dim",
      estadoPrevio: null,
      ubicacionArchivo: null,
      areaActualId: 7,
      areaResponsableId: 6,
      plazoDesde: "2026-10-01",
      plazoDiasHabiles: 30,
    });
  });

  it("anular y reabrir conservan el lugar del papel", () => {
    const movs = inicio();
    const anula = mov("estado", { estadoAnterior: "en_tramite", estadoNuevo: "anulado", motivo: "Cargado por error" });
    expect(hasta([...movs, anula])).toMatchObject({ estado: "anulado", estadoPrevio: "en_tramite", areaActualId: 6 });
    const reabre = mov("estado", { estadoAnterior: "anulado", estadoNuevo: "en_tramite", motivo: "No era un error" });
    expect(hasta([...movs, anula, reabre])).toEqual(hasta(movs));
  });

  it("adjuntos: retirar y purgar", () => {
    const movs = inicio();
    const adj = mov("adjunto", { datos: { documento: "DNI", nombre: "dni.pdf", mime: "application/pdf", bytes: 10, sha256: "x", ruta: "2026/10/x" } });
    const retira = mov("correccion", { corrigeMovimientoId: adj.id, motivo: "Era de otro expediente", datos: { retirar_adjunto: adj.id.toString(), purgar: false } });
    const p = hasta([...movs, adj, retira]);
    expect(p.items.adjuntos[adj.id.toString()]).toEqual({ documento: "DNI", vigente: false, purgado: false });
    expect(p.items.documentos.DNI.adjuntos).toEqual([Number(adj.id)]);
    const purga = mov("correccion", { corrigeMovimientoId: adj.id, motivo: "Datos de un tercero", datos: { retirar_adjunto: adj.id.toString(), purgar: true } });
    expect(hasta([...movs, adj, retira, purga]).items.adjuntos[adj.id.toString()]).toMatchObject({ vigente: false, purgado: true });
  });

  it("terminar la carga histórica pasa lo pendiente a histórico", () => {
    secuencia = 0;
    const alta = mov("alta", { pasoDestino: "MESA", areaDestinoId: 1, estadoNuevo: "en_tramite", cargaHistorica: true, datos: { documentos_recibidos: [] } });
    const fila = mov("pase", { pasoOrigen: "MESA", pasoDestino: "LEGAL", areaDestinoId: 4, cargaHistorica: true, datos: { pasos_salteados: ["COMPUTO_ALTA", "LIQUIDACION"] } });
    const fin = mov("edicion", { datos: { cambios: { carga_historica: [true, false] }, historicos: { subtareas: ["MESA_CARATULA"], documentos: ["DNI"] } } });
    const enCarga = hasta([alta, fila]);
    // La transcripción llega recibida: nadie confirma en la ficha de papel.
    expect(enCarga).toMatchObject({ cargaHistorica: true, pasoClave: "LEGAL", recibidoEn: fila.fechaEfectiva });
    const p = hasta([alta, fila, fin]);
    expect(p.cargaHistorica).toBe(false);
    expect(p.items.subtareas.MESA_CARATULA).toMatchObject({ hecha: false, historica: true, mov: Number(fin.id) });
    expect(p.items.documentos.DNI).toMatchObject({ estado: "historico", mov: Number(fin.id) });
  });
});

describe("objetivoDeReversion (2.13(b))", () => {
  it("el último pase, con las notas y recepciones posteriores y su recepción implícita", () => {
    const movs = inicio();
    const implicita = mov("recepcion", { areaUsuarioId: 6, comandoId: "pase-dim", datos: { implicita: true } });
    const pase = mov("pase", { areaUsuarioId: 6, comandoId: "pase-dim", pasoDestino: "DIM", areaDestinoId: 7 });
    const nota = mov("nota");
    const r = objetivoDeReversion([...movs, implicita, pase, nota], "DIM");
    expect(r.ok && r.objetivo.id).toBe(pase.id);
    expect(r.ok && r.arrastra.map((m) => m.id)).toEqual([implicita.id, nota.id]);
  });

  it("una edición de datos o una nota no tapan el pase; un documento sí", () => {
    const movs = inicio();
    const edicion = mov("edicion", { datos: { cambios: { padron: ["1", "2"] } } });
    expect(objetivoDeReversion([...movs, edicion], "TRIBUTARIO")).toMatchObject({ ok: true, objetivo: { id: movs[1].id } });
    const doc = mov("documento", { datos: { documento: "DNI", estado: "presentado" } });
    expect(objetivoDeReversion([...movs, doc], "TRIBUTARIO")).toMatchObject({ ok: false });
  });

  it("una subtarea se revierte solo si es del paso actual", () => {
    const movs = inicio();
    const s = mov("subtarea", { datos: { subtarea: "TRIB_NOTIFICADA", hecha: true, dato: "2026-10-01", paso: "TRIBUTARIO" } });
    expect(objetivoDeReversion([...movs, s], "TRIBUTARIO")).toMatchObject({ ok: true, objetivo: { id: s.id } });
    expect(objetivoDeReversion([...movs, s], "DIM")).toMatchObject({ ok: false });
  });

  it("después de revertir, el anterior pasa a ser el último; el alta no se revierte", () => {
    const movs = inicio();
    const reversion = mov("correccion", { corrigeMovimientoId: movs[1].id, motivo: "Pase por error", datos: { revertir: true, arrastra: [] } });
    expect(objetivoDeReversion([...movs, reversion], "MESA")).toMatchObject({ ok: false });
  });
});
