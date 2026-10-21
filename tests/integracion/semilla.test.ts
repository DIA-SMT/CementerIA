// La semilla (prisma/semilla) contra la base efímera: corre con el rol de la
// app, como SISTEMA, y tiene que pasar todos los triggers y CHECKs.
//
// Este archivo CONFIRMA lo que siembra (no es una transacción que se revierte).
// Los tests de la base no dependen de la semilla y usan códigos únicos; los del
// dominio de expedientes (alta, edición, ficha, búsqueda) sí la necesitan y la
// corren antes (es idempotente). Como el orden de los archivos no está fijo,
// la "primera corrida" de acá puede ser la segunda: ver yaSembrada.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sembrar, type ResumenSemilla } from "../../prisma/semilla/sembrar";
import { AREAS } from "../../prisma/semilla/areas";
import { TIPOS_MONUMENTO, TIPOS_TRAMITE } from "../../prisma/semilla/catalogos";
import { CEMENTERIOS } from "../../prisma/semilla/cementerios";
import { ANIOS_FERIADOS, FERIADOS } from "../../prisma/semilla/feriados";
import { NOTAS_CARGA_INICIAL, PLANTILLAS } from "../../prisma/semilla/plantillas";
import { USUARIOS_FICTICIOS } from "../../prisma/semilla/usuarios";
import { cuilValido } from "@/lib/dominio/cuil";
import { validarPublicacion } from "@/lib/dominio/plantillas/validar";
import { SISTEMA, clientePrisma, conPg, enTransaccion, fijarActor, intentar, type Rol } from "./helper";

const ADMIN = "20000000001";
const CONGELADA = /no se modifica: se crea una versión nueva/;
const CODIGOS_PLANTILLAS = PLANTILLAS.map((p) => p.codigo);

const prisma = clientePrisma();
let primera: ResumenSemilla;
/** Otro archivo de la corrida ya sembró (los del dominio de expedientes lo hacen). */
let yaSembrada = false;

beforeAll(async () => {
  yaSembrada = (await prisma.area.count({ where: { codigo: { in: AREAS.map((a) => a.codigo) } } })) > 0;
  primera = await sembrar(prisma, { adminCuil: ADMIN });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function consultar<F extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<F[]> {
  return conPg("app", async (c) => (await c.query<F>(sql, params)).rows);
}

describe("semilla", () => {
  it("la primera corrida crea todo lo de la semilla", () => {
    // Si otro archivo sembró antes, esta corrida no crea nada; lo que hay en la
    // base lo verifican los tests de abajo.
    if (yaSembrada) {
      expect(primera.avisos).toEqual([]);
      expect(Object.values(primera.creados).every((n) => n === 0)).toBe(true);
      return;
    }
    expect(primera).toEqual({
      creados: {
        areas: AREAS.length,
        tiposMonumento: TIPOS_MONUMENTO.length,
        tiposTramite: TIPOS_TRAMITE.length,
        cementerios: CEMENTERIOS.length,
        feriados: FERIADOS.length,
        feriadosAnios: ANIOS_FERIADOS.length,
        usuarios: USUARIOS_FICTICIOS.length + 1,
        plantillas: 4,
      },
      avisos: [],
    });
  });

  it("áreas: 7 internas (Dirección no recibe pases) y 4 externas", async () => {
    const filas = await consultar<{ codigo: string; tipo: string; recibe_pases: boolean; activa: boolean }>(
      "SELECT codigo, tipo, recibe_pases, activa FROM public.areas WHERE codigo = ANY($1) ORDER BY orden",
      [AREAS.map((a) => a.codigo)],
    );
    expect(filas.map((f) => f.codigo)).toEqual(AREAS.map((a) => a.codigo));
    expect(filas.filter((f) => f.tipo === "interna")).toHaveLength(7);
    expect(filas.filter((f) => f.tipo === "externa").map((f) => f.codigo)).toEqual(["DIM", "CEM_OESTE", "CEM_NORTE", "CEM_JARDIN_NORTE"]);
    expect(filas.filter((f) => !f.recibe_pases).map((f) => f.codigo)).toEqual(["DIRECCION"]);
    expect(filas.every((f) => f.activa)).toBe(true);
  });

  it("tipos de monumento y de trámite", async () => {
    const monumentos = await consultar<{ codigo: string }>(
      "SELECT codigo FROM public.tipos_monumento WHERE codigo = ANY($1) AND activo",
      [TIPOS_MONUMENTO.map((t) => t.codigo)],
    );
    // Los 5 de los procedimientos (con el panteón, docs/fuentes) y NICHO y CINERARIO_COMUN de la propuesta.
    expect(monumentos).toHaveLength(7);
    const tramites = await consultar<{ codigo: string }>(
      "SELECT codigo FROM public.tipos_tramite WHERE codigo = ANY($1) AND activo ORDER BY id",
      [TIPOS_TRAMITE.map((t) => t.codigo)],
    );
    expect(tramites.map((t) => t.codigo)).toEqual(["RENOVACION", "RENOVACION_SPT", "NUEVA_CONCESION"]);
  });

  it("cementerios: en su área externa, con nomenclatura y tipos de monumento que existen", async () => {
    const filas = await consultar<{ codigo: string; area: string; tipo_area: string; campos: string[]; tipos: string[]; tipos_inexistentes: number }>(
      `SELECT c.codigo, a.codigo AS area, a.tipo AS tipo_area,
              (SELECT array_agg(e ->> 'clave' ORDER BY o) FROM jsonb_array_elements(c.campos_ubicacion) WITH ORDINALITY AS x(e, o)
                WHERE (e ->> 'activo')::boolean) AS campos,
              c.tipos_monumento AS tipos,
              (SELECT count(*)::int FROM unnest(c.tipos_monumento) AS t(codigo)
                WHERE NOT EXISTS (SELECT 1 FROM public.tipos_monumento m WHERE m.codigo = t.codigo)) AS tipos_inexistentes
         FROM public.cementerios c JOIN public.areas a ON a.id = c.area_id
        WHERE c.codigo = ANY($1) ORDER BY c.id`,
      [CEMENTERIOS.map((c) => c.codigo)],
    );
    expect(filas.map((f) => [f.codigo, f.area, f.tipo_area])).toEqual([
      ["OESTE", "CEM_OESTE", "externa"],
      ["NORTE", "CEM_NORTE", "externa"],
      ["JARDIN_NORTE", "CEM_JARDIN_NORTE", "externa"],
    ]);
    // docs/fuentes: el Oeste y Jardín sin cuadro (sección A a H y en romanos);
    // el Norte, la provisoria. Jardín habilita solo la sepultura.
    expect(filas.map((f) => [f.codigo, f.campos])).toEqual([
      ["OESTE", ["seccion", "lote", "numero"]],
      ["NORTE", ["seccion", "cuadro", "lote", "numero"]],
      ["JARDIN_NORTE", ["seccion", "lote", "numero"]],
    ]);
    expect(filas.map((f) => [f.codigo, f.tipos])).toEqual([
      ["OESTE", ["SEPULTURA", "SOTANITO", "CAPILLA", "MAUSOLEO", "PANTEON"]],
      ["NORTE", ["SEPULTURA", "SOTANITO", "CAPILLA", "MAUSOLEO", "PANTEON"]],
      ["JARDIN_NORTE", ["SEPULTURA"]],
    ]);
    for (const f of filas) expect(f.tipos_inexistentes).toBe(0);
  });

  it("feriados 2026 y 2027, con los años sin cerrar", async () => {
    const filas = await consultar<{ fecha: string; ambito: string; dia: number; norma: string | null }>(
      `SELECT fecha::text AS fecha, ambito, extract(isodow FROM fecha)::int AS dia, norma
         FROM public.feriados WHERE fecha = ANY($1::date[]) ORDER BY fecha`,
      [FERIADOS.map((f) => f.fecha)],
    );
    expect(filas.map((f) => f.fecha)).toEqual(FERIADOS.map((f) => f.fecha));
    // Los trasladados por la Ley 27.399 (art. 6) caen siempre lunes.
    const trasladados = filas.filter((f) => f.norma === "Ley 27.399, art. 6");
    expect(trasladados.map((f) => f.fecha)).toEqual(["2026-06-15", "2026-11-23", "2027-06-21", "2027-08-16", "2027-10-11"]);
    expect(trasladados.every((f) => f.dia === 1)).toBe(true);
    expect(filas.filter((f) => f.ambito !== "nacional").map((f) => `${f.fecha} ${f.ambito}`)).toEqual([
      "2026-09-24 provincial",
      "2026-09-29 municipal",
      "2027-09-24 provincial",
      "2027-09-29 municipal",
    ]);

    const anios = await consultar<{ anio: number; cerrado: boolean }>(
      "SELECT anio, cerrado FROM public.feriados_anios WHERE anio = ANY($1) ORDER BY anio",
      [[...ANIOS_FERIADOS]],
    );
    expect(anios).toEqual([
      { anio: 2026, cerrado: false },
      { anio: 2027, cerrado: false },
    ]);
  });

  it("los días hábiles saltean los feriados sembrados", async () => {
    const [r] = await consultar<{ suma: string; papa: string; entre: number }>(
      // Viernes 20/11/2026 es hábil (el feriado pasó al lunes 23): el 2.º día
      // hábil después del 19 es el martes 24. El lunes 09/11/2026 es feriado
      // (Decreto 1103/2026): el día hábil siguiente al viernes 6 es el martes
      // 10. Entre el 23/09 y el 30/09 de 2026 caen el 24 (provincial) y el 29
      // (municipal).
      `SELECT public.f_sumar_dias_habiles('2026-11-19', 2)::text AS suma,
              public.f_sumar_dias_habiles('2026-11-06', 1)::text AS papa,
              public.f_dias_habiles_entre('2026-09-23', '2026-09-30') AS entre`,
    );
    expect(r).toEqual({ suma: "2026-11-24", papa: "2026-11-10", entre: 3 });
  });

  it("usuarios: un operador por área interna, Dirección en lectura y el admin, con CUIL válidos", async () => {
    const filas = await consultar<{ cuil: string; area: string | null; tipo_area: string | null; rol: string; activo: boolean }>(
      `SELECT u.cuil, a.codigo AS area, a.tipo AS tipo_area, u.rol, u.activo
         FROM public.usuarios u LEFT JOIN public.areas a ON a.id = u.area_id
        WHERE u.cuil = ANY($1) ORDER BY u.id`,
      [[...USUARIOS_FICTICIOS.map((u) => u.cuil), ADMIN]],
    );
    expect(filas.map((f) => `${f.area ?? "-"} ${f.rol}`)).toEqual([
      "MESA_ENTRADAS operador",
      "COMPUTO operador",
      "LIQUIDACION operador",
      "LEGAL operador",
      "ADMINISTRATIVO operador",
      "TRIBUTARIO operador",
      "DIRECCION lectura",
      "- admin",
    ]);
    expect(filas.every((f) => f.activo && cuilValido(f.cuil))).toBe(true);
    expect(filas.some((f) => f.tipo_area === "externa")).toBe(false);
  });

  it("las 4 plantillas quedaron publicadas como v1, por SISTEMA, y pasan la validación de Publicar", async () => {
    const filas = await prisma.plantilla.findMany({
      where: { codigo: { in: CODIGOS_PLANTILLAS } },
      include: { tipoTramite: true },
      orderBy: { id: "asc" },
    });
    expect(
      filas.map((p) => ({
        codigo: p.codigo,
        version: p.version,
        estado: p.estado,
        tipo: p.tipoTramite.codigo,
        notas: p.notasCambio,
        creadoPor: p.creadoPor,
        publicadoPor: p.publicadoPor,
        publicada: p.publicadoEn !== null,
      })),
    ).toEqual(
      PLANTILLAS.map((p) => ({
        codigo: p.codigo,
        version: 1,
        estado: "publicada",
        tipo: p.tipoTramite,
        notas: NOTAS_CARGA_INICIAL,
        creadoPor: SISTEMA,
        publicadoPor: SISTEMA,
        publicada: true,
      })),
    );

    const catalogos = {
      areas: await prisma.area.findMany(),
      tiposMonumento: await prisma.tipoMonumento.findMany(),
      cementerios: await prisma.cementerio.findMany(),
    };
    for (const p of filas) {
      const r = validarPublicacion(p.definicion, catalogos);
      expect(r.ok ? [] : r.errores).toEqual([]);
      expect(p.definicion).toEqual(PLANTILLAS.find((x) => x.codigo === p.codigo)?.definicion);
    }
  });

  it("la auditoría registró el alta y la publicación de cada plantilla, firmadas por SISTEMA", async () => {
    const filas = await consultar<{ codigo: string; operaciones: string; usuarios: number[]; motivos: string[] }>(
      `SELECT p.codigo, string_agg(c.operacion, '' ORDER BY c.id) AS operaciones,
              array_agg(DISTINCT c.usuario_id) AS usuarios, array_agg(DISTINCT c.motivo) AS motivos
         FROM public.plantillas p
         JOIN auditoria.cambios c ON c.tabla = 'plantillas' AND c.registro_id = p.id::text
        WHERE p.codigo = ANY($1)
        GROUP BY p.codigo ORDER BY min(p.id)`,
      [CODIGOS_PLANTILLAS],
    );
    expect(filas).toEqual(
      CODIGOS_PLANTILLAS.map((codigo) => ({ codigo, operaciones: "IU", usuarios: [SISTEMA], motivos: ["Semilla (prisma/semilla)"] })),
    );
  });

  describe("plantillas_congelar sobre las plantillas sembradas", () => {
    it.each<Rol>(["app", "owner"])("rechaza un UPDATE de la definición (rol %s)", async (rol) => {
      await enTransaccion(rol, async (c) => {
        await fijarActor(c, SISTEMA, "Prueba de congelado");
        const r = await intentar(
          c,
          `UPDATE public.plantillas SET definicion = jsonb_set(definicion, '{forma_pago}', '"plan_pagos"')
            WHERE codigo = 'RENOV_CONTADO' AND version = 1`,
        );
        expect(r).toMatchObject({ ok: false });
        if (!r.ok) expect(r.error).toMatch(CONGELADA);
      });
    });

    it("rechaza borrar una plantilla publicada", async () => {
      await enTransaccion("app", async (c) => {
        await fijarActor(c, SISTEMA, "Prueba de congelado");
        const r = await intentar(c, "DELETE FROM public.plantillas WHERE codigo = 'RENOV_PLAN' AND version = 1");
        expect(r).toMatchObject({ ok: false });
        if (!r.ok) expect(r.error).toMatch(/Solo se borran borradores/);
      });
    });
  });

  describe("idempotencia", () => {
    it("una segunda corrida no crea nada ni deja filas en la auditoría", async () => {
      const contar = async () =>
        (await consultar<{ n: string }>("SELECT count(*) AS n FROM auditoria.cambios"))[0].n;
      const antes = await contar();
      const segunda = await sembrar(prisma, { adminCuil: ADMIN });
      expect(segunda).toEqual({
        creados: {
          areas: 0,
          tiposMonumento: 0,
          tiposTramite: 0,
          cementerios: 0,
          feriados: 0,
          feriadosAnios: 0,
          usuarios: 0,
          plantillas: 0,
        },
        avisos: [],
      });
      expect(await contar()).toBe(antes);
    });

    it("si el CUIL del admin ya es de otro usuario, avisa y no lo cambia", async () => {
      const operador = USUARIOS_FICTICIOS[0];
      const r = await sembrar(prisma, { adminCuil: operador.cuil, usuariosFicticios: false });
      expect(r.avisos).toEqual([expect.stringMatching(/ya existe como operador: no se cambia/)]);
      const [u] = await consultar<{ rol: string }>("SELECT rol FROM public.usuarios WHERE cuil = $1", [operador.cuil]);
      expect(u.rol).toBe("operador");
    });

    it("rechaza un ADMIN_INICIAL_CUIL mal formado antes de escribir", async () => {
      await expect(sembrar(prisma, { adminCuil: "20-00000000-1" })).rejects.toThrow(/11 dígitos/);
    });
  });
});
