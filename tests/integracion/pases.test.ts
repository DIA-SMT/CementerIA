// El pase (src/lib/dominio/expedientes/pase.ts) contra la base real:
// docs/propuesta-mvp.md, 3.3, 3.5, 2.13(c) y (e). Recorridos completos de las
// plantillas (a), (b) y (d), concurrencia, idempotencia y fechas retroactivas.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RENOV_CONTADO } from "../../prisma/semilla/plantillas/renov-contado";
import { conActorEn } from "@/lib/db/actor";
import { ErrorDominio, MENSAJE_CONFLICTO_VERSION } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, inicioDelDiaEnTucuman, sumarDias } from "@/lib/fechas";
import {
  asegurarSemilla,
  avanzar,
  comando,
  completarPaso,
  datosAlta,
  idArea,
  movimientos,
  proyeccion,
  responsable,
  servicio,
  usuario,
} from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let tributario: UsuarioPermisos;
let administrativo: UsuarioPermisos;
let admin: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, tributario, administrativo, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "TRIBUTARIO"),
    usuario(prisma, "ADMINISTRATIVO"),
    usuario(prisma, "ADMIN"),
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

describe("recorrido completo de (a) RENOV_CONTADO", () => {
  it("del alta al último paso: cada pase al área siguiente, sin confirmar, con la recepción implícita al actuar", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const esperado = [
      ["COMPUTO_ALTA", "COMPUTO"],
      ["LIQUIDACION", "LIQUIDACION"],
      ["LEGAL", "LEGAL"],
      ["ADM_RESOLUCION", "ADMINISTRATIVO"],
      ["COMPUTO_FINAL", "COMPUTO"],
      ["ADM_ENTREGA", "ADMINISTRATIVO"],
    ] as const;
    for (const [paso, area] of esperado) {
      const r = await avanzar(exp, prisma, alta.numero);
      expect(r).toMatchObject({
        repetido: false,
        paso: { clave: paso },
        areaActual: { codigo: area },
        areaResponsable: { codigo: area },
        sinConfirmar: true,
        estado: "en_tramite",
      });
    }

    const e = await proyeccion(prisma, alta.numero);
    expect(e).toMatchObject({ pasoClave: "ADM_ENTREGA", pasoOrden: 7, estado: "en_tramite", recibidoEn: null, pasoRetornoClave: null });
    expect(e.areaActual.codigo).toBe("ADMINISTRATIVO");

    // El último paso no tiene destinos: se sale con Concluir (semana 4).
    const v = await exp.validarPase(administrativo, alta.numero);
    expect(v.destinos).toEqual([]);
    expect(v.permiso).toEqual({ permitido: false, motivo: "paso_final" });
    await expect(exp.darPase(administrativo, alta.numero, "ADM_ENTREGA", e.version, comando())).rejects.toMatchObject({
      motivo: "paso_final",
    });

    const ms = await movimientos(prisma, alta.numero);
    const pases = ms.filter((m) => m.tipo === "pase");
    expect(pases.map((m) => m.pasoDestino)).toEqual(esperado.map(([p]) => p));
    expect(pases.map((m) => m.pasoOrigen)).toEqual(["MESA", "COMPUTO_ALTA", "LIQUIDACION", "LEGAL", "ADM_RESOLUCION", "COMPUTO_FINAL"]);
    // Cada área de destino actuó sin confirmar: una recepción implícita por
    // área (salvo la última, que todavía no hizo nada), con la fecha de llegada.
    const recepciones = ms.filter((m) => m.tipo === "recepcion");
    expect(recepciones).toHaveLength(5);
    for (const r of recepciones) {
      expect(r.datos).toEqual({ implicita: true });
      const pase = pases.find((p) => p.pasoDestino === r.pasoDestino && p.secuencia < r.secuencia);
      expect(r.fechaEfectiva.getTime()).toBe(pase?.fechaEfectiva.getTime());
    }
    // El historial lleva siempre el área concreta y el autor.
    expect(pases.every((m) => m.areaDestinoId !== null && m.usuarioId > 1)).toBe(true);
    expect(e.version).toBe(ms.length - 1 - ms.filter((m) => m.tipo === "recepcion").length);

    // En el último paso todavía se trabaja: confirmar, tildar la entrega.
    const conf = await exp.confirmarRecepcion(administrativo, alta.numero, e.version, comando());
    const t = await exp.tildarSubtarea(administrativo, alta.numero, "ADM_ENTREGADO", hoyEnTucuman(), conf.version, comando());
    expect(t.recepcionImplicita).toBe(false);
    const f = await exp.obtenerFicha(administrativo, alta.numero);
    expect(f.pase).toEqual({ faltan: [], destinos: [] });
    expect(f.recorrido.at(-1)?.subtareas[0]).toMatchObject({ clave: "ADM_ENTREGADO", hecha: true, valor: hoyEnTucuman() });
  });

  it("sin completar el paso: faltan_requisitos con la lista exacta; ningún movimiento", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { documentosRecibidos: ["DNI"] }), comando());
    const v = await exp.validarPase(mesa, alta.numero);
    expect(v.faltan.map((f) => f.clave)).toEqual(["MESA_CARATULA", "FORM_INICIO_RENOV", "BOLETA_SERVICIO"]);
    const err = await errorDe(exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", 0, comando()));
    expect(err.codigo).toBe("faltan_requisitos");
    expect(err.message).toMatch(/^Faltan 3: /);
    expect(err.errores.map((x) => x.ruta)).toEqual(["subtareas.MESA_CARATULA", "documentos.FORM_INICIO_RENOV", "documentos.BOLETA_SERVICIO"]);
    expect((await movimientos(prisma, alta.numero)).map((m) => m.tipo)).toEqual(["alta"]);
  });

  it("destino inválido, permisos y versión", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const version = await completarPaso(exp, prisma, alta.numero);
    expect((await errorDe(exp.darPase(mesa, alta.numero, "LEGAL", version, comando()))).codigo).toBe("destino_invalido");
    await expect(exp.darPase(computo, alta.numero, "COMPUTO_ALTA", version, comando())).rejects.toBeInstanceOf(PermisoDenegado);
    await expect(exp.darPase(admin, alta.numero, "COMPUTO_ALTA", version, comando())).rejects.toMatchObject({ motivo: "admin_no_opera" });
    const conflicto = await errorDe(exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version - 1, comando()));
    expect(conflicto).toMatchObject({ codigo: "conflicto_version", message: MENSAJE_CONFLICTO_VERSION });
    expect((await errorDe(exp.darPase(mesa, "CEM-1999-99999", "X", 0, comando()))).codigo).toBe("no_encontrado");
  });
});

describe("(b) RENOV_PLAN: el paso DIM con custodia de Tributario", () => {
  it("entra a la DIM en espera de pago, con el plazo cargado, y sale con la deuda cancelada", async () => {
    const hoy = hoyEnTucuman();
    const inicio = sumarDias(hoy, -20);
    const notificada = sumarDias(hoy, -2);
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "RENOV_PLAN", fechaInicio: inicio }), comando());
    for (let i = 0; i < 5; i++) await avanzar(exp, prisma, alta.numero);
    expect((await proyeccion(prisma, alta.numero)).pasoClave).toBe("TRIBUTARIO");

    // Tributario notifica (TRIB_NOTIFICADA con fecha) y remite a la DIM.
    const version = await completarPaso(exp, prisma, alta.numero, { fecha: notificada });
    const pase = await exp.darPase(tributario, alta.numero, "DIM", version, comando());
    expect(pase).toMatchObject({
      paso: { clave: "DIM", orden: 7 },
      areaActual: { codigo: "DIM" },
      areaResponsable: { codigo: "TRIBUTARIO" },
      sinConfirmar: false,
      estado: "espera_pago_dim",
    });
    let e = await proyeccion(prisma, alta.numero);
    expect(e.recibidoEn?.getTime()).toBe(e.enAreaDesde.getTime());
    expect(e.plazoDiasHabiles).toBe(30);
    expect(e.plazoDesde?.toISOString().slice(0, 10)).toBe(notificada);
    expect(e.plazoCumplidoEn).toBeNull();
    const mPase = (await movimientos(prisma, alta.numero)).filter((m) => m.tipo === "pase").at(-1);
    expect(mPase).toMatchObject({ estadoAnterior: "en_tramite", estadoNuevo: "espera_pago_dim", areaDestinoId: await idArea(prisma, "DIM") });

    // La custodia: en "Afuera" de Tributario; Mesa la ve como consulta.
    const afuera = await exp.bandeja(tributario, "afuera");
    expect(afuera.filas.find((f) => f.numero === alta.numero)).toMatchObject({
      soloConsulta: false,
      estado: "espera_pago_dim",
      areaActual: { codigo: "DIM", externa: true },
      etiquetas: [{ tipo: "plazo", desde: notificada, diasHabiles: 30, cumplidoEn: null }],
    });
    expect((await exp.bandeja(mesa, "afuera")).filas.find((f) => f.numero === alta.numero)?.soloConsulta).toBe(true);
    expect((await exp.bandeja(tributario, "en_mi_area")).filas.some((f) => f.numero === alta.numero)).toBe(false);

    // Sin la deuda cancelada no sale.
    const falta = await errorDe(exp.darPase(tributario, alta.numero, "ADM_TITULO", e.version, comando()));
    expect(falta.errores).toEqual([{ ruta: "subtareas.DIM_DEUDA_CANCELADA", mensaje: expect.stringMatching(/falta tildarla/) }]);

    // Las subtareas del paso externo toman su fecha como fecha efectiva, con precisión de día (3.5).
    const plan = await exp.tildarSubtarea(tributario, alta.numero, "DIM_PLAN_INICIADO", hoy, e.version, comando());
    e = await proyeccion(prisma, alta.numero);
    expect(e.plazoCumplidoEn?.toISOString().slice(0, 10)).toBe(hoy);
    const mPlan = (await movimientos(prisma, alta.numero)).find((m) => m.id.toString() === plan.movimientoId);
    expect(mPlan).toMatchObject({ precisionFecha: "dia", datos: { subtarea: "DIM_PLAN_INICIADO", hecha: true, dato: hoy, paso: "DIM" } });
    expect(mPlan?.fechaEfectiva.getTime()).toBe(inicioDelDiaEnTucuman(hoy).getTime());

    // Destildar la de cierre reabre el plazo; volver a tildarla lo cierra.
    const des = await exp.destildarSubtarea(tributario, alta.numero, "DIM_PLAN_INICIADO", "Se cargó en el expediente equivocado", plan.version, comando());
    expect((await proyeccion(prisma, alta.numero)).plazoCumplidoEn).toBeNull();
    const re = await exp.tildarSubtarea(tributario, alta.numero, "DIM_PLAN_INICIADO", hoy, des.version, comando());
    const cancelada = await exp.tildarSubtarea(tributario, alta.numero, "DIM_DEUDA_CANCELADA", hoy, re.version, comando());

    // El pase de regreso: sale de la espera, limpia el plazo, queda sin confirmar en Administrativo.
    const vuelta = await exp.darPase(tributario, alta.numero, "ADM_TITULO", cancelada.version, comando());
    expect(vuelta).toMatchObject({ paso: { clave: "ADM_TITULO" }, areaActual: { codigo: "ADMINISTRATIVO" }, sinConfirmar: true, estado: "en_tramite" });
    e = await proyeccion(prisma, alta.numero);
    expect(e).toMatchObject({ plazoDesde: null, plazoDiasHabiles: null, plazoCumplidoEn: null, recibidoEn: null });
    const mVuelta = (await movimientos(prisma, alta.numero)).at(-1);
    expect(mVuelta).toMatchObject({ tipo: "pase", estadoAnterior: "espera_pago_dim", estadoNuevo: "en_tramite", areaOrigenId: await idArea(prisma, "DIM") });

    // Y sigue hasta el final.
    for (let i = 0; i < 2; i++) await avanzar(exp, prisma, alta.numero);
    expect((await proyeccion(prisma, alta.numero)).pasoClave).toBe("ADM_ENTREGA");
  });
});

describe("(d) NUEVA_CONC_CONTADO: el paso $CEMENTERIO", () => {
  it("va al área del cementerio del expediente, con custodia de Mesa de Entradas, y vuelve a Legal", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "NUEVA_CONC_CONTADO", cementerio: "NORTE" }), comando());
    for (let i = 0; i < 2; i++) await avanzar(exp, prisma, alta.numero);
    const r = await avanzar(exp, prisma, alta.numero);
    expect(r).toMatchObject({
      paso: { clave: "CEMENTERIO", orden: 4 },
      areaActual: { codigo: "CEM_NORTE" },
      areaResponsable: { codigo: "MESA_ENTRADAS" },
      sinConfirmar: false,
    });
    const ms = await movimientos(prisma, alta.numero);
    expect(ms.at(-1)).toMatchObject({ tipo: "pase", pasoDestino: "CEMENTERIO", areaDestinoId: await idArea(prisma, "CEM_NORTE") });
    expect((await responsable(prisma, alta.numero)).id).toBe(mesa.id);

    const f = await exp.obtenerFicha(mesa, alta.numero);
    expect(f.recorrido[3]).toMatchObject({ area: { codigo: "CEM_NORTE" }, custodia: { codigo: "MESA_ENTRADAS" }, situacion: "actual" });
    expect(f.acciones.darPase).toEqual({ permitido: true, requiereMotivo: false });
    expect(f.pase.faltan.map((x) => x.clave)).toEqual(["CEM_CONOCIMIENTO", "CEM_REGISTRADO"]);

    const vuelta = await avanzar(exp, prisma, alta.numero, { fecha: hoyEnTucuman() });
    expect(vuelta).toMatchObject({ paso: { clave: "LEGAL" }, areaActual: { codigo: "LEGAL" }, sinConfirmar: true });
    const despues = await movimientos(prisma, alta.numero);
    const conocimiento = despues.find((m) => m.tipo === "subtarea" && (m.datos as { subtarea?: string }).subtarea === "CEM_CONOCIMIENTO");
    expect(conocimiento).toMatchObject({ precisionFecha: "dia" });
    // Un paso sin fecha toma ahora, con precisión de minuto.
    const registrado = despues.find((m) => m.tipo === "subtarea" && (m.datos as { subtarea?: string }).subtarea === "CEM_REGISTRADO");
    expect(registrado).toMatchObject({ precisionFecha: "minuto" });
    expect(despues.at(-1)).toMatchObject({ tipo: "pase", areaOrigenId: await idArea(prisma, "CEM_NORTE") });
  });
});

describe("concurrencia e idempotencia (3.3, puntos 1 a 3)", () => {
  it("dos pases a la vez con la misma versión: uno gana y el otro recibe el mensaje de versión", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const version = await completarPaso(exp, prisma, alta.numero);
    const resultados = await Promise.allSettled([
      exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version, comando()),
      exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version, comando()),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const fallidos = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0].reason).toBeInstanceOf(ErrorDominio);
    expect(fallidos[0].reason).toMatchObject({ codigo: "conflicto_version", message: MENSAJE_CONFLICTO_VERSION });
    expect((await movimientos(prisma, alta.numero)).filter((m) => m.tipo === "pase")).toHaveLength(1);
  });

  it("el mismo comando dos veces (también a la vez) devuelve el primer resultado sin repetir nada", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero); // en Cómputo, sin confirmar
    const version = await completarPaso(exp, prisma, alta.numero);
    const c = comando();
    const [a, b] = await Promise.all([
      exp.darPase(computo, alta.numero, "LIQUIDACION", version, c),
      exp.darPase(computo, alta.numero, "LIQUIDACION", version, c),
    ]);
    expect([a.repetido, b.repetido].sort()).toEqual([false, true]);
    expect(a.movimientoId).toBe(b.movimientoId);
    const otra = await exp.darPase(computo, alta.numero, "LIQUIDACION", 0, c);
    expect(otra).toMatchObject({ repetido: true, movimientoId: a.movimientoId, version: a.version });
    const ms = await movimientos(prisma, alta.numero);
    expect(ms.filter((m) => m.tipo === "pase")).toHaveLength(2);
    expect(ms.filter((m) => m.comandoId === c).map((m) => m.tipo)).toEqual(["pase"]);
  });

  it("la recepción implícita va con el comando de la primera acción del área sin confirmar", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero);
    const e = await proyeccion(prisma, alta.numero);
    expect(e.recibidoEn).toBeNull();
    const v = await exp.validarPase(computo, alta.numero);
    expect(v.faltan.length).toBeGreaterThan(0);
    const version = await completarPaso(exp, prisma, alta.numero);
    expect(version).toBeGreaterThan(e.version);
    const ms = await movimientos(prisma, alta.numero);
    const implicita = ms.filter((m) => m.tipo === "recepcion");
    expect(implicita).toHaveLength(1);
    // Fue con el comando de la primera acción de Cómputo (la primera subtarea o documento).
    const primera = ms.find((m) => m.secuencia === (implicita[0]?.secuencia ?? 0) + 1);
    expect(primera?.comandoId).toBe(implicita[0]?.comandoId);
  });
});

describe("fechas retroactivas (2.13(c) y 3.3 punto 7)", () => {
  it("válidas: con precisión de día, desde el inicio; inválidas: futuras, de más de 30 días, antes del inicio o del último movimiento", async () => {
    const hoy = hoyEnTucuman();
    const alta = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -10) }), comando());
    // El alta con fecha pasada tiene precisión de día: la ficha lo muestra sin hora.
    let f = await exp.obtenerFicha(mesa, alta.numero);
    expect(f.enAreaDesdePrecision).toBe("dia");
    expect(f.recibidoEnPrecision).toBe("dia");

    const version = await completarPaso(exp, prisma, alta.numero);
    const pase = (fecha: string) => exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version, comando(), { fechaEfectiva: fecha });
    const mensaje = async (fecha: string) => (await errorDe(pase(fecha))).errores[0]?.mensaje;
    expect(await mensaje(sumarDias(hoy, 1))).toMatch(/posterior a ahora/);
    expect(await mensaje(sumarDias(hoy, -11))).toMatch(/anterior al inicio/);

    const r = await pase(sumarDias(hoy, -5));
    expect(r.repetido).toBe(false);
    const m = (await movimientos(prisma, alta.numero)).at(-1);
    expect(m).toMatchObject({ tipo: "pase", precisionFecha: "dia" });
    expect(m?.fechaEfectiva.getTime()).toBe(inicioDelDiaEnTucuman(sumarDias(hoy, -5)).getTime());
    f = await exp.obtenerFicha(computo, alta.numero);
    expect(f.enAreaDesdePrecision).toBe("dia");
    // La línea de tiempo va por fecha efectiva: el pase "de hace 5 días" queda antes que los tildes de hoy.
    expect(f.historial.find((x) => x.tipo === "pase")).toMatchObject({ precisionFecha: "dia", diferido: true });

    // Cómputo: no antes del pase que lo trajo (por día, porque el pase tiene precisión de día).
    const v2 = await completarPaso(exp, prisma, alta.numero);
    const pase2 = (fecha: string) => exp.darPase(computo, alta.numero, "LIQUIDACION", v2, comando(), { fechaEfectiva: fecha });
    expect((await errorDe(pase2(sumarDias(hoy, -6)))).errores[0]?.mensaje).toMatch(/anterior al último movimiento del papel/);
    expect(await pase2(`${sumarDias(hoy, -5)}T08:15`)).toMatchObject({ repetido: false, sinConfirmar: true });
    // La recepción implícita de Cómputo tomó la fecha de llegada, con su precisión.
    const recepcion = (await movimientos(prisma, alta.numero)).find((x) => x.tipo === "recepcion");
    expect(recepcion).toMatchObject({ precisionFecha: "dia", datos: { implicita: true } });

    // Más de 30 días: también para un expediente viejo (para eso está la carga histórica).
    const viejo = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -29) }), comando());
    const v3 = await completarPaso(exp, prisma, viejo.numero);
    expect((await errorDe(exp.darPase(mesa, viejo.numero, "COMPUTO_ALTA", v3, comando(), { fechaEfectiva: sumarDias(hoy, -31) }))).errores[0]?.mensaje).toMatch(
      /más de 30 días/,
    );
    expect(await exp.darPase(mesa, viejo.numero, "COMPUTO_ALTA", v3, comando(), { fechaEfectiva: sumarDias(hoy, -29) })).toMatchObject({ repetido: false });
  });

  it("un pase sin fecha usa ahora, con precisión de minuto; a un paso externo queda recibido con esa fecha", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "NUEVA_CONC_CONTADO" }), comando());
    for (let i = 0; i < 3; i++) await avanzar(exp, prisma, alta.numero);
    const f = await exp.obtenerFicha(mesa, alta.numero);
    // En el cementerio (custodia Mesa): recibido_en = fecha del pase, con su precisión.
    expect(f.recibidoEnPrecision).toBe("minuto");
    expect(f.situaciones).not.toContain("sin_confirmar");
  });
});

describe("pasos omitibles y carga histórica", () => {
  it("un posterior salteando solo omitibles exige motivo y queda en pasos_omitidos", async () => {
    // Ninguna plantilla de la semilla tiene pasos omitibles: una de prueba, con Cómputo alta omitible.
    const codigo = `PRUEBA_OMITIBLE_${Date.now().toString(36).toUpperCase()}`;
    const tipo = await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: "RENOVACION" }, select: { id: true } });
    const definicion = { ...RENOV_CONTADO, pasos: RENOV_CONTADO.pasos.map((p) => (p.clave === "COMPUTO_ALTA" ? { ...p, omitible: true } : p)) };
    const plantilla = await conActorEn(prisma, 1, "Plantilla de prueba", async (tx) => {
      const p = await tx.plantilla.create({
        data: { codigo, version: 1, tipoTramiteId: tipo.id, nombre: "Prueba con un paso omitible", definicion, creadoPor: 1 },
        select: { id: true },
      });
      await tx.plantilla.update({
        where: { id: p.id },
        data: { estado: "publicada", publicadoEn: new Date(), publicadoPor: 1, notasCambio: "Prueba de integración" },
      });
      return p;
    });
    const alta = await exp.alta(mesa, { ...(await datosAlta(prisma)), plantillaId: plantilla.id }, comando());
    const version = await completarPaso(exp, prisma, alta.numero);
    const v = await exp.validarPase(mesa, alta.numero);
    expect(v.destinos.map((d) => [d.clave, d.tipo, d.requiereMotivo])).toEqual([
      ["COMPUTO_ALTA", "siguiente", false],
      ["LIQUIDACION", "omitiendo", true],
    ]);
    expect((await errorDe(exp.darPase(mesa, alta.numero, "LIQUIDACION", version, comando()))).codigo).toBe("motivo_requerido");
    const r = await exp.darPase(mesa, alta.numero, "LIQUIDACION", version, comando(), { motivo: "No hay datos que grabar en Cómputo" });
    expect(r).toMatchObject({ paso: { clave: "LIQUIDACION", orden: 3 }, areaActual: { codigo: "LIQUIDACION" } });
    expect((await movimientos(prisma, alta.numero)).at(-1)).toMatchObject({
      tipo: "pase",
      motivo: "No hay datos que grabar en Cómputo",
      datos: { pasos_omitidos: ["COMPUTO_ALTA"], pasos_salteados: [] },
    });
  });

  it("con la carga histórica abierta no hay pases (se registran en la transcripción, semana 4)", async () => {
    const alta = await exp.alta(
      mesa,
      await datosAlta(prisma, { cargaHistorica: true, fuente: "Ficha papel", fechaInicio: sumarDias(hoyEnTucuman(), -400) }),
      comando(),
    );
    const version = await completarPaso(exp, prisma, alta.numero);
    await expect(exp.darPase(mesa, alta.numero, "COMPUTO_ALTA", version, comando())).rejects.toMatchObject({ motivo: "carga_historica_abierta" });
    expect((await exp.validarPase(mesa, alta.numero)).permiso).toEqual({ permitido: false, motivo: "carga_historica_abierta" });
  });
});
