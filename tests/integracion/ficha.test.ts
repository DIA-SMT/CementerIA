// Ficha, "Ver datos completos" y carátula (src/lib/dominio/expedientes/ficha.ts y
// caratula.ts) contra la base real: docs/propuesta-mvp.md, decisión 13, 2.10,
// 2.13(a), 3.2 y sección 5.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RENOV_CONTADO } from "../../prisma/semilla/plantillas/renov-contado";
import { conActorEn } from "@/lib/db/actor";
import { ErrorDominio, type ResultadoAlta } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { asegurarSemilla, comando, datosAlta, servicio, simularPase, titular, unicoLetras, usuario } from "./dominio";
import { SISTEMA, clientePrisma, unico } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let legal: UsuarioPermisos;
let direccion: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let alta: ResultadoAlta;
const solicitanteApellido = unicoLetras("FICTICIA ");

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, legal, direccion, liquidacion] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "DIRECCION"),
    usuario(prisma, "LIQUIDACION"),
  ]);
  alta = await exp.alta(
    mesa,
    await datosAlta(prisma, {
      numeroMunicipal: "777/2026",
      documentosRecibidos: ["DNI", "ESTADO_CUENTA"],
      datosExtra: { concesion_hasta: "2031-10-20" },
      personas: [
        titular({ esContacto: false, telefono: "0381 000-4567", email: "titular.ficticio@ejemplo.test", domicilio: "Calle Ficticia 999" }),
        { rol: "solicitante", apellido: solicitanteApellido, nombres: "Solicitante", dni: "96123456", vinculo: "hija", telefono: "0381 000-7788", esContacto: true },
      ],
    }),
    comando(),
  );
});

afterAll(async () => prisma.$disconnect());

async function accesos(usuarioId: number, accion: string) {
  const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: alta.numero }, select: { id: true } });
  return prisma.auditoriaAcceso.findMany({ where: { usuarioId, accion, expedienteId: e.id }, orderBy: { id: "asc" } });
}

describe("ficha", () => {
  it("todo lo de la sección 5, para Mesa de Entradas con el contacto completo", async () => {
    const f = await exp.obtenerFicha(mesa, alta.numero, { ip: "10.0.0.7" });
    expect(f).toMatchObject({
      numero: alta.numero,
      numeroCorto: alta.numeroCorto,
      numeroMunicipal: "777/2026",
      estado: "en_tramite",
      version: 0,
      tipoTramite: { codigo: "RENOVACION" },
      plantilla: { codigo: "RENOV_CONTADO", version: 1, versionPublicada: 1, hayVersionNueva: false, texto: "Renovación, pago de contado · v1" },
      cementerio: { codigo: "OESTE" },
      tipoMonumento: { codigo: "SEPULTURA", nombre: "Sepultura o bóveda" },
      paso: { clave: "MESA", nombre: "Mesa de Entradas", orden: 1, total: 7, esFinal: false },
      areaActual: { codigo: "MESA_ENTRADAS" },
      areaResponsable: { codigo: "MESA_ENTRADAS" },
      situaciones: [],
      plazo: null,
      datosCompletos: true,
      formaPago: "contado",
    });
    expect(f.recorrido.map((p) => [p.clave, p.situacion])).toEqual([
      ["MESA", "actual"],
      ["COMPUTO_ALTA", "pendiente"],
      ["LIQUIDACION", "pendiente"],
      ["LEGAL", "pendiente"],
      ["ADM_RESOLUCION", "pendiente"],
      ["COMPUTO_FINAL", "pendiente"],
      ["ADM_ENTREGA", "pendiente"],
    ]);
    expect(f.recorrido[0]).toMatchObject({ area: { codigo: "MESA_ENTRADAS" }, diasAlerta: 2, subtareas: [{ clave: "MESA_CARATULA", hecha: false }] });
    // Documentación separada por origen, con lo recibido en el alta.
    expect(f.documentacion.direccion.map((d) => [d.clave, d.estado])).toEqual([
      ["FORM_INICIO_RENOV", "pendiente"],
      ["CONST_COMPUTOS", "pendiente"],
      ["ESTADO_CUENTA", "presentado"],
      ["CONST_PERIODOS", "pendiente"],
      // docs/fuentes: en el Oeste se pide la Conservación de los últimos 5 años.
      ["CONSERVACION", "pendiente"],
      ["INFORME_TECNICO", "pendiente"],
    ]);
    expect(f.documentacion.concesionario.map((d) => [d.clave, d.estado])).toEqual([
      ["DNI", "presentado"],
      ["BOLETA_SERVICIO", "pendiente"],
      ["COMPROBANTE_PAGO", "pendiente"],
    ]);
    expect(f.documentacion.concesionario[0]).toMatchObject({ exigirAlSalirDe: { clave: "MESA", nombre: "Mesa de Entradas" }, adjuntos: [] });
    expect(f.personas.map((p) => [p.rol, p.etiquetaRol, p.esContacto, p.contacto.enmascarado])).toEqual([
      ["titular", "Titular de la concesión", false, false],
      ["solicitante", "Solicitante", true, false],
    ]);
    expect(f.personas[0].contacto).toMatchObject({ telefono: "0381 000-4567", email: "titular.ficticio@ejemplo.test", domicilio: "Calle Ficticia 999" });
    expect(f.conceptos.map((c) => c.clave)).toEqual(["DERECHO_OFICINA", "INSPECCION_TECNICA", "ARRENDAMIENTO"]);
    expect(f.conceptos[0].paso).toEqual({ clave: "LIQUIDACION", nombre: "Liquidación y boleta" });
    expect(f.datosExtra.find((d) => d.clave === "concesion_hasta")).toMatchObject({ valor: "2031-10-20", exigirAlSalirDe: { clave: "COMPUTO_FINAL" } });
    expect(f.ubicacion.map((u) => u.clave)).toEqual(["seccion", "lote", "numero"]);
    expect(f.historial).toHaveLength(1);
    expect(f.historial[0]).toMatchObject({
      tipo: "alta",
      secuencia: 1,
      precisionFecha: "minuto",
      diferido: false,
      usuario: { id: mesa.id, corto: "P. Mesa de Entradas" },
      pasoDestino: { clave: "MESA", nombre: "Mesa de Entradas" },
      areaDestino: { codigo: "MESA_ENTRADAS" },
      cargaHistorica: false,
      fuente: null,
    });
    expect(f.historial[0].personasCreadas.map((p) => p.rol)).toEqual(["titular", "solicitante"]);
    expect(f.acciones).toMatchObject({
      verDatosCompletos: { permitido: true, requiereMotivo: false },
      editarIdentificatorios: { permitido: true, requiereMotivo: false },
      imprimir: { permitido: true },
    });

    const [acceso] = await accesos(mesa.id, "ver_expediente");
    expect(acceso).toMatchObject({ detalle: { enmascarado: false }, ip: "10.0.0.7" });
  });

  it("enmascarado para un área que no trabaja el expediente, con el acceso registrado", async () => {
    const f = await exp.obtenerFicha(legal, alta.numero, { ip: "no-es-una-ip" });
    expect(f.datosCompletos).toBe(false);
    expect(f.personas[0].contacto).toEqual({
      telefono: "•••• •••-••67",
      telefonoWhatsapp: true,
      email: "t•••@e•••",
      domicilio: "•••",
      enmascarado: true,
    });
    // El nombre y el DNI sí se ven.
    expect(f.personas[1]).toMatchObject({ apellido: solicitanteApellido, dni: "96123456" });
    expect(f.acciones.verDatosCompletos).toEqual({ permitido: true, requiereMotivo: true });
    expect(f.acciones.editarIdentificatorios.permitido).toBe(false);
    for (const d of [...f.documentacion.direccion, ...f.documentacion.concesionario]) expect(d.adjuntos).toBeNull();
    const [acceso] = await accesos(legal.id, "ver_expediente");
    expect(acceso).toMatchObject({ detalle: { enmascarado: true }, ip: null });
  });

  it("Dirección lo ve completo (decisión 13)", async () => {
    expect((await exp.obtenerFicha(direccion, alta.numero)).datosCompletos).toBe(true);
  });

  it("un área por la que pasó el expediente lo ve completo", async () => {
    const otro = await exp.alta(mesa, await datosAlta(prisma), comando());
    expect((await exp.obtenerFicha(liquidacion, otro.numero)).datosCompletos).toBe(false);
    await simularPase(prisma, otro.numero, mesa, { clave: "LIQUIDACION", orden: 3, area: "LIQUIDACION" });
    const f = await exp.obtenerFicha(liquidacion, otro.numero);
    expect(f.datosCompletos).toBe(true);
    expect(f.situaciones).toEqual(["sin_confirmar"]);
    expect(f.recorrido.slice(0, 4).map((p) => p.situacion)).toEqual(["cumplido", "cumplido", "actual", "pendiente"]);
    expect(f.historial.map((m) => m.tipo)).toEqual(["alta", "pase"]);
  });

  it("número que no existe", async () => {
    await expect(exp.obtenerFicha(mesa, "CEM-1999-99999")).rejects.toMatchObject({ codigo: "no_encontrado" });
    await expect(exp.obtenerFicha(mesa, "cualquier cosa")).rejects.toBeInstanceOf(ErrorDominio);
  });

  it("acepta el número en forma corta", async () => {
    expect((await exp.obtenerFicha(mesa, alta.numeroCorto)).numero).toBe(alta.numero);
  });
});

describe("ver datos completos", () => {
  it("quien no trabaja el expediente necesita motivo, que queda en auditoria.accesos", async () => {
    await expect(exp.verDatosCompletos(legal, alta.numero, null)).rejects.toMatchObject({ codigo: "motivo_requerido" });
    await expect(exp.verDatosCompletos(legal, alta.numero, "corto")).rejects.toMatchObject({ codigo: "motivo_requerido" });
    const d = await exp.verDatosCompletos(legal, alta.numero, "Llamar por el dictamen pendiente");
    expect(d.personas.filter((p) => p.vigente).map((p) => [p.rol, p.telefono])).toEqual([
      ["titular", "0381 000-4567"],
      ["solicitante", "0381 000-7788"],
    ]);
    const registros = await accesos(legal.id, "ver_datos_completos");
    expect(registros.map((r) => r.detalle)).toEqual([{ motivo: "Llamar por el dictamen pendiente" }]);
  });

  it("quien lo trabaja no necesita motivo, pero igual queda registrado", async () => {
    await exp.verDatosCompletos(mesa, alta.numero, null);
    expect((await accesos(mesa.id, "ver_datos_completos")).map((r) => r.detalle)).toEqual([{ motivo: null }]);
  });
});

describe("historial y versiones", () => {
  it("una edición muestra la persona nueva enlazada a la que reemplaza", async () => {
    const a = await exp.alta(mesa, await datosAlta(prisma), comando());
    const form = await exp.formularioEdicion(mesa, a.numero);
    const [t] = form.valores.personas;
    await exp.editar(mesa, a.numero, { personas: [{ ...t, apellido: `${t.apellido} CORREGIDO` }] }, form.version, null, comando());
    const f = await exp.obtenerFicha(mesa, a.numero);
    expect(f.historial.map((m) => m.tipo)).toEqual(["alta", "edicion"]);
    const nueva = f.personas[0];
    expect(f.historial[1].personasCreadas).toEqual([{ id: nueva.id, rol: "titular", orden: 1, reemplazaA: t.id }]);
    expect(f.personasHistoricas).toMatchObject([{ id: t.id, vigente: false, reemplazadaPorId: nueva.id, apellido: t.apellido }]);
    expect(f.historial[1].datos).toEqual({ cambios: {}, personas: { baja: [], reemplazadas: [Number(t.id)] } });
  });

  it('carga histórica: con su fuente y la etiqueta; "hay v2" cuando se publica otra versión', async () => {
    const tipo = await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: "RENOVACION" } });
    const codigo = unico("PLV");
    const v1 = await conActorEn(prisma, SISTEMA, "Plantilla de prueba", async (tx) => {
      const p = await tx.plantilla.create({ data: { codigo, version: 1, tipoTramiteId: tipo.id, nombre: "Prueba versionada", definicion: RENOV_CONTADO, creadoPor: SISTEMA } });
      return tx.plantilla.update({ where: { id: p.id }, data: { estado: "publicada", publicadoEn: new Date(), publicadoPor: SISTEMA, notasCambio: "v1" } });
    });
    const a = await exp.alta(
      mesa,
      { ...(await datosAlta(prisma, { fechaInicio: "2018-05-02", cargaHistorica: true, fuente: "Libro de pases de Legal" })), plantillaId: v1.id },
      comando(),
    );
    await conActorEn(prisma, SISTEMA, "Plantilla de prueba", async (tx) => {
      const v2 = await tx.plantilla.create({ data: { codigo, version: 2, tipoTramiteId: tipo.id, nombre: "Prueba versionada", definicion: RENOV_CONTADO, creadoPor: SISTEMA } });
      await tx.plantilla.update({ where: { id: v1.id }, data: { estado: "retirada" } });
      await tx.plantilla.update({ where: { id: v2.id }, data: { estado: "publicada", publicadoEn: new Date(), publicadoPor: SISTEMA, notasCambio: "v2" } });
    });
    const f = await exp.obtenerFicha(mesa, a.numero);
    expect(f.plantilla).toMatchObject({ version: 1, versionPublicada: 2, hayVersionNueva: true, texto: "Prueba versionada · v1 (hay v2)" });
    expect(f.fechaInicio).toBe("2018-05-02");
    expect(f.situaciones).toContain("carga_historica");
    expect(f.historial[0]).toMatchObject({ cargaHistorica: true, fuente: "Libro de pases de Legal", precisionFecha: "dia", diferido: true });
  });
});

describe("carátula", () => {
  it("sin teléfono, correo ni domicilio; con el recorrido previsto; registra imprimir", async () => {
    const c = await exp.datosCaratula(legal, alta.numero);
    expect(c).toMatchObject({
      numero: alta.numero,
      numeroCorto: alta.numeroCorto,
      numeroMunicipal: "777/2026",
      rutaFicha: `/expedientes/${alta.numero}`,
      tramite: { tipo: "Renovación de concesión", plantilla: "Renovación, pago de contado", version: 1 },
      cementerio: "Cementerio del Oeste",
      tipoMonumento: "Sepultura o bóveda",
      solicitantes: [{ apellido: solicitanteApellido, dni: "96123456", vinculo: "hija", fallecido: false }],
    });
    expect(c.titulares).toHaveLength(1);
    expect(c.recorrido.map((p) => [p.clave, p.area])).toEqual([
      ["MESA", "Mesa de Entradas"],
      ["COMPUTO_ALTA", "Cómputo"],
      ["LIQUIDACION", "Liquidación"],
      ["LEGAL", "Asesoría Legal"],
      ["ADM_RESOLUCION", "Administrativo"],
      ["COMPUTO_FINAL", "Cómputo"],
      ["ADM_ENTREGA", "Administrativo"],
    ]);
    const texto = JSON.stringify(c);
    for (const dato of ["0381", "ejemplo.test", "Calle Ficticia"]) expect(texto).not.toContain(dato);
    expect((await accesos(legal.id, "imprimir")).map((r) => r.detalle)).toEqual([{ hoja: "caratula" }]);
  });

  it("el paso del cementerio se imprime con el cementerio del expediente", async () => {
    const a = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "NUEVA_CONC_CONTADO", cementerio: "JARDIN_NORTE", tipoMonumento: "SEPULTURA" }), comando());
    const c = await exp.datosCaratula(mesa, a.numero);
    expect(c.recorrido.find((p) => p.clave === "CEMENTERIO")).toMatchObject({ area: "Cementerio Jardín Norte", custodia: "Mesa de Entradas" });
  });
});
