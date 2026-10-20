import { describe, expect, it } from "vitest";
import {
  anioEnTucuman,
  comoDatetimeLocal,
  diaEnTucuman,
  diasEntre,
  esFechaValida,
  fechaDesdeDb,
  fechaParaDb,
  formatearFecha,
  formatearFechaHora,
  formatearSegunPrecision,
  hoyEnTucuman,
  inicioDelDiaEnTucuman,
  interpretarDatetimeLocal,
  sumarDias,
} from "./fechas";

// vitest.config.mts fija TZ=UTC: si algo dependiera de la zona del proceso, acá
// daría un día o tres horas corridas.
describe("el proceso corre en UTC", () => {
  it("TZ=UTC", () => {
    expect(new Date(2026, 9, 15).getTimezoneOffset()).toBe(0);
  });
});

describe("fechas del dominio (YYYY-MM-DD)", () => {
  it("valida forma y existencia del día", () => {
    expect(esFechaValida("2026-10-15")).toBe(true);
    expect(esFechaValida("2028-02-29")).toBe(true);
    expect(esFechaValida("2026-02-29")).toBe(false);
    expect(esFechaValida("2026-13-01")).toBe(false);
    expect(esFechaValida("15/10/2026")).toBe(false);
    expect(esFechaValida("2026-10-15T00:00")).toBe(false);
    expect(esFechaValida(null)).toBe(false);
  });

  it("ida y vuelta con Prisma sin correrse de día", () => {
    const d = fechaParaDb("2019-03-15");
    expect(d.toISOString()).toBe("2019-03-15T00:00:00.000Z");
    expect(fechaDesdeDb(d)).toBe("2019-03-15");
    expect(fechaDesdeDb(null)).toBeNull();
    expect(() => fechaParaDb("2019-02-30")).toThrow(RangeError);
  });

  it("aritmética de días corridos, también entre años y con bisiestos", () => {
    expect(sumarDias("2026-10-15", -30)).toBe("2026-09-15");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(diasEntre("2026-09-15", "2026-10-15")).toBe(30);
    expect(diasEntre("2026-10-15", "2026-09-15")).toBe(-30);
  });
});

describe("instantes en hora de Tucumán (UTC-3, sin horario de verano)", () => {
  it("hoy y el año son los de Tucumán, no los de UTC", () => {
    // 01:30 UTC del 1/1/2027 = 22:30 del 31/12/2026 en Tucumán.
    const cercaDeMedianoche = new Date("2027-01-01T01:30:00Z");
    expect(hoyEnTucuman(cercaDeMedianoche)).toBe("2026-12-31");
    expect(anioEnTucuman(cercaDeMedianoche)).toBe(2026);
    expect(diaEnTucuman(new Date("2027-01-01T03:00:00Z"))).toBe("2027-01-01");
  });

  it("inicio del día: las 00:00 de Tucumán son las 03:00 UTC", () => {
    expect(inicioDelDiaEnTucuman("2026-10-15").toISOString()).toBe("2026-10-15T03:00:00.000Z");
  });

  it("datetime-local se interpreta en Tucumán (fromZonedTime)", () => {
    expect(interpretarDatetimeLocal("2026-10-15T14:30").toISOString()).toBe("2026-10-15T17:30:00.000Z");
    expect(interpretarDatetimeLocal("2026-10-15T23:59:30").toISOString()).toBe("2026-10-16T02:59:30.000Z");
    expect(comoDatetimeLocal(new Date("2026-10-16T02:59:30Z"))).toBe("2026-10-15T23:59");
  });

  it("datetime-local inválido", () => {
    for (const malo of ["2026-10-15", "2026-02-30T10:00", "2026-10-15T24:00", "15/10/2026 10:00", "2026-10-15T10:00Z"]) {
      expect(() => interpretarDatetimeLocal(malo), malo).toThrow(RangeError);
    }
  });
});

describe("formato es-AR", () => {
  it("fechas y fechas con hora", () => {
    expect(formatearFecha("2019-03-15")).toBe("15/03/2019");
    // Un instante a la noche de Tucumán sigue siendo ese día, aunque en UTC ya sea el siguiente.
    expect(formatearFecha(new Date("2026-10-16T02:30:00Z"))).toBe("15/10/2026");
    expect(formatearFechaHora(new Date("2026-10-16T02:30:00Z"))).toBe("15/10/2026 23:30");
    expect(formatearFechaHora(new Date("2026-10-15T12:05:00Z"))).toBe("15/10/2026 09:05");
  });

  it("según la precisión de la fecha efectiva", () => {
    const medianoche = inicioDelDiaEnTucuman("2024-03-15");
    expect(formatearSegunPrecision(medianoche, "dia")).toBe("15/03/2024");
    expect(formatearSegunPrecision(medianoche, "minuto")).toBe("15/03/2024 00:00");
  });
});
