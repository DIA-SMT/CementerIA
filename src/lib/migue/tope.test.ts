import { describe, expect, it, vi } from "vitest";
import type { Escritor } from "@/lib/dominio/expedientes/dependencias";
import { claveDeConsumo, contarConsulta, decidirTope, ventanaDe } from "./tope";

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";

describe("claveDeConsumo: la persona sin poder decir quién es", () => {
  it("es un HMAC de 32 caracteres en base64url (el CHECK de consumo_migue), estable y distinto por persona", () => {
    const a = claveDeConsumo(SECRETO, { tipo: "ip", ip: "10.1.2.3" });
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(claveDeConsumo(SECRETO, { tipo: "ip", ip: "10.1.2.3" })).toBe(a);
    expect(claveDeConsumo(SECRETO, { tipo: "ip", ip: "10.1.2.4" })).not.toBe(a);
    expect(claveDeConsumo("otro-secreto-de-prueba-de-mas-de-32-caracteres", { tipo: "ip", ip: "10.1.2.3" })).not.toBe(a);
  });

  it("no lleva la IP ni el id en claro, y una IP no choca con un usuario", () => {
    const ip = claveDeConsumo(SECRETO, { tipo: "ip", ip: "10.1.2.3" });
    expect(ip).not.toContain("10.1.2.3");
    expect(claveDeConsumo(SECRETO, { tipo: "usuario", id: 7 })).not.toBe(claveDeConsumo(SECRETO, { tipo: "ip", ip: "7" }));
    // Sin IP (no vino X-Real-IP ni X-Forwarded-For): todos los "sin IP" comparten el tope.
    expect(claveDeConsumo(SECRETO, { tipo: "ip", ip: null })).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("ventanaDe y decidirTope", () => {
  it("la ventana es el comienzo de la hora", () => {
    expect(ventanaDe(new Date("2026-11-02T13:47:12.345Z")).toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });

  it("deja pasar hasta el tope incluido; después, por persona o global", () => {
    const topes = { persona: 20, global: 300 };
    expect(decidirTope({ persona: 20, global: 300 }, topes)).toEqual({ permitido: true });
    expect(decidirTope({ persona: 21, global: 21 }, topes)).toEqual({ permitido: false, motivo: "persona" });
    expect(decidirTope({ persona: 3, global: 301 }, topes)).toEqual({ permitido: false, motivo: "global" });
  });
});

describe("contarConsulta", () => {
  function escritor(cuentas: { persona: number; global: number }, fallar = false) {
    const sentencias: string[] = [];
    const escribir = vi.fn(async (_usuario: number, _motivo: string | null, fn: (tx: never) => Promise<unknown>) => {
      if (fallar) throw new Error("sin base");
      const tx = {
        $queryRaw: (partes: TemplateStringsArray) => {
          const sql = partes.join("?");
          sentencias.push(sql);
          return Promise.resolve(sql.includes("INSERT") ? [{ consultas: cuentas.persona }] : [{ total: cuentas.global }]);
        },
      };
      return fn(tx as never);
    }) as unknown as Escritor;
    return { escribir, sentencias };
  }

  it("incrementa primero (INSERT … ON CONFLICT … RETURNING) y decide con lo contado; firma SISTEMA en lo público y el usuario en lo interno", async () => {
    const { escribir, sentencias } = escritor({ persona: 1, global: 5 });
    const deps = { escribir, secreto: SECRETO, topes: { persona: 20, global: 300 } };
    expect(await contarConsulta(deps, { tipo: "ip", ip: "10.0.0.1" })).toEqual({ permitido: true });
    expect(sentencias[0]).toMatch(/INSERT INTO public\.consumo_migue[\s\S]*ON CONFLICT \(clave, ventana\) DO UPDATE SET consultas = consumo_migue\.consultas \+ 1[\s\S]*RETURNING/);
    expect(vi.mocked(escribir).mock.calls[0][0]).toBe(1);
    await contarConsulta(deps, { tipo: "usuario", id: 42 });
    expect(vi.mocked(escribir).mock.calls[1][0]).toBe(42);
  });

  it("pasado el tope de la persona no suma el global; con la base caída, deja pasar", async () => {
    const pasado = escritor({ persona: 21, global: 0 });
    expect(await contarConsulta({ escribir: pasado.escribir, secreto: SECRETO, topes: { persona: 20, global: 300 } }, { tipo: "ip", ip: null })).toEqual({
      permitido: false,
      motivo: "persona",
    });
    expect(pasado.sentencias).toHaveLength(1);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const caida = escritor({ persona: 0, global: 0 }, true);
    expect(await contarConsulta({ escribir: caida.escribir, secreto: SECRETO, topes: { persona: 20, global: 300 } }, { tipo: "ip", ip: null })).toEqual({ permitido: true });
    vi.restoreAllMocks();
  });
});
