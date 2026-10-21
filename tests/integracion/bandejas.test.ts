// Bandejas (src/lib/dominio/expedientes/bandejas.ts) y lo que la ficha suma en
// la semana 3 (acciones, "Faltan N", destinos, subtareas reiniciables):
// docs/propuesta-mvp.md, sección 5 y 3.2.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conActorEn } from "@/lib/db/actor";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, sumarDias } from "@/lib/fechas";
import { asegurarSemilla, avanzar, comando, completarPaso, datosAlta, proyeccion, servicio, titular, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let legal: UsuarioPermisos;
let direccion: UsuarioPermisos;
let admin: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, liquidacion, legal, direccion, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "DIRECCION"),
    usuario(prisma, "ADMIN"),
  ]);
});

afterAll(async () => prisma.$disconnect());

describe("bandejas", () => {
  it("Por confirmar y En mi área, con las columnas de la sección 5", async () => {
    const hoy = hoyEnTucuman();
    const persona = titular();
    // N° municipal propio: alta.test.ts espera que el suyo (4321/2026) no tenga duplicados, y el orden de los archivos varía.
    const alta = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -20), numeroMunicipal: "8765/2026", personas: [persona] }), comando());
    // Llega a Cómputo hace 15 días: con dias_alerta 5, demorado.
    const r = await avanzar(exp, prisma, alta.numero, { fechaPase: sumarDias(hoy, -15) });

    const porConfirmar = await exp.bandeja(computo, "por_confirmar");
    const fila = porConfirmar.filas.find((f) => f.numero === alta.numero);
    expect(fila).toMatchObject({
      numeroCorto: alta.numeroCorto,
      numeroMunicipal: "8765/2026",
      titular: `${persona.apellido}, ${persona.nombres}`,
      tramite: { tipo: "Renovación de concesión", plantilla: "Renovación, pago de contado", codigo: "RENOV_CONTADO", version: 1 },
      paso: { clave: "COMPUTO_ALTA", nombre: "Cómputo: alta", orden: 2, total: 7 },
      estado: "en_tramite",
      version: r.version,
      areaActual: { codigo: "COMPUTO", externa: false },
      diasAlerta: 5,
      demorado: true,
      etiquetas: [{ tipo: "sin_confirmar" }],
      soloConsulta: false,
    });
    // f_dias_habiles_entre: hábiles desde la llegada (sin fines de semana ni feriados).
    const [{ dias }] = await prisma.$queryRaw<Array<{ dias: number }>>`
      SELECT public.f_dias_habiles_entre(${sumarDias(hoy, -15)}::date, ${hoy}::date) AS dias`;
    expect(fila?.diasEnArea).toBe(dias);
    expect((await exp.bandeja(computo, "en_mi_area")).filas.find((f) => f.numero === alta.numero)?.etiquetas).toEqual([{ tipo: "sin_confirmar" }]);
    // De los más viejos a los más nuevos.
    const fechas = porConfirmar.filas.map((f) => f.enAreaDesde.getTime());
    expect([...fechas].sort((a, b) => a - b)).toEqual(fechas);

    // Confirmado: sale de Por confirmar y queda en En mi área sin la etiqueta.
    await exp.confirmarRecepcion(computo, alta.numero, r.version, comando());
    expect((await exp.bandeja(computo, "por_confirmar")).filas.some((f) => f.numero === alta.numero)).toBe(false);
    expect((await exp.bandeja(computo, "en_mi_area")).filas.find((f) => f.numero === alta.numero)?.etiquetas).toEqual([]);
    // Otra área no lo ve.
    expect((await exp.bandeja(legal, "en_mi_area")).filas.some((f) => f.numero === alta.numero)).toBe(false);
  });

  it("Dirección y el admin no tienen bandeja; su contador es 0", async () => {
    await expect(exp.bandeja(direccion, "en_mi_area")).rejects.toMatchObject({ motivo: "solo_lectura" });
    await expect(exp.bandeja(admin, "por_confirmar")).rejects.toMatchObject({ motivo: "admin_no_opera" });
    expect(await exp.contadorPorConfirmar(direccion)).toBe(0);
    expect(await exp.contadorPorConfirmar(admin)).toBe(0);
  });

  it("los concluidos, archivados y anulados no están en ninguna bandeja", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero);
    const antes = await exp.contadorPorConfirmar(computo);
    await conActorEn(prisma, 1, "Estado forzado en un test", (tx) =>
      tx.expediente.update({ where: { numeroInterno: alta.numero }, data: { estado: "anulado", estadoPrevio: "en_tramite" } }),
    );
    expect(await exp.contadorPorConfirmar(computo)).toBe(antes - 1);
    expect((await exp.bandeja(computo, "por_confirmar")).filas.some((f) => f.numero === alta.numero)).toBe(false);
  });
});

describe("la ficha para actuar (semana 3)", () => {
  it("acciones según el usuario, Faltan N, destinos y subtareas reiniciables", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    for (let i = 0; i < 3; i++) await avanzar(exp, prisma, alta.numero); // en Legal, sin confirmar

    const deLegal = await exp.obtenerFicha(legal, alta.numero);
    const si = { permitido: true, requiereMotivo: false };
    expect(deLegal.acciones).toMatchObject({
      confirmarRecepcion: si,
      tildarSubtarea: si,
      marcarDocumento: si,
      adjuntar: si,
      darPase: si,
      devolver: si,
    });
    expect(deLegal.pase.faltan.map((f) => f.clave)).toEqual(["LEG_DICTAMEN"]);
    expect(deLegal.pase.destinos).toEqual([expect.objectContaining({ clave: "ADM_RESOLUCION", tipo: "siguiente" })]);
    expect(deLegal.devolucion.destinos.map((d) => d.clave)).toEqual(["MESA", "COMPUTO_ALTA", "LIQUIDACION"]);
    expect(deLegal.devolucion.subtareasReiniciables.map((s) => `${s.paso.orden}:${s.clave}`)).toEqual([
      "1:MESA_CARATULA",
      "2:COMP_GRABADO",
      "3:LIQ_DEBITOS",
      "3:LIQ_BOLETA",
      "3:LIQ_PAGO",
    ]);
    expect(deLegal.situaciones).toContain("sin_confirmar");

    const deMesa = await exp.obtenerFicha(mesa, alta.numero);
    expect(deMesa.acciones.darPase).toEqual({ permitido: false, motivo: "no_es_responsable" });
    expect(deMesa.acciones.marcarDocumento).toEqual(si);
    expect(deMesa.acciones.adjuntar).toEqual(si);
    const deLiquidacion = await exp.obtenerFicha(liquidacion, alta.numero);
    expect(deLiquidacion.acciones.devolver).toEqual({ permitido: false, motivo: "no_es_responsable" });
    expect(deLiquidacion.datosCompletos).toBe(true);
    expect(deLiquidacion.adjuntos).toEqual([]);

    // Completo: no falta nada.
    await completarPaso(exp, prisma, alta.numero);
    const completo = await exp.obtenerFicha(legal, alta.numero);
    expect(completo.pase.faltan).toEqual([]);
    expect(completo.pase.destinos[0]?.faltan).toEqual([]);
    expect(completo.situaciones).not.toContain("sin_confirmar");
    expect((await proyeccion(prisma, alta.numero)).version).toBe(completo.version);
  });
});

describe("bandeja: acciones de cada fila y contadores de las pestañas (pantallas de la semana 3)", () => {
  it("Confirmar va donde hay que confirmar; Dar pase rápido, solo sin faltantes y con un único destino", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const deMesa = () => exp.bandeja(mesa, "en_mi_area").then((b) => b.filas.find((f) => f.numero === alta.numero));
    // En Mesa, recibido en el alta y con faltantes.
    expect(await deMesa()).toMatchObject({ puedeConfirmar: false, paseRapido: null });
    await completarPaso(exp, prisma, alta.numero);
    expect((await deMesa())?.paseRapido).toEqual({ clave: "COMPUTO_ALTA", nombre: "Cómputo: alta", orden: 2 });

    const pase = await avanzar(exp, prisma, alta.numero);
    const fila = (await exp.bandeja(computo, "por_confirmar")).filas.find((f) => f.numero === alta.numero);
    expect(fila).toMatchObject({ puedeConfirmar: true, paseRapido: null, version: pase.version });
    // Liquidación no es la responsable: aunque lo viera, no lo confirma ni le da pase.
    expect((await exp.bandeja(liquidacion, "por_confirmar")).filas.some((f) => f.numero === alta.numero)).toBe(false);

    // Liquidación lo devuelve a Cómputo: en rojo con el motivo, y al completarlo
    // el único destino es el siguiente (que es el que lo devolvió).
    await avanzar(exp, prisma, alta.numero);
    const enLiq = await exp.validarPase(liquidacion, alta.numero);
    await exp.devolver(liquidacion, alta.numero, "COMPUTO_ALTA", "Falta firma: constancia sin firmar", ["COMP_GRABADO"], enLiq.version, comando());
    const devuelto = (await exp.bandeja(computo, "por_confirmar")).filas.find((f) => f.numero === alta.numero);
    expect(devuelto?.etiquetas).toContainEqual({
      tipo: "devuelto",
      porArea: "Liquidación",
      desdePaso: "Liquidación y boleta",
      motivo: "Falta firma: constancia sin firmar",
    });
    expect(devuelto?.paseRapido).toBeNull();
    await completarPaso(exp, prisma, alta.numero);
    expect((await exp.bandeja(computo, "en_mi_area")).filas.find((f) => f.numero === alta.numero)?.paseRapido).toMatchObject({ clave: "LIQUIDACION" });
  });

  it("con reenvío directo hay dos destinos: sin pase rápido (se elige en la ficha)", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    for (let i = 0; i < 3; i++) await avanzar(exp, prisma, alta.numero); // en Legal
    const v = await exp.validarPase(legal, alta.numero);
    await exp.devolver(legal, alta.numero, "COMPUTO_ALTA", "Error en boleta: el período no coincide", [], v.version, comando());
    await completarPaso(exp, prisma, alta.numero);
    const fila = (await exp.bandeja(computo, "en_mi_area")).filas.find((f) => f.numero === alta.numero);
    expect(fila?.paseRapido).toBeNull();
    const ficha = await exp.obtenerFicha(computo, alta.numero);
    expect(ficha.pase.destinos.map((d) => d.tipo)).toEqual(["siguiente", "reenvio"]);
  });

  it("los contadores coinciden con lo que muestra cada pestaña", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    await avanzar(exp, prisma, alta.numero);
    for (const u of [mesa, computo, liquidacion]) {
      const c = await exp.contadoresBandeja(u);
      const [pc, ema, af, pz, ch] = await Promise.all([
        exp.bandeja(u, "por_confirmar"),
        exp.bandeja(u, "en_mi_area"),
        exp.bandeja(u, "afuera"),
        exp.bandeja(u, "plazos"),
        exp.bandeja(u, "carga_historica"),
      ]);
      // Semana 4: Plazos y Carga histórica.
      if (!pz.hayMas) expect(c.plazos).toBe(pz.filas.length);
      if (!ch.hayMas) expect(c.carga_historica).toBe(ch.filas.length);
      if (!pc.hayMas) expect(c.por_confirmar).toBe(pc.filas.length);
      if (!ema.hayMas) expect(c.en_mi_area).toBe(ema.filas.length);
      if (!af.hayMas) {
        expect(c.afuera).toBe(af.filas.length);
        expect(c.afueraCustodia).toBe(af.filas.filter((f) => !f.soloConsulta).length);
      }
      expect(c.por_confirmar).toBe(await exp.contadorPorConfirmar(u));
    }
    expect(await exp.contadoresBandeja(direccion)).toEqual({ por_confirmar: 0, en_mi_area: 0, afuera: 0, afueraCustodia: 0, plazos: 0, plazosAlerta: 0, carga_historica: 0 });
    expect(await exp.contadoresBandeja(admin)).toEqual({ por_confirmar: 0, en_mi_area: 0, afuera: 0, afueraCustodia: 0, plazos: 0, plazosAlerta: 0, carga_historica: 0 });
  });
});
