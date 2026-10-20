// Recepción (src/lib/dominio/expedientes/recepcion.ts), subtareas
// (subtareas.ts) y documentos (documentos.ts) contra la base real:
// docs/propuesta-mvp.md, decisión 8, 3.2, 3.3 y 3.5.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio } from "@/lib/dominio/expedientes";
import { leerItems } from "@/lib/dominio/expedientes/items";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, sumarDias } from "@/lib/fechas";
import { asegurarSemilla, avanzar, comando, datosAlta, forzarEstado, movimientos, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let legal: UsuarioPermisos;
let direccion: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, liquidacion, legal, direccion] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "DIRECCION"),
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

/** Un expediente recién pasado a Cómputo, sin confirmar. */
async function enComputo(cambios: Parameters<typeof datosAlta>[1] = {}): Promise<{ numero: string; version: number }> {
  const alta = await exp.alta(mesa, await datosAlta(prisma, cambios), comando());
  const r = await avanzar(exp, prisma, alta.numero);
  return { numero: alta.numero, version: r.version };
}

describe("confirmar la recepción", () => {
  it("de a uno: recepción explícita, recibido_en y versión; el contador baja", async () => {
    const antes = await exp.contadorPorConfirmar(computo);
    const { numero, version } = await enComputo();
    expect(await exp.contadorPorConfirmar(computo)).toBe(antes + 1);
    expect((await exp.bandeja(computo, "por_confirmar")).filas.some((f) => f.numero === numero)).toBe(true);

    const c = comando();
    const r = await exp.confirmarRecepcion(computo, numero, version, c);
    expect(r).toMatchObject({ repetido: false, version: version + 1 });
    const e = await proyeccion(prisma, numero);
    expect(e.recibidoEn?.getTime()).toBe(r.recibidoEn.getTime());
    expect((await movimientos(prisma, numero)).at(-1)).toMatchObject({ tipo: "recepcion", datos: { implicita: false }, pasoDestino: "COMPUTO_ALTA" });
    expect(await exp.contadorPorConfirmar(computo)).toBe(antes);
    expect((await exp.bandeja(computo, "por_confirmar")).filas.some((f) => f.numero === numero)).toBe(false);

    // Otra vez: ya está recibido. Con el mismo comando: lo de la primera vez.
    expect((await errorDe(exp.confirmarRecepcion(computo, numero, r.version, comando()))).codigo).toBe("ya_recibido");
    expect(await exp.confirmarRecepcion(computo, numero, 0, c)).toMatchObject({ repetido: true, movimientoId: r.movimientoId, version: r.version });
  });

  it("con fecha anterior (no antes de la llegada) y solo el área donde está", async () => {
    const hoy = hoyEnTucuman();
    const alta = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -6) }), comando());
    const r = await avanzar(exp, prisma, alta.numero, { fechaPase: sumarDias(hoy, -3) });
    expect((await errorDe(exp.confirmarRecepcion(computo, alta.numero, r.version, comando(), { fechaEfectiva: sumarDias(hoy, -4) }))).errores[0]?.ruta).toBe(
      "fechaEfectiva",
    );
    await expect(exp.confirmarRecepcion(legal, alta.numero, r.version, comando())).rejects.toBeInstanceOf(PermisoDenegado);
    await expect(exp.confirmarRecepcion(direccion, alta.numero, r.version, comando())).rejects.toMatchObject({ motivo: "solo_lectura" });
    const ok = await exp.confirmarRecepcion(computo, alta.numero, r.version, comando(), { fechaEfectiva: `${sumarDias(hoy, -2)}T10:30` });
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({ tipo: "recepcion", precisionFecha: "minuto" });
    const f = await exp.obtenerFicha(computo, alta.numero);
    expect(f.recibidoEn?.getTime()).toBe(ok.recibidoEn.getTime());
    expect(f.recibidoEnPrecision).toBe("minuto");
    expect(f.enAreaDesdePrecision).toBe("dia");
  });

  it("en lote: cada uno en su transacción, con el resultado de cada uno", async () => {
    const a = await enComputo();
    const b = await enComputo();
    const yaRecibido = await enComputo();
    await exp.confirmarRecepcion(computo, yaRecibido.numero, yaRecibido.version, comando());
    const otro = await exp.alta(mesa, await datosAlta(prisma), comando()); // en Mesa
    const c = comando();
    const lote = [
      { numero: a.numero, version: a.version },
      { numero: b.numero, version: b.version - 1 },
      { numero: yaRecibido.numero, version: yaRecibido.version + 1 },
      { numero: otro.numero, version: 0 },
    ];
    const r = await exp.confirmarRecepciones(computo, lote, c);
    expect(r.map((x) => (x.ok ? "ok" : x.codigo))).toEqual(["ok", "conflicto_version", "ya_recibido", "permiso"]);
    // Reintentar el lote no repite la recepción de `a`.
    const r2 = await exp.confirmarRecepciones(computo, lote.slice(0, 1), c);
    expect(r2[0]).toMatchObject({ ok: true, repetido: true });
    expect((await movimientos(prisma, a.numero)).filter((m) => m.tipo === "recepcion")).toHaveLength(1);
  });
});

describe("subtareas del paso actual", () => {
  it("tildar con dato, destildar con motivo, solo las del paso actual y solo el responsable", async () => {
    const { numero, version } = await enComputo();
    const t = await exp.tildarSubtarea(computo, numero, "COMP_GRABADO", "Registro 4455", version, comando());
    expect(t).toMatchObject({ hecha: true, dato: "Registro 4455", recepcionImplicita: true, version: version + 1 });
    let items = leerItems((await proyeccion(prisma, numero)).items);
    expect(items.subtareas.COMP_GRABADO).toEqual({ hecha: true, dato: "Registro 4455", mov: Number(t.movimientoId), reiniciada_por_mov: null, historica: false });
    const ms = await movimientos(prisma, numero);
    expect(ms.slice(-2).map((m) => m.tipo)).toEqual(["recepcion", "subtarea"]);
    expect(ms.at(-1)).toMatchObject({ datos: { subtarea: "COMP_GRABADO", hecha: true, dato: "Registro 4455", paso: "COMPUTO_ALTA" } });

    // Lo mismo otra vez no cambia nada; otro dato sí.
    expect((await errorDe(exp.tildarSubtarea(computo, numero, "COMP_GRABADO", "Registro 4455", t.version, comando()))).codigo).toBe("sin_cambios");
    const t2 = await exp.tildarSubtarea(computo, numero, "COMP_GRABADO", "Registro 4456", t.version, comando());

    // Destildar exige motivo.
    expect((await errorDe(exp.destildarSubtarea(computo, numero, "COMP_GRABADO", "no", t2.version, comando()))).codigo).toBe("motivo_requerido");
    const d = await exp.destildarSubtarea(computo, numero, "COMP_GRABADO", "Se grabó en el registro equivocado", t2.version, comando());
    items = leerItems((await proyeccion(prisma, numero)).items);
    expect(items.subtareas.COMP_GRABADO).toMatchObject({ hecha: false, dato: null, mov: Number(d.movimientoId) });
    expect((await movimientos(prisma, numero)).at(-1)).toMatchObject({ tipo: "subtarea", motivo: "Se grabó en el registro equivocado", datos: { hecha: false } });
    expect((await errorDe(exp.destildarSubtarea(computo, numero, "COMP_GRABADO", "Otra vez lo mismo", d.version, comando()))).codigo).toBe("sin_cambios");

    // Otra subtarea, de otro paso o inexistente.
    expect((await errorDe(exp.tildarSubtarea(computo, numero, "LIQ_PAGO", hoyEnTucuman(), d.version, comando()))).message).toMatch(/del paso actual/);
    expect((await errorDe(exp.tildarSubtarea(computo, numero, "NO_EXISTE", null, d.version, comando()))).codigo).toBe("validacion");
    await expect(exp.tildarSubtarea(liquidacion, numero, "COMP_GRABADO", null, d.version, comando())).rejects.toBeInstanceOf(PermisoDenegado);
    await expect(exp.tildarSubtarea(mesa, numero, "COMP_GRABADO", null, d.version, comando())).rejects.toMatchObject({ motivo: "no_es_responsable" });
    expect((await errorDe(exp.tildarSubtarea(computo, numero, "COMP_GRABADO", null, d.version - 1, comando()))).codigo).toBe("conflicto_version");
  });

  it("fecha obligatoria y estado", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero);
    const r = await avanzar(exp, prisma, alta.numero); // en Liquidación
    expect((await errorDe(exp.tildarSubtarea(liquidacion, alta.numero, "LIQ_PAGO", null, r.version, comando()))).errores).toEqual([
      { ruta: "dato", mensaje: "Indicá la fecha" },
    ]);
    expect((await errorDe(exp.tildarSubtarea(liquidacion, alta.numero, "LIQ_PAGO", sumarDias(hoyEnTucuman(), 1), r.version, comando()))).errores[0]?.mensaje).toMatch(
      /futura/,
    );
    await forzarEstado(prisma, alta.numero, "archivado");
    const e = await proyeccion(prisma, alta.numero);
    expect((await errorDe(exp.tildarSubtarea(liquidacion, alta.numero, "LIQ_PAGO", hoyEnTucuman(), e.version, comando()))).codigo).toBe("estado_no_admite");
  });
});

describe("documentos", () => {
  it("presentado, no corresponde con observación, pendiente; quién puede (3.2)", async () => {
    const { numero, version } = await enComputo();
    // No corresponde sin observación: no.
    expect((await errorDe(exp.marcarDocumento(computo, numero, "CONST_COMPUTOS", "no_corresponde", "  ", version, comando()))).errores).toEqual([
      { ruta: "observacion", mensaje: "Explicá por qué no corresponde" },
    ]);
    const a = await exp.marcarDocumento(computo, numero, "CONST_COMPUTOS", "no_corresponde", "Lo trae el concesionario en papel", version, comando());
    expect(a).toMatchObject({ estado: "no_corresponde", recepcionImplicita: true });
    expect((await movimientos(prisma, numero)).at(-1)).toMatchObject({
      tipo: "documento",
      observacion: "Lo trae el concesionario en papel",
      datos: { documento: "CONST_COMPUTOS", estado: "no_corresponde" },
    });
    // Mesa de Entradas marca aunque no sea la responsable, y no es una recepción de Cómputo.
    const b = await exp.marcarDocumento(mesa, numero, "ESTADO_CUENTA", "presentado", null, a.version, comando());
    expect(b.recepcionImplicita).toBe(false);
    const c = await exp.marcarDocumento(computo, numero, "CONST_COMPUTOS", "pendiente", "se ignora", b.version, comando());
    expect(c.observacion).toBeNull();
    const items = leerItems((await proyeccion(prisma, numero)).items);
    expect(items.documentos.CONST_COMPUTOS).toMatchObject({ estado: "pendiente", obs: null, mov: Number(c.movimientoId) });
    expect(items.documentos.ESTADO_CUENTA).toMatchObject({ estado: "presentado", mov: Number(b.movimientoId) });

    expect((await errorDe(exp.marcarDocumento(computo, numero, "CONST_COMPUTOS", "pendiente", null, c.version, comando()))).codigo).toBe("sin_cambios");
    expect((await errorDe(exp.marcarDocumento(computo, numero, "NO_EXISTE", "presentado", null, c.version, comando()))).codigo).toBe("validacion");
    await expect(exp.marcarDocumento(legal, numero, "DNI", "presentado", null, c.version, comando())).rejects.toMatchObject({ motivo: "no_es_responsable" });

    // Concluido: Mesa ya no (solo estados activos); archivado: nadie.
    await forzarEstado(prisma, numero, "concluido");
    let e = await proyeccion(prisma, numero);
    await expect(exp.marcarDocumento(mesa, numero, "DNI", "presentado", null, e.version, comando())).rejects.toMatchObject({ motivo: "estado_no_admite" });
    await forzarEstado(prisma, numero, "archivado");
    e = await proyeccion(prisma, numero);
    expect((await errorDe(exp.marcarDocumento(computo, numero, "DNI", "presentado", null, e.version, comando()))).codigo).toBe("estado_no_admite");
  });
});
