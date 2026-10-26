import { describe, expect, it } from "vitest";
import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import {
  alternarCategoria,
  atajoDe,
  categoriaDe,
  contextoResumen,
  detalleTramo,
  filtroInicial,
  HISTORIAL_LARGO,
  pasaFiltro,
  resumenMovimiento,
  textoConteo,
  textoIntegridad,
  tituloTramo,
} from "./historial";

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
    revertido: false,
    fechaCorregida: null,
    observacionCorregida: null,
    correcciones: [],
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

  it("subtarea: la fecha anotada va en formato argentino (26/10/2026: el patrón no tenía las barras invertidas)", () => {
    const c = contextoResumen([], [], { subtareas: [{ clave: "LIQ_PAGO", nombre: "Pago verificado" }] });
    expect(resumenMovimiento(movimiento({ tipo: "subtarea", datos: { subtarea: "LIQ_PAGO", hecha: true, dato: "2026-10-23" } }), c)).toEqual([
      "Pago verificado: tildada (23/10/2026)",
    ]);
    expect(resumenMovimiento(movimiento({ tipo: "subtarea", datos: { subtarea: "LIQ_PAGO", hecha: true, dato: "Res. 123" } }), c)).toEqual([
      "Pago verificado: tildada (Res. 123)",
    ]);
  });

  it("datos raros no rompen la línea de tiempo", () => {
    expect(resumenMovimiento(movimiento({ tipo: "edicion", datos: null }), ctx)).toEqual([]);
    expect(resumenMovimiento(movimiento({ tipo: "edicion", datos: { cambios: [1, 2] } }), ctx)).toEqual([]);
  });
});

describe("filtros del historial (26/10/2026)", () => {
  it("cada tipo de movimiento tiene su categoría; el alta y la recepción van con los pases", () => {
    expect(["alta", "recepcion", "pase", "devolucion"].map(categoriaDe)).toEqual(["pases", "pases", "pases", "pases"]);
    expect(["subtarea", "documento", "adjunto", "edicion", "estado", "nota", "correccion"].map(categoriaDe)).toEqual([
      "subtareas",
      "documentos",
      "adjuntos",
      "ediciones",
      "estados",
      "notas",
      "correcciones",
    ]);
    expect(categoriaDe("desconocido")).toBe("notas");
  });

  it("un historial largo abre en «Solo lo importante»; uno corto, con todo", () => {
    expect(atajoDe(filtroInicial(HISTORIAL_LARGO))).toBe("todo");
    const largo = filtroInicial(HISTORIAL_LARGO + 1);
    expect(atajoDe(largo)).toBe("importante");
    expect(pasaFiltro({ categoria: "pases", paso: "LEGAL" }, largo)).toBe(true);
    expect(pasaFiltro({ categoria: "estados", paso: null }, largo)).toBe(true);
    expect(pasaFiltro({ categoria: "subtareas", paso: "LEGAL" }, largo)).toBe(false);
  });

  it("alternar una categoría y filtrar por paso dejan de ser un atajo", () => {
    const todo = filtroInicial(3);
    const sinNotas = alternarCategoria(todo, "notas");
    expect(atajoDe(sinNotas)).toBeNull();
    expect(pasaFiltro({ categoria: "notas", paso: null }, sinNotas)).toBe(false);
    expect(atajoDe(alternarCategoria(sinNotas, "notas"))).toBe("todo");
    const enLegal = { ...todo, paso: "LEGAL" };
    expect(atajoDe(enLegal)).toBeNull();
    expect(pasaFiltro({ categoria: "notas", paso: "LEGAL" }, enLegal)).toBe(true);
    expect(pasaFiltro({ categoria: "notas", paso: "MESA" }, enLegal)).toBe(false);
  });
});

describe("encabezado de cada tramo", () => {
  const base = {
    orden: 3,
    paso: { nombre: "Dictamen" },
    area: { nombre: "Asesoría Legal" },
    desde: new Date("2026-10-01T13:00:00Z"),
    desdePrecision: "minuto" as const,
    hasta: new Date("2026-10-15T03:00:00Z"),
    hastaPrecision: "dia" as const,
    actual: false,
    diasHabiles: 10,
  };

  it("paso y área, de cuándo a cuándo y los días hábiles", () => {
    expect(tituloTramo(base)).toBe("3. Dictamen · Asesoría Legal");
    expect(tituloTramo({ ...base, area: { nombre: "Dictamen" } })).toBe("3. Dictamen");
    expect(detalleTramo(base)).toBe("Del 01/10/2026 10:00 al 15/10/2026 · 10 días hábiles");
    expect(detalleTramo({ ...base, diasHabiles: 1 })).toMatch(/· 1 día hábil$/);
  });

  it("el tramo en curso cuenta hasta hoy", () => {
    expect(detalleTramo({ ...base, hasta: null, actual: true, diasHabiles: 0 })).toBe("Desde el 01/10/2026 10:00 · 0 días hábiles hasta hoy");
  });
});

describe("texto de la integridad", () => {
  const r = { integra: true, movimientos: 23, hashFinal: "a".repeat(64), huella: "a".repeat(16), secuenciaRota: null, motivo: null };
  it("íntegro, con la cantidad", () => {
    expect(textoIntegridad(r)).toBe("Historial íntegro: 23 movimientos.");
    expect(textoIntegridad({ ...r, movimientos: 1 })).toBe("Historial íntegro: 1 movimiento.");
  });
  it("roto, con la secuencia y el motivo", () => {
    expect(textoIntegridad({ ...r, integra: false, secuenciaRota: 5, motivo: "hash_distinto" })).toBe(
      "La cadena del historial está rota: el movimiento 5 cambió después de registrarse.",
    );
    expect(textoIntegridad({ ...r, integra: false, secuenciaRota: 2, motivo: "secuencia_faltante" })).toMatch(/falta el movimiento 2/);
    expect(textoIntegridad({ ...r, integra: false, secuenciaRota: 3, motivo: "hash_anterior_distinto" })).toMatch(/movimiento 3 no encadena/);
  });
});

describe("contador de la línea de tiempo", () => {
  it("dice cuántos se ven de cuántos", () => {
    expect(textoConteo(1, 1)).toBe("Se ve el único movimiento.");
    expect(textoConteo(0, 1)).toBe("No se ve el único movimiento.");
    expect(textoConteo(23, 23)).toBe("Se ven los 23 movimientos.");
    expect(textoConteo(0, 23)).toBe("No se ve ninguno de los 23 movimientos.");
    expect(textoConteo(1, 23)).toBe("Se ve 1 de 23 movimientos.");
    expect(textoConteo(8, 23)).toBe("Se ven 8 de 23 movimientos.");
  });
});
