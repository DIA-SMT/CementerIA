// Funciones SQL: normalización, actor y días hábiles (propuesta 2.11 y 3.6).

import pg from "pg";
import { describe, expect, it } from "vitest";
import { errorDe, fila, quitarActor } from "./escenario";
import { SISTEMA, conPg, enTransaccion, fijarActor, intentar } from "./helper";

describe("f_normalizar y f_unaccent", () => {
  const CASOS: Array<[string, string]> = [
    ["GONZÁLEZ", "gonzalez"],
    ["GONZÁLEZ, María-José", "gonzalez maria jose"],
    ["  Peña   Ñandú  ", "pena nandu"],
    ["Müller O'Brien", "muller o brien"],
    ["Secc. 3 · Cuadro B · Lote 12", "secc 3 cuadro b lote 12"],
    ["CEM-2026-00042", "cem 2026 00042"],
    ["¡¿?!", ""],
  ];

  it.each(CASOS)("f_normalizar(%j) = %j", async (entrada, esperado) => {
    await enTransaccion("app", async (c) => {
      const r = await fila<{ v: string }>(c, "SELECT public.f_normalizar($1) AS v", [entrada]);
      expect(r.v).toBe(esperado);
    });
  });

  it("NULL da NULL", async () => {
    await enTransaccion("app", async (c) => {
      expect((await fila<{ v: string | null }>(c, "SELECT public.f_normalizar(NULL) AS v")).v).toBeNull();
    });
  });

  it("\"gonzalez\" encuentra \"GONZÁLEZ\" con el índice trigram (2.13(g))", async () => {
    await enTransaccion("app", async (c) => {
      const r = await fila<{ v: boolean }>(c, "SELECT public.f_normalizar('Juan GONZÁLEZ Pérez') LIKE '%' || public.f_normalizar('gonzalez') || '%' AS v");
      expect(r.v).toBe(true);
    });
  });

  it("f_unaccent y f_normalizar son IMMUTABLE (se pueden usar en índices); los días hábiles, STABLE", async () => {
    await enTransaccion("app", async (c) => {
      const r = await c.query<{ funcion: string; volatilidad: string; resultado: string }>(
        `SELECT p.proname AS funcion, p.provolatile AS volatilidad, pg_get_function_result(p.oid) AS resultado
           FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('f_unaccent', 'f_normalizar', 'f_actor', 'f_sumar_dias_habiles', 'f_dias_habiles_entre')
          ORDER BY 1`,
      );
      expect(r.rows).toEqual([
        { funcion: "f_actor", volatilidad: "s", resultado: "integer" },
        { funcion: "f_dias_habiles_entre", volatilidad: "s", resultado: "integer" },
        { funcion: "f_normalizar", volatilidad: "i", resultado: "text" },
        { funcion: "f_sumar_dias_habiles", volatilidad: "s", resultado: "date" },
        { funcion: "f_unaccent", volatilidad: "i", resultado: "text" },
      ]);
    });
  });

  it("f_unaccent no depende del search_path de quien la llama", async () => {
    await enTransaccion("app", async (c) => {
      await c.query("SET LOCAL search_path = pg_catalog");
      expect((await fila<{ v: string }>(c, "SELECT public.f_normalizar('ÁRBOL') AS v")).v).toBe("arbol");
    });
  });
});

describe("f_actor", () => {
  it("devuelve el actor de la transacción", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      expect((await fila<{ v: number }>(c, "SELECT public.f_actor() AS v")).v).toBe(SISTEMA);
    });
  });

  it("sin actor lanza \"Falta el actor (app.usuario_id)\"", async () => {
    await enTransaccion("app", async (c) => {
      expect(errorDe(await intentar(c, "SELECT public.f_actor()"))).toBe("Falta el actor (app.usuario_id)");
      await fijarActor(c, SISTEMA);
      await quitarActor(c);
      expect(errorDe(await intentar(c, "SELECT public.f_actor()"))).toBe("Falta el actor (app.usuario_id)");
    });
  });

  it("el actor vale solo para la transacción: no queda pegado a la conexión del pool", async () => {
    await conPg("app", async (c) => {
      await c.query("BEGIN");
      await fijarActor(c, SISTEMA, "Primera transacción");
      await c.query("COMMIT");
      await c.query("BEGIN");
      try {
        expect(errorDe(await intentar(c, "SELECT public.f_actor()"))).toMatch(/Falta el actor/);
        const motivo = await fila<{ v: string | null }>(c, "SELECT current_setting('app.motivo', true) AS v");
        expect(motivo.v ?? "").toBe("");
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Días hábiles
// ---------------------------------------------------------------------------

// Feriados ficticios en 2031, un año que la semilla no toca:
//   mar 11/03 aislado; vie 21/03 y lun 24/03 (fin de semana largo de cuatro
//   días); sáb 29/03 (feriado en fin de semana: no descuenta dos veces); y una
//   feria del lun 14/04 al vie 25/04.
const FERIADOS: Array<[string, string]> = [
  ["2031-03-11", "nacional"],
  ["2031-03-21", "provincial"],
  ["2031-03-24", "nacional"],
  ["2031-03-29", "municipal"],
  ...["14", "15", "16", "17", "18", "21", "22", "23", "24", "25"].map((d): [string, string] => [`2031-04-${d}`, "feria"]),
];

async function conFeriados(fn: (c: pg.Client) => Promise<void>): Promise<void> {
  await enTransaccion("app", async (c) => {
    await fijarActor(c, SISTEMA, "Feriados ficticios para la prueba");
    for (const [fecha, ambito] of FERIADOS) {
      await c.query(
        "INSERT INTO public.feriados (fecha, descripcion, ambito) VALUES ($1, 'Feriado de prueba', $2) ON CONFLICT (fecha) DO NOTHING",
        [fecha, ambito],
      );
    }
    await fn(c);
  });
}

// Referencia en TypeScript, escrita aparte de la función SQL, para comparar
// muchos casos. Fechas como texto YYYY-MM-DD y aritmética en UTC: no depende de
// la zona horaria del proceso.
function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function esHabil(fecha: string, feriados: Set<string>): boolean {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return dia !== 0 && dia !== 6 && !feriados.has(fecha);
}

function sumarDiasHabiles(desde: string, n: number, feriados: Set<string>): string {
  let dia = desde;
  for (let contados = 0; contados < n; ) {
    dia = sumarDias(dia, 1);
    if (esHabil(dia, feriados)) contados++;
  }
  return dia;
}

function diasHabilesEntre(desde: string, hasta: string, feriados: Set<string>): number {
  const [menor, mayor, signo] = desde <= hasta ? [desde, hasta, 1] : [hasta, desde, -1];
  let n = 0;
  for (let dia = sumarDias(menor, 1); dia <= mayor; dia = sumarDias(dia, 1)) {
    if (esHabil(dia, feriados)) n++;
  }
  return signo * n;
}

const SET_FERIADOS = new Set(FERIADOS.map(([f]) => f));

describe("f_sumar_dias_habiles", () => {
  const CASOS: Array<[string, string, number, string]> = [
    ["lunes + 1 es martes", "2031-03-03", 1, "2031-03-04"],
    ["viernes + 1 saltea el fin de semana", "2031-03-07", 1, "2031-03-10"],
    ["sábado + 1 cuenta desde el lunes", "2031-03-08", 1, "2031-03-10"],
    ["domingo + 1 cuenta desde el lunes", "2031-03-09", 1, "2031-03-10"],
    ["n = 0 devuelve la misma fecha", "2031-03-09", 0, "2031-03-09"],
    ["lunes + 5 es el lunes siguiente", "2031-03-03", 5, "2031-03-10"],
    ["saltea un feriado aislado", "2031-03-10", 1, "2031-03-12"],
    ["saltea un fin de semana largo", "2031-03-20", 1, "2031-03-25"],
    ["un feriado en sábado no descuenta dos veces", "2031-03-28", 1, "2031-03-31"],
    ["saltea una feria de dos semanas", "2031-04-11", 1, "2031-04-28"],
    ["30 días hábiles atravesando todo eso", "2031-03-03", 30, "2031-05-01"],
  ];

  it.each(CASOS)("%s", async (_caso, desde, n, esperado) => {
    await conFeriados(async (c) => {
      const r = await fila<{ v: string }>(c, "SELECT public.f_sumar_dias_habiles($1::date, $2)::text AS v", [desde, n]);
      expect(r.v).toBe(esperado);
      expect(sumarDiasHabiles(desde, n, SET_FERIADOS)).toBe(esperado);
    });
  });

  it("coincide con la referencia para cada día de marzo a mayo y varios n", async () => {
    await conFeriados(async (c) => {
      const r = await c.query<{ desde: string; n: number; v: string }>(
        `SELECT d::date::text AS desde, n, public.f_sumar_dias_habiles(d::date, n)::text AS v
           FROM generate_series(date '2031-03-01', date '2031-05-31', interval '1 day') AS d,
                unnest(ARRAY[0, 1, 2, 3, 5, 10, 15, 30]) AS n`,
      );
      const distintos = r.rows.filter((f) => f.v !== sumarDiasHabiles(f.desde, f.n, SET_FERIADOS));
      expect(distintos).toEqual([]);
      expect(r.rows.length).toBe(92 * 8);
    });
  });

  it("se recalcula al cargar un feriado nuevo", async () => {
    await conFeriados(async (c) => {
      const antes = await fila<{ v: string }>(c, "SELECT public.f_sumar_dias_habiles('2031-03-03', 1)::text AS v");
      await c.query("INSERT INTO public.feriados (fecha, descripcion, ambito) VALUES ('2031-03-04', 'Asueto de prueba', 'asueto')");
      const despues = await fila<{ v: string }>(c, "SELECT public.f_sumar_dias_habiles('2031-03-03', 1)::text AS v");
      expect([antes.v, despues.v]).toEqual(["2031-03-04", "2031-03-05"]);
    });
  });

  it("n negativo es un error; NULL da NULL", async () => {
    await conFeriados(async (c) => {
      expect(errorDe(await intentar(c, "SELECT public.f_sumar_dias_habiles('2031-03-03', -1)"))).toMatch(/no puede ser negativo/);
      expect((await fila<{ v: string | null }>(c, "SELECT public.f_sumar_dias_habiles(NULL, 3) AS v")).v).toBeNull();
      expect((await fila<{ v: string | null }>(c, "SELECT public.f_sumar_dias_habiles('2031-03-03', NULL) AS v")).v).toBeNull();
    });
  });

  it("f_dias_habiles_entre con una fecha NULL da NULL, no 0 (plazo DIM sin inicio tildado)", async () => {
    await conFeriados(async (c) => {
      const r = await fila<{ a: number | null; b: number | null; vence: number | null }>(
        c,
        `SELECT public.f_dias_habiles_entre(NULL, '2031-03-03') AS a,
                public.f_dias_habiles_entre('2031-03-03', NULL) AS b,
                public.f_dias_habiles_entre('2031-03-03', public.f_sumar_dias_habiles(NULL, 30)) AS vence`,
      );
      expect(r).toEqual({ a: null, b: null, vence: null });
    });
  });
});

describe("f_dias_habiles_entre", () => {
  const CASOS: Array<[string, string, string, number]> = [
    ["lunes a viernes de la misma semana", "2031-03-03", "2031-03-07", 4],
    ["viernes a lunes", "2031-03-07", "2031-03-10", 1],
    ["sábado a lunes", "2031-03-08", "2031-03-10", 1],
    ["sábado a domingo", "2031-03-08", "2031-03-09", 0],
    ["el mismo día", "2031-03-05", "2031-03-05", 0],
    ["con un feriado en el medio", "2031-03-10", "2031-03-12", 1],
    ["fin de semana largo", "2031-03-20", "2031-03-25", 1],
    ["feriado en sábado", "2031-03-28", "2031-03-31", 1],
    ["atravesando la feria", "2031-04-11", "2031-04-28", 1],
    ["hacia atrás es negativo (plazo vencido)", "2031-03-07", "2031-03-03", -4],
    ["30 días hábiles", "2031-03-03", "2031-05-01", 30],
  ];

  it.each(CASOS)("%s", async (_caso, desde, hasta, esperado) => {
    await conFeriados(async (c) => {
      const r = await fila<{ v: number }>(c, "SELECT public.f_dias_habiles_entre($1::date, $2::date) AS v", [desde, hasta]);
      expect(r.v).toBe(esperado);
      expect(diasHabilesEntre(desde, hasta, SET_FERIADOS)).toBe(esperado);
    });
  });

  it("coincide con la referencia en todos los pares de marzo y abril", async () => {
    await conFeriados(async (c) => {
      const r = await c.query<{ desde: string; hasta: string; v: number }>(
        `SELECT d::date::text AS desde, h::date::text AS hasta, public.f_dias_habiles_entre(d::date, h::date) AS v
           FROM generate_series(date '2031-03-01', date '2031-04-30', interval '1 day') AS d,
                generate_series(date '2031-03-01', date '2031-04-30', interval '3 days') AS h`,
      );
      const distintos = r.rows.filter((f) => f.v !== diasHabilesEntre(f.desde, f.hasta, SET_FERIADOS));
      expect(distintos).toEqual([]);
      expect(r.rows.length).toBeGreaterThan(1000);
    });
  });

  it("es la inversa de f_sumar_dias_habiles", async () => {
    await conFeriados(async (c) => {
      const r = await fila<{ distintos: number }>(
        c,
        `SELECT count(*)::int AS distintos
           FROM generate_series(date '2031-03-01', date '2031-05-31', interval '1 day') AS d,
                generate_series(0, 40) AS n
          WHERE public.f_dias_habiles_entre(d::date, public.f_sumar_dias_habiles(d::date, n)) <> n`,
      );
      expect(r.distintos).toBe(0);
    });
  });
});

describe("feriados (2.9)", () => {
  it("el ámbito es uno de los cinco, y cualquiera de ellos hace no hábil el día", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "Feriados ficticios para la prueba");
      // Lunes 6 a viernes 10 de junio de 2033, un feriado de cada ámbito.
      const AMBITOS = ["nacional", "provincial", "municipal", "asueto", "feria"];
      for (const [i, ambito] of AMBITOS.entries()) {
        await c.query("INSERT INTO public.feriados (fecha, descripcion, ambito) VALUES (date '2033-06-06' + $1::int, 'Feriado de prueba', $2)", [i, ambito]);
      }
      const r = await fila<{ entre: number; suma: string }>(
        c,
        "SELECT public.f_dias_habiles_entre('2033-06-05', '2033-06-12') AS entre, public.f_sumar_dias_habiles('2033-06-03', 1)::text AS suma",
      );
      expect(r).toEqual({ entre: 0, suma: "2033-06-13" });

      const invalido = await intentar(c, "INSERT INTO public.feriados (fecha, descripcion, ambito) VALUES ('2033-06-20', 'Feriado de prueba', 'regional')");
      expect(errorDe(invalido)).toMatch(/feriados_ambito_check/);
      const repetido = await intentar(c, "INSERT INTO public.feriados (fecha, descripcion) VALUES ('2033-06-06', 'Otro el mismo día')");
      expect(errorDe(repetido)).toMatch(/feriados_pkey/);
    });
  });
});
