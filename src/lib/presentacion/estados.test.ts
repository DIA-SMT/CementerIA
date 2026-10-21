import { describe, expect, it } from "vitest";
import { UBICACION_ARCHIVO_DESCONOCIDA } from "@/lib/dominio/expedientes/estados";
import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import {
  botonesEstado,
  menuCorreccion,
  mostrarPlazo,
  movimientoCorregible,
  resumenCorreccion,
  rutaReinicio,
  textoBotonConcluir,
  textoUbicacion,
  tipoDeOpcion,
  UBICACION_DESCONOCIDA,
  valorUbicacion,
  type PermisosEstado,
} from "./estados";

describe("semáforo del plazo DIM (3.6)", () => {
  const base = { texto: "vence 30/11 · faltan 3 días hábiles", provisorio: false, aniosSinCerrar: [] as number[] };

  it("ámbar por vencer, rojo vencido: con etiqueta y texto (el color no es la única señal)", () => {
    const ambar = mostrarPlazo({ ...base, semaforo: "por_vencer" });
    expect(ambar).toMatchObject({ etiqueta: "Por vencer", alerta: true, texto: "Vence 30/11 · faltan 3 días hábiles", aviso: null });
    expect(ambar.clase).toContain("amber");
    const rojo = mostrarPlazo({ ...base, semaforo: "vencido", texto: "venció el 30/11 (hace 2 días hábiles)" });
    expect(rojo).toMatchObject({ etiqueta: "Vencido", alerta: true, texto: "Venció el 30/11 (hace 2 días hábiles)" });
    expect(rojo.clase).toContain("red");
  });

  it("en término, sin iniciar y cumplido no alertan", () => {
    expect(mostrarPlazo({ ...base, semaforo: "en_termino" })).toMatchObject({ etiqueta: "En término", alerta: false });
    expect(mostrarPlazo({ ...base, semaforo: "sin_iniciar", texto: "el plazo empieza con la notificación" })).toMatchObject({
      etiqueta: "Sin iniciar",
      alerta: false,
      texto: "El plazo empieza con la notificación",
    });
    expect(mostrarPlazo({ ...base, semaforo: "cumplido" }).alerta).toBe(false);
  });

  it("provisorio: dice qué años de feriados faltan cerrar, ordenados", () => {
    expect(mostrarPlazo({ ...base, semaforo: "por_vencer", provisorio: true, aniosSinCerrar: [2027] }).aviso).toBe("Provisorio: falta cerrar los feriados de 2027.");
    expect(mostrarPlazo({ ...base, semaforo: "en_termino", provisorio: true, aniosSinCerrar: [2027, 2026] }).aviso).toBe(
      "Provisorio: faltan cerrar los feriados de 2026 y 2027.",
    );
    expect(mostrarPlazo({ ...base, semaforo: "en_termino", provisorio: true, aniosSinCerrar: [] }).aviso).toBe("Provisorio: puede faltar cargar algún feriado.");
  });
});

describe("botones de estado (3.1)", () => {
  const nada: PermisosEstado = {
    concluir: false,
    archivar: false,
    archivarSinConcluir: false,
    desarchivar: false,
    anular: false,
    reabrir: false,
    reiniciar: false,
    cambiarUbicacionArchivo: false,
    nota: false,
  };

  it("sin permisos no hay botones", () => {
    expect(botonesEstado(nada, { faltanConcluir: 0, hayPlantillas: true })).toEqual([]);
  });

  it("Mesa de Entradas con un expediente en trámite: archivar sin concluir, vincular, reiniciar, anular y nota", () => {
    const b = botonesEstado({ ...nada, archivarSinConcluir: true, reiniciar: true, anular: true, nota: true }, { faltanConcluir: 0, hayPlantillas: true });
    expect(b.map((x) => x.accion)).toEqual(["archivarSinConcluir", "vinculado", "reiniciar", "anular", "nota"]);
    expect(b.every((x) => !x.principal)).toBe(true);
  });

  it("reiniciar y vincular necesitan alguna plantilla publicada", () => {
    const b = botonesEstado({ ...nada, archivarSinConcluir: true, reiniciar: true }, { faltanConcluir: 0, hayPlantillas: false });
    expect(b.map((x) => x.accion)).toEqual(["archivarSinConcluir"]);
  });

  it("concluir: 'Faltan N' como el pase, y es el principal solo si no falta nada", () => {
    expect(botonesEstado({ ...nada, concluir: true }, { faltanConcluir: 2, hayPlantillas: false })).toEqual([{ accion: "concluir", etiqueta: "Concluir · Faltan 2", principal: false }]);
    expect(botonesEstado({ ...nada, concluir: true }, { faltanConcluir: 0, hayPlantillas: false })).toEqual([{ accion: "concluir", etiqueta: "Concluir", principal: true }]);
    expect(textoBotonConcluir(1)).toBe("Concluir · Faltan 1");
  });

  it("archivado: desarchivar y cambiar la ubicación; anulado: reabrir", () => {
    expect(botonesEstado({ ...nada, desarchivar: true, cambiarUbicacionArchivo: true, nota: true }, { faltanConcluir: 0, hayPlantillas: true }).map((x) => x.accion)).toEqual([
      "desarchivar",
      "ubicacionArchivo",
      "nota",
    ]);
    expect(botonesEstado({ ...nada, reabrir: true }, { faltanConcluir: 0, hayPlantillas: true }).map((x) => x.etiqueta)).toEqual(["Reabrir"]);
  });

  it("ubicación de archivo: 'No se sabe' es DESCONOCIDA (la misma constante que el dominio)", () => {
    expect(UBICACION_DESCONOCIDA).toBe(UBICACION_ARCHIVO_DESCONOCIDA);
    expect(valorUbicacion("  Caja 12 ", false)).toBe("Caja 12");
    expect(valorUbicacion("Caja 12", true)).toBe("DESCONOCIDA");
    expect(textoUbicacion("DESCONOCIDA")).toBe("Desconocida (carga histórica)");
    expect(textoUbicacion(null)).toBe("—");
    expect(textoUbicacion("Caja 3")).toBe("Caja 3");
  });

  it("reiniciar lleva al alta precargada", () => {
    expect(rutaReinicio("CEM-2026-00001", 7)).toBe("/expedientes/nuevo?desde=CEM-2026-00001&plantilla=7");
    expect(rutaReinicio("CEM-2026-00001")).toBe("/expedientes/nuevo?desde=CEM-2026-00001");
  });
});

describe("menú Corregir (2.13(b))", () => {
  it("solo lo que el dominio permite, en orden fijo y con el rótulo del tipo de movimiento", () => {
    const pase = menuCorreccion({ tipo: "pase", correcciones: ["observacion", "fecha", "revertir"], observacion: null }, null);
    expect(pase.map((i) => [i.opcion, i.etiqueta])).toEqual([
      ["revertir", "Revertir el pase"],
      ["fecha", "Corregir la fecha"],
      ["observacion", "Agregar una observación"],
    ]);
    expect(pase[0].delicada).toBe(true);
    expect(menuCorreccion({ tipo: "devolucion", correcciones: ["revertir", "observacion"], observacion: "x" }, null).map((i) => i.etiqueta)).toEqual([
      "Revertir la devolución",
      "Corregir la observación",
    ]);
    expect(menuCorreccion({ tipo: "nota", correcciones: [], observacion: null }, null)).toEqual([]);
  });

  it("subtarea de un paso cerrado: el dato (si lleva) y destildar; sin tildar, nada", () => {
    const conDato = menuCorreccion({ tipo: "subtarea", correcciones: ["subtarea", "observacion"], observacion: null }, { dato: "texto", hecha: true });
    expect(conDato.map((i) => i.opcion)).toEqual(["observacion", "subtarea_dato", "subtarea_destildar"]);
    const sinDato = menuCorreccion({ tipo: "subtarea", correcciones: ["subtarea"], observacion: null }, { dato: null, hecha: true });
    expect(sinDato.map((i) => i.opcion)).toEqual(["subtarea_destildar"]);
    expect(menuCorreccion({ tipo: "subtarea", correcciones: ["subtarea"], observacion: null }, { dato: "fecha", hecha: false })).toEqual([]);
    expect(tipoDeOpcion("subtarea_dato")).toBe("subtarea");
    expect(tipoDeOpcion("subtarea_destildar")).toBe("subtarea");
    expect(tipoDeOpcion("fecha")).toBe("fecha");
  });

  it("adjunto: retirar y, para el admin, purgar (delicada)", () => {
    const m = menuCorreccion({ tipo: "adjunto", correcciones: ["purgar_adjunto", "retirar_adjunto"], observacion: null }, null);
    expect(m.map((i) => i.opcion)).toEqual(["retirar_adjunto", "purgar_adjunto"]);
    expect(m[1]).toMatchObject({ delicada: true, soloAdmin: true });
  });

  it("lo que dice el historial de cada corrección", () => {
    expect(resumenCorreccion({ revertir: true, arrastra: [] })).toBe("Revierte el movimiento");
    expect(resumenCorreccion({ revertir: true, arrastra: ["5", "6"] })).toBe("Revierte el movimiento y 2 movimientos posteriores (recepciones y notas)");
    expect(resumenCorreccion({ fecha_efectiva: ["a", "b"], precision: ["dia", "dia"] })).toBe("Corrige la fecha");
    expect(resumenCorreccion({ observacion: [null, "x"] })).toBe("Corrige la observación");
    expect(resumenCorreccion({ subtarea: "LIQ", dato: ["B-1", "B-2"] }, () => "Boleta")).toBe('Corrige el dato de "Boleta": B-1 → B-2');
    expect(resumenCorreccion({ subtarea: "LIQ", hecha: false }, () => "Boleta")).toBe('Destilda "Boleta"');
    expect(resumenCorreccion({ retirar_adjunto: "9", purgar: false })).toBe("Retira el adjunto (el archivo se conserva)");
    expect(resumenCorreccion({ retirar_adjunto: "9", purgar: true })).toMatch(/^Purga el adjunto/);
    expect(resumenCorreccion({ suprimir_persona: "3" })).toMatch(/Ley 25\.326/);
    expect(resumenCorreccion(null)).toBe("Corrección");
  });

  it("movimientoCorregible: la fecha y la observación que valen, la subtarea y el adjunto", () => {
    const m: Parameters<typeof movimientoCorregible>[0] = {
      id: "41",
      tipo: "subtarea",
      // 15/10/2026 10:30 en Tucumán (UTC-3).
      fechaEfectiva: new Date("2026-10-15T13:30:00Z"),
      precisionFecha: "minuto",
      fechaCorregida: { fechaEfectiva: new Date("2026-10-14T03:00:00Z"), precisionFecha: "dia" },
      observacion: "vieja",
      observacionCorregida: { valor: null },
      datos: { subtarea: "LIQ_BOLETA", hecha: true, dato: "B-1" },
      correcciones: ["subtarea", "fecha"] satisfies MovimientoFicha["correcciones"],
    };
    const c = movimientoCorregible(m, new Map([["LIQ_BOLETA", { nombre: "Boleta emitida", dato: "texto", valor: "B-1", hecha: true }]]));
    expect(c).toMatchObject({
      id: "41",
      descripcion: "Subtarea del 14/10/2026",
      fecha: { dia: "2026-10-14", momento: "2026-10-14T00:00", precision: "dia" },
      observacion: null,
      subtarea: { clave: "LIQ_BOLETA", nombre: "Boleta emitida", dato: "texto", valor: "B-1", hecha: true },
      adjunto: null,
    });
    const adj = movimientoCorregible({ ...m, tipo: "adjunto", fechaCorregida: null, observacionCorregida: null, datos: { nombre: "boleta.pdf" } }, new Map());
    expect(adj).toMatchObject({ adjunto: "boleta.pdf", subtarea: null, observacion: "vieja", fecha: { dia: "2026-10-15", momento: "2026-10-15T10:30", precision: "minuto" } });
  });
});
