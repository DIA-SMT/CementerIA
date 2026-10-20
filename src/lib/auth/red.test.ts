import { describe, expect, it } from "vitest";
import { cookieSegura, opcionesBorrado, opcionesCookie } from "./cookies";
import { textoDeError } from "./errores";
import { hostnameDeSolicitud, ipDeSolicitud, mismoOrigen } from "./red";

describe("ipDeSolicitud", () => {
  it("prefiere X-Real-IP, que nginx pisa", () => {
    expect(ipDeSolicitud(new Headers({ "x-real-ip": "10.1.2.3", "x-forwarded-for": "1.1.1.1" }))).toBe("10.1.2.3");
  });

  it("usa el primer X-Forwarded-For si no hay X-Real-IP", () => {
    expect(ipDeSolicitud(new Headers({ "x-forwarded-for": "10.1.2.3, 127.0.0.1" }))).toBe("10.1.2.3");
  });

  it("acepta IPv6 y descarta lo que no es una IP (la columna es inet)", () => {
    expect(ipDeSolicitud(new Headers({ "x-real-ip": "::1" }))).toBe("::1");
    expect(ipDeSolicitud(new Headers({ "x-real-ip": "no-es-ip'; DROP" }))).toBeNull();
    expect(ipDeSolicitud(new Headers())).toBeNull();
  });
});

describe("mismoOrigen", () => {
  it("acepta un POST de una página propia", () => {
    expect(mismoOrigen(new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
  });

  it("compara el host aunque detrás de nginx Next vea http", () => {
    expect(
      mismoOrigen(new Headers({ origin: "https://cementeria.ejemplo.invalid", host: "cementeria.ejemplo.invalid" })),
    ).toBe(true);
  });

  it("rechaza un POST que viene de otro sitio", () => {
    expect(mismoOrigen(new Headers({ origin: "https://otro.sitio", host: "cementeria.ejemplo.invalid" }))).toBe(false);
    expect(mismoOrigen(new Headers({ origin: "null", host: "cementeria.ejemplo.invalid" }))).toBe(false);
  });

  it("compara contra Host, no contra X-Forwarded-Host (lo escribe el cliente)", () => {
    expect(
      mismoOrigen(
        new Headers({ origin: "https://otro.sitio", host: "cementeria.ejemplo.invalid", "x-forwarded-host": "otro.sitio" }),
      ),
    ).toBe(false);
  });

  it("sin Origin (no es un navegador) se acepta", () => {
    expect(mismoOrigen(new Headers({ host: "cementeria.ejemplo.invalid" }))).toBe(true);
  });
});

describe("hostnameDeSolicitud", () => {
  it("devuelve el host sin puerto", () => {
    expect(hostnameDeSolicitud(new Headers({ host: "cementeria-staging.ejemplo.invalid:3010" }))).toBe(
      "cementeria-staging.ejemplo.invalid",
    );
    expect(hostnameDeSolicitud(new Headers({ host: "[::1]:3000" }))).toBe("[::1]");
  });

  it("ignora X-Forwarded-Host, que puede escribir el cliente", () => {
    expect(
      hostnameDeSolicitud(new Headers({ host: "cementeria.ejemplo.invalid", "x-forwarded-host": "staging.otro" })),
    ).toBe("cementeria.ejemplo.invalid");
  });

  it("sin Host, vacío", () => {
    expect(hostnameDeSolicitud(new Headers())).toBe("");
  });
});

describe("cookies", () => {
  it("Secure siempre en producción, aunque Next vea http detrás de nginx", () => {
    expect(cookieSegura(new URL("http://127.0.0.1:3010/"), "production")).toBe(true);
  });

  it("sin Secure solo en http://localhost fuera de producción", () => {
    expect(cookieSegura(new URL("http://localhost:3000/"), "development")).toBe(false);
    expect(cookieSegura(new URL("http://127.0.0.1:3000/"), "development")).toBe(false);
    expect(cookieSegura(new URL("http://otra-pc:3000/"), "development")).toBe(true);
    expect(cookieSegura(new URL("https://localhost:3000/"), "development")).toBe(true);
  });

  it("httpOnly y SameSite=Lax", () => {
    expect(opcionesCookie(true, 600)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    expect(opcionesBorrado(false, "/auth/callback")).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/auth/callback",
      maxAge: 0,
    });
  });
});

describe("textoDeError", () => {
  it("distingue las tres fallas del state", () => {
    const textos = new Set([textoDeError("state_ausente"), textoDeError("state_vencido"), textoDeError("state_distinto")]);
    expect(textos.size).toBe(3);
    expect(textos.has(null)).toBe(false);
  });

  it("solo muestra códigos conocidos: el valor viene de la URL", () => {
    expect(textoDeError("<script>alert(1)</script>")).toBeNull();
    expect(textoDeError("toString")).toBeNull();
    expect(textoDeError(undefined)).toBeNull();
    expect(textoDeError("token_invalido")).toMatch(/Cidituc/);
  });
});
