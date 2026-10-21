import { describe, expect, it } from "vitest";
import { RENOV_CONTADO as RENOV_CONTADO_SEMILLA } from "../../../../prisma/semilla/plantillas/renov-contado";
import { RENOV_PLAN as RENOV_PLAN_SEMILLA } from "../../../../prisma/semilla/plantillas/renov-plan";
import { inicioDelDiaEnTucuman, interpretarDatetimeLocal } from "@/lib/fechas";
import type { DefinicionPlantilla, PasoPlantilla } from "../plantillas/esquema";
import { resolverDefinicion } from "../plantillas/resolver";
import { ErrorDominio } from "./errores";
import {
  destinosPosibles,
  esAnterior,
  faltantesDelPaso,
  faltantesParaSalir,
  faltantesParaConcluir,
  aniosDelPlazo,
  semaforoPlazo,
  textoPlazo,
  interpretarFechaEfectiva,
  plazoAlEntrar,
  subtareasReiniciables,
  validarFechaEfectiva,
  type FechaEfectiva,
} from "./flujo";
import type { ItemsExpediente, ItemSubtarea } from "./items";
import { validarDato } from "./subtareas";

// Las reglas del flujo reciben la definición ya resuelta para el expediente
// (plantillas/resolver.ts): acá, un expediente del Norte con titular persona
// física, que ve los mismos conceptos, documentos y subtareas que antes de la
// semana 4.
const RENOV_CONTADO = resolverDefinicion(RENOV_CONTADO_SEMILLA, { cementerio: "NORTE", rolesJuridicos: [] });
const RENOV_PLAN = resolverDefinicion(RENOV_PLAN_SEMILLA, { cementerio: "NORTE", rolesJuridicos: [] });

function items(cambios: Partial<ItemsExpediente> = {}): ItemsExpediente {
  return { subtareas: {}, documentos: {}, adjuntos: {}, ...cambios };
}

const hecha = (dato: string | null = null): ItemSubtarea => ({ hecha: true, dato, mov: 1, reiniciada_por_mov: null, historica: false });
const presentado = { estado: "presentado" as const, obs: null, mov: 1, adjuntos: [] };

/** Todo lo de MESA hecho en RENOV_CONTADO. */
const MESA_COMPLETA = items({
  subtareas: { MESA_CARATULA: hecha() },
  documentos: { FORM_INICIO_RENOV: presentado, DNI: presentado, BOLETA_SERVICIO: presentado },
});

function error(fn: () => unknown): ErrorDominio {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDominio) return e;
    throw e;
  }
  throw new Error("se esperaba ErrorDominio");
}

describe("faltantesParaSalir (3.3, puntos 4 a 6)", () => {
  it("en el alta de RENOV_CONTADO falta la carátula y los 3 documentos de Mesa", () => {
    const faltan = faltantesDelPaso(RENOV_CONTADO, items(), {}, 1);
    expect(faltan.map((f) => `${f.tipo}:${f.clave}`)).toEqual([
      "subtarea:MESA_CARATULA",
      "documento:FORM_INICIO_RENOV",
      "documento:DNI",
      "documento:BOLETA_SERVICIO",
    ]);
    expect(faltantesDelPaso(RENOV_CONTADO, MESA_COMPLETA, {}, 1)).toEqual([]);
  });

  it("una subtarea con fecha obligatoria tildada sin fecha falta como sin_dato", () => {
    const i = items({ subtareas: { LIQ_DEBITOS: hecha(), LIQ_BOLETA: hecha(), LIQ_PAGO: hecha(null) } });
    const faltan = faltantesParaSalir(RENOV_CONTADO, i, {}, { pasosConSubtareas: [3], hastaOrden: 0 });
    expect(faltan).toEqual([expect.objectContaining({ tipo: "subtarea", clave: "LIQ_PAGO", motivo: "sin_dato" })]);
  });

  it("los documentos son acumulativos: lo exigido al salir de Mesa se sigue exigiendo después", () => {
    const sinDni = items({ ...MESA_COMPLETA, documentos: { FORM_INICIO_RENOV: presentado, BOLETA_SERVICIO: presentado } });
    const faltan = faltantesParaSalir(RENOV_CONTADO, sinDni, {}, { pasosConSubtareas: [], hastaOrden: 2 });
    expect(faltan.map((f) => f.clave)).toEqual(["CONST_COMPUTOS", "DNI"]);
  });

  it("no corresponde sin observación, adjunto obligatorio sin adjunto vigente, histórico aceptado", () => {
    const def: DefinicionPlantilla = {
      ...RENOV_CONTADO,
      documentos: RENOV_CONTADO.documentos.map((d) => (d.clave === "DNI" ? { ...d, adjunto: "obligatorio" as const } : d)),
    };
    const i = items({
      subtareas: { MESA_CARATULA: { ...hecha(), hecha: false, historica: true } },
      documentos: {
        FORM_INICIO_RENOV: { estado: "no_corresponde", obs: null, mov: 1, adjuntos: [] },
        DNI: { estado: "presentado", obs: null, mov: 1, adjuntos: [7] },
        BOLETA_SERVICIO: { estado: "historico", obs: null, mov: null, adjuntos: [] },
      },
      adjuntos: { "7": { documento: "DNI", vigente: false, purgado: false } },
    });
    expect(faltantesDelPaso(def, i, {}, 1).map((f) => [f.clave, f.tipo === "documento" ? f.motivo : ""])).toEqual([
      ["FORM_INICIO_RENOV", "sin_observacion"],
      ["DNI", "sin_adjunto"],
    ]);
  });

  it("campos extra obligatorios exigibles hasta el paso", () => {
    const def: DefinicionPlantilla = {
      ...RENOV_CONTADO,
      campos_extra: RENOV_CONTADO.campos_extra.map((c) => ({ ...c, obligatorio: true, exigir_al_salir_de: "MESA" })),
    };
    expect(faltantesDelPaso(def, MESA_COMPLETA, { concesion_desde: "2026-01-01" }, 1)).toEqual([
      expect.objectContaining({ tipo: "campo_extra", clave: "concesion_hasta", mensaje: "Vencimiento de la concesión: falta completarlo" }),
    ]);
  });
});

describe("destinosPosibles (3.3, punto 8)", () => {
  it("el siguiente; en el último paso, ninguno", () => {
    expect(destinosPosibles(RENOV_CONTADO, MESA_COMPLETA, {}, 1, null).map((d) => [d.clave, d.tipo, d.faltan.length])).toEqual([
      ["COMPUTO_ALTA", "siguiente", 0],
    ]);
    expect(destinosPosibles(RENOV_CONTADO, items(), {}, 7, null)).toEqual([]);
  });

  it("reenvío directo al paso que devolvió: exige los intermedios y lo reiniciado, aunque no sea obligatorio", () => {
    // Legal (4) devolvió a Cómputo alta (2): el reenvío va de 2 a 4 salteando Liquidación.
    const base = {
      subtareas: { MESA_CARATULA: hecha(), COMP_GRABADO: hecha("R-1"), LIQ_DEBITOS: hecha(), LIQ_PAGO: hecha("2026-10-01") },
      documentos: {
        ...MESA_COMPLETA.documentos,
        CONST_COMPUTOS: presentado,
        ESTADO_CUENTA: presentado,
        CONST_PERIODOS: presentado,
        INFORME_TECNICO: presentado,
        COMPROBANTE_PAGO: presentado,
      },
    };
    const reiniciada: ItemSubtarea = { hecha: false, dato: null, mov: 9, reiniciada_por_mov: 9, historica: false };
    const falta = destinosPosibles(RENOV_CONTADO, items({ ...base, subtareas: { ...base.subtareas, LIQ_BOLETA: reiniciada } }), {}, 2, "LEGAL");
    expect(falta.map((d) => [d.clave, d.tipo, d.esRetorno])).toEqual([
      ["LIQUIDACION", "siguiente", false],
      ["LEGAL", "reenvio", true],
    ]);
    expect(falta[0].faltan).toEqual([]);
    expect(falta[1].pasosSalteados).toEqual(["LIQUIDACION"]);
    expect(falta[1].faltan).toEqual([expect.objectContaining({ clave: "LIQ_BOLETA", motivo: "reiniciada" })]);

    const completo = destinosPosibles(RENOV_CONTADO, items({ ...base, subtareas: { ...base.subtareas, LIQ_BOLETA: hecha("B-2") } }), {}, 2, "LEGAL");
    expect(completo[1].faltan).toEqual([]);

    // Una subtarea opcional reiniciada también frena el reenvío (pero no el pase al siguiente).
    const def: DefinicionPlantilla = {
      ...RENOV_CONTADO,
      pasos: RENOV_CONTADO.pasos.map((p) => (p.clave === "LIQUIDACION" ? { ...p, subtareas: p.subtareas.map((s) => ({ ...s, obligatoria: false })) } : p)),
    };
    const opcional = destinosPosibles(def, items({ ...base, subtareas: { ...base.subtareas, LIQ_BOLETA: reiniciada } }), {}, 2, "LEGAL");
    expect(opcional[1].faltan.map((f) => f.clave)).toEqual(["LIQ_BOLETA"]);
  });

  it("si el paso que devolvió es el siguiente, es el siguiente con esRetorno", () => {
    expect(destinosPosibles(RENOV_CONTADO, MESA_COMPLETA, {}, 1, "COMPUTO_ALTA")).toEqual([
      expect.objectContaining({ clave: "COMPUTO_ALTA", tipo: "siguiente", esRetorno: true }),
    ]);
  });

  it("posteriores salteando solo omitibles, con motivo", () => {
    const omitible = (p: PasoPlantilla): PasoPlantilla => ({ ...p, omitible: true });
    const def: DefinicionPlantilla = {
      ...RENOV_CONTADO,
      pasos: RENOV_CONTADO.pasos.map((p) => (p.clave === "COMPUTO_ALTA" || p.clave === "LIQUIDACION" ? omitible(p) : p)),
    };
    const destinos = destinosPosibles(def, MESA_COMPLETA, {}, 1, null);
    expect(destinos.map((d) => [d.clave, d.tipo, d.requiereMotivo, d.pasosOmitidos])).toEqual([
      ["COMPUTO_ALTA", "siguiente", false, []],
      ["LIQUIDACION", "omitiendo", true, ["COMPUTO_ALTA"]],
      ["LEGAL", "omitiendo", true, ["COMPUTO_ALTA", "LIQUIDACION"]],
    ]);
    // Legal no es omitible: no se puede saltear para llegar a Administrativo.
    expect(destinos.some((d) => d.clave === "ADM_RESOLUCION")).toBe(false);
  });
});

describe("subtareasReiniciables (3.4)", () => {
  it("las tildadas de los pasos anteriores al actual, con su paso", () => {
    const i = items({ subtareas: { MESA_CARATULA: hecha(), LIQ_BOLETA: hecha("B-1"), LEG_DICTAMEN: hecha() } });
    expect(subtareasReiniciables(RENOV_CONTADO, i, 4).map((s) => [s.clave, s.paso.orden])).toEqual([
      ["MESA_CARATULA", 1],
      ["LIQ_BOLETA", 3],
    ]);
  });
});

describe("fechas efectivas (2.13(c) y 3.3 punto 7)", () => {
  const ahora = new Date("2026-10-20T15:00:00Z"); // 12:00 en Tucumán

  it("interpreta vacío, día, datetime-local y Date", () => {
    expect(interpretarFechaEfectiva(undefined, ahora)).toEqual({ instante: ahora, precision: "minuto" });
    expect(interpretarFechaEfectiva("", ahora)).toEqual({ instante: ahora, precision: "minuto" });
    expect(interpretarFechaEfectiva("2026-10-15", ahora)).toEqual({ instante: inicioDelDiaEnTucuman("2026-10-15"), precision: "dia" });
    expect(interpretarFechaEfectiva("2026-10-15T09:30", ahora)).toEqual({ instante: interpretarDatetimeLocal("2026-10-15T09:30"), precision: "minuto" });
    const d = new Date("2026-10-19T12:00:00Z");
    expect(interpretarFechaEfectiva(d, ahora)).toEqual({ instante: d, precision: "minuto" });
    expect(error(() => interpretarFechaEfectiva("15/10/2026", ahora)).errores[0]?.ruta).toBe("fechaEfectiva");
    expect(error(() => interpretarFechaEfectiva("2026-02-30", ahora)).codigo).toBe("validacion");
  });

  const limites = { ahora, fechaInicio: "2026-09-01" };

  it("no futura (con un minuto de tolerancia), hasta 30 días, no antes del inicio", () => {
    expect(() => validarFechaEfectiva(interpretarFechaEfectiva("2026-10-20", ahora), limites)).not.toThrow();
    expect(() => validarFechaEfectiva({ instante: new Date(ahora.getTime() + 30_000), precision: "minuto" }, limites)).not.toThrow();
    expect(error(() => validarFechaEfectiva({ instante: new Date(ahora.getTime() + 120_000), precision: "minuto" }, limites)).errores[0]?.mensaje).toMatch(
      /posterior a ahora/,
    );
    expect(error(() => validarFechaEfectiva(interpretarFechaEfectiva("2026-10-21", ahora), limites)).errores[0]?.mensaje).toMatch(/posterior/);
    expect(() => validarFechaEfectiva(interpretarFechaEfectiva("2026-09-20", ahora), limites)).not.toThrow();
    expect(error(() => validarFechaEfectiva(interpretarFechaEfectiva("2026-09-19", ahora), limites)).errores[0]?.mensaje).toMatch(/30 días/);
    expect(error(() => validarFechaEfectiva(interpretarFechaEfectiva("2026-10-01", ahora), { ...limites, fechaInicio: "2026-10-05" })).errores[0]?.mensaje).toMatch(
      /inicio del expediente \(05\/10\/2026\)/,
    );
    // Sin límite de días (la fecha de una subtarea de un paso externo).
    expect(() => validarFechaEfectiva(interpretarFechaEfectiva("2026-09-02", ahora), { ...limites, diasAtras: null })).not.toThrow();
  });

  it("no anterior al último movimiento de ubicación; por día si alguno tiene precisión de día", () => {
    const ultimo: FechaEfectiva = { instante: interpretarDatetimeLocal("2026-10-15T10:00"), precision: "minuto" };
    const con = (f: FechaEfectiva) => () => validarFechaEfectiva(f, { ...limites, ultimoDeUbicacion: ultimo });
    expect(con(interpretarFechaEfectiva("2026-10-15T09:59", ahora))).toThrow(/Revisá la fecha/);
    expect(error(con(interpretarFechaEfectiva("2026-10-15T09:59", ahora))).errores[0]?.mensaje).toMatch(/15\/10\/2026 10:00/);
    expect(con(interpretarFechaEfectiva("2026-10-15T10:00", ahora))).not.toThrow();
    // El 15 con precisión de día no es anterior al 15 a las 10:00.
    expect(con(interpretarFechaEfectiva("2026-10-15", ahora))).not.toThrow();
    expect(con(interpretarFechaEfectiva("2026-10-14", ahora))).toThrow();
    expect(esAnterior(interpretarFechaEfectiva("2026-10-15T23:59", ahora), { instante: inicioDelDiaEnTucuman("2026-10-16"), precision: "dia" })).toBe(true);
  });
});

describe("plazo del paso (3.6)", () => {
  const dim = RENOV_PLAN.pasos.find((p) => p.clave === "DIM");
  const tributario = RENOV_PLAN.pasos.find((p) => p.clave === "TRIBUTARIO");

  it("al entrar a la DIM: 30 días hábiles desde la notificación; sin plazo, todo null", () => {
    if (!dim || !tributario) throw new Error("falta el paso");
    expect(plazoAlEntrar(dim, items({ subtareas: { TRIB_NOTIFICADA: hecha("2026-10-10") } }))).toEqual({
      plazoDiasHabiles: 30,
      plazoDesde: "2026-10-10",
      plazoCumplidoEn: null,
    });
    expect(plazoAlEntrar(dim, items())).toEqual({ plazoDiasHabiles: 30, plazoDesde: null, plazoCumplidoEn: null });
    expect(plazoAlEntrar(tributario, items({ subtareas: { TRIB_NOTIFICADA: hecha("2026-10-10") } }))).toEqual({
      plazoDiasHabiles: null,
      plazoDesde: null,
      plazoCumplidoEn: null,
    });
  });
});

describe("dato de una subtarea", () => {
  const limites = { hoy: "2026-10-20", fechaInicio: "2026-10-01" };
  const pago = RENOV_CONTADO.pasos[2].subtareas.find((s) => s.clave === "LIQ_PAGO");
  const boleta = RENOV_CONTADO.pasos[2].subtareas.find((s) => s.clave === "LIQ_BOLETA");
  const debitos = RENOV_CONTADO.pasos[2].subtareas.find((s) => s.clave === "LIQ_DEBITOS");

  it("fecha obligatoria, texto opcional, sin dato", () => {
    if (!pago || !boleta || !debitos) throw new Error("falta la subtarea");
    expect(validarDato(pago, "2026-10-15", limites)).toBe("2026-10-15");
    expect(error(() => validarDato(pago, null, limites)).errores[0]).toEqual({ ruta: "dato", mensaje: "Indicá la fecha" });
    expect(error(() => validarDato(pago, "2026-10-21", limites)).errores[0]?.mensaje).toMatch(/futura/);
    expect(error(() => validarDato(pago, "2026-09-30", limites)).errores[0]?.mensaje).toMatch(/inicio/);
    expect(validarDato(boleta, "  B-123  ", limites)).toBe("B-123");
    expect(validarDato(boleta, "", limites)).toBeNull();
    expect(error(() => validarDato(boleta, "x".repeat(201), limites)).errores[0]?.mensaje).toMatch(/200/);
    expect(validarDato(debitos, null, limites)).toBeNull();
    expect(error(() => validarDato(debitos, "algo", limites)).errores[0]?.mensaje).toMatch(/no lleva dato/);
  });
});

describe("semana 4: concluir y semáforo del plazo", () => {
  const ultimo = RENOV_CONTADO.pasos.length;
  const final = RENOV_CONTADO.pasos[ultimo - 1];

  it("concluir exige las subtareas del último paso y lo acumulado", () => {
    const faltan = faltantesParaConcluir(RENOV_CONTADO, items(), {});
    expect(faltan.some((f) => f.tipo === "subtarea" && f.clave === final.subtareas[0]?.clave)).toBe(true);
    // Lo exigido al salir de Mesa también (la regla es acumulativa).
    expect(faltan.some((f) => f.tipo === "documento" && f.clave === "DNI")).toBe(true);
  });

  it("y los documentos y campos con exigir_al_salir_de: null, que el pase no pide", () => {
    const def: DefinicionPlantilla = {
      ...RENOV_CONTADO,
      documentos: [
        ...RENOV_CONTADO.documentos,
        { ...RENOV_CONTADO.documentos[0], clave: "TITULO_FIRMADO", nombre: "Título firmado", obligatorio: true, exigir_al_salir_de: null },
      ],
      campos_extra: RENOV_CONTADO.campos_extra.map((c) => (c.clave === "concesion_hasta" ? { ...c, obligatorio: true, exigir_al_salir_de: null } : c)),
    };
    const claves = (f: ReturnType<typeof faltantesParaConcluir>) => f.map((x) => x.clave);
    expect(claves(faltantesParaConcluir(def, items(), {}))).toEqual(expect.arrayContaining(["TITULO_FIRMADO", "concesion_hasta"]));
    expect(claves(faltantesDelPaso(def, items(), {}, ultimo - 1))).not.toContain("TITULO_FIRMADO");
    const f = faltantesParaConcluir(def, items(), {}).find((x) => x.clave === "TITULO_FIRMADO");
    expect(f?.tipo === "documento" && f.exigirAlSalirDe.clave).toBe(final.clave);
  });

  it("semáforo: sin iniciar, en término, ámbar con 5 o menos, rojo vencido, cumplido", () => {
    expect(semaforoPlazo({ desde: null, cumplidoEn: null, faltan: null })).toBe("sin_iniciar");
    expect(semaforoPlazo({ desde: "2026-10-01", cumplidoEn: null, faltan: 6 })).toBe("en_termino");
    expect(semaforoPlazo({ desde: "2026-10-01", cumplidoEn: null, faltan: 5 })).toBe("por_vencer");
    expect(semaforoPlazo({ desde: "2026-10-01", cumplidoEn: null, faltan: 0 })).toBe("por_vencer");
    expect(semaforoPlazo({ desde: "2026-10-01", cumplidoEn: null, faltan: -1 })).toBe("vencido");
    expect(semaforoPlazo({ desde: "2026-10-01", cumplidoEn: "2026-10-10", faltan: -3 })).toBe("cumplido");
  });

  it("texto del plazo y años que tienen que estar cerrados", () => {
    expect(textoPlazo({ vence: "2026-11-30", faltan: 3, cumplidoEn: null, provisorio: false })).toBe("vence 30/11 · faltan 3 días hábiles");
    expect(textoPlazo({ vence: "2026-11-30", faltan: 1, cumplidoEn: null, provisorio: true })).toBe("vence 30/11 · faltan 1 día hábil (provisorio)");
    expect(textoPlazo({ vence: "2026-11-30", faltan: 0, cumplidoEn: null, provisorio: false })).toBe("vence hoy 30/11");
    expect(textoPlazo({ vence: "2026-11-30", faltan: -2, cumplidoEn: null, provisorio: false })).toBe("venció el 30/11 (hace 2 días hábiles)");
    expect(textoPlazo({ vence: null, faltan: null, cumplidoEn: null, provisorio: false })).toMatch(/notificación/);
    expect(textoPlazo({ vence: "2026-11-30", faltan: 2, cumplidoEn: "2026-11-02", provisorio: false })).toBe("plazo cumplido el 02/11/2026");
    expect(aniosDelPlazo("2026-12-01", "2027-01-20")).toEqual([2026, 2027]);
    expect(aniosDelPlazo("2026-10-01", "2026-11-20")).toEqual([2026]);
  });
});
