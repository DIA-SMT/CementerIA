import { describe, expect, it } from "vitest";
import { BLOQUEO_USUARIO_MS, estaBloqueado, LimitePorIp, MAXIMO_FALLOS_IP, MAXIMO_FALLOS_USUARIO, siguienteFallo, VENTANA_IP_MS } from "./limite-intentos";

const T0 = new Date("2026-10-27T12:00:00Z");

describe("bloqueo por usuario (5 fallos seguidos, 15 minutos)", () => {
  it("los cuatro primeros fallos suman; el quinto bloquea 15 minutos y el contador vuelve a 0", () => {
    let intentos = 0;
    for (let i = 1; i < MAXIMO_FALLOS_USUARIO; i++) {
      const r = siguienteFallo(intentos, T0);
      expect(r).toEqual({ intentosFallidos: i, bloqueadoHasta: null, bloqueo: false });
      intentos = r.intentosFallidos;
    }
    const quinto = siguienteFallo(intentos, T0);
    expect(quinto).toEqual({ intentosFallidos: 0, bloqueadoHasta: new Date(T0.getTime() + BLOQUEO_USUARIO_MS), bloqueo: true });
    expect(MAXIMO_FALLOS_USUARIO).toBe(5);
    expect(BLOQUEO_USUARIO_MS).toBe(15 * 60 * 1000);
  });

  it("estaBloqueado con el reloj: hasta el instante exacto sí, después no", () => {
    const hasta = new Date(T0.getTime() + BLOQUEO_USUARIO_MS);
    expect(estaBloqueado(hasta, T0)).toBe(true);
    expect(estaBloqueado(hasta, new Date(hasta.getTime() - 1))).toBe(true);
    expect(estaBloqueado(hasta, hasta)).toBe(false);
    expect(estaBloqueado(null, T0)).toBe(false);
  });
});

describe("límite por IP (en memoria, por instancia)", () => {
  it("bloquea la IP al llegar al tope, solo durante la ventana", () => {
    let ahora = T0.getTime();
    const limite = new LimitePorIp({ maximo: 3, ventanaMs: 60_000, ahora: () => ahora });
    expect(limite.bloqueada("10.0.0.1")).toBe(false);
    expect([limite.registrarFallo("10.0.0.1"), limite.registrarFallo("10.0.0.1")]).toEqual([1, 2]);
    expect(limite.bloqueada("10.0.0.1")).toBe(false);
    limite.registrarFallo("10.0.0.1");
    expect(limite.bloqueada("10.0.0.1")).toBe(true);
    // Otra IP, independiente.
    expect(limite.bloqueada("10.0.0.2")).toBe(false);
    // Vencida la ventana, empieza de cero.
    ahora += 60_000;
    expect(limite.bloqueada("10.0.0.1")).toBe(false);
    expect(limite.registrarFallo("10.0.0.1")).toBe(1);
  });

  it("sin IP conocida cuenta como una IP más", () => {
    const limite = new LimitePorIp({ maximo: 1, ventanaMs: 60_000, ahora: () => T0.getTime() });
    limite.registrarFallo(null);
    expect(limite.bloqueada(null)).toBe(true);
    expect(limite.bloqueada("10.0.0.1")).toBe(false);
  });

  it("los valores de la app: 30 fallos en 15 minutos (holgado: varias oficinas pueden salir por la misma IP)", () => {
    expect(MAXIMO_FALLOS_IP).toBe(30);
    expect(VENTANA_IP_MS).toBe(15 * 60 * 1000);
  });

  it("la memoria no crece sin fin: poda lo vencido", () => {
    let ahora = T0.getTime();
    const limite = new LimitePorIp({ maximo: 5, ventanaMs: 1000, ahora: () => ahora });
    for (let i = 0; i < 10_000; i++) limite.registrarFallo(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`);
    expect(limite.tamano).toBe(10_000);
    ahora += 1000;
    limite.registrarFallo("192.168.0.1");
    expect(limite.tamano).toBe(1);
  });
});
