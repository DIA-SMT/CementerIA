// La transcripción de la ficha de papel (src/lib/dominio/expedientes/transcripcion.ts)
// contra la base real: docs/propuesta-mvp.md, 2.13(c). Un expediente de 2019
// con 5 filas hasta Legal (con una devolución), tildes con fecha, "Terminar
// carga histórica", y otro llevado a concluido y archivado con ubicación
// DESCONOCIDA. Mientras la carga está abierta no aparece en las bandejas de
// trabajo ni cuenta como demorado.
//
// Después de terminarla (la revisión del 03/11/2026): los demorados, el plazo
// y los avisos por tiempo cuentan desde ese momento, no desde las fechas del
// papel (que la ficha sigue mostrando); el expediente sigue marcado "Del
// papel" y el buscador lo encuentra; y una subtarea sin fecha toma la de la
// llegada a su paso.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generarEn, TIPOS_POR_TIEMPO } from "@/lib/dominio/avisos";
import { ErrorDominio, type FilaTranscripcion, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { leerItems } from "@/lib/dominio/expedientes/items";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, inicioDelDiaEnTucuman, interpretarDatetimeLocal } from "@/lib/fechas";
import { asegurarSemilla, comando, conciliacion, datosAlta, movimientos, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma, SISTEMA } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let mesa: UsuarioPermisos;
let legal: UsuarioPermisos;
let tributario: UsuarioPermisos;
let admin: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, legal, tributario, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "TRIBUTARIO"),
    usuario(prisma, "ADMIN"),
  ]);
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

class Deshacer extends Error {}

/**
 * Los tipos de aviso por tiempo que `generarEn` le daría a un expediente si
 * corriera en `ahora`. En una transacción que se deshace: los avisos de todos
 * los expedientes de la base no quedan para los otros archivos.
 */
async function avisosPorTiempo(numero: string, ahora: Date): Promise<string[]> {
  let tipos: string[] = [];
  await prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.usuario_id', ${String(SISTEMA)}, true)`;
        await generarEn(tx, ahora);
        const e = await tx.expediente.findUniqueOrThrow({ where: { numeroInterno: numero }, select: { id: true } });
        const avisos = await tx.aviso.findMany({ where: { expedienteId: e.id, tipo: { in: [...TIPOS_POR_TIEMPO] } }, select: { tipo: true } });
        tipos = [...new Set(avisos.map((a) => a.tipo))].sort();
        throw new Deshacer();
      },
      { timeout: 60_000 },
    )
    .catch((e: unknown) => {
      if (!(e instanceof Deshacer)) throw e;
    });
  return tipos;
}

describe("después de terminar la carga con el expediente en trámite", () => {
  it("los demorados y los avisos cuentan desde que se terminó, no desde 1998; la ficha sigue mostrando la fecha del papel", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { cargaHistorica: true, fuente: "Ficha papel", fechaInicio: "1998-03-02" }), comando());
    const r = await exp.transcribir(mesa, alta.numero, [fila({ fecha: "1998-09-15", pasoDestino: "LEGAL" })], 0);
    await exp.terminarCargaHistorica(mesa, alta.numero, r.version, comando());
    const llegada = inicioDelDiaEnTucuman("1998-09-15");
    const terminada = (await movimientos(prisma, alta.numero)).at(-1)?.fechaEfectiva;
    if (!terminada) throw new Error("falta el movimiento de terminar");

    // La historia no cambia: en Legal desde el 15/09/1998, con los años que pasó en el papel.
    const f = await exp.obtenerFicha(legal, alta.numero);
    expect(f.enAreaDesde).toEqual(llegada);
    expect(f.tramos.find((t) => t.actual)?.diasHabiles).toBeGreaterThan(5000);
    // La demora (la misma regla que la bandeja y el panel), desde que se terminó.
    expect(f.demora).toMatchObject({ desde: terminada, diasEnArea: 0, demorado: false });

    const enLegal = (await exp.bandeja(legal, "en_mi_area")).filas.find((x) => x.numero === alta.numero);
    expect(enLegal).toMatchObject({ enAreaDesde: llegada, diasEnArea: 0, demorado: false, cuentaDesde: terminada });
    expect((await exp.panel(admin)).demorados.filas.map((x) => x.numero)).not.toContain(alta.numero);
    expect(await avisosPorTiempo(alta.numero, new Date())).toEqual([]);

    // Con el tiempo sí se demora, contando desde el fin de la carga: decenas de días, no miles.
    const despues = new Date(terminada.getTime() + 60 * 86_400_000);
    const luego = (await servicio(prisma, () => despues).bandeja(legal, "en_mi_area")).filas.find((x) => x.numero === alta.numero);
    expect(luego?.demorado).toBe(true);
    expect(luego?.diasEnArea).toBeGreaterThanOrEqual(30);
    expect(luego?.diasEnArea).toBeLessThan(60);
    expect(await avisosPorTiempo(alta.numero, despues)).toEqual(["demorado"]);

    const c = await conciliacion(prisma, alta.numero);
    expect(c.actual).toEqual(c.reconstruida);
  });

  it("el plazo de la DIM transcripto corre desde que se terminó la carga, no vencido desde 1998", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "RENOV_PLAN", cargaHistorica: true, fuente: "Ficha papel", fechaInicio: "1998-03-02" }), comando());
    const r1 = await exp.transcribir(mesa, alta.numero, [fila({ fecha: "1998-09-01", pasoDestino: "TRIBUTARIO" })], 0);
    const t = await exp.tildarSubtareaHistorica(mesa, alta.numero, "TRIB_NOTIFICADA", "1998-09-10", { fuente: "Ficha papel" }, r1.version, comando());
    const r2 = await exp.transcribir(mesa, alta.numero, [fila({ fecha: "1998-09-15", pasoDestino: "DIM" })], t.version);
    expect((await proyeccion(prisma, alta.numero)).plazoDesde).toEqual(new Date("1998-09-10T00:00:00Z"));
    await exp.terminarCargaHistorica(mesa, alta.numero, r2.version, comando());

    const hoy = hoyEnTucuman();
    const [{ vence }] = await prisma.$queryRaw<Array<{ vence: string }>>`SELECT public.f_sumar_dias_habiles(${hoy}::date, 30)::text AS vence`;
    const f = await exp.obtenerFicha(tributario, alta.numero);
    // `desde` es el del papel; el vencimiento, a 30 días hábiles del fin de la carga.
    expect(f.plazo).toMatchObject({ desde: "1998-09-10", vence, faltan: 30, semaforo: "en_termino" });
    expect(f.plazo?.aniosSinCerrar.every((a) => a >= Number(hoy.slice(0, 4)))).toBe(true);
    const enPlazos = (await exp.bandeja(tributario, "plazos")).filas.find((x) => x.numero === alta.numero);
    expect(enPlazos?.etiquetas).toContainEqual(expect.objectContaining({ tipo: "plazo", vence, semaforo: "en_termino" }));
    expect((await exp.panel(admin)).plazos.vencidos.filas.map((x) => x.numero)).not.toContain(alta.numero);
    expect(await avisosPorTiempo(alta.numero, new Date())).toEqual([]);
  });

  it("sigue marcado 'Del papel': la ficha, el buscador (historica=1) y no el filtro de la carga abierta", async () => {
    const alta = await historico2019();
    const r = await exp.transcribir(mesa, alta.numero, [fila({ fecha: "2019-05-10", pasoDestino: "LEGAL" })], 0);
    const abierta = await exp.buscar(mesa, { filtros: { delPapel: true } });
    expect(abierta.resultados.find((x) => x.numero === alta.numero)).toMatchObject({ delPapel: true, cargaHistorica: true });
    await exp.terminarCargaHistorica(mesa, alta.numero, r.version, comando());

    expect((await proyeccion(prisma, alta.numero)).cargaHistorica).toBe(false);
    expect((await exp.obtenerFicha(mesa, alta.numero)).delPapel).toBe(true);
    const delPapel = await exp.buscar(mesa, { filtros: { delPapel: true } });
    expect(delPapel.resultados.find((x) => x.numero === alta.numero)).toMatchObject({ delPapel: true, cargaHistorica: false });
    expect(delPapel.resultados.every((x) => x.delPapel)).toBe(true);
    expect((await exp.buscar(mesa, { filtros: { delPapel: false } })).resultados.map((x) => x.numero)).not.toContain(alta.numero);
    expect((await exp.buscar(mesa, { filtros: { cargaAbierta: true } })).resultados.map((x) => x.numero)).not.toContain(alta.numero);
    // Uno nacido en el sistema no es del papel.
    const nuevo = await exp.alta(mesa, await datosAlta(prisma), comando());
    expect((await exp.obtenerFicha(mesa, nuevo.numero)).delPapel).toBe(false);
    expect((await exp.buscar(mesa, { filtros: { delPapel: true } })).resultados.map((x) => x.numero)).not.toContain(nuevo.numero);
  });

  it("una subtarea sin fecha toma la de la llegada a su paso, con su precisión (el alta, en el primero)", async () => {
    const alta = await historico2019();
    // COMPUTO_ALTA queda salteado: la ficha no lo registra.
    const r = await exp.transcribir(
      mesa,
      alta.numero,
      [fila({ fecha: "2019-04-02T09:15", pasoDestino: "LIQUIDACION" }), fila({ fecha: "2019-05-10", pasoDestino: "LEGAL" })],
      0,
    );
    const a = await exp.tildarSubtareaHistorica(mesa, alta.numero, "LIQ_DEBITOS", null, { fuente: "Ficha papel" }, r.version, comando());
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      tipo: "subtarea",
      fechaEfectiva: interpretarDatetimeLocal("2019-04-02T09:15"),
      precisionFecha: "minuto",
      datos: { subtarea: "LIQ_DEBITOS", paso: "LIQUIDACION" },
    });
    const b = await exp.tildarSubtareaHistorica(mesa, alta.numero, "MESA_CARATULA", null, { fuente: "Ficha papel" }, a.version, comando());
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({ fechaEfectiva: inicioDelDiaEnTucuman("2019-03-15"), precisionFecha: "dia" });
    // El paso salteado se recorrió en el pase que lo salteó.
    await exp.tildarSubtareaHistorica(mesa, alta.numero, "COMP_GRABADO", null, { fuente: "Ficha papel" }, b.version, comando());
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({ fechaEfectiva: interpretarDatetimeLocal("2019-04-02T09:15"), precisionFecha: "minuto" });
  });
});
