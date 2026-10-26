import { describe, expect, it } from "vitest";
import { avisosPorTiempo, type ExpedienteEnTrabajo } from "./tiempo";

// La regla de cada aviso por tiempo, sin base: los días hábiles ya vienen
// calculados (en la base, con los feriados). La integración prueba el cálculo.

const LLEGADA = new Date("2026-10-15T12:00:00Z");

function fila(cambios: Partial<ExpedienteEnTrabajo> = {}): ExpedienteEnTrabajo {
  return {
    expediente_id: BigInt(7),
    numero_interno: "CEM-2026-00007",
    tramite: "Renovación, pago en cuotas",
    paso_clave: "LEGAL",
    paso: "Asesoría Legal",
    dias_alerta: 10,
    area_actual_id: 4,
    area_actual: "Asesoría Legal",
    area_responsable_id: 4,
    en_area_desde: LLEGADA,
    recibido_en: LLEGADA,
    dias_en_area: 1,
    plazo_desde: null,
    plazo_dias_habiles: null,
    plazo_cumplido_en: null,
    vence: null,
    faltan: null,
    anios_sin_cerrar: null,
    envio_id: null,
    envio_area_id: null,
    ...cambios,
  };
}

const enDim = (faltan: number, cambios: Partial<ExpedienteEnTrabajo> = {}) =>
  fila({
    paso_clave: "DIM",
    paso: "DIM",
    dias_alerta: 60,
    area_actual_id: 8,
    area_actual: "Dirección de Ingresos Municipales (DIM)",
    area_responsable_id: 6,
    plazo_desde: "2026-09-01",
    plazo_dias_habiles: 30,
    vence: "2026-10-20",
    faltan,
    ...cambios,
  });

describe("avisosPorTiempo", () => {
  it("nada si todo está en término", () => {
    expect(avisosPorTiempo([fila()])).toEqual([]);
  });

  it("plazo DIM: 6 días es en término; de 5 a 0, por vencer; negativo, vencido; a la custodia", () => {
    expect(avisosPorTiempo([enDim(6)])).toEqual([]);
    const [cinco] = avisosPorTiempo([enDim(5)]);
    expect(cinco).toMatchObject({ areaId: 6, clave: "plazo_por_vencer:7:2026-09-01", contenido: { tipo: "plazo_por_vencer", prioridad: "normal" } });
    expect(avisosPorTiempo([enDim(0)])[0]?.contenido.tipo).toBe("plazo_por_vencer");
    const [vencido] = avisosPorTiempo([enDim(-2)]);
    expect(vencido).toMatchObject({ areaId: 6, clave: "plazo_vencido:7:2026-09-01", contenido: { tipo: "plazo_vencido", prioridad: "alta" } });
  });

  it("plazo cumplido o sin empezar: nada", () => {
    expect(avisosPorTiempo([enDim(-2, { plazo_cumplido_en: "2026-10-01" })])).toEqual([]);
    expect(avisosPorTiempo([enDim(-2, { plazo_desde: null, vence: null, faltan: null })])).toEqual([]);
  });

  it("provisorio si hay un año sin cerrar", () => {
    expect(avisosPorTiempo([enDim(3, { anios_sin_cerrar: [2026] })])[0]?.contenido.texto).toContain("(provisorio)");
  });

  it("sin confirmar: más de 2 días hábiles, al área que lo envió, uno por envío", () => {
    const sin = (dias: number, cambios: Partial<ExpedienteEnTrabajo> = {}) =>
      fila({ recibido_en: null, dias_en_area: dias, envio_id: BigInt(55), envio_area_id: 3, dias_alerta: 30, ...cambios });
    expect(avisosPorTiempo([sin(2)])).toEqual([]);
    expect(avisosPorTiempo([sin(3)])).toEqual([
      expect.objectContaining({ areaId: 3, movimientoId: BigInt(55), clave: "sin_confirmar:55", contenido: expect.objectContaining({ tipo: "sin_confirmar" }) }),
    ]);
    // Confirmado, sin envío conocido o mandado por la misma área: nada.
    expect(avisosPorTiempo([sin(5, { recibido_en: LLEGADA })])).toEqual([]);
    expect(avisosPorTiempo([sin(5, { envio_id: null, envio_area_id: null })])).toEqual([]);
    expect(avisosPorTiempo([sin(5, { envio_area_id: 4 })])).toEqual([]);
  });

  it("demorado: desde dias_alerta, al área responsable, uno por estadía en el paso", () => {
    expect(avisosPorTiempo([fila({ dias_en_area: 9 })])).toEqual([]);
    const [d] = avisosPorTiempo([fila({ dias_en_area: 10 })]);
    expect(d).toMatchObject({ areaId: 4, clave: `demorado:7:LEGAL:${LLEGADA.toISOString()}`, contenido: { tipo: "demorado" } });
    expect(avisosPorTiempo([fila({ dias_en_area: 25 })])[0]?.clave).toBe(d?.clave);
    expect(avisosPorTiempo([fila({ dias_en_area: 99, dias_alerta: null })])).toEqual([]);
  });

  it("un expediente puede dar varios a la vez (vencido y demorado en la DIM)", () => {
    const tipos = avisosPorTiempo([enDim(-1, { dias_en_area: 61 })]).map((a) => a.contenido.tipo);
    expect(tipos).toEqual(["plazo_vencido", "demorado"]);
  });

  it("ningún aviso lleva datos de personas: solo número, trámite, paso y área", () => {
    for (const a of avisosPorTiempo([enDim(-1, { dias_en_area: 61 }), fila({ dias_en_area: 12 })])) {
      expect(a.contenido.titulo).toContain("CEM-2026-00007");
      expect(a.contenido.enlace).toBe("/expedientes/CEM-2026-00007");
    }
  });
});
