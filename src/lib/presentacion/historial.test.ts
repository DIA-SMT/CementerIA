import { describe, expect, it } from "vitest";
import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import { contextoResumen, resumenMovimiento } from "./historial";

function movimiento(cambios: Partial<MovimientoFicha>): MovimientoFicha {
  return {
    id: "1",
    secuencia: 1,
    tipo: "alta",
    fechaEfectiva: new Date("2026-10-15T13:00:00Z"),
    precisionFecha: "minuto",
    registradoEn: new Date("2026-10-15T13:00:00Z"),
    diferido: false,
    usuario: { id: 2, nombre: "Prueba", apellido: "Mesa", corto: "P. Mesa" },
    areaUsuario: { codigo: "MESA_ENTRADAS", nombre: "Mesa de Entradas" },
    pasoOrigen: null,
    pasoDestino: null,
    areaOrigen: null,
    areaDestino: null,
    estadoAnterior: null,
    estadoNuevo: null,
    observacion: null,
    motivo: null,
    datos: {},
    cargaHistorica: false,
    fuente: null,
    corrigeMovimientoId: null,
    corregidoPor: [],
    personasCreadas: [],
    ...cambios,
  };
}

const ctx = contextoResumen(
  [
    { id: "10", etiquetaRol: "Titular", apellido: "FICTICIO", nombres: "Uno" },
    { id: "11", etiquetaRol: "Titular", apellido: "FICTICIO", nombres: "Uno Corregido" },
    { id: "12", etiquetaRol: "Solicitante", apellido: "OTRA", nombres: "Dos" },
  ],
  [{ clave: "concesion_hasta", etiqueta: "Vencimiento de la concesión" }],
);

describe("resumen de cada movimiento", () => {
  it("alta: dónde ingresó, el paso y las personas", () => {
    const m = movimiento({
      areaDestino: { codigo: "MESA_ENTRADAS", nombre: "Mesa de Entradas" },
      pasoDestino: { clave: "MESA", nombre: "Ingreso en Mesa de Entradas" },
      estadoNuevo: "en_tramite",
      personasCreadas: [{ id: "10", rol: "titular", orden: 1, reemplazaA: null }],
    });
    expect(resumenMovimiento(m, ctx)).toEqual([
      "Ingresó en Mesa de Entradas",
      "Paso: Ingreso en Mesa de Entradas",
      "Estado: En trámite",
      "Persona: Titular FICTICIO, Uno",
    ]);
  });

  it("pase: de dónde a dónde", () => {
    const m = movimiento({
      tipo: "pase",
      areaOrigen: { codigo: "MESA_ENTRADAS", nombre: "Mesa de Entradas" },
      areaDestino: { codigo: "COMPUTO", nombre: "Cómputo" },
      pasoOrigen: { clave: "MESA", nombre: "Mesa" },
      pasoDestino: { clave: "COMPUTO_ALTA", nombre: "Alta en Cómputo" },
    });
    expect(resumenMovimiento(m, ctx)).toEqual(["De Mesa de Entradas a Cómputo", "Paso: Mesa → Alta en Cómputo"]);
  });

  it("edición: qué campos cambiaron (con la etiqueta de los campos extra), versiones nuevas y bajas", () => {
    const m = movimiento({
      tipo: "edicion",
      datos: {
        cambios: { padron: ["A", "B"], "datos_extra.concesion_hasta": [null, "2031-10-20"] },
        personas: { baja: [12], reemplazadas: [10] },
      },
      personasCreadas: [{ id: "11", rol: "titular", orden: 1, reemplazaA: "10" }],
    });
    expect(resumenMovimiento(m, ctx)).toEqual([
      "Cambió: padrón, Vencimiento de la concesión",
      "Datos nuevos de Titular FICTICIO, Uno Corregido",
      "Persona quitada: Solicitante OTRA, Dos",
    ]);
  });

  it("datos raros no rompen la línea de tiempo", () => {
    expect(resumenMovimiento(movimiento({ tipo: "edicion", datos: null }), ctx)).toEqual([]);
    expect(resumenMovimiento(movimiento({ tipo: "edicion", datos: { cambios: [1, 2] } }), ctx)).toEqual([]);
  });
});
