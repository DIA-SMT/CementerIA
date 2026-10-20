// Alta de expedientes (src/lib/dominio/expedientes/alta.ts) contra la base real:
// docs/propuesta-mvp.md, 2.6, 2.7, 2.13(c), 2.13(d), 2.13(f) y 3.1.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RENOV_CONTADO } from "../../prisma/semilla/plantillas/renov-contado";
import { conActorEn } from "@/lib/db/actor";
import { crearServicioExpedientes, ErrorDominio } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { anioEnTucuman, hoyEnTucuman, inicioDelDiaEnTucuman, sumarDias } from "@/lib/fechas";
import { asegurarSemilla, comando, datosAlta, idArea, servicio, titular, unicoLetras, usuario, forzarEstado } from "./dominio";
import { SISTEMA, clientePrisma, unico } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let admin: UsuarioPermisos;
let computo: UsuarioPermisos;
let direccion: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, admin, computo, direccion] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "ADMIN"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "DIRECCION"),
  ]);
});

afterAll(async () => prisma.$disconnect());

async function codigoDeError(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof ErrorDominio) return e.codigo;
    if (e instanceof PermisoDenegado) return `permiso:${e.motivo}`;
    throw e;
  }
  throw new Error("Se esperaba un error");
}

describe("alta normal", () => {
  it("crea la proyección, el movimiento alta y después las personas, en el primer paso", async () => {
    const t = titular();
    const solicitante = { rol: "solicitante", apellido: unicoLetras("FICTICIA "), nombres: "Hija", vinculo: "hija", email: "hija@ejemplo.test", esContacto: true };
    const datos = await datosAlta(prisma, {
      personas: [t, solicitante],
      numeroMunicipal: "4321/2026",
      documentosRecibidos: ["DNI", "FORM_INICIO_RENOV"],
      datosExtra: { concesion_hasta: "2031-10-20" },
      ubicacion: { seccion: "07", cuadro: "zz", lote: "0099", numero: "" },
    });
    const antes = Date.now();
    const r = await exp.alta(mesa, datos, comando());
    expect(r).toMatchObject({ repetido: false, version: 0, avisos: [] });
    const anio = anioEnTucuman();
    expect(r.numero).toMatch(new RegExp(`^CEM-${anio}-\\d{5,6}$`));

    const e = await prisma.expediente.findUniqueOrThrow({
      where: { numeroInterno: r.numero },
      include: { movimientos: true, personas: { orderBy: { id: "asc" } }, plantilla: true },
    });
    const mesaArea = await idArea(prisma, "MESA_ENTRADAS");
    expect(e).toMatchObject({
      anio,
      numeroMunicipal: "4321/2026",
      numeroMunicipalNorm: "43212026",
      tipoMonumento: "SEPULTURA",
      ubicacion: { seccion: "7", cuadro: "ZZ", lote: "99" },
      ubicacionClave: "cuadro=ZZ;lote=99;seccion=7",
      ubicacionTexto: "Sección 7 · Cuadro ZZ · Lote 99",
      formaPago: "contado",
      estado: "en_tramite",
      pasoClave: "MESA",
      pasoOrden: 1,
      areaActualId: mesaArea,
      areaResponsableId: mesaArea,
      cargaHistorica: false,
      version: 0,
      creadoPor: mesa.id,
      datosExtra: { concesion_hasta: "2031-10-20" },
    });
    expect(e.plantilla.codigo).toBe("RENOV_CONTADO");
    expect(e.recibidoEn?.getTime()).toBe(e.enAreaDesde.getTime());
    // Hoy: la fecha efectiva es el momento del alta (precisión de minuto).
    expect(e.enAreaDesde.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(e.enAreaDesde.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    expect(e.movimientos).toHaveLength(1);
    const [alta] = e.movimientos;
    expect(alta).toMatchObject({
      tipo: "alta",
      secuencia: 1,
      usuarioId: mesa.id,
      areaUsuarioId: mesaArea,
      areaDestinoId: mesaArea,
      pasoDestino: "MESA",
      estadoNuevo: "en_tramite",
      precisionFecha: "minuto",
      cargaHistorica: false,
      fuente: null,
    });
    expect(alta.fechaEfectiva.getTime()).toBe(e.enAreaDesde.getTime());
    // Sin datos personales en el historial (2.8).
    expect(JSON.stringify(alta.datos)).not.toContain(t.apellido);
    expect(JSON.stringify(alta.datos)).not.toContain(t.dni ?? "x");

    expect(e.personas.map((p) => [p.rol, p.orden, p.vigente, p.esContacto, p.creadaMovId])).toEqual([
      ["titular", 1, true, false, alta.id],
      ["solicitante", 1, true, true, alta.id],
    ]);
    expect(e.personas[0]).toMatchObject({ apellido: t.apellido, dni: t.dni, telefono: "0381 000-1234", vinculo: null });

    expect(e.items).toEqual({
      subtareas: {},
      documentos: {
        DNI: { estado: "presentado", obs: null, mov: Number(alta.id), adjuntos: [] },
        FORM_INICIO_RENOV: { estado: "presentado", obs: null, mov: Number(alta.id), adjuntos: [] },
      },
      adjuntos: {},
    });
    expect(e.busqueda).toContain(r.numeroCorto.replace("/", " "));
    expect(e.busqueda).toContain(t.apellido.toLowerCase());
    expect(e.busqueda).toContain("43212026");
  });

  it("con fecha de inicio pasada: precisión de día, a las 00:00 de Tucumán", async () => {
    const fecha = sumarDias(hoyEnTucuman(), -10);
    const r = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: fecha }), comando());
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: r.numero }, include: { movimientos: true } });
    expect(e.enAreaDesde.toISOString()).toBe(inicioDelDiaEnTucuman(fecha).toISOString());
    expect(e.movimientos[0]).toMatchObject({ precisionFecha: "dia", fechaEfectiva: inicioDelDiaEnTucuman(fecha) });
    const [f] = await prisma.$queryRaw<Array<{ fecha_inicio: string }>>`SELECT fecha_inicio::text FROM expedientes WHERE id = ${e.id}`;
    expect(f.fecha_inicio).toBe(fecha);
  });

  it("el admin también da altas; Cómputo y Dirección no", async () => {
    await expect(exp.alta(admin, await datosAlta(prisma), comando())).resolves.toMatchObject({ repetido: false });
    expect(await codigoDeError(exp.alta(computo, await datosAlta(prisma), comando()))).toBe("permiso:area_no_habilitada");
    expect(await codigoDeError(exp.alta(direccion, await datosAlta(prisma), comando()))).toBe("permiso:solo_lectura");
  });

  it("un primer paso de otra área queda sin confirmar si lo da de alta el admin (Mesa recibe lo que crea)", async () => {
    const r = await exp.alta(admin, await datosAlta(prisma), comando());
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: r.numero } });
    expect(e.recibidoEn).toBeNull();
  });
});

describe("alta histórica (2.13(c))", () => {
  it("cualquier fecha desde 1950, con fuente; el número lleva el año de registro", async () => {
    const r = await exp.alta(
      mesa,
      await datosAlta(prisma, { fechaInicio: "2019-03-15", cargaHistorica: true, fuente: "Ficha papel" }),
      comando(),
    );
    expect(r.numero.startsWith(`CEM-${anioEnTucuman()}-`)).toBe(true);
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: r.numero }, include: { movimientos: true } });
    expect(e.cargaHistorica).toBe(true);
    expect(e.movimientos[0]).toMatchObject({ cargaHistorica: true, fuente: "Ficha papel", precisionFecha: "dia" });
    expect(e.movimientos[0].fechaEfectiva.toISOString()).toBe("2019-03-15T03:00:00.000Z");
  });

  it("sin fuente, o antes de 1950, no", async () => {
    expect(await codigoDeError(exp.alta(mesa, await datosAlta(prisma, { fechaInicio: "2019-03-15", cargaHistorica: true }), comando()))).toBe("validacion");
    expect(
      await codigoDeError(exp.alta(mesa, await datosAlta(prisma, { fechaInicio: "1949-12-31", cargaHistorica: true, fuente: "Ficha" }), comando())),
    ).toBe("validacion");
  });

  it("sin carga histórica no pasa de 30 días atrás", async () => {
    const vieja = sumarDias(hoyEnTucuman(), -31);
    expect(await codigoDeError(exp.alta(mesa, await datosAlta(prisma, { fechaInicio: vieja }), comando()))).toBe("validacion");
  });

  it("la carga histórica es de Mesa de Entradas y del admin", async () => {
    const datos = await datosAlta(prisma, { fechaInicio: "2019-03-15", cargaHistorica: true, fuente: "Ficha" });
    expect(await codigoDeError(exp.alta(computo, datos, comando()))).toBe("permiso:area_no_habilitada");
    await expect(exp.alta(admin, datos, comando())).resolves.toMatchObject({ repetido: false });
  });
});

describe("validaciones", () => {
  it("personas fuera de min/max y ubicación inválida, con el detalle por campo", async () => {
    let error: unknown;
    try {
      await exp.alta(mesa, await datosAlta(prisma, { personas: [], ubicacion: { seccion: "x", cuadro: "B" } }), comando());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorDominio);
    const e = error as ErrorDominio;
    expect(e.codigo).toBe("validacion");
    expect(e.errores).toEqual(
      expect.arrayContaining([
        { ruta: "personas", mensaje: "Titular de la concesión: tiene que haber 1 (hay 0)" },
        { ruta: "ubicacion.lote", mensaje: "Lote: es obligatorio" },
        { ruta: "ubicacion.seccion", mensaje: "Sección: tiene que ser un número entero" },
      ]),
    );
  });

  it("una plantilla en borrador o retirada no da altas", async () => {
    const tipo = await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: "RENOVACION" } });
    const codigo = unico("PL");
    const [borrador, retirada] = await conActorEn(prisma, SISTEMA, "Plantillas de prueba", async (tx) => {
      const crear = (c: string) =>
        tx.plantilla.create({ data: { codigo: c, version: 1, tipoTramiteId: tipo.id, nombre: "Prueba", definicion: RENOV_CONTADO, creadoPor: SISTEMA } });
      const b = await crear(codigo);
      const r = await crear(`${codigo}_R`);
      await tx.plantilla.update({ where: { id: r.id }, data: { estado: "publicada", publicadoEn: new Date(), publicadoPor: SISTEMA, notasCambio: "Prueba" } });
      await tx.plantilla.update({ where: { id: r.id }, data: { estado: "retirada" } });
      return [b, r];
    });
    for (const p of [borrador, retirada]) {
      expect(await codigoDeError(exp.alta(mesa, { ...(await datosAlta(prisma)), plantillaId: p.id }, comando()))).toBe("plantilla_no_publicada");
    }
  });

  it("un cementerio sin tipos de monumento: falta configurar el cementerio", async () => {
    const cementerioId = await conActorEn(prisma, SISTEMA, "Cementerio de prueba", async (tx) => {
      const area = await tx.area.create({ data: { codigo: unico("CEMX"), nombre: "Cementerio sin configurar", tipo: "externa" } });
      const c = await tx.cementerio.create({
        data: { codigo: unico("SINCONF"), nombre: "Cementerio sin configurar", areaId: area.id, camposUbicacion: [], tiposMonumento: [] },
      });
      return c.id;
    });
    expect(await codigoDeError(exp.alta(mesa, { ...(await datosAlta(prisma)), cementerioId }, comando()))).toBe("configuracion_incompleta");
    await expect(exp.contextoAlta(mesa, (await datosAlta(prisma)).plantillaId, cementerioId)).resolves.toMatchObject({
      problemas: [expect.stringMatching(/Falta configurar.*tipos de monumento/), expect.stringMatching(/Falta configurar.*campos de ubicación/)],
    });
  });

  it("comando_id tiene que ser un UUID", async () => {
    expect(await codigoDeError(exp.alta(mesa, await datosAlta(prisma), "no-es-uuid"))).toBe("validacion");
  });
});

describe("numeración (2.13(f))", () => {
  it("sin huecos: un alta que falla después de tomar el número lo devuelve", async () => {
    const a = await exp.alta(mesa, await datosAlta(prisma), comando());
    class Falla extends Error {}
    const fallido = crearServicioExpedientes({
      leer: prisma,
      escribir: (u, m, fn) =>
        conActorEn(prisma, u, m, async (tx) => {
          await fn(tx);
          throw new Falla("falla simulada después de numerar");
        }),
    });
    await expect(fallido.alta(mesa, await datosAlta(prisma), comando())).rejects.toBeInstanceOf(Falla);
    const b = await exp.alta(mesa, await datosAlta(prisma), comando());
    const sec = (n: string) => Number(n.split("-")[2]);
    expect(sec(b.numero)).toBe(sec(a.numero) + 1);
  });

  it("altas concurrentes: números distintos y consecutivos", async () => {
    const datos = await Promise.all(Array.from({ length: 8 }, () => datosAlta(prisma)));
    const resultados = await Promise.all(datos.map((d) => exp.alta(mesa, d, comando())));
    const secuencias = resultados.map((r) => Number(r.numero.split("-")[2])).sort((x, y) => x - y);
    expect(new Set(secuencias).size).toBe(8);
    expect(secuencias.at(-1)! - secuencias[0]).toBe(7);
  });
});

describe("idempotencia por comando_id", () => {
  it("el mismo comando devuelve el mismo expediente y no crea otro", async () => {
    const c = comando();
    const datos = await datosAlta(prisma);
    const primero = await exp.alta(mesa, datos, c);
    const segundo = await exp.alta(mesa, { ...datos, padron: "otro" }, c);
    expect(segundo).toEqual({ ...primero, repetido: true, avisos: [] });
    expect(await prisma.movimiento.count({ where: { comandoId: c } })).toBe(1);
  });

  it("dos envíos simultáneos del mismo comando (doble clic) crean uno solo", async () => {
    const c = randomUUID();
    const datos = await datosAlta(prisma);
    const [x, y] = await Promise.all([exp.alta(mesa, datos, c), exp.alta(mesa, datos, c)]);
    expect(x.numero).toBe(y.numero);
    expect([x.repetido, y.repetido].sort()).toEqual([false, true]);
    expect(await prisma.expediente.count({ where: { padron: datos.padron } })).toBe(1);
  });
});

describe("avisos de duplicados", () => {
  it("misma ubicación en el cementerio, mismo padrón o mismo N° municipal; los anulados no cuentan", async () => {
    const ubicacion = { seccion: "4", cuadro: unicoLetras("").slice(-3), lote: "12" };
    const padron = unicoLetras("PD-");
    const municipal = `${Date.now() % 100000}/2026`;
    const primero = await exp.alta(mesa, await datosAlta(prisma, { ubicacion, padron, numeroMunicipal: municipal }), comando());

    // El formulario consulta antes de guardar, con los valores sin normalizar.
    const cementerioId = (await datosAlta(prisma)).cementerioId;
    const avisos = await exp.avisosDuplicados(mesa, {
      cementerioId,
      ubicacion: { seccion: "04", cuadro: ubicacion.cuadro.toLowerCase(), lote: "012" },
      padron: padron.toLowerCase(),
      numeroMunicipal: municipal.replace("/", "-"),
    });
    expect(avisos).toEqual([
      {
        numero: primero.numero,
        estado: "en_tramite",
        coincidencias: ["ubicacion", "padron", "numero_municipal"],
        mensaje: `${primero.numero} (en trámite) tiene la misma ubicación, el mismo padrón y el mismo N° municipal`,
      },
    ]);

    // En otro cementerio, la misma ubicación no es el mismo espacio.
    const otro = await exp.alta(mesa, await datosAlta(prisma, { cementerio: "NORTE", ubicacion }), comando());
    expect(otro.avisos).toEqual([]);
    const segundo = await exp.alta(mesa, await datosAlta(prisma, { ubicacion }), comando());
    expect(segundo.avisos.map((a) => [a.numero, a.coincidencias])).toEqual([[primero.numero, ["ubicacion"]]]);

    await forzarEstado(prisma, primero.numero, "anulado");
    const tercero = await exp.alta(mesa, await datosAlta(prisma, { ubicacion }), comando());
    expect(tercero.avisos.map((a) => a.numero)).toEqual([segundo.numero]);
  });
});

describe("opciones del formulario", () => {
  it("lista las plantillas publicadas y los cementerios activos", async () => {
    const o = await exp.opcionesAlta();
    expect(o.plantillas.map((p) => p.codigo)).toEqual(expect.arrayContaining(["RENOV_CONTADO", "RENOV_PLAN", "RENOV_SPT_CONTADO", "NUEVA_CONC_CONTADO"]));
    expect(o.plantillas.find((p) => p.codigo === "RENOV_PLAN")).toMatchObject({ version: 1, formaPago: "plan_pagos", tipoTramite: { codigo: "RENOVACION" } });
    expect(o.cementerios.map((c) => c.codigo)).toEqual(expect.arrayContaining(["OESTE", "NORTE", "JARDIN_NORTE"]));
  });

  it("el contexto trae los campos activos y los monumentos admitidos", async () => {
    const d = await datosAlta(prisma, { plantilla: "NUEVA_CONC_CONTADO" });
    const c = await exp.contextoAlta(mesa, d.plantillaId, d.cementerioId);
    expect(c.problemas).toEqual([]);
    expect(c.camposUbicacion.map((x) => x.clave)).toEqual(["seccion", "cuadro", "lote", "numero"]);
    // NUEVA_CONC_CONTADO admite todos los del cementerio.
    expect(c.tiposMonumento.map((t) => t.codigo)).toEqual(["SOTANITO", "CAPILLA", "MAUSOLEO", "SEPULTURA", "NICHO", "CINERARIO_COMUN"]);
    expect(c.esquema.hoy).toBe(hoyEnTucuman());
    expect(await codigoDeError(exp.contextoAlta(computo, d.plantillaId, d.cementerioId))).toBe("permiso:area_no_habilitada");
  });
});
