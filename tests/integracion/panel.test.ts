// El panel general y el CSV del buscador (semana 4) contra la base real:
// docs/propuesta-mvp.md, sección 5 (/panel y /expedientes), 3.2 y decisión 13.
// La base es compartida por toda la batería: los conteos se comparan con la
// base y las listas se buscan por los expedientes que arma cada test.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, sumarDias } from "@/lib/fechas";
import { asegurarSemilla, comando, completarPaso, datosAlta, idArea, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let direccion: UsuarioPermisos;
let admin: UsuarioPermisos;
const hoy = hoyEnTucuman();

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, direccion, admin] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "DIRECCION"),
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

describe("panel (sección 5)", () => {
  it("demorados, sin confirmar, diferidos, correcciones, cargas históricas, conteos, matriz y avisos", async () => {
    // Un demorado: en Mesa desde hace 10 días (dias_alerta de MESA: 2).
    const demorado = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -10) }), comando());
    // Uno enviado a Cómputo hace 9 días y sin confirmar: también es un pase diferido (cargado hoy).
    const enviado = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -10) }), comando());
    const v = await completarPaso(exp, prisma, enviado.numero);
    const pase = await exp.darPase(mesa, enviado.numero, "COMPUTO_ALTA", v, comando(), { fechaEfectiva: sumarDias(hoy, -9) });
    // Una corrección del mes.
    await exp.corregirObservacion(mesa, enviado.numero, pase.movimientoId, "Con carátula", "Faltaba anotar la carátula", pase.version, comando());
    // Una carga histórica abierta, vieja: no cuenta como demorada.
    const historico = await exp.alta(mesa, await datosAlta(prisma, { cargaHistorica: true, fuente: "Ficha papel", fechaInicio: "2018-02-01" }), comando());

    const p = await exp.panel(direccion);
    expect(p.hoy).toBe(hoy);
    expect(p.demorados.filas.find((f) => f.numero === demorado.numero)).toMatchObject({ diasAlerta: 2, areaActual: { codigo: "MESA_ENTRADAS" } });
    expect(p.demorados.filas.find((f) => f.numero === demorado.numero)?.diasEnArea).toBeGreaterThanOrEqual(2);
    expect(p.demorados.filas.map((f) => f.numero)).not.toContain(historico.numero);
    expect(p.sinConfirmar.filas.find((f) => f.numero === enviado.numero)).toMatchObject({ areaActual: { codigo: "COMPUTO" } });
    expect(p.diferidos.mes).toBe(hoy.slice(0, 7));
    expect(p.diferidos.filas.find((m) => m.numero === enviado.numero)).toMatchObject({ tipo: "pase", movimientoId: pase.movimientoId, precisionFecha: "dia" });
    expect(p.correcciones.filas.find((m) => m.numero === enviado.numero)).toMatchObject({ tipo: "correccion", motivo: "Faltaba anotar la carátula" });
    expect(p.cargasHistoricas.filas.map((f) => f.numero)).toContain(historico.numero);
    expect(p.cargasHistoricas.busqueda).toEqual({ cargaHistorica: true });

    // Conteos por estado: sin las cargas históricas abiertas, y el enlace lleva a la misma lista.
    for (const c of p.conteos) {
      expect(c.cantidad).toBe(await prisma.expediente.count({ where: { estado: c.estado, cargaHistorica: false } }));
      expect(c.busqueda).toMatchObject({ estados: [c.estado], cargaHistorica: false });
    }
    const conteo = p.conteos.find((c) => c.estado === "en_tramite");
    if (!conteo) throw new Error("falta en_tramite");
    const buscados = await exp.buscar(direccion, { filtros: conteo.busqueda });
    if (!buscados.hayMas) expect(buscados.resultados).toHaveLength(conteo.cantidad);

    // Matriz área × tipo de trámite.
    const idComputo = await idArea(prisma, "COMPUTO");
    const tipo = await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: "RENOVACION" }, select: { id: true } });
    const celda = p.matriz.celdas.find((c) => c.areaId === idComputo && c.tipoTramiteId === tipo.id);
    expect(celda?.cantidad).toBe(
      await prisma.expediente.count({
        where: { areaActualId: idComputo, tipoTramiteId: tipo.id, estado: { in: ["en_tramite", "espera_pago_dim"] }, cargaHistorica: false },
      }),
    );
    expect(celda?.busqueda).toEqual({ areaActualId: idComputo, tipoTramiteId: tipo.id, estados: ["en_tramite", "espera_pago_dim"], cargaHistorica: false });
    expect(p.matriz.areas.map((a) => a.codigo)).toContain("COMPUTO");
    const enCelda = await exp.buscar(direccion, { filtros: celda?.busqueda });
    expect(enCelda.resultados.map((r) => r.numero)).toContain(enviado.numero);

    // Avisos: la semilla deja 2026 y 2027 sin cerrar.
    expect(p.avisos).toContainEqual({ tipo: "feriados_sin_cerrar", anio: Number(hoy.slice(0, 4)) + 1, mensaje: `Feriados de ${Number(hoy.slice(0, 4)) + 1} sin cerrar` });

    // Filtrado por tipo de trámite.
    const nueva = await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: "NUEVA_CONCESION" }, select: { id: true } });
    const pn = await exp.panel(admin, { tipoTramiteId: nueva.id });
    expect(pn.demorados.filas.map((f) => f.numero)).not.toContain(demorado.numero);
    for (const c of pn.conteos) {
      expect(c.cantidad).toBe(await prisma.expediente.count({ where: { estado: c.estado, cargaHistorica: false, tipoTramiteId: nueva.id } }));
      expect(c.busqueda.tipoTramiteId).toBe(nueva.id);
    }
    // El panel es de todos.
    expect((await exp.panel(computo)).conteos).toHaveLength(5);
  });
});

describe("exportar CSV (3.2: Dirección y admin, sin datos de contacto)", () => {
  it("con los filtros del buscador, sin teléfono, correo ni domicilio, y registrado en auditoria.accesos", async () => {
    const datos = await datosAlta(prisma);
    const titular = datos.personas[0];
    const alta = await exp.alta(mesa, datos, comando());

    expect(await errorDe(exp.exportarCsv(mesa, { q: alta.numero }))).toMatchObject({ motivo: "area_no_habilitada" });
    expect(await errorDe(exp.exportarCsv(computo, {}))).toMatchObject({ motivo: "area_no_habilitada" });

    const csv = await exp.exportarCsv(direccion, { q: alta.numero }, { ip: "10.0.0.7" });
    expect(csv).toMatchObject({ nombreArchivo: `expedientes-${hoy}.csv`, tipo: "text/csv; charset=utf-8", filas: 1, truncado: false });
    const lineas = csv.contenido.replace(/^﻿/, "").split("\r\n");
    expect(lineas[0]).toBe("N° interno;N° municipal;Estado;Fecha de inicio;Tipo de trámite;Plantilla;Versión;Cementerio;Ubicación;Paso;Área actual;Titular;Carga histórica");
    expect(lineas[1]).toContain(alta.numero);
    expect(lineas[1]).toContain(titular.apellido ?? "");
    for (const dato of [titular.telefono, titular.email, titular.domicilio]) expect(csv.contenido).not.toContain(dato ?? "-");

    const acceso = await prisma.auditoriaAcceso.findFirst({ where: { usuarioId: direccion.id, accion: "exportar" }, orderBy: { id: "desc" } });
    expect(acceso).toMatchObject({ expedienteId: null, ip: "10.0.0.7", detalle: { formato: "csv", q: alta.numero, filas: 1, truncado: false } });

    // Por filtros, como el buscador (el admin también exporta).
    const porFiltros = await exp.exportarCsv(admin, { filtros: { estados: ["en_tramite"], fechaInicioDesde: hoy } });
    const buscados = await exp.buscar(admin, { filtros: { estados: ["en_tramite"], fechaInicioDesde: hoy } });
    if (!buscados.hayMas) expect(porFiltros.filas).toBe(buscados.resultados.length);
    expect(porFiltros.filas).toBeGreaterThanOrEqual(1);
    expect(await errorDe(exp.exportarCsv(admin, { filtros: { fechaInicioDesde: "2026-02-30" } }))).toMatchObject({ codigo: "validacion" });
  });
});
