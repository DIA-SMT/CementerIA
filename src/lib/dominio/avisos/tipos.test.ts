import { describe, expect, it } from "vitest";
import {
  avisoCierre,
  avisoDemorado,
  avisoDevolucion,
  avisoLlegada,
  avisoPlazo,
  avisoSinConfirmar,
  claveDeMovimiento,
  claveDemorado,
  claveDePlazo,
  claveSinConfirmar,
  diasDePurga,
  DIAS_RETENCION_MINIMA,
  enlaceExpediente,
  esTipoAviso,
  ETIQUETA_TIPO_AVISO,
  LARGO_MAXIMO_MOTIVO,
  LARGO_MAXIMO_TEXTO,
  LARGO_MAXIMO_TITULO,
  PRIORIDAD_DE,
  recortar,
  TIPOS_AVISO,
  TIPOS_DESACTIVABLES,
} from "./tipos";

const BASE = { numero: "CEM-2026-00031", tramite: "Renovación, pago de contado", paso: "Cómputo: alta" };

describe("tipos y prioridades", () => {
  it("cada tipo tiene prioridad y etiqueta; los de prioridad alta son devuelto y plazo vencido", () => {
    for (const t of TIPOS_AVISO) {
      expect(PRIORIDAD_DE[t]).toMatch(/^(baja|normal|alta)$/);
      expect(ETIQUETA_TIPO_AVISO[t].length).toBeGreaterThan(0);
    }
    expect(TIPOS_AVISO.filter((t) => PRIORIDAD_DE[t] === "alta")).toEqual(["devuelto", "plazo_vencido"]);
    expect(PRIORIDAD_DE.cerrado).toBe("baja");
  });

  it("solo se puede apagar 'Concluido o archivado'", () => {
    expect(TIPOS_DESACTIVABLES).toEqual(["cerrado"]);
  });

  it("esTipoAviso", () => {
    expect(esTipoAviso("devuelto")).toBe(true);
    expect(esTipoAviso("otro")).toBe(false);
    expect(esTipoAviso(null)).toBe(false);
  });
});

describe("claves (no duplicar)", () => {
  it("por movimiento, por plazo, por envío y por estadía en el paso", () => {
    expect(claveDeMovimiento("llego", BigInt(12))).toBe("llego:12");
    expect(claveDeMovimiento("devuelto", "13")).toBe("devuelto:13");
    expect(claveDePlazo("plazo_vencido", BigInt(5), "2026-09-01")).toBe("plazo_vencido:5:2026-09-01");
    expect(claveSinConfirmar(BigInt(99))).toBe("sin_confirmar:99");
    const llegada = new Date("2026-10-20T13:05:00.000Z");
    expect(claveDemorado(BigInt(5), "LEGAL", llegada)).toBe("demorado:5:LEGAL:2026-10-20T13:05:00.000Z");
  });

  it("la demora es una por estadía, no una por día: la misma llegada da la misma clave", () => {
    const llegada = new Date("2026-10-01T12:00:00Z");
    expect(claveDemorado(BigInt(1), "LEGAL", llegada)).toBe(claveDemorado(BigInt(1), "LEGAL", new Date(llegada)));
    expect(claveDemorado(BigInt(1), "LEGAL", llegada)).not.toBe(claveDemorado(BigInt(1), "LEGAL", new Date("2026-10-15T12:00:00Z")));
  });
});

describe("contenido", () => {
  it("llegó: número, trámite, paso y de dónde viene; el enlace es la ficha (ruta relativa)", () => {
    const c = avisoLlegada({ ...BASE, areaOrigen: "Mesa de Entradas", areaActual: "Cómputo", externo: false });
    expect(c).toEqual({
      tipo: "llego",
      prioridad: "normal",
      titulo: "Llegó CEM-2026-00031",
      texto: "Renovación, pago de contado · paso Cómputo: alta · desde Mesa de Entradas",
      enlace: "/expedientes/CEM-2026-00031",
    });
  });

  it("llegó a un paso externo: lo dice y que la custodia es del área", () => {
    const c = avisoLlegada({ ...BASE, paso: "DIM", areaOrigen: "Departamento Tributario / Notificación", areaActual: "Dirección de Ingresos Municipales (DIM)", externo: true });
    expect(c.titulo).toBe("CEM-2026-00031 está en Dirección de Ingresos Municipales (DIM)");
    expect(c.texto).toContain("lo custodia tu área");
  });

  it("devuelto: prioridad alta, quién y el motivo (recortado)", () => {
    const motivo = `Falta documentación: ${"x".repeat(400)}`;
    const c = avisoDevolucion({ ...BASE, areaQueDevolvio: "Liquidación", motivo, externo: false, areaActual: "Cómputo" });
    expect(c.prioridad).toBe("alta");
    expect(c.titulo).toBe("Te devolvieron CEM-2026-00031");
    expect(c.texto.startsWith("Liquidación lo devolvió a Cómputo: alta: Falta documentación: xxx")).toBe(true);
    expect(c.texto).toContain("…");
    expect(c.texto.length).toBeLessThanOrEqual(LARGO_MAXIMO_MOTIVO + 80);
  });

  it("plazo por vencer, que vence hoy y vencido", () => {
    expect(avisoPlazo({ ...BASE, paso: "DIM", vence: "2026-11-30", faltan: 3, provisorio: true })).toMatchObject({
      tipo: "plazo_por_vencer",
      prioridad: "normal",
      titulo: "Plazo DIM por vencer: CEM-2026-00031",
      texto: expect.stringMatching(/^Vence el 30\/11\/2026, faltan 3 días hábiles \(provisorio\)/),
    });
    expect(avisoPlazo({ ...BASE, vence: "2026-10-26", faltan: 0, provisorio: false }).texto).toMatch(/^Vence el 26\/10\/2026, vence hoy ·/);
    expect(avisoPlazo({ ...BASE, vence: "2026-10-20", faltan: -1, provisorio: false })).toMatchObject({
      tipo: "plazo_vencido",
      prioridad: "alta",
      texto: expect.stringMatching(/^Venció el 20\/10\/2026, hace 1 día hábil ·/),
    });
  });

  it("sin confirmar, demorado y cerrado", () => {
    expect(avisoSinConfirmar({ ...BASE, areaDestino: "Liquidación", dias: 3 }).texto).toMatch(/^Tu área lo envió a Liquidación hace 3 días hábiles/);
    expect(avisoDemorado({ ...BASE, area: "Asesoría Legal", dias: 12, diasAlerta: 10 }).texto).toMatch(/^12 días hábiles en Asesoría Legal \(la alerta del paso es a los 10\)/);
    expect(avisoCierre({ numero: BASE.numero, tramite: BASE.tramite, estado: "concluido", area: "Administrativo", ubicacionArchivo: null, sinConcluir: false })).toMatchObject({
      tipo: "cerrado",
      prioridad: "baja",
      titulo: "Concluido: CEM-2026-00031",
      texto: "Renovación, pago de contado · lo concluyó Administrativo",
    });
    expect(avisoCierre({ numero: BASE.numero, tramite: BASE.tramite, estado: "archivado", area: "Mesa de Entradas", ubicacionArchivo: "Caja 12", sinConcluir: true }).texto).toBe(
      "Renovación, pago de contado · sin concluir · ubicación Caja 12 · lo archivó Mesa de Entradas",
    );
  });

  it("títulos y textos dentro de los largos del CHECK, sin espacios de más", () => {
    const largo = "Trámite ".repeat(100);
    const c = avisoLlegada({ numero: "CEM-2026-00001", tramite: largo, paso: largo, areaOrigen: largo, areaActual: largo, externo: true });
    expect(Array.from(c.titulo).length).toBeLessThanOrEqual(LARGO_MAXIMO_TITULO);
    expect(Array.from(c.texto).length).toBeLessThanOrEqual(LARGO_MAXIMO_TEXTO);
    expect(recortar("  a \n  b  ", 10)).toBe("a b");
    expect(recortar("abcdef", 4)).toBe("abc…");
  });

  it("el enlace escapa lo que no es de una ruta", () => {
    expect(enlaceExpediente("CEM-2026-00031")).toBe("/expedientes/CEM-2026-00031");
    expect(enlaceExpediente("a/b?c")).toBe("/expedientes/a%2Fb%3Fc");
  });
});

describe("diasDePurga", () => {
  it("por defecto y como mínimo, 90", () => {
    expect(diasDePurga(undefined)).toBe(DIAS_RETENCION_MINIMA);
    expect(diasDePurga("90")).toBe(90);
    expect(diasDePurga("365")).toBe(365);
    expect(() => diasDePurga("30")).toThrow(/como mínimo 90/);
    expect(() => diasDePurga("")).toThrow(/número de días/);
    expect(() => diasDePurga("90d")).toThrow(/número de días/);
  });
});
