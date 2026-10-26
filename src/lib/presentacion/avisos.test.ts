import { describe, expect, it } from "vitest";
import type { AvisoVista, ResumenAvisos } from "@/lib/dominio/avisos/consultas";
import { idsValidos } from "@/lib/dominio/avisos/consultas";
import {
  esResumenAvisos,
  haceCuanto,
  leerFiltrosAvisos,
  leerIds,
  marcarEnResumen,
  nombreCampana,
  numeroCampana,
  rutaAvisos,
  TONO_TIPO_AVISO,
} from "./avisos";

function aviso(id: string, leido = false, cambios: Partial<AvisoVista> = {}): AvisoVista {
  return {
    id,
    tipo: "llego",
    prioridad: "normal",
    titulo: `Llegó CEM-2026-0000${id}`,
    texto: "Renovación · paso Cómputo: alta",
    enlace: `/expedientes/CEM-2026-0000${id}`,
    numero: `CEM-2026-0000${id}`,
    creadoEn: "2026-10-26T12:00:00.000Z",
    leidoEn: leido ? "2026-10-26T12:30:00.000Z" : null,
    ...cambios,
  };
}

describe("la campana", () => {
  it("nombre accesible y número visible", () => {
    expect(nombreCampana(3)).toBe("Avisos, 3 sin leer");
    expect(nombreCampana(1)).toBe("Avisos, 1 sin leer");
    expect(nombreCampana(0)).toBe("Avisos, ninguno sin leer");
    expect(numeroCampana(0)).toBeNull();
    expect(numeroCampana(7)).toBe("7");
    expect(numeroCampana(120)).toBe("99+");
  });

  it("los de prioridad alta van con el tono de error; los que piden atención, de advertencia", () => {
    expect(TONO_TIPO_AVISO.devuelto).toBe("error");
    expect(TONO_TIPO_AVISO.plazo_vencido).toBe("error");
    expect(TONO_TIPO_AVISO.plazo_por_vencer).toBe("advertencia");
    expect(TONO_TIPO_AVISO.llego).toBe("info");
  });

  it("marcarEnResumen: uno, o todos (también los que no están en la lista)", () => {
    const r: ResumenAvisos = { noLeidos: 12, ultimos: [aviso("1"), aviso("2", true), aviso("3")] };
    const ahora = new Date("2026-10-26T13:00:00Z");
    const uno = marcarEnResumen(r, ["1", "2"], ahora);
    expect(uno.noLeidos).toBe(11);
    expect(uno.ultimos.map((a) => a.leidoEn !== null)).toEqual([true, true, false]);
    expect(uno.ultimos[1]?.leidoEn).toBe("2026-10-26T12:30:00.000Z");
    const todos = marcarEnResumen(r, "todos", ahora);
    expect(todos.noLeidos).toBe(0);
    expect(todos.ultimos.every((a) => a.leidoEn !== null)).toBe(true);
  });

  it("esResumenAvisos no cree cualquier cosa que llegue por fetch", () => {
    expect(esResumenAvisos({ noLeidos: 1, ultimos: [aviso("1")] })).toBe(true);
    expect(esResumenAvisos({ noLeidos: 0, ultimos: [] })).toBe(true);
    expect(esResumenAvisos({ noLeidos: "1", ultimos: [] })).toBe(false);
    expect(esResumenAvisos({ noLeidos: 1, ultimos: [aviso("1", false, { enlace: "https://otro.ejemplo" })] })).toBe(false);
    expect(esResumenAvisos({ noLeidos: 1, ultimos: [{ ...aviso("1"), tipo: "otro" }] })).toBe(false);
    expect(esResumenAvisos(null)).toBe(false);
  });
});

describe("haceCuanto (días de Tucumán)", () => {
  const ahora = new Date("2026-10-26T15:00:00Z"); // 12:00 en Tucumán
  it("minutos, horas, ayer, días y fecha", () => {
    expect(haceCuanto(new Date("2026-10-26T14:59:30Z"), ahora)).toBe("recién");
    expect(haceCuanto(new Date("2026-10-26T14:55:00Z"), ahora)).toBe("hace 5 min");
    expect(haceCuanto(new Date("2026-10-26T12:00:00Z"), ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-10-25T20:00:00.000Z", ahora)).toBe("ayer");
    expect(haceCuanto("2026-10-23T20:00:00.000Z", ahora)).toBe("hace 3 días");
    expect(haceCuanto("2026-10-10T20:00:00.000Z", ahora)).toBe("el 10/10/2026");
  });

  it("a las 0:10 de Tucumán, uno de las 23:50 es de ayer aunque en UTC sea el mismo día", () => {
    const madrugada = new Date("2026-10-26T03:10:00Z"); // 00:10 en Tucumán
    expect(haceCuanto(new Date("2026-10-26T02:50:00Z"), madrugada)).toBe("ayer");
  });
});

describe("/avisos: filtros en la URL", () => {
  it("lee y arma la URL (ida y vuelta)", () => {
    const f = leerFiltrosAvisos({ estado: "no_leidos", tipo: "devuelto", pagina: "3" });
    expect(f).toEqual({ soloNoLeidos: true, tipo: "devuelto", pagina: 3 });
    expect(rutaAvisos(f)).toBe("/avisos?estado=no_leidos&tipo=devuelto&pagina=3");
    expect(rutaAvisos({})).toBe("/avisos");
    expect(rutaAvisos({ pagina: 1, tipo: null })).toBe("/avisos");
  });

  it("lo que no entiende lo ignora", () => {
    expect(leerFiltrosAvisos({ estado: "x", tipo: "<script>", pagina: "-2" })).toEqual({ soloNoLeidos: false, tipo: null, pagina: 1 });
    expect(leerFiltrosAvisos({ tipo: ["llego", "devuelto"], pagina: "2.5" })).toEqual({ soloNoLeidos: false, tipo: "llego", pagina: 1 });
  });
});

describe("ids de las Server Actions", () => {
  it("solo enteros positivos como texto, sin repetir, hasta 200", () => {
    expect(leerIds(["1", "x", 3, "0", "007", "12"])).toEqual(["1", "12"]);
    expect(leerIds("1")).toEqual([]);
    expect(idsValidos(["5", "5", "6", null, "-1"])).toEqual([BigInt(5), BigInt(6)]);
    expect(idsValidos(Array.from({ length: 300 }, (_, i) => String(i + 1)))).toHaveLength(200);
  });
});
