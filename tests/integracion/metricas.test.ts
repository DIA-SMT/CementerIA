// Métricas de gestión (docs/api-dominio.md, sección 20) contra la base real:
// las consultas, f_dias_habiles_entre y f_sumar_dias_habiles con un feriado,
// las correcciones, la línea de base con una carga histórica y el CSV con su
// registro en auditoria.accesos.
//
// No depende de la semilla de escenarios (que usa fechas relativas a hoy):
// arma en una transacción que se deshace una plantilla con código único y
// expedientes de 1999 (y una carga histórica de 1998) con fechas conocidas, y
// mide con el reloj en el 30/04/1999 y el filtro de esa plantilla. Los días
// hábiles esperados están contados a mano; el 10/03/1999 se carga como
// feriado para ver que se saltea.

import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cliente, Transaccion } from "@/lib/db/crear-cliente";
import type { Escritor } from "@/lib/dominio/expedientes";
import { ErrorDominio } from "@/lib/dominio/expedientes";
import { crearServicioMetricas, type Metricas, type ServicioMetricas } from "@/lib/dominio/metricas";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { asegurarSemilla, idArea, unicoLetras, usuario } from "./dominio";
import { clientePrisma, SISTEMA } from "./helper";

const prisma = clientePrisma();
afterAll(async () => prisma.$disconnect());

class Deshacer extends Error {}

interface Contexto {
  tx: Transaccion;
  metricas: ServicioMetricas;
}

/** Corre `fn` en una transacción que se deshace al final (como conServiciosQueSeDeshacen de admin.ts). */
async function conTransaccionQueSeDeshace<T>(cliente: Cliente, ahora: Date, fn: (c: Contexto) => Promise<T>): Promise<T> {
  let resultado: { valor: T } | undefined;
  await cliente
    .$transaction(
      async (tx) => {
        let n = 0;
        const escribir: Escritor = async (usuarioId, motivo, f) => {
          n += 1;
          await tx.$executeRawUnsafe(`SAVEPOINT sp_metricas_${n}`);
          try {
            await tx.$executeRaw`SELECT set_config('app.usuario_id', ${String(usuarioId)}, true), set_config('app.motivo', ${motivo ?? ""}, true)`;
            const r = await f(tx);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT sp_metricas_${n}`);
            return r;
          } catch (e) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_metricas_${n}`);
            throw e;
          }
        };
        resultado = { valor: await fn({ tx, metricas: crearServicioMetricas({ leer: tx, escribir, ahora: () => ahora }) }) };
        throw new Deshacer();
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
    .catch((e: unknown) => {
      if (!(e instanceof Deshacer)) throw e;
    });
  if (!resultado) throw new Error("La transacción del test no llegó al final");
  return resultado.valor;
}

const comoActor = (tx: Transaccion, id: number) => tx.$executeRaw`SELECT set_config('app.usuario_id', ${String(id)}, true)`;

/** 10 h de Tucumán de ese día. */
const a = (fecha: string) => new Date(`${fecha}T10:00:00-03:00`);

let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let administrativo: UsuarioPermisos;
let tributario: UsuarioPermisos;
let direccion: UsuarioPermisos;
let area: Record<"MESA" | "COMPUTO" | "ADM" | "DIM", number>;
let cementerio: number;
let tipoTramite: number;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, administrativo, tributario, direccion] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "ADMINISTRATIVO"),
    usuario(prisma, "TRIBUTARIO"),
    usuario(prisma, "DIRECCION"),
  ]);
  area = {
    MESA: await idArea(prisma, "MESA_ENTRADAS"),
    COMPUTO: await idArea(prisma, "COMPUTO"),
    ADM: await idArea(prisma, "ADMINISTRATIVO"),
    DIM: await idArea(prisma, "DIM"),
  };
  cementerio = (await prisma.cementerio.findFirstOrThrow({ select: { id: true } })).id;
  tipoTramite = (await prisma.tipoTramite.findUniqueOrThrow({ where: { codigo: "RENOVACION" }, select: { id: true } })).id;
});

const DEFINICION = {
  pasos: [
    { clave: "MESA", nombre: "Mesa de Entradas", area: "MESA_ENTRADAS", dias_alerta: 2, plazo: null },
    { clave: "COMPUTO", nombre: "Cómputo", area: "COMPUTO", dias_alerta: 5, plazo: null },
    {
      clave: "DIM",
      nombre: "Pago en la DIM",
      area: "DIM",
      custodia: "TRIBUTARIO",
      dias_alerta: 60,
      plazo: { dias_habiles: 30, desde_subtarea: "TRIB_NOTIFICADA", hasta_subtarea: "DIM_PLAN_INICIADO" },
    },
    { clave: "ADM", nombre: "Título", area: "ADMINISTRATIVO", dias_alerta: 15, plazo: null },
  ],
};

interface Armado {
  codigo: string;
  numeros: Record<"A" | "B" | "C" | "H", string>;
}

/**
 * - A (sistema): Mesa 1/3 → Cómputo 3/3 (recepción el 4/3) → Título 9/3 → concluido 12/3.
 * - B (sistema): Mesa 15/3 → Cómputo 17/3 → devuelto a Mesa 19/3 ("Error en boleta") →
 *   Cómputo 22/3; un pase a Título el 23/3, revertido. Sigue en Cómputo sin confirmar.
 * - C (sistema): Mesa 1/3 (notificado el 2/3) → DIM 2/3 → plan iniciado el 20/4 → Título 21/4.
 * - H (carga histórica terminada, 1998): Mesa 1/6 → Cómputo 8/6 → Título 22/6 → concluido 26/6.
 */
async function armar(tx: Transaccion): Promise<Armado> {
  await comoActor(tx, SISTEMA);
  await tx.$executeRaw`INSERT INTO public.feriados (fecha, descripcion, ambito) VALUES ('1999-03-10', 'Feriado de prueba de las métricas', 'municipal')`;
  const codigo = `METRICAS_${unicoLetras()}`.slice(0, 60);
  const [plantilla] = await tx.$queryRaw<Array<{ id: number }>>`
    INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, estado, definicion, creado_por)
    VALUES (${codigo}, 1, ${tipoTramite}, 'Plantilla de prueba de métricas', 'borrador', ${JSON.stringify(DEFINICION)}::jsonb, ${SISTEMA})
    RETURNING id`;
  await tx.$executeRaw`UPDATE public.plantillas SET estado = 'publicada', publicado_por = ${SISTEMA}, publicado_en = now(), notas_cambio = 'Prueba de integración' WHERE id = ${plantilla.id}`;

  const expediente = async (fechaInicio: string, proyeccion: { estado: string; paso: string; orden: number; area: number; desde: Date }, cargaHistorica = false) => {
    await comoActor(tx, SISTEMA);
    const anio = Number(fechaInicio.slice(0, 4));
    const secuencia = randomInt(100_000, 2_000_000_000);
    const numero = `CEM-${anio}-${secuencia}`;
    const [fila] = await tx.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO public.expedientes (anio, secuencia, numero_interno, fecha_inicio, tipo_tramite_id, plantilla_id, cementerio_id, tipo_monumento,
                                      estado, paso_clave, paso_orden, area_actual_id, area_responsable_id, en_area_desde, carga_historica, creado_por)
      VALUES (${anio}, ${secuencia}, ${numero}, ${fechaInicio}::date, ${tipoTramite}, ${plantilla.id}, ${cementerio}, 'SEPULTURA',
              ${proyeccion.estado}, ${proyeccion.paso}, ${proyeccion.orden}, ${proyeccion.area}, ${proyeccion.area}, ${proyeccion.desde}, ${cargaHistorica}, ${SISTEMA})
      RETURNING id`;
    return { id: fila.id, numero };
  };
  const mov = async (
    exp: { id: bigint },
    quien: UsuarioPermisos,
    tipo: string,
    fecha: Date,
    m: { paso?: string; area?: number; estado?: string; motivo?: string; datos?: object; corrige?: bigint; historica?: boolean } = {},
  ): Promise<bigint> => {
    await comoActor(tx, quien.id);
    const [fila] = await tx.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, usuario_id, paso_destino, area_destino_id, estado_nuevo, motivo, datos,
                                      corrige_movimiento_id, carga_historica, fuente, comando_id)
      VALUES (${exp.id}, ${tipo}, ${fecha}, ${quien.id}, ${m.paso ?? null}, ${m.area ?? null}, ${m.estado ?? null}, ${m.motivo ?? null},
              ${JSON.stringify(m.datos ?? {})}::jsonb, ${m.corrige ?? null}, ${m.historica ?? false},
              ${m.historica ? "Ficha de papel" : null}, ${randomUUID()}::uuid)
      RETURNING id`;
    return fila.id;
  };
  const pase = (exp: { id: bigint }, quien: UsuarioPermisos, fecha: string, paso: "MESA" | "COMPUTO" | "DIM" | "ADM", historica = false) =>
    mov(exp, quien, "pase", a(fecha), { paso, area: area[paso], historica, datos: { pasos_omitidos: [], pasos_salteados: [] } });

  const A = await expediente("1999-03-01", { estado: "concluido", paso: "ADM", orden: 4, area: area.ADM, desde: a("1999-03-09") });
  await mov(A, mesa, "alta", a("1999-03-01"), { paso: "MESA", area: area.MESA, estado: "en_tramite" });
  await pase(A, mesa, "1999-03-03", "COMPUTO");
  await mov(A, computo, "recepcion", a("1999-03-04"), { paso: "COMPUTO", area: area.COMPUTO, datos: { implicita: false } });
  await pase(A, computo, "1999-03-09", "ADM");
  await mov(A, administrativo, "estado", a("1999-03-12"), { estado: "concluido" });

  const B = await expediente("1999-03-15", { estado: "en_tramite", paso: "COMPUTO", orden: 2, area: area.COMPUTO, desde: a("1999-03-22") });
  await mov(B, mesa, "alta", a("1999-03-15"), { paso: "MESA", area: area.MESA, estado: "en_tramite" });
  await pase(B, mesa, "1999-03-17", "COMPUTO");
  await mov(B, computo, "devolucion", a("1999-03-19"), {
    paso: "MESA",
    area: area.MESA,
    motivo: "Error en boleta: el importe no coincide",
    datos: { subtareas_reiniciadas: [] },
  });
  await pase(B, mesa, "1999-03-22", "COMPUTO");
  const porError = await pase(B, computo, "1999-03-23", "ADM");
  await mov(B, computo, "correccion", a("1999-03-23"), { corrige: porError, motivo: "Pase dado por error en el expediente", datos: { revertir: true, arrastra: [] } });

  const C = await expediente("1999-03-01", { estado: "en_tramite", paso: "ADM", orden: 4, area: area.ADM, desde: a("1999-04-21") });
  await mov(C, mesa, "alta", a("1999-03-01"), { paso: "MESA", area: area.MESA, estado: "en_tramite" });
  await mov(C, mesa, "subtarea", a("1999-03-02"), { datos: { subtarea: "TRIB_NOTIFICADA", hecha: true, dato: "1999-03-02", paso: "MESA" } });
  await pase(C, mesa, "1999-03-02", "DIM");
  await mov(C, tributario, "subtarea", a("1999-04-20"), { datos: { subtarea: "DIM_PLAN_INICIADO", hecha: true, dato: "1999-04-20", paso: "DIM" } });
  await pase(C, tributario, "1999-04-21", "ADM");

  const H = await expediente("1998-06-01", { estado: "concluido", paso: "ADM", orden: 4, area: area.ADM, desde: a("1998-06-22") });
  await mov(H, mesa, "alta", a("1998-06-01"), { paso: "MESA", area: area.MESA, estado: "en_tramite", historica: true });
  await pase(H, mesa, "1998-06-08", "COMPUTO", true);
  await pase(H, mesa, "1998-06-22", "ADM", true);
  await mov(H, mesa, "estado", a("1998-06-26"), { estado: "concluido", historica: true });

  return { codigo, numeros: { A: A.numero, B: B.numero, C: C.numero, H: H.numero } };
}

const AHORA = new Date("1999-04-30T15:00:00-03:00");
const PERIODO = { desde: "1999-03-01", hasta: "1999-04-30" };

describe("métricas de gestión contra la base", () => {
  it("tiempos, flujo, devoluciones, carga, plazo DIM, línea de base y papel con fechas conocidas", async () => {
    const m: Metricas = await conTransaccionQueSeDeshace(prisma, AHORA, async ({ tx, metricas }) => {
      const { codigo } = await armar(tx);
      return metricas.metricas(direccion, { ...PERIODO, plantillaCodigo: codigo });
    });

    // Punta a punta de A: (1/3, 12/3] son 9 días de lunes a viernes menos el feriado del 10/3.
    expect(m.puntaAPunta.total.conSistema).toMatchObject({ n: 1, mediana: 8, p90: 8 });
    // H, de la ficha: (1/6/1998, 26/6/1998] = 19.
    expect(m.puntaAPunta.total.antes).toMatchObject({ n: 1, mediana: 19 });

    const paso = (clave: string) => m.pasos.find((p) => p.pasoClave === clave);
    // Mesa: A 2, B 2 y 1 (después de la devolución), C 1.
    expect(paso("MESA")?.tiempos).toMatchObject({ n: 4, mediana: 1.5, total: 6 });
    // Cómputo: A (3/3, 9/3] = 4 sin el feriado; B 2 (la devolución). El pase revertido no cuenta: B sigue ahí.
    expect(paso("COMPUTO")).toMatchObject({ tiempos: { n: 2, mediana: 3, total: 6 }, devoluciones: 1, tasaDevolucion: 0.5, hoy: 1 });
    // DIM: (2/3, 21/4] = 35 sin el feriado. Es el cuello de botella.
    expect(paso("DIM")).toMatchObject({ tiempos: { n: 1, mediana: 35 }, area: { externa: true } });
    expect(m.resumen.cuelloMediana?.pasoClave).toBe("DIM");
    expect(paso("ADM")).toMatchObject({ tiempos: { n: 1, mediana: 2 }, hoy: 1 });

    expect(m.recepcion.find((r) => r.area.id === area.COMPUTO)).toMatchObject({ confirmadas: { n: 1, mediana: 1 }, sinConfirmarHoy: 1 });

    expect(m.flujo.map((f) => [f.periodo.clave, f.ingresados, f.concluidos, f.stockFinal])).toEqual([
      ["1999-03", 3, 1, 2],
      ["1999-04", 0, 0, 2],
    ]);
    expect(m.flujo[0].busquedaIngresados).toMatchObject({ fechaInicioDesde: "1999-03-01", fechaInicioHasta: "1999-03-31", plantillaCodigo: expect.any(String) });

    expect(m.resumen).toMatchObject({ ingresados: 3, concluidos: 1, enTramiteHoy: 2, demoradosHoy: 1, devoluciones: 1, salidas: 8, tasaDevolucion: 0.125 });
    expect(m.devoluciones.motivos.find((x) => x.motivo === "Error en boleta")?.cantidad).toBe(1);
    expect(m.devoluciones.rutas).toEqual([
      expect.objectContaining({ origen: expect.objectContaining({ area: expect.objectContaining({ id: area.COMPUTO }) }), destino: expect.objectContaining({ paso: "Mesa de Entradas" }), cantidad: 1 }),
    ]);

    // Carga: B en Cómputo (demorado: desde el 22/3) y C en Administrativo (desde el 21/4, alerta 15).
    expect(m.carga.find((c) => c.area.id === area.COMPUTO)).toMatchObject({ hoy: 1, demoradosHoy: 1, busquedaHoy: { areaActualId: area.COMPUTO } });
    expect(m.carga.find((c) => c.area.id === area.ADM)).toMatchObject({ hoy: 1, demoradosHoy: 0 });

    // Plazo DIM de C: notificado el 2/3, vence el 14/4 (30 días hábiles sin el feriado); plan iniciado el 20/4: vencido.
    expect(m.dim).toMatchObject({ total: 1, enTermino: 0, cumplidoVencido: 1, demora: { n: 1, mediana: 35 } });

    // Línea de base: los pasos de H, de la ficha.
    expect(m.lineaBase.pasos.map((p) => [p.paso, p.antes.mediana, p.conSistema.mediana])).toEqual([
      ["Mesa de Entradas", 5, 1.5],
      ["Cómputo", 10, 3],
      ["Título", 4, 2],
    ]);
    expect(m.lineaBase).toMatchObject({ expedientes: 1, muestraChica: true });

    expect(m.papel).toMatchObject({ fichasReemplazadas: 3, acumuladoSistema: 3, cargasHistoricas: 1, hojasEstimadas: 3 });
  });

  it("el vencimiento del plazo usa f_sumar_dias_habiles de la base (con el feriado)", async () => {
    const vence = await prisma.$queryRaw<Array<{ v: string }>>`SELECT public.f_sumar_dias_habiles('1999-03-02'::date, 30)::text AS v`;
    // Sin el feriado de prueba (la transacción del test anterior se deshizo): el 13/4.
    expect(vence[0].v).toBe("1999-04-13");
  });

  it("exportar una tabla: CSV para Excel y `exportar` en auditoria.accesos", async () => {
    const r = await conTransaccionQueSeDeshace(prisma, AHORA, async ({ tx, metricas }) => {
      const { codigo } = await armar(tx);
      const csv = await metricas.exportarCsv(direccion, { ...PERIODO, plantillaCodigo: codigo }, "pasos", { ip: "10.1.2.3" });
      const acceso = await tx.auditoriaAcceso.findFirstOrThrow({ where: { usuarioId: direccion.id, accion: "exportar" }, orderBy: { id: "desc" } });
      return { csv, acceso, codigo };
    });
    expect(r.csv.nombreArchivo).toBe("metricas-pasos-1999-04-30.csv");
    expect(r.csv.contenido.startsWith("﻿Paso;Área;Área externa;n;Mediana;")).toBe(true);
    expect(r.csv.contenido).toContain("\r\nCómputo;Cómputo;No;2;3;3;4;4;6;5;0;1;50;1;");
    expect(r.csv.filas).toBe(4);
    expect(r.acceso.expedienteId).toBeNull();
    expect(r.acceso.ip).toBe("10.1.2.3");
    expect(r.acceso.detalle).toMatchObject({ formato: "csv", origen: "metricas", tabla: "pasos", filas: 4, filtros: { plantillaCodigo: r.codigo, desde: "1999-03-01" } });
  });

  it("permisos y período inválido", async () => {
    const error = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        return e;
      }
      return null;
    };
    const servicio = crearServicioMetricas({ leer: prisma, escribir: () => Promise.reject(new Error("no escribe")), ahora: () => AHORA });
    expect(await error(servicio.metricas(computo, PERIODO))).toBeInstanceOf(PermisoDenegado);
    expect(await error(servicio.exportarCsv(mesa, PERIODO, "flujo"))).toBeInstanceOf(PermisoDenegado);
    const invalido = await error(servicio.metricas(direccion, { desde: "1999-04-30", hasta: "1999-03-01" }));
    expect(invalido).toBeInstanceOf(ErrorDominio);
    expect((invalido as ErrorDominio).codigo).toBe("validacion");
  });

  it("sin datos en el período: todo en cero, sin errores", async () => {
    const m = await conTransaccionQueSeDeshace(prisma, AHORA, async ({ tx, metricas }) => {
      const { codigo } = await armar(tx);
      return metricas.metricas(direccion, { desde: "1999-04-26", hasta: "1999-04-30", plantillaCodigo: codigo, agrupar: "semana", historicos: "incluir" });
    });
    expect(m.flujo).toHaveLength(1);
    expect(m.puntaAPunta.total.conSistema.n).toBe(0);
    expect(m.resumen.cuelloMediana).toBeNull();
    // Lo de hoy sí: B y C siguen en trámite. Con la carga histórica incluida, H tampoco cambia nada (es de 1998).
    expect(m.resumen.enTramiteHoy).toBe(2);
    expect(m.puntaAPunta.total.antes.n).toBe(1);
  });
});
