import { describe, expect, it } from "vitest";
import { agruparEnTramos, type MovimientoAgrupable } from "./tramos";

let siguiente = 0;
function mov(cambios: Partial<MovimientoAgrupable> & Pick<MovimientoAgrupable, "tipo" | "fechaEfectiva">): MovimientoAgrupable {
  siguiente += 1;
  return {
    id: String(siguiente),
    precisionFecha: "minuto",
    pasoDestino: null,
    areaDestino: null,
    estadoNuevo: null,
    revertido: false,
    fechaCorregida: null,
    ...cambios,
  };
}

const MESA = { codigo: "MESA_ENTRADAS", nombre: "Mesa de Entradas" };
const COMPUTO = { codigo: "COMPUTO", nombre: "Cómputo" };
const LEGAL = { codigo: "LEGAL", nombre: "Asesoría Legal" };
const d = (iso: string) => new Date(iso);

describe("agruparEnTramos", () => {
  it("cada alta, pase y devolución abre un tramo; lo demás queda en el tramo en que pasó", () => {
    const alta = mov({ tipo: "alta", fechaEfectiva: d("2026-10-01T12:00:00Z"), pasoDestino: { clave: "MESA", nombre: "Mesa" }, areaDestino: MESA });
    const tilde = mov({ tipo: "subtarea", fechaEfectiva: d("2026-10-01T13:00:00Z") });
    const pase = mov({ tipo: "pase", fechaEfectiva: d("2026-10-02T12:00:00Z"), pasoDestino: { clave: "COMPUTO_ALTA", nombre: "Alta" }, areaDestino: COMPUTO });
    const recepcion = mov({ tipo: "recepcion", fechaEfectiva: d("2026-10-03T12:00:00Z"), areaDestino: COMPUTO });
    const nota = mov({ tipo: "nota", fechaEfectiva: d("2026-10-04T12:00:00Z") });
    const devolucion = mov({ tipo: "devolucion", fechaEfectiva: d("2026-10-05T12:00:00Z"), pasoDestino: { clave: "MESA", nombre: "Mesa" }, areaDestino: MESA });

    const t = agruparEnTramos([alta, tilde, pase, recepcion, nota, devolucion], true);
    expect(t.map((x) => [x.orden, x.paso?.clave, x.area?.codigo, x.movimientos, x.actual])).toEqual([
      [1, "MESA", "MESA_ENTRADAS", [alta.id, tilde.id], false],
      [2, "COMPUTO_ALTA", "COMPUTO", [pase.id, recepcion.id, nota.id], false],
      [3, "MESA", "MESA_ENTRADAS", [devolucion.id], true],
    ]);
    expect(t[0].hasta).toEqual(pase.fechaEfectiva);
    expect(t[1].hasta).toEqual(devolucion.fechaEfectiva);
    expect(t[2].hasta).toBeNull();
  });

  it("lo revertido no abre tramo, y vale la fecha corregida", () => {
    const alta = mov({ tipo: "alta", fechaEfectiva: d("2026-10-01T12:00:00Z"), pasoDestino: { clave: "MESA", nombre: "Mesa" }, areaDestino: MESA });
    const revertido = mov({ tipo: "pase", fechaEfectiva: d("2026-10-02T12:00:00Z"), pasoDestino: { clave: "LEGAL", nombre: "Legal" }, areaDestino: LEGAL, revertido: true });
    const correccion = mov({ tipo: "correccion", fechaEfectiva: d("2026-10-02T13:00:00Z") });
    const pase = mov({
      tipo: "pase",
      fechaEfectiva: d("2026-10-06T12:00:00Z"),
      fechaCorregida: { fechaEfectiva: d("2026-10-05T03:00:00Z"), precisionFecha: "dia" },
      pasoDestino: { clave: "COMPUTO_ALTA", nombre: "Alta" },
      areaDestino: COMPUTO,
    });
    const t = agruparEnTramos([alta, revertido, correccion, pase], true);
    expect(t.map((x) => x.movimientos)).toEqual([[alta.id, revertido.id, correccion.id], [pase.id]]);
    expect(t[1].desde).toEqual(d("2026-10-05T03:00:00Z"));
    expect(t[1].desdePrecision).toBe("dia");
    expect(t[0].hasta).toEqual(d("2026-10-05T03:00:00Z"));
  });

  it("un expediente concluido o archivado cierra su último tramo con ese cambio de estado", () => {
    const alta = mov({ tipo: "alta", fechaEfectiva: d("2026-10-01T12:00:00Z"), pasoDestino: { clave: "MESA", nombre: "Mesa" }, areaDestino: MESA });
    const concluir = mov({ tipo: "estado", estadoNuevo: "concluido", fechaEfectiva: d("2026-10-03T12:00:00Z") });
    const nota = mov({ tipo: "nota", fechaEfectiva: d("2026-10-09T12:00:00Z") });
    const t = agruparEnTramos([alta, concluir, nota], false);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ actual: false, hasta: concluir.fechaEfectiva, movimientos: [alta.id, concluir.id, nota.id] });

    // Sin cambio de estado (anulado por reinicio en otra transacción, por ejemplo): hasta el último movimiento.
    const sinEstado = agruparEnTramos([alta, nota], false);
    expect(sinEstado[0].hasta).toEqual(nota.fechaEfectiva);
  });

  it("un cambio de estado que lleva el papel a otra área abre tramo (el regreso del papel, desarchivar)", () => {
    const alta = mov({ tipo: "alta", fechaEfectiva: d("2026-10-01T12:00:00Z"), pasoDestino: { clave: "MESA", nombre: "Mesa" }, areaDestino: MESA });
    const mismo = mov({ tipo: "estado", estadoNuevo: "espera_pago_dim", fechaEfectiva: d("2026-10-02T12:00:00Z"), areaDestino: MESA });
    const regreso = mov({ tipo: "estado", estadoNuevo: "archivado", fechaEfectiva: d("2026-10-03T12:00:00Z"), areaDestino: COMPUTO });
    const t = agruparEnTramos([alta, mismo, regreso], false);
    expect(t.map((x) => x.movimientos)).toEqual([[alta.id, mismo.id], [regreso.id]]);
    expect(t[1]).toMatchObject({ area: COMPUTO, paso: { clave: "MESA" }, hasta: regreso.fechaEfectiva });
  });

  it("sin movimientos no hay tramos", () => {
    expect(agruparEnTramos([], true)).toEqual([]);
  });
});
