import { describe, expect, it } from "vitest";
import { codificarFlujo, COOKIE_STATE, leerFlujo, urlDelDerivador, VIDA_STATE_SEG } from "./derivador";

const STATE = "0b7e6c1a-3f4d-4e5a-9b8c-7d6e5f4a3b2c";

describe("urlDelDerivador", () => {
  it("arma el fragmento #/login con next y state (el derivador usa HashRouter)", () => {
    const url = urlDelDerivador("https://cidituc.smt.gob.ar/", "cementeria", STATE);
    expect(url).toBe(`https://cidituc.smt.gob.ar/#/login?next=cementeria&state=${STATE}`);
  });

  it("reemplaza el fragmento que traiga la variable de entorno", () => {
    const url = urlDelDerivador("https://cidituc.smt.gob.ar/#/login?next=otra-app", "cementeria-staging", STATE);
    expect(url).toBe(`https://cidituc.smt.gob.ar/#/login?next=cementeria-staging&state=${STATE}`);
  });

  it("el state sale en el fragmento: nunca llega a un servidor ni a un log de acceso", () => {
    const url = new URL(urlDelDerivador("https://cidituc.smt.gob.ar/", "cementeria", STATE));
    expect(url.search).toBe("");
    expect(url.hash).toContain(STATE);
  });
});

describe("cookie del flujo", () => {
  it("se llama cem_cidituc_state y vive diez minutos", () => {
    expect(COOKIE_STATE).toBe("cem_cidituc_state");
    expect(VIDA_STATE_SEG).toBe(600);
  });

  it("guarda el state solo, o con el destino", () => {
    expect(leerFlujo(codificarFlujo(STATE, null))).toEqual({ state: STATE, volver: null });
    expect(leerFlujo(codificarFlujo(STATE, "/expedientes/2026-00012?pestaña=historial; x"))).toEqual({
      state: STATE,
      volver: "/expedientes/2026-00012?pestaña=historial; x",
    });
  });

  it("el valor no lleva caracteres que rompan una cookie", () => {
    expect(codificarFlujo(STATE, "/a b;c,d")).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
  });

  it.each([[undefined], [""], ["no-es-un-uuid"], [`${STATE.toUpperCase()}`], [`x${STATE}`]])(
    "rechaza un valor sin forma de state: %j",
    (valor) => {
      expect(leerFlujo(valor)).toBeNull();
    },
  );
});
