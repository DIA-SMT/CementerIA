// La devolución (src/lib/dominio/expedientes/devolucion.ts) y el reenvío
// directo contra la base real: docs/propuesta-mvp.md, 3.4 y 3.3 punto 8.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { leerItems } from "@/lib/dominio/expedientes/items";
import { asegurarSemilla, avanzar, comando, completarPaso, datosAlta, movimientos, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let legal: UsuarioPermisos;
let tributario: UsuarioPermisos;

const MOTIVO = "Error en boleta: falta el arrendamiento";

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, liquidacion, legal, tributario] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "TRIBUTARIO"),
  ]);
});

afterAll(async () => prisma.$disconnect());

async function errorDe(p: Promise<unknown>): Promise<ErrorDominio> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorDominio) return e;
    throw e;
  }
  throw new Error("se esperaba ErrorDominio");
}

/** Un RENOV_CONTADO en Legal, sin confirmar. */
async function enLegal(): Promise<{ numero: string; version: number }> {
  const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
  let r = await avanzar(exp, prisma, alta.numero);
  r = await avanzar(exp, prisma, alta.numero);
  r = await avanzar(exp, prisma, alta.numero);
  expect(r.paso.clave).toBe("LEGAL");
  return { numero: alta.numero, version: r.version };
}

describe("devolución desde Legal a Liquidación, con reenvío directo", () => {
  it("destilda lo que hay que rehacer, marca el retorno y la bandeja muestra el motivo", async () => {
    const { numero, version } = await enLegal();
    const d = await exp.devolver(legal, numero, "LIQUIDACION", MOTIVO, ["LIQ_BOLETA"], version, comando(), { observacion: "Boleta B-0001" });
    expect(d).toMatchObject({
      repetido: false,
      paso: { clave: "LIQUIDACION", orden: 3 },
      pasoRetorno: "LEGAL",
      subtareasReiniciadas: ["LIQ_BOLETA"],
      sinConfirmar: true,
      estado: "en_tramite",
    });
    // Legal no había confirmado: primero, la recepción implícita.
    expect(d.recepcionImplicitaId).not.toBeNull();

    const e = await proyeccion(prisma, numero);
    expect(e).toMatchObject({ pasoClave: "LIQUIDACION", pasoOrden: 3, pasoRetornoClave: "LEGAL", recibidoEn: null, version: version + 1 });
    expect(e.areaActual.codigo).toBe("LIQUIDACION");
    const items = leerItems(e.items);
    expect(items.subtareas.LIQ_BOLETA).toEqual({ hecha: false, dato: null, mov: Number(d.movimientoId), reiniciada_por_mov: Number(d.movimientoId), historica: false });
    // Lo demás sigue tildado: la firma en papel sigue existiendo.
    expect(items.subtareas.LIQ_DEBITOS?.hecha).toBe(true);
    expect(items.subtareas.LIQ_PAGO?.hecha).toBe(true);

    const m = (await movimientos(prisma, numero)).at(-1);
    expect(m).toMatchObject({ tipo: "devolucion", pasoOrigen: "LEGAL", pasoDestino: "LIQUIDACION", motivo: MOTIVO, observacion: "Boleta B-0001", datos: { subtareas_reiniciadas: ["LIQ_BOLETA"] } });

    // "Devuelto por Asesoría Legal: <motivo>", en Por confirmar de Liquidación.
    const fila = (await exp.bandeja(liquidacion, "por_confirmar")).filas.find((f) => f.numero === numero);
    expect(fila?.etiquetas).toEqual([
      { tipo: "devuelto", porArea: "Asesoría Legal", desdePaso: "Asesoría Legal", motivo: MOTIVO },
      { tipo: "sin_confirmar" },
    ]);

    // La ficha: devuelto, y lo que falta es rehacer la boleta.
    const f = await exp.obtenerFicha(liquidacion, numero);
    expect(f.situaciones).toEqual(expect.arrayContaining(["devuelto", "sin_confirmar"]));
    expect(f.pase.faltan).toEqual([expect.objectContaining({ clave: "LIQ_BOLETA", motivo: "reiniciada" })]);
    expect(f.pase.destinos).toEqual([expect.objectContaining({ clave: "LEGAL", tipo: "siguiente", esRetorno: true })]);
    expect(f.recorrido[2].subtareas.find((s) => s.clave === "LIQ_BOLETA")).toMatchObject({ hecha: false, reiniciadaPorMovimientoId: d.movimientoId });

    const sinRehacer = await errorDe(exp.darPase(liquidacion, numero, "LEGAL", e.version, comando()));
    expect(sinRehacer.codigo).toBe("faltan_requisitos");

    const t = await exp.tildarSubtarea(liquidacion, numero, "LIQ_BOLETA", "B-0002", e.version, comando());
    const p = await exp.darPase(liquidacion, numero, "LEGAL", t.version, comando());
    expect(p).toMatchObject({ paso: { clave: "LEGAL" } });
    expect((await proyeccion(prisma, numero)).pasoRetornoClave).toBeNull();
  });

  it("reenvío directo salteando los intermedios (pasos_salteados) si están completos", async () => {
    const { numero, version } = await enLegal();
    const d = await exp.devolver(legal, numero, "MESA", "Falta firma del titular en el formulario", ["MESA_CARATULA"], version, comando());
    expect(d.pasoRetorno).toBe("LEGAL");
    let v = await exp.validarPase(mesa, numero);
    const reenvio = v.destinos.find((x) => x.tipo === "reenvio");
    expect(reenvio).toMatchObject({ clave: "LEGAL", pasosSalteados: ["COMPUTO_ALTA", "LIQUIDACION"] });
    expect(reenvio?.faltan.map((x) => x.clave)).toEqual(["MESA_CARATULA"]);

    const t = await exp.tildarSubtarea(mesa, numero, "MESA_CARATULA", null, d.version, comando());
    v = await exp.validarPase(mesa, numero);
    expect(v.destinos.map((x) => [x.clave, x.faltan.length])).toEqual([
      ["COMPUTO_ALTA", 0],
      ["LEGAL", 0],
    ]);
    const p = await exp.darPase(mesa, numero, "LEGAL", t.version, comando());
    expect(p).toMatchObject({ paso: { clave: "LEGAL", orden: 4 }, areaActual: { codigo: "LEGAL" }, sinConfirmar: true });
    expect((await movimientos(prisma, numero)).at(-1)).toMatchObject({
      tipo: "pase",
      pasoOrigen: "MESA",
      pasoDestino: "LEGAL",
      datos: { pasos_omitidos: [], pasos_salteados: ["COMPUTO_ALTA", "LIQUIDACION"] },
      motivo: null,
    });
    expect((await proyeccion(prisma, numero)).pasoRetornoClave).toBeNull();
  });

  it("devoluciones encadenadas conservan el retorno más avanzado; lo reiniciado en un intermedio impide el reenvío", async () => {
    const { numero, version } = await enLegal();
    const a = await exp.devolver(legal, numero, "LIQUIDACION", MOTIVO, ["LIQ_BOLETA"], version, comando());
    const b = await exp.devolver(liquidacion, numero, "COMPUTO_ALTA", "Falta la constancia de Cómputos firmada", [], a.version, comando());
    expect(b.pasoRetorno).toBe("LEGAL");
    const v = await exp.validarPase(computo, numero);
    // Cómputo no puede rehacer la boleta: el reenvío a Legal no está disponible y el papel pasa por Liquidación.
    expect(v.destinos.find((x) => x.tipo === "reenvio")?.faltan.map((x) => x.clave)).toEqual(["LIQ_BOLETA"]);
    expect(v.destinos.find((x) => x.tipo === "siguiente")).toMatchObject({ clave: "LIQUIDACION", faltan: [] });
    const err = await errorDe(exp.darPase(computo, numero, "LEGAL", b.version, comando()));
    expect(err.codigo).toBe("faltan_requisitos");
  });
});

describe("validaciones de la devolución", () => {
  it("motivo de 10 caracteres, paso anterior, subtareas reiniciables, área responsable, idempotencia", async () => {
    const { numero, version } = await enLegal();
    expect((await errorDe(exp.devolver(legal, numero, "LIQUIDACION", "Corto", [], version, comando()))).codigo).toBe("motivo_requerido");
    expect((await errorDe(exp.devolver(legal, numero, "LEGAL", MOTIVO, [], version, comando()))).codigo).toBe("destino_invalido");
    expect((await errorDe(exp.devolver(legal, numero, "ADM_RESOLUCION", MOTIVO, [], version, comando()))).codigo).toBe("destino_invalido");
    // MESA_CARATULA es de un paso anterior al destino; LEG_DICTAMEN es del actual.
    const sub = await errorDe(exp.devolver(legal, numero, "LIQUIDACION", MOTIVO, ["MESA_CARATULA", "LEG_DICTAMEN"], version, comando()));
    expect(sub.errores.map((x) => x.ruta)).toEqual(["subtareas.MESA_CARATULA", "subtareas.LEG_DICTAMEN"]);
    await expect(exp.devolver(liquidacion, numero, "LIQUIDACION", MOTIVO, [], version, comando())).rejects.toBeInstanceOf(PermisoDenegado);

    const c = comando();
    const d = await exp.devolver(legal, numero, "LIQUIDACION", MOTIVO, [], version, c);
    const otra = await exp.devolver(legal, numero, "LIQUIDACION", MOTIVO, [], version, c);
    expect(otra).toMatchObject({ repetido: true, movimientoId: d.movimientoId });
    expect((await movimientos(prisma, numero)).filter((m) => m.tipo === "devolucion")).toHaveLength(1);
    // El primer paso no devuelve.
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await expect(exp.devolver(mesa, alta.numero, "MESA", MOTIVO, [], 0, comando())).rejects.toMatchObject({ motivo: "primer_paso" });
  });

  it("devolver desde la DIM sale de la espera de pago y limpia el plazo (3.4 y 3.5)", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "RENOV_PLAN" }), comando());
    for (let i = 0; i < 6; i++) await avanzar(exp, prisma, alta.numero);
    const e = await proyeccion(prisma, alta.numero);
    expect(e).toMatchObject({ pasoClave: "DIM", estado: "espera_pago_dim", plazoDiasHabiles: 30 });
    const d = await exp.devolver(tributario, alta.numero, "TRIBUTARIO", "La DIM devolvió el expediente sin pago", [], e.version, comando());
    // Vuelve al área del usuario: recibido en el acto.
    expect(d).toMatchObject({ estado: "en_tramite", paso: { clave: "TRIBUTARIO" }, sinConfirmar: false, pasoRetorno: "DIM" });
    const despues = await proyeccion(prisma, alta.numero);
    expect(despues).toMatchObject({ plazoDesde: null, plazoDiasHabiles: null, plazoCumplidoEn: null, estado: "en_tramite" });
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({ tipo: "devolucion", estadoAnterior: "espera_pago_dim", estadoNuevo: "en_tramite" });
    // Y al volver a entrar a la DIM se carga de nuevo (la notificación sigue tildada).
    const version = await completarPaso(exp, prisma, alta.numero);
    await exp.darPase(tributario, alta.numero, "DIM", version, comando());
    expect(await proyeccion(prisma, alta.numero)).toMatchObject({ estado: "espera_pago_dim", plazoDiasHabiles: 30, pasoRetornoClave: null });
  });
});
