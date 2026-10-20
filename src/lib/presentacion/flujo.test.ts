import { describe, expect, it } from "vitest";
import type { DestinoPase, Faltante } from "@/lib/dominio/expedientes/flujo";
import {
  aplicarAtajo,
  destinoInicial,
  formatearBytes,
  itemsFaltan,
  leerPestana,
  limitesFecha,
  nuevoComandoId,
  opcionesDestino,
  pestanaPorDefecto,
  reiniciablesPara,
  resumenLote,
  rutaCampoExtra,
  textoBotonPase,
  textoDevuelto,
  textoDias,
  valorFechaEfectiva,
} from "./flujo";

const paso = (orden: number, clave = `P${orden}`) => ({ clave, nombre: `Paso ${orden}`, orden });

const FALTAN: Faltante[] = [
  { tipo: "subtarea", clave: "MESA_CARATULA", nombre: "Carátula", paso: paso(1), motivo: "sin_tildar", mensaje: "Carátula: falta tildarla" },
  { tipo: "subtarea", clave: "COMP_GRABADO", nombre: "Grabado", paso: paso(1), motivo: "sin_dato", mensaje: "Grabado: falta el dato" },
  { tipo: "documento", clave: "DNI", nombre: "DNI", exigirAlSalirDe: paso(1), motivo: "pendiente", mensaje: "DNI: pendiente" },
  { tipo: "documento", clave: "NC", nombre: "Nota", exigirAlSalirDe: paso(1), motivo: "sin_observacion", mensaje: 'Nota: "no corresponde" necesita una observación' },
  { tipo: "documento", clave: "COMPROBANTE", nombre: "Comprobante", exigirAlSalirDe: paso(1), motivo: "sin_adjunto", mensaje: "Comprobante: falta adjuntar el archivo" },
  { tipo: "campo_extra", clave: "concesion_hasta", etiqueta: "Concesión hasta", exigirAlSalirDe: paso(1), mensaje: "Concesión hasta: falta completarlo" },
];

const TODO = { tildarSubtarea: true, marcarDocumento: true, adjuntar: true, completarCamposExtra: true };

describe("bandeja: pestaña por defecto", () => {
  const cero = { por_confirmar: 0, en_mi_area: 0, afuera: 0, afueraCustodia: 0 };

  it("la pedida en la URL manda, aunque esté vacía", () => {
    expect(pestanaPorDefecto({ ...cero, por_confirmar: 3 }, "afuera")).toBe("afuera");
  });

  it("sin pedido, la primera con trabajo: por confirmar, en mi área, afuera", () => {
    expect(pestanaPorDefecto({ ...cero, por_confirmar: 1, en_mi_area: 9 }, null)).toBe("por_confirmar");
    expect(pestanaPorDefecto({ ...cero, en_mi_area: 2, afueraCustodia: 4, afuera: 4 }, null)).toBe("en_mi_area");
    expect(pestanaPorDefecto({ ...cero, afuera: 1, afueraCustodia: 1 }, null)).toBe("afuera");
  });

  it("lo que Mesa de Entradas solo consulta afuera no es trabajo; sin nada, En mi área", () => {
    expect(pestanaPorDefecto({ ...cero, afuera: 12, afueraCustodia: 0 }, null)).toBe("en_mi_area");
    expect(pestanaPorDefecto(cero, null)).toBe("en_mi_area");
  });

  it("?pestana= solo acepta las de la semana 3", () => {
    expect(leerPestana("afuera")).toBe("afuera");
    expect(leerPestana(["por_confirmar", "x"])).toBe("por_confirmar");
    expect(leerPestana("plazos")).toBeNull();
    expect(leerPestana(undefined)).toBeNull();
  });

  it("textos de la fila y del lote", () => {
    expect(textoDias(1)).toBe("1 día hábil");
    expect(textoDias(0)).toBe("0 días hábiles");
    expect(textoDevuelto({ porArea: "Asesoría Legal", motivo: "Falta firma del director" })).toBe("Devuelto por Asesoría Legal: Falta firma del director");
    expect(textoDevuelto({ porArea: null, motivo: null })).toBe("Devuelto");
    const r = resumenLote([
      { ok: true, numero: "A" },
      { ok: true, numero: "B" },
      { ok: false, numero: "C", mensaje: "Otro usuario modificó el expediente; recargá" },
    ]);
    expect(r).toEqual({
      confirmados: 2,
      fallidos: [{ numero: "C", mensaje: "Otro usuario modificó el expediente; recargá" }],
      texto: "Se confirmaron 2 recepciones; 1 no se pudo confirmar.",
    });
    expect(resumenLote([{ ok: true, numero: "A" }]).texto).toBe("Se confirmó 1 recepción.");
  });
});

describe('"Faltan N": la lista con acceso directo', () => {
  it("cada faltante abre lo que lo resuelve", () => {
    const items = itemsFaltan(FALTAN, TODO, "/expedientes/CEM-2026-00001/editar");
    expect(items.map((i) => [i.id, i.accion?.etiqueta, i.accion?.acceso])).toEqual([
      ["subtareas.MESA_CARATULA", "Tildar", { tipo: "tildar", clave: "MESA_CARATULA" }],
      ["subtareas.COMP_GRABADO", "Completar el dato", { tipo: "tildar", clave: "COMP_GRABADO" }],
      ["documentos.DNI", "Marcar", { tipo: "documento", clave: "DNI" }],
      ["documentos.NC", "Agregar la observación", { tipo: "documento", clave: "NC" }],
      ["documentos.COMPROBANTE", "Adjuntar", { tipo: "adjuntar", documento: "COMPROBANTE" }],
      [
        "datosExtra.concesion_hasta",
        "Completar",
        { tipo: "campo", href: "/expedientes/CEM-2026-00001/editar#campo-datosExtra-concesion_hasta" },
      ],
    ]);
    expect(items.every((i) => i.aviso === null)).toBe(true);
    expect(items[0].texto).toBe("Carátula: falta tildarla");
  });

  it("sin permiso para esa cosa, sin acceso y con aviso", () => {
    const items = itemsFaltan(FALTAN, { tildarSubtarea: false, marcarDocumento: true, adjuntar: false, completarCamposExtra: false }, "/e");
    expect(items.map((i) => i.accion === null)).toEqual([true, true, false, false, true, true]);
    expect(items[0].aviso).toBe("La tilda el área responsable");
    expect(items[4].aviso).toMatch(/Mesa de Entradas/);
  });

  it("el botón dice cuántos faltan", () => {
    expect(textoBotonPase(0)).toBe("Dar pase");
    expect(textoBotonPase(3)).toBe("Dar pase · Faltan 3");
    expect(rutaCampoExtra("/x/editar", "a.b")).toBe("/x/editar#campo-datosExtra-a-b");
  });
});

describe("diálogo de pase: destinos", () => {
  const nombre = (c: string) => ({ P3: "Liquidación", P4: "Legal" })[c] ?? c;
  const destinos: DestinoPase[] = [
    { ...paso(3, "P3"), tipo: "siguiente", esRetorno: false, pasosSalteados: [], pasosOmitidos: [], requiereMotivo: false, faltan: [FALTAN[0]] },
    { ...paso(5, "P5"), tipo: "reenvio", esRetorno: true, pasosSalteados: ["P3", "P4"], pasosOmitidos: [], requiereMotivo: false, faltan: [] },
    { ...paso(4, "P4"), tipo: "omitiendo", esRetorno: false, pasosSalteados: [], pasosOmitidos: ["P3"], requiereMotivo: true, faltan: [] },
  ];

  it("explica cada destino y deshabilita los que tienen algo pendiente", () => {
    const o = opcionesDestino(destinos, nombre);
    expect(o[0]).toMatchObject({ clave: "P3", etiqueta: "3. Paso 3 (paso siguiente)", disponible: false, faltan: 1 });
    expect(o[0].detalle).toBe("Falta 1 cosa: Carátula: falta tildarla.");
    expect(o[1]).toMatchObject({ etiqueta: "5. Paso 5 (reenvío directo)", detalle: "Vuelve al paso que lo devolvió, salteando Liquidación, Legal.", disponible: true });
    expect(o[2]).toMatchObject({ etiqueta: "4. Paso 4 (salteando Liquidación)", requiereMotivo: true, disponible: true });
    expect(destinoInicial(o)).toBe("P5");
    expect(destinoInicial([])).toBeNull();
  });

  it("el siguiente que es el paso que lo devolvió lo dice", () => {
    const o = opcionesDestino([{ ...destinos[0], esRetorno: true, faltan: [] }], nombre);
    expect(o[0]).toMatchObject({ detalle: "Es el paso que lo devolvió.", disponible: true });
  });
});

describe("devolución", () => {
  it("los atajos van al comienzo del motivo y se reemplazan entre sí", () => {
    expect(aplicarAtajo("", "Falta firma")).toBe("Falta firma: ");
    expect(aplicarAtajo("del director en la resolución", "Falta firma")).toBe("Falta firma: del director en la resolución");
    expect(aplicarAtajo("Falta firma: del director", "Error en boleta")).toBe("Error en boleta: del director");
    expect(aplicarAtajo("falta documentación. DNI vencido", "Falta firma")).toBe("Falta firma: DNI vencido");
  });

  it("se ofrecen las subtareas del paso destino en adelante", () => {
    const r = [
      { clave: "A", nombre: "A", paso: paso(1) },
      { clave: "B", nombre: "B", paso: paso(2) },
      { clave: "C", nombre: "C", paso: paso(3) },
    ];
    expect(reiniciablesPara(r, 2).map((s) => s.clave)).toEqual(["B", "C"]);
    expect(reiniciablesPara(r, null)).toEqual([]);
  });
});

describe("fecha efectiva", () => {
  // 20/10/2026 15:42 en Tucumán (UTC-3).
  const ahora = new Date("2026-10-20T18:42:10Z");

  it("de hace 30 días (desde las 00:00) a ahora, en hora de Tucumán", () => {
    expect(limitesFecha(ahora)).toEqual({ minDia: "2026-09-20", maxDia: "2026-10-20", minMomento: "2026-09-20T00:00", maxMomento: "2026-10-20T15:42" });
  });

  it("lo que se manda según la precisión elegida", () => {
    expect(valorFechaEfectiva("ahora", "2026-10-19T10:00", "2026-10-19")).toBe("");
    expect(valorFechaEfectiva("momento", "2026-10-19T10:00", "2026-10-18")).toBe("2026-10-19T10:00");
    expect(valorFechaEfectiva("dia", "2026-10-19T10:00", " 2026-10-18 ")).toBe("2026-10-18");
  });
});

describe("varios", () => {
  it("comandoId: randomUUID si está; si no (http en la red municipal), uno v4 con getRandomValues", () => {
    expect(nuevoComandoId({ randomUUID: () => "11111111-1111-4111-8111-111111111111", getRandomValues: <T extends ArrayBufferView | null>(a: T) => a })).toBe("11111111-1111-4111-8111-111111111111");
    const sinUuid = nuevoComandoId({ getRandomValues: <T extends ArrayBufferView | null>(a: T) => (a instanceof Uint8Array ? (a.fill(0xff), a) : a) });
    expect(sinUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const tira = nuevoComandoId({
      randomUUID: () => {
        throw new Error("contexto inseguro");
      },
      getRandomValues: <T extends ArrayBufferView | null>(a: T) => a,
    });
    expect(tira).toBe("00000000-0000-4000-8000-000000000000");
    expect(nuevoComandoId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("bytes legibles", () => {
    expect(formatearBytes(512)).toBe("512 B");
    expect(formatearBytes(2048)).toBe("2 KB");
    expect(formatearBytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});
