// expedientes: columnas derivadas, control de fecha_inicio y CHECKs (propuesta 2.6, 2.11 y 2.13(d)).

import pg from "pg";
import { describe, expect, it } from "vitest";
import { HOY_TUCUMAN, crearEscenario, crearExpediente, fila, json, sql, type Columnas, type Escenario, type FilaExpediente } from "./escenario";
import { SISTEMA, enTransaccion, fijarActor } from "./helper";

async function conEscenario(fn: (c: pg.Client, e: Escenario) => Promise<void>): Promise<void> {
  await enTransaccion("app", async (c) => {
    await fijarActor(c, SISTEMA, "Prueba de expedientes");
    await fn(c, await crearEscenario(c));
  });
}

async function leer(c: pg.Client, id: string): Promise<FilaExpediente> {
  return fila<FilaExpediente>(c, "SELECT * FROM public.expedientes WHERE id = $1", [id]);
}

/** Intenta el alta dentro de un savepoint y devuelve el error, o "" si entró. */
async function errorDelAlta(c: pg.Client, e: Escenario, columnas: Columnas): Promise<string> {
  await c.query("SAVEPOINT alta");
  try {
    await crearExpediente(c, e, columnas);
    await c.query("RELEASE SAVEPOINT alta");
    return "";
  } catch (error) {
    await c.query("ROLLBACK TO SAVEPOINT alta");
    return (error as Error).message;
  }
}

async function errorDelUpdate(c: pg.Client, id: string, asignacion: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT cambio");
  try {
    await c.query(`UPDATE public.expedientes SET ${asignacion} WHERE id = $1`, [id, ...params]);
    await c.query("RELEASE SAVEPOINT cambio");
    return "";
  } catch (error) {
    await c.query("ROLLBACK TO SAVEPOINT cambio");
    return (error as Error).message;
  }
}

describe("expedientes_preparar: números normalizados", () => {
  const NUMEROS: Array<[string | null, string | null]> = [
    ["12.345/2026", "123452026"],
    ["12345-2026", "123452026"],
    ["ab-12 c", "AB12C"],
    ["  0001-a  ", "0001A"],
    ["Ñ-5/á", "N5A"],
    ["---", null],
    ["", null],
    [null, null],
  ];

  it.each(NUMEROS)("numero_municipal %j → %j", async (numero, esperado) => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e, { numero_municipal: numero });
      expect(exp.numero_municipal_norm).toBe(esperado);
    });
  });

  it.each(NUMEROS)("padron %j → %j", async (padron, esperado) => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e, { padron });
      expect(exp.padron_norm).toBe(esperado);
    });
  });

  it("los recalcula en cada UPDATE, aunque la app mande otro valor", async () => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e, { numero_municipal: "1/2026", padron: "P-1" });
      await c.query(
        "UPDATE public.expedientes SET numero_municipal = '77.001/2026', numero_municipal_norm = 'FALSO', padron_norm = 'FALSO' WHERE id = $1",
        [exp.id],
      );
      expect(await leer(c, exp.id)).toMatchObject({ numero_municipal_norm: "770012026", padron_norm: "P1" });
    });
  });

  it("pisa actualizado_en con now()", async () => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e, { actualizado_en: "2001-01-01T00:00:00Z" });
      await c.query("UPDATE public.expedientes SET observaciones = 'x', actualizado_en = '2001-01-01' WHERE id = $1", [exp.id]);
      const r = await fila<{ es_now: boolean }>(c, "SELECT actualizado_en = now() AS es_now FROM public.expedientes WHERE id = $1", [exp.id]);
      expect(r.es_now).toBe(true);
    });
  });
});

describe("expedientes_preparar: ubicacion_clave", () => {
  const UBICACIONES: Array<[string, Record<string, unknown>, string | null]> = [
    ["ordena por clave", { seccion: "3", cuadro: "B", lote: "12", numero: "45" }, "cuadro=B;lote=12;numero=45;seccion=3"],
    ["omite los valores vacíos", { seccion: "3", cuadro: "", lote: "   ", fila: null }, "seccion=3"],
    ["recorta los espacios", { cuadro: "  B ", lote: "12" }, "cuadro=B;lote=12"],
    ["acepta números", { lote: 12, numero: 45 }, "lote=12;numero=45"],
    ["NULL si no hay valores", { seccion: "", cuadro: null }, null],
    ["NULL si la ubicación está vacía", {}, null],
  ];

  it.each(UBICACIONES)("%s", async (_caso, ubicacion, esperada) => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e, { ubicacion: json(ubicacion) });
      expect(exp.ubicacion_clave).toBe(esperada);
    });
  });

  it("solo se recalcula cuando cambia la ubicación", async () => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e, { ubicacion: json({ seccion: "3", lote: "12" }) });
      expect(exp.ubicacion_clave).toBe("lote=12;seccion=3");

      // Otro cambio, o la misma ubicación escrita en otro orden, no la tocan.
      await c.query("UPDATE public.expedientes SET observaciones = 'Otro cambio' WHERE id = $1", [exp.id]);
      await c.query("UPDATE public.expedientes SET ubicacion = $2::jsonb WHERE id = $1", [exp.id, json({ lote: "12", seccion: "3" })]);
      expect((await leer(c, exp.id)).ubicacion_clave).toBe("lote=12;seccion=3");

      await c.query("UPDATE public.expedientes SET ubicacion = $2::jsonb WHERE id = $1", [exp.id, json({ seccion: "3", lote: "13" })]);
      expect((await leer(c, exp.id)).ubicacion_clave).toBe("lote=13;seccion=3");

      await c.query("UPDATE public.expedientes SET ubicacion = '{}' WHERE id = $1", [exp.id]);
      expect((await leer(c, exp.id)).ubicacion_clave).toBeNull();
    });
  });
});

describe("expedientes_preparar: ubicacion_clave la arma solo el trigger", () => {
  it("escribirla a mano no tiene efecto", async () => {
    await conEscenario(async (c, e) => {
      const alta = await crearExpediente(c, e, { ubicacion: json({ seccion: "3", lote: "12" }), ubicacion_clave: "lote=99" });
      expect(alta.ubicacion_clave).toBe("lote=12;seccion=3");

      await c.query("UPDATE public.expedientes SET ubicacion_clave = 'lote=99' WHERE id = $1", [alta.id]);
      expect((await leer(c, alta.id)).ubicacion_clave).toBe("lote=12;seccion=3");
      await c.query("UPDATE public.expedientes SET ubicacion_clave = NULL WHERE id = $1", [alta.id]);
      expect((await leer(c, alta.id)).ubicacion_clave).toBe("lote=12;seccion=3");

      // Junto con un cambio de ubicación, gana la que arma el trigger.
      await c.query("UPDATE public.expedientes SET ubicacion = $2::jsonb, ubicacion_clave = 'lote=99' WHERE id = $1", [alta.id, json({ seccion: "4", lote: "1" })]);
      expect((await leer(c, alta.id)).ubicacion_clave).toBe("lote=1;seccion=4");
    });
  });
});

describe("expedientes_preparar: exige el actor", () => {
  it("sin conActor() no se inserta ni se modifica la proyección", async () => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e);
      await c.query("SELECT set_config('app.usuario_id', '', true)");
      expect(await errorDelAlta(c, e, {})).toMatch(/Falta el actor/);
      expect(await errorDelUpdate(c, exp.id, "estado = 'concluido', version = version + 1")).toMatch(/Falta el actor/);
    });
  });
});

describe("expedientes_preparar: fecha_inicio", () => {
  const MANANA_TUCUMAN = sql("(now() AT TIME ZONE 'America/Argentina/Tucuman')::date + 1");

  it("admite hoy (Tucumán) y fechas pasadas desde 1950", async () => {
    await conEscenario(async (c, e) => {
      const fechas: Array<[string, unknown]> = [
        ["hoy", HOY_TUCUMAN],
        ["hace 30 días", sql("(now() AT TIME ZONE 'America/Argentina/Tucuman')::date - 30")],
        ["2019-03-15", "2019-03-15"],
        ["1950-01-01", "1950-01-01"],
      ];
      for (const [etiqueta, fecha] of fechas) {
        expect(await errorDelAlta(c, e, { fecha_inicio: fecha }), etiqueta).toBe("");
      }
    });
  });

  it("rechaza una fecha_inicio futura", async () => {
    await conEscenario(async (c, e) => {
      expect(await errorDelAlta(c, e, { fecha_inicio: MANANA_TUCUMAN })).toMatch(/no puede ser posterior a hoy/);
    });
  });

  it("controla contra el día de Tucumán aunque la sesión esté en otra zona horaria", async () => {
    await conEscenario(async (c, e) => {
      // UTC+14: para esta sesión, current_date suele ser "mañana" en Tucumán.
      await c.query("SET LOCAL TIME ZONE 'Pacific/Kiritimati'");
      expect(await errorDelAlta(c, e, { fecha_inicio: MANANA_TUCUMAN })).toMatch(/no puede ser posterior a hoy/);
      expect(await errorDelAlta(c, e, { fecha_inicio: HOY_TUCUMAN })).toBe("");
    });
  });

  it("rechaza mover fecha_inicio al futuro", async () => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e);
      expect(await errorDelUpdate(c, exp.id, "fecha_inicio = (now() AT TIME ZONE 'America/Argentina/Tucuman')::date + 1")).toMatch(/no puede ser posterior a hoy/);
    });
  });

  it("rechaza fechas anteriores a 1950", async () => {
    await conEscenario(async (c, e) => {
      expect(await errorDelAlta(c, e, { fecha_inicio: "1949-12-31" })).toMatch(/expedientes_fecha_inicio_check/);
    });
  });
});

describe("expedientes: CHECKs de estado", () => {
  it("el estado es uno de los cinco", async () => {
    await conEscenario(async (c, e) => {
      for (const estado of ["en_tramite", "espera_pago_dim", "concluido"]) {
        expect(await errorDelAlta(c, e, { estado }), estado).toBe("");
      }
      expect(await errorDelAlta(c, e, { estado: "pendiente" })).toMatch(/expedientes_estado_check/);
    });
  });

  it("estado_previo va si y solo si el estado es archivado o anulado", async () => {
    await conEscenario(async (c, e) => {
      expect(await errorDelAlta(c, e, { estado: "anulado" })).toMatch(/expedientes_estado_previo_check/);
      expect(await errorDelAlta(c, e, { estado: "archivado", ubicacion_archivo: "Caja 1" })).toMatch(/expedientes_estado_previo_check/);
      expect(await errorDelAlta(c, e, { estado: "en_tramite", estado_previo: "concluido" })).toMatch(/expedientes_estado_previo_check/);
      expect(await errorDelAlta(c, e, { estado: "anulado", estado_previo: "en_tramite" })).toBe("");
      expect(await errorDelAlta(c, e, { estado: "archivado", estado_previo: "concluido", ubicacion_archivo: "Caja 1" })).toBe("");
    });
  });

  it("un archivado dice dónde está (DESCONOCIDA en carga histórica)", async () => {
    await conEscenario(async (c, e) => {
      expect(await errorDelAlta(c, e, { estado: "archivado", estado_previo: "concluido" })).toMatch(/expedientes_ubicacion_archivo_check/);
      expect(await errorDelAlta(c, e, { estado: "archivado", estado_previo: "concluido", ubicacion_archivo: "DESCONOCIDA", carga_historica: true })).toBe("");
    });
  });

  it("archivar y desarchivar por UPDATE respetan los mismos CHECKs", async () => {
    await conEscenario(async (c, e) => {
      const exp = await crearExpediente(c, e);
      expect(await errorDelUpdate(c, exp.id, "estado = 'archivado', estado_previo = 'en_tramite'")).toMatch(/expedientes_ubicacion_archivo_check/);
      expect(await errorDelUpdate(c, exp.id, "estado = 'archivado', estado_previo = 'en_tramite', ubicacion_archivo = 'Caja 7'")).toBe("");
      expect(await errorDelUpdate(c, exp.id, "estado = 'en_tramite'")).toMatch(/expedientes_estado_previo_check/);
      expect(await errorDelUpdate(c, exp.id, "estado = estado_previo, estado_previo = NULL")).toBe("");
    });
  });

  it("forma de pago, ubicación, datos, items y plazo tienen valores acotados", async () => {
    await conEscenario(async (c, e) => {
      expect(await errorDelAlta(c, e, { forma_pago: "tarjeta" })).toMatch(/expedientes_forma_pago_check/);
      expect(await errorDelAlta(c, e, { forma_pago: null })).toBe("");
      // El trigger corre antes que el CHECK y jsonb_each_text ya rechaza lo que
      // no es objeto; lo que importa es que no entre.
      expect(await errorDelAlta(c, e, { ubicacion: "[]" })).toMatch(/expedientes_ubicacion_check|jsonb_each_text on a non-object/);
      expect(await errorDelAlta(c, e, { datos_extra: "[]" })).toMatch(/expedientes_datos_extra_check/);
      expect(await errorDelAlta(c, e, { items: "[]" })).toMatch(/expedientes_items_check/);
      expect(await errorDelAlta(c, e, { plazo_desde: "2026-10-01" })).toMatch(/expedientes_plazo_check/);
      expect(await errorDelAlta(c, e, { plazo_desde: "2026-10-01", plazo_dias_habiles: 30 })).toBe("");
    });
  });
});
