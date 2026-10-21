// La transcripción de la ficha de papel (src/lib/dominio/expedientes/transcripcion.ts)
// contra la base real: docs/propuesta-mvp.md, 2.13(c). Un expediente de 2019
// con 5 filas hasta Legal (con una devolución), tildes con fecha, "Terminar
// carga histórica", y otro llevado a concluido y archivado con ubicación
// DESCONOCIDA. Mientras la carga está abierta no aparece en las bandejas de
// trabajo ni cuenta como demorado.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio, type FilaTranscripcion, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { leerItems } from "@/lib/dominio/expedientes/items";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { inicioDelDiaEnTucuman, interpretarDatetimeLocal } from "@/lib/fechas";
import { asegurarSemilla, comando, conciliacion, datosAlta, movimientos, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let mesa: UsuarioPermisos;
let legal: UsuarioPermisos;
let admin: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, legal, admin] = await Promise.all([usuario(prisma, "MESA_ENTRADAS"), usuario(prisma, "LEGAL"), usuario(prisma, "ADMIN")]);
});

afterAll(async () => prisma.$disconnect());

async function errorDe(p: Promise<unknown>): Promise<ErrorDominio | PermisoDenegado> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorDominio || e instanceof PermisoDenegado) return e;
    throw e;
  }
  throw new Error("se esperaba un error");
}

const fila = (cambios: Partial<FilaTranscripcion> & Pick<FilaTranscripcion, "fecha" | "pasoDestino">): FilaTranscripcion => ({
  comandoId: randomUUID(),
  fuente: "Ficha papel",
  ...cambios,
});

async function historico2019() {
  return exp.alta(mesa, await datosAlta(prisma, { cargaHistorica: true, fuente: "Ficha papel", fechaInicio: "2019-03-15" }), comando());
}

describe("transcripción de un expediente de 2019 hasta Legal", () => {
  it("5 filas (pases salteando pasos y una devolución), tildes con fecha y 'Terminar carga histórica'", async () => {
    const alta = await historico2019();
    expect(alta.numero).toMatch(/^CEM-\d{4}-/);

    // Con la carga abierta: no hay pases normales y está en la pestaña de Mesa, no en su área.
    const f0 = await exp.obtenerFicha(mesa, alta.numero);
    expect(f0.situaciones).toContain("carga_historica");
    expect(f0.acciones.transcribir).toEqual({ permitido: true, requiereMotivo: false });
    expect(f0.acciones.darPase).toEqual({ permitido: false, motivo: "carga_historica_abierta" });
    expect((await exp.bandeja(mesa, "carga_historica")).filas.map((x) => x.numero)).toContain(alta.numero);
    expect((await exp.bandeja(mesa, "en_mi_area")).filas.map((x) => x.numero)).not.toContain(alta.numero);
    expect((await exp.bandeja(legal, "carga_historica")).filas).toEqual([]);
    expect(await errorDe(exp.transcribir(legal, alta.numero, [fila({ fecha: "2019-03-20", pasoDestino: "COMPUTO_ALTA" })], 0))).toMatchObject({
      motivo: "area_no_habilitada",
    });

    const filas: FilaTranscripcion[] = [
      fila({ fecha: "2019-03-20", pasoDestino: "COMPUTO_ALTA" }),
      fila({ fecha: "2019-04-02", pasoDestino: "LIQUIDACION", observacion: "Con estado de cuenta" }),
      fila({ fecha: "2019-05-10", pasoDestino: "LEGAL", fuente: "Libro de pases de Legal" }),
      fila({ fecha: "2019-05-20", pasoDestino: "LIQUIDACION", motivo: "Error en boleta: faltaba el arrendamiento" }),
      fila({ fecha: "2019-06-03T10:30", pasoDestino: "LEGAL" }),
    ];

    // Validaciones por fila, y el lote es uno: si una falla, no queda ninguna.
    const sinMotivo = await errorDe(exp.transcribir(mesa, alta.numero, [filas[0], filas[1], filas[2], { ...filas[3], motivo: null }], 0));
    expect(sinMotivo).toMatchObject({ codigo: "motivo_requerido", errores: [{ ruta: "filas[3].motivo" }] });
    const retrocede = await errorDe(exp.transcribir(mesa, alta.numero, [filas[0], { ...filas[1], fecha: "2019-03-19" }], 0));
    expect(retrocede).toMatchObject({ codigo: "validacion", errores: [{ ruta: "filas[1].fecha" }] });
    const sinFuente = await errorDe(exp.transcribir(mesa, alta.numero, [{ ...filas[0], fuente: " " }], 0));
    expect(sinFuente).toMatchObject({ codigo: "validacion", errores: [{ ruta: "filas[0].fuente" }] });
    const mismoPaso = await errorDe(exp.transcribir(mesa, alta.numero, [{ ...filas[0], pasoDestino: "MESA" }], 0));
    expect(mismoPaso).toMatchObject({ errores: [{ ruta: "filas[0].pasoDestino" }] });
    const antesDelInicio = await errorDe(exp.transcribir(mesa, alta.numero, [{ ...filas[0], fecha: "2019-03-01" }], 0));
    expect(antesDelInicio).toMatchObject({ errores: [{ ruta: "filas[0].fecha" }] });
    expect((await movimientos(prisma, alta.numero)).map((m) => m.tipo)).toEqual(["alta"]);

    const r = await exp.transcribir(mesa, alta.numero, filas, 0);
    expect(r).toMatchObject({ version: 1, paso: { clave: "LEGAL", orden: 4 } });
    expect(r.filas.map((x) => [x.tipo, x.paso.clave, x.repetida])).toEqual([
      ["pase", "COMPUTO_ALTA", false],
      ["pase", "LIQUIDACION", false],
      ["pase", "LEGAL", false],
      ["devolucion", "LIQUIDACION", false],
      ["pase", "LEGAL", false],
    ]);
    const movs = (await movimientos(prisma, alta.numero)).slice(1);
    expect(movs.map((m) => [m.tipo, m.cargaHistorica, m.fuente, m.precisionFecha])).toEqual([
      ["pase", true, "Ficha papel", "dia"],
      ["pase", true, "Ficha papel", "dia"],
      ["pase", true, "Libro de pases de Legal", "dia"],
      ["devolucion", true, "Ficha papel", "dia"],
      ["pase", true, "Ficha papel", "minuto"],
    ]);
    expect(movs.map((m) => m.comandoId)).toEqual(filas.map((x) => x.comandoId));
    expect(movs[0].fechaEfectiva).toEqual(inicioDelDiaEnTucuman("2019-03-20"));
    expect(movs[4].fechaEfectiva).toEqual(interpretarDatetimeLocal("2019-06-03T10:30"));
    expect(movs[3]).toMatchObject({ motivo: "Error en boleta: faltaba el arrendamiento", datos: { subtareas_reiniciadas: [], transcripcion: true } });
    expect(movs[1]).toMatchObject({ observacion: "Con estado de cuenta", datos: { pasos_salteados: [], pasos_omitidos: [] } });
    const p = await proyeccion(prisma, alta.numero);
    expect(p).toMatchObject({ pasoClave: "LEGAL", areaActual: { codigo: "LEGAL" }, cargaHistorica: true, pasoRetornoClave: null });
    expect(p.recibidoEn).toEqual(movs[4].fechaEfectiva);
    expect(p.enAreaDesde).toEqual(movs[4].fechaEfectiva);

    // El mismo lote otra vez (reintento): nada nuevo.
    const otra = await exp.transcribir(mesa, alta.numero, filas, 0);
    expect(otra.filas.every((x) => x.repetida)).toBe(true);
    expect(otra.version).toBe(1);
    expect(await movimientos(prisma, alta.numero)).toHaveLength(6);

    // Con la carga abierta no está en la bandeja de Legal ni es un demorado del panel.
    expect((await exp.bandeja(legal, "en_mi_area")).filas.map((x) => x.numero)).not.toContain(alta.numero);
    expect((await exp.bandeja(legal, "por_confirmar")).filas.map((x) => x.numero)).not.toContain(alta.numero);
    const panel = await exp.panel(admin);
    expect(panel.demorados.filas.map((x) => x.numero)).not.toContain(alta.numero);
    expect(panel.cargasHistoricas.filas.map((x) => x.numero)).toContain(alta.numero);

    // Un tilde con su fecha (de un paso ya recorrido), sin exigir nada.
    const t = await exp.tildarSubtareaHistorica(mesa, alta.numero, "LIQ_PAGO", "2019-04-20", { fuente: "Ficha papel" }, r.version, comando());
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      tipo: "subtarea",
      cargaHistorica: true,
      fuente: "Ficha papel",
      precisionFecha: "dia",
      fechaEfectiva: inicioDelDiaEnTucuman("2019-04-20"),
      datos: { subtarea: "LIQ_PAGO", hecha: true, dato: "2019-04-20", paso: "LIQUIDACION" },
    });
    expect(await errorDe(exp.tildarSubtareaHistorica(mesa, alta.numero, "ADM_RES_CONF", null, { fuente: "Ficha papel" }, t.version, comando()))).toMatchObject({
      codigo: "validacion",
    });

    // Terminar: lo pendiente de los pasos anteriores pasa a histórico.
    const pendiente = (await exp.obtenerFicha(mesa, alta.numero)).cargaHistoricaPendiente;
    expect(pendiente?.subtareas).toEqual(expect.arrayContaining(["MESA_CARATULA", "COMP_GRABADO", "LIQ_DEBITOS"]));
    expect(pendiente?.subtareas).not.toContain("LIQ_PAGO");
    expect(pendiente?.subtareas).not.toContain("LEG_DICTAMEN");
    expect(pendiente?.documentos).toEqual(expect.arrayContaining(["DNI", "ESTADO_CUENTA"]));
    expect(await errorDe(exp.terminarCargaHistorica(legal, alta.numero, t.version, comando()))).toMatchObject({ motivo: "area_no_habilitada" });
    const fin = await exp.terminarCargaHistorica(mesa, alta.numero, t.version, comando());
    expect(fin.historicos).toEqual(pendiente);
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      tipo: "edicion",
      datos: { cambios: { carga_historica: [true, false] }, historicos: pendiente },
    });
    const items = leerItems((await proyeccion(prisma, alta.numero)).items);
    expect(items.subtareas.MESA_CARATULA).toMatchObject({ historica: true, hecha: false });
    expect(items.documentos.DNI).toMatchObject({ estado: "historico" });

    // Desde ahí rigen las reglas normales: Legal lo trabaja y solo le falta lo suyo.
    const v = await exp.validarPase(legal, alta.numero);
    expect(v.permiso).toEqual({ permitido: true, requiereMotivo: false });
    expect(v.faltan.map((x) => x.clave)).toEqual(["LEG_DICTAMEN"]);
    expect((await exp.bandeja(legal, "en_mi_area")).filas.map((x) => x.numero)).toContain(alta.numero);
    expect((await exp.bandeja(mesa, "carga_historica")).filas.map((x) => x.numero)).not.toContain(alta.numero);
    expect(await errorDe(exp.transcribir(mesa, alta.numero, [fila({ fecha: "2019-07-01", pasoDestino: "ADM_RESOLUCION" })], fin.version))).toMatchObject({
      motivo: "sin_carga_historica",
    });
    const c = await conciliacion(prisma, alta.numero);
    expect(c.actual).toEqual(c.reconstruida);
  });
});

describe("transcripción hasta el archivo", () => {
  it("lleva a concluido y a archivado con ubicación DESCONOCIDA; terminar pasa todo a histórico", async () => {
    const alta = await historico2019();
    const pasos = ["COMPUTO_ALTA", "LIQUIDACION", "LEGAL", "ADM_RESOLUCION", "COMPUTO_FINAL", "ADM_ENTREGA"];
    const r = await exp.transcribir(
      mesa,
      alta.numero,
      [fila({ fecha: "2019-04-01", pasoDestino: "LEGAL" }), ...pasos.slice(3).map((paso, i) => fila({ fecha: `2019-0${5 + i}-01`, pasoDestino: paso }))],
      0,
    );
    expect(r.paso.clave).toBe("ADM_ENTREGA");
    expect((await movimientos(prisma, alta.numero))[1]).toMatchObject({ datos: { pasos_salteados: ["COMPUTO_ALTA", "LIQUIDACION"] } });

    // Sin concluir, archivar exige motivo (lo exige también el CHECK).
    expect(
      await errorDe(exp.transcribirEstado(mesa, alta.numero, { estado: "archivado", fecha: "2019-09-01", fuente: "Ficha papel", ubicacionArchivo: "desconocida" }, r.version, comando())),
    ).toMatchObject({ codigo: "motivo_requerido" });
    const c = await exp.transcribirEstado(mesa, alta.numero, { estado: "concluido", fecha: "2019-08-15", fuente: "Ficha papel" }, r.version, comando());
    // No retrocede respecto del último pase.
    expect(
      await errorDe(exp.transcribirEstado(mesa, alta.numero, { estado: "archivado", fecha: "2019-08-01", fuente: "Ficha papel", ubicacionArchivo: "Caja 1" }, c.version, comando())),
    ).toMatchObject({ codigo: "validacion" });
    const a = await exp.transcribirEstado(mesa, alta.numero, { estado: "archivado", fecha: "2019-09-01", fuente: "Ficha papel", ubicacionArchivo: "desconocida" }, c.version, comando());
    expect(await proyeccion(prisma, alta.numero)).toMatchObject({ estado: "archivado", estadoPrevio: "concluido", ubicacionArchivo: "DESCONOCIDA", cargaHistorica: true });
    expect((await movimientos(prisma, alta.numero)).slice(-2).map((m) => [m.estadoAnterior, m.estadoNuevo, m.cargaHistorica, m.motivo])).toEqual([
      ["en_tramite", "concluido", true, null],
      ["concluido", "archivado", true, null],
    ]);

    const fin = await exp.terminarCargaHistorica(mesa, alta.numero, a.version, comando());
    // Concluido: todos los pasos quedaron atrás, también el último.
    expect(fin.historicos.subtareas).toEqual(expect.arrayContaining(["MESA_CARATULA", "LEG_DICTAMEN", "ADM_ENTREGADO"]));
    expect((await proyeccion(prisma, alta.numero)).cargaHistorica).toBe(false);
    // La ubicación desconocida se reemplaza cuando aparece la caja.
    const caja = await exp.cambiarUbicacionArchivo(mesa, alta.numero, "Caja 2019-07", fin.version, comando());
    expect(caja.ubicacionArchivo).toBe("Caja 2019-07");
    const cc = await conciliacion(prisma, alta.numero);
    expect(cc.actual).toEqual(cc.reconstruida);
  });
});
