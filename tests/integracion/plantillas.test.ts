// plantillas: una fila por versión, congelada al publicarse (propuesta 2.5 y 2.13(a)).

import pg from "pg";
import { describe, expect, it } from "vitest";
import { crearPlantilla, crearTipoTramite, errorDe, fila, json, type FilaPlantilla } from "./escenario";
import { SISTEMA, enTransaccion, fijarActor, intentar, unico } from "./helper";

const CONGELADA = /no se modifica: se crea una versión nueva/;
const PUBLICAR = "estado = 'publicada', publicado_en = now(), publicado_por = 1, notas_cambio = 'Publicación de prueba'";

type Estado = "borrador" | "publicada" | "retirada";

interface Contexto {
  tipoTramite: number;
  otroTipoTramite: number;
}

async function conCatalogo(fn: (c: pg.Client, x: Contexto) => Promise<void>): Promise<void> {
  await enTransaccion("app", async (c) => {
    await fijarActor(c, SISTEMA, "Prueba de plantillas");
    await fn(c, { tipoTramite: await crearTipoTramite(c), otroTipoTramite: await crearTipoTramite(c) });
  });
}

/** Una plantilla en el estado pedido, llegando a él por las transiciones permitidas. */
async function plantillaEn(c: pg.Client, x: Contexto, estado: Estado, columnas: Record<string, unknown> = {}): Promise<FilaPlantilla> {
  const p = await crearPlantilla(c, x.tipoTramite, { estado: "borrador", ...columnas });
  if (estado !== "borrador") await c.query(`UPDATE public.plantillas SET ${PUBLICAR} WHERE id = $1`, [p.id]);
  if (estado === "retirada") await c.query("UPDATE public.plantillas SET estado = 'retirada' WHERE id = $1", [p.id]);
  return fila<FilaPlantilla>(c, "SELECT * FROM public.plantillas WHERE id = $1", [p.id]);
}

describe("plantillas_congelar: una versión publicada o retirada no cambia", () => {
  const CAMPOS: Array<[string, (x: Contexto) => [string, unknown]]> = [
    ["definicion", () => ["definicion = $2::jsonb", json({ pasos: [], cambiada: true })]],
    ["nombre", () => ["nombre = $2", "Otro nombre"]],
    ["codigo", () => ["codigo = $2", unico("OTRO")]],
    ["version", () => ["version = $2", 9]],
    ["tipo_tramite_id", (x) => ["tipo_tramite_id = $2", x.otroTipoTramite]],
  ];

  for (const estado of ["publicada", "retirada"] as const) {
    it.each(CAMPOS)(`${estado}: rechaza el cambio de %s`, async (_campo, cambio) => {
      await conCatalogo(async (c, x) => {
        const p = await plantillaEn(c, x, estado);
        const [asignacion, valor] = cambio(x);
        const r = await intentar(c, `UPDATE public.plantillas SET ${asignacion} WHERE id = $1`, [p.id, valor]);
        expect(errorDe(r)).toMatch(CONGELADA);
      });
    });
  }

  it("un borrador sí se edita", async () => {
    await conCatalogo(async (c, x) => {
      const p = await plantillaEn(c, x, "borrador");
      const r = await intentar(c, "UPDATE public.plantillas SET definicion = $2::jsonb, nombre = 'Renombrada' WHERE id = $1", [p.id, json({ pasos: [], editada: true })]);
      expect(r).toMatchObject({ ok: true });
    });
  });
});

describe("plantillas_congelar: una versión nace borrador", () => {
  it.each(["publicada", "retirada"])("no se inserta una plantilla %s", async (estado) => {
    await conCatalogo(async (c, x) => {
      // Con las columnas de publicación completas, para que lo que decida sea
      // el trigger y no el CHECK de publicación.
      const r = await intentar(
        c,
        "INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, estado, definicion, notas_cambio, creado_por, publicado_por, publicado_en) VALUES ($1, 1, $2, 'Nace publicada', $3, '{}', 'Notas', 1, 1, now())",
        [unico("PL"), x.tipoTramite, estado],
      );
      expect(errorDe(r)).toMatch(/nace como borrador/);
    });
  });

  it("un borrador sí se inserta", async () => {
    await conCatalogo(async (c, x) => {
      const r = await intentar(c, "INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, definicion, creado_por) VALUES ($1, 1, $2, 'Borrador', '{}', 1) RETURNING estado", [unico("PL"), x.tipoTramite]);
      expect(r).toMatchObject({ ok: true, filas: [{ estado: "borrador" }] });
    });
  });
});

describe("plantillas_congelar: transiciones de estado", () => {
  const TRANSICIONES: Array<{ desde: Estado; hacia: Estado; resultado: "permitida" | "rechazada" }> = [
    { desde: "borrador", hacia: "publicada", resultado: "permitida" },
    { desde: "publicada", hacia: "retirada", resultado: "permitida" },
    { desde: "borrador", hacia: "retirada", resultado: "rechazada" },
    { desde: "publicada", hacia: "borrador", resultado: "rechazada" },
    { desde: "retirada", hacia: "publicada", resultado: "rechazada" },
    { desde: "retirada", hacia: "borrador", resultado: "rechazada" },
  ];

  it.each(TRANSICIONES)("$desde → $hacia: $resultado", async ({ desde, hacia, resultado }) => {
    await conCatalogo(async (c, x) => {
      const p = await plantillaEn(c, x, desde);
      // Las columnas de publicación van siempre, para que lo que decida sea el
      // trigger y no el CHECK de publicación.
      const r = await intentar(
        c,
        "UPDATE public.plantillas SET estado = $2, publicado_en = coalesce(publicado_en, now()), publicado_por = 1, notas_cambio = coalesce(notas_cambio, 'Notas de prueba') WHERE id = $1",
        [p.id, hacia],
      );
      if (resultado === "permitida") {
        expect(r).toMatchObject({ ok: true });
      } else {
        expect(errorDe(r)).toMatch(new RegExp(`Transición de plantilla no permitida: ${desde} → ${hacia}`));
      }
    });
  });

  it("publicar exige notas de cambio y fecha de publicación", async () => {
    await conCatalogo(async (c, x) => {
      const p = await plantillaEn(c, x, "borrador");
      for (const asignacion of [
        "estado = 'publicada', publicado_en = now()",
        "estado = 'publicada', notas_cambio = 'Notas'",
      ]) {
        const r = await intentar(c, `UPDATE public.plantillas SET ${asignacion} WHERE id = $1`, [p.id]);
        expect(errorDe(r), asignacion).toMatch(/plantillas_publicacion_check/);
      }
    });
  });

  it("publicar la v2 en una sola transacción: se retira la v1 y se publica el borrador (2.13(a))", async () => {
    await conCatalogo(async (c, x) => {
      const v1 = await plantillaEn(c, x, "publicada");
      const v2 = await plantillaEn(c, x, "borrador", { codigo: v1.codigo, version: 2 });
      await c.query("UPDATE public.plantillas SET estado = 'retirada' WHERE id = $1", [v1.id]);
      await c.query(`UPDATE public.plantillas SET ${PUBLICAR} WHERE id = $1`, [v2.id]);
      const estados = await c.query<{ version: number; estado: string }>("SELECT version, estado FROM public.plantillas WHERE codigo = $1 ORDER BY version", [v1.codigo]);
      expect(estados.rows).toEqual([
        { version: 1, estado: "retirada" },
        { version: 2, estado: "publicada" },
      ]);
    });
  });
});

describe("plantillas_congelar: solo se borran borradores", () => {
  const BORRADOS: Array<{ estado: Estado; resultado: "se borra" | "no se borra" }> = [
    { estado: "borrador", resultado: "se borra" },
    { estado: "publicada", resultado: "no se borra" },
    { estado: "retirada", resultado: "no se borra" },
  ];

  it.each(BORRADOS)("una plantilla $estado $resultado", async ({ estado, resultado }) => {
    await conCatalogo(async (c, x) => {
      const p = await plantillaEn(c, x, estado);
      const r = await intentar(c, "DELETE FROM public.plantillas WHERE id = $1", [p.id]);
      if (resultado === "se borra") {
        expect(r).toMatchObject({ ok: true });
      } else {
        expect(errorDe(r)).toMatch(/Solo se borran borradores/);
      }
    });
  });
});

describe("plantillas: índices únicos y reglas por código", () => {
  it("una sola versión publicada por código", async () => {
    await conCatalogo(async (c, x) => {
      const v1 = await plantillaEn(c, x, "publicada");
      // Publicar la v2 sin retirar la v1. (Insertarla ya publicada lo frena
      // antes plantillas_congelar: ver "una versión nace borrador".)
      const v2 = await plantillaEn(c, x, "borrador", { codigo: v1.codigo, version: 2 });
      const publicar = await intentar(c, `UPDATE public.plantillas SET ${PUBLICAR} WHERE id = $1`, [v2.id]);
      expect(errorDe(publicar)).toMatch(/plantillas_codigo_publicada_key/);
    });
  });

  it("un solo borrador por código", async () => {
    await conCatalogo(async (c, x) => {
      const v1 = await plantillaEn(c, x, "borrador");
      const r = await intentar(c, "INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, estado, definicion, creado_por) VALUES ($1, 2, $2, 'v2', 'borrador', '{}', 1)", [v1.codigo, x.tipoTramite]);
      expect(errorDe(r)).toMatch(/plantillas_codigo_borrador_key/);
    });
  });

  it("conviven varias retiradas, una publicada y un borrador del mismo código", async () => {
    await conCatalogo(async (c, x) => {
      const v1 = await plantillaEn(c, x, "retirada");
      await plantillaEn(c, x, "retirada", { codigo: v1.codigo, version: 2 });
      await plantillaEn(c, x, "publicada", { codigo: v1.codigo, version: 3 });
      await plantillaEn(c, x, "borrador", { codigo: v1.codigo, version: 4 });
      const n = await fila<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.plantillas WHERE codigo = $1", [v1.codigo]);
      expect(n.n).toBe(4);
    });
  });

  it("(codigo, version) es único", async () => {
    await conCatalogo(async (c, x) => {
      const v1 = await plantillaEn(c, x, "retirada");
      const r = await intentar(c, "INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, estado, definicion, creado_por) VALUES ($1, 1, $2, 'v1 otra vez', 'borrador', '{}', 1)", [v1.codigo, x.tipoTramite]);
      expect(errorDe(r)).toMatch(/plantillas_codigo_version_key/);
    });
  });

  it("todas las versiones de un código son del mismo tipo de trámite", async () => {
    await conCatalogo(async (c, x) => {
      const v1 = await plantillaEn(c, x, "publicada");
      const r = await intentar(c, "INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, estado, definicion, creado_por) VALUES ($1, 2, $2, 'v2', 'borrador', '{}', 1)", [v1.codigo, x.otroTipoTramite]);
      expect(errorDe(r)).toMatch(/mismo tipo de trámite/);
    });
  });

  it("codigo, version, estado y definicion tienen valores acotados", async () => {
    await conCatalogo(async (c, x) => {
      const casos: Array<[Record<string, unknown>, RegExp]> = [
        [{ codigo: "renov-contado" }, /plantillas_codigo_check/],
        [{ version: 0 }, /plantillas_version_check/],
        // Un estado inválido lo frena antes plantillas_congelar (los BEFORE
        // corren antes que los CHECKs); plantillas_estado_check queda de red.
        [{ estado: "vigente" }, /nace como borrador \(llegó vigente\)/],
        [{ definicion: "[]" }, /plantillas_definicion_check/],
      ];
      for (const [columnas, error] of casos) {
        await c.query("SAVEPOINT p");
        const r = await crearPlantilla(c, x.tipoTramite, { estado: "borrador", ...columnas }).then(
          () => "",
          (e: Error) => e.message,
        );
        await c.query("ROLLBACK TO SAVEPOINT p");
        expect(r, JSON.stringify(columnas)).toMatch(error);
      }
    });
  });
});
