import { describe, expect, it } from "vitest";
import { destinoSeguro, rutaDeLogin } from "./destino";

describe("destinoSeguro", () => {
  it.each([
    ["/bandeja", "/bandeja"],
    ["/expedientes/2026-00012", "/expedientes/2026-00012"],
    ["/expedientes?q=perez&estado=en_tramite", "/expedientes?q=perez&estado=en_tramite"],
    ["/expedientes/../panel", "/panel"],
  ])("acepta una ruta propia: %s", (valor, esperado) => {
    expect(destinoSeguro(valor)).toBe(esperado);
  });

  it.each([
    ["vacío", ""],
    ["null", null],
    ["absoluta a otro sitio", "https://otro.sitio/robar"],
    ["sin protocolo", "//otro.sitio/robar"],
    ["con barra invertida", "/\\otro.sitio"],
    ["con tabulador", "/\t/otro.sitio"],
    ["que normaliza a //", "/.//otro.sitio"],
    ["codificada que normaliza a //", "/%2e//otro.sitio"],
    ["javascript:", "javascript:alert(1)"],
    ["relativa sin barra", "bandeja"],
    ["el inicio", "/"],
    ["el login (daría una vuelta en círculo)", "/login?volver=/bandeja"],
    ["el callback", "/auth/callback?auth=x"],
    ["la salida", "/auth/salir"],
    ["el login simulado", "/dev/login"],
    ["una API", "/api/expedientes/1/adjuntos"],
    ["sin acceso", "/sin-acceso"],
    ["demasiado larga", `/expedientes?q=${"a".repeat(600)}`],
  ])("rechaza %s", (_caso, valor) => {
    expect(destinoSeguro(valor)).toBeNull();
  });

  it("no confunde /loginx con /login", () => {
    expect(destinoSeguro("/loginx")).toBe("/loginx");
  });
});

describe("rutaDeLogin", () => {
  it("sin destino ni error, /login a secas", () => {
    expect(rutaDeLogin(null)).toBe("/login");
    expect(rutaDeLogin("/")).toBe("/login");
  });

  it("lleva el error y el destino saneado", () => {
    expect(rutaDeLogin("/expedientes/2026-00012", "sesion_vencida")).toBe(
      "/login?error=sesion_vencida&volver=%2Fexpedientes%2F2026-00012",
    );
    expect(rutaDeLogin("//otro.sitio", "state_vencido")).toBe("/login?error=state_vencido");
  });
});
