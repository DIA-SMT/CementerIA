import { describe, expect, it } from "vitest";
import { analizarConsulta, armarBusqueda, type DatosBusqueda } from "./busqueda";

const base: DatosBusqueda = {
  anio: 2026,
  secuencia: 42,
  numeroMunicipal: "12.345/2026",
  padron: "P-0099",
  cementerio: "Cementerio del Oeste",
  ubicacionTexto: "Sección 3 · Cuadro B · Lote 12 · N° 45",
  personas: [
    { apellido: "GONZÁLEZ", nombres: "María José", dni: "30111222", razonSocial: null, cuit: null },
    { apellido: null, nombres: null, dni: null, razonSocial: null, cuit: null },
    { apellido: null, nombres: null, dni: null, razonSocial: "Asociación Ficticia de Socorros Mutuos", cuit: "30999990130" },
  ],
  extrasBuscables: ["Res. 77/2020", null, 15],
};

describe("armarBusqueda (2.13(g))", () => {
  it("incluye número interno y forma corta, N° municipal y padrón (como se escribieron y normalizados), cementerio, ubicación, personas y extras buscables", () => {
    const b = armarBusqueda(base);
    for (const parte of ["cem 2026 00042", "42", "12 345", "123452026", "p 0099", "p0099", "cementerio del oeste", "seccion 3", "cuadro b", "lote 12", "gonzalez maria jose", "30111222", "asociacion ficticia de socorros mutuos", "30999990130", "res 77", "15"]) {
      expect(b, parte).toContain(parte);
    }
  });

  it("todo normalizado: sin acentos ni mayúsculas", () => {
    expect(armarBusqueda(base)).toMatch(/^[a-z0-9 ]+$/);
  });

  it("sin partes repetidas y determinista", () => {
    const una = armarBusqueda(base);
    expect(armarBusqueda({ ...base, personas: [...base.personas, base.personas[0]] })).toBe(una);
    expect(una.match(/gonzalez/g)).toHaveLength(1);
    expect(armarBusqueda({ ...base })).toBe(una);
  });

  it("con datos mínimos", () => {
    expect(
      armarBusqueda({ anio: 2026, secuencia: 1, numeroMunicipal: null, padron: null, cementerio: "Norte", ubicacionTexto: "", personas: [], extrasBuscables: [] }),
    ).toBe("cem 2026 00001 1 2026 norte");
  });
});

describe("analizarConsulta: la caja única no adivina", () => {
  it("vacía", () => {
    expect(analizarConsulta("")).toEqual({ tipo: "vacia" });
    expect(analizarConsulta(undefined)).toEqual({ tipo: "vacia" });
    expect(analizarConsulta("  ¿? ")).toEqual({ tipo: "vacia" });
  });

  it("prefijo CEM explícito", () => {
    expect(analizarConsulta("CEM-2026-00042")).toEqual({ tipo: "numero_interno", anio: 2026, secuencia: 42, numero: "CEM-2026-00042" });
    expect(analizarConsulta("cem 2026 42")).toMatchObject({ tipo: "numero_interno", numero: "CEM-2026-00042" });
    expect(analizarConsulta("CEM2026/7")).toMatchObject({ numero: "CEM-2026-00007" });
  });

  it("CEM sin forma de número es texto", () => {
    expect(analizarConsulta("cementerio oeste")).toMatchObject({ tipo: "texto", palabras: ["cementerio", "oeste"] });
  });

  it("DNI con puntos", () => {
    expect(analizarConsulta("30.111.222")).toEqual({ tipo: "numerica", digitos: "30111222", formaCorta: null, dnis: ["30111222"], cuits: [] });
  });

  it("CUIL o CUIT de 11 dígitos: también el DNI que contiene y el CUIT de una persona jurídica", () => {
    expect(analizarConsulta("20-30111222-3")).toEqual({
      tipo: "numerica",
      digitos: "20301112223",
      formaCorta: null,
      dnis: ["20301112223", "30111222"],
      cuits: ["20301112223"],
    });
    expect(analizarConsulta("30-99999013-0")).toMatchObject({ cuits: ["30999990130"] });
  });

  it("N° municipal con barra, que también puede ser la forma corta de un número interno", () => {
    expect(analizarConsulta("1234/2026")).toEqual({
      tipo: "numerica",
      digitos: "12342026",
      formaCorta: { anio: 2026, secuencia: 1234 },
      dnis: ["12342026"],
      cuits: [],
    });
    expect(analizarConsulta("42 / 2026")).toMatchObject({ formaCorta: { anio: 2026, secuencia: 42 } });
  });

  it("texto: palabras normalizadas", () => {
    expect(analizarConsulta("Gonzalez  MARÍA")).toEqual({ tipo: "texto", normalizada: "gonzalez maria", palabras: ["gonzalez", "maria"] });
    // Letras y números mezclados no son "solo dígitos".
    expect(analizarConsulta("lote 12")).toMatchObject({ tipo: "texto" });
  });
});
