// movimientos: historial de solo inserción (propuesta 2.8, 2.11 y 2.13(b)).

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  borrarRolDePrueba,
  crearEscenario,
  crearExpediente,
  crearMovimiento,
  crearPersona,
  crearRolDePrueba,
  enTransaccionCon,
  errorDe,
  fila,
  quitarActor,
  sql,
  type Columnas,
  type Escenario,
  type FilaMovimiento,
  type RolDePrueba,
} from "./escenario";
import { SISTEMA, clientePg, conPg, enTransaccion, fijarActor, intentar, type Rol } from "./helper";

const MOTIVO = "Motivo de la prueba de integración";
const INMUTABLE = /movimientos es solo inserción/;

/** Expediente con un `alta` y una persona que la referencia (TRUNCATE tiene que ir con CASCADE). */
async function conHistorial(c: pg.Client): Promise<{ e: Escenario; expedienteId: string; alta: FilaMovimiento }> {
  await fijarActor(c, SISTEMA, MOTIVO);
  const e = await crearEscenario(c);
  const exp = await crearExpediente(c, e);
  const alta = await crearMovimiento(c, exp.id, { tipo: "alta" });
  await crearPersona(c, exp.id, { creada_mov_id: alta.id });
  return { e, expedienteId: exp.id, alta };
}

// expediente_personas.creada_mov_id apunta a movimientos: sin CASCADE el
// TRUNCATE fallaría por la FK antes de llegar al trigger, y el test pasaría por
// el motivo equivocado.
const SENTENCIAS_PROHIBIDAS: Array<[string, string]> = [
  ["UPDATE", "UPDATE public.movimientos SET observacion = 'reescrita' WHERE id = $1"],
  ["UPDATE de la fecha de registro", "UPDATE public.movimientos SET registrado_en = registrado_en - interval '1 day' WHERE id = $1"],
  ["DELETE", "DELETE FROM public.movimientos WHERE id = $1"],
  ["TRUNCATE", "TRUNCATE public.movimientos CASCADE"],
];

function paramsDe(sentencia: string, id: string): unknown[] {
  return sentencia.includes("$1") ? [id] : [];
}

describe("movimientos: el historial es solo inserción", () => {
  it.each(SENTENCIAS_PROHIBIDAS)("cementeria_app no tiene privilegio de %s", async (_op, sentencia) => {
    await enTransaccion("app", async (c) => {
      const { alta } = await conHistorial(c);
      const r = await intentar(c, sentencia, paramsDe(sentencia, alta.id));
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
      expect(errorDe(r)).toMatch(/permission denied for table (movimientos|expediente_personas)/);
    });
  });

  it.each(SENTENCIAS_PROHIBIDAS)("el owner tampoco puede: %s choca con movimientos_inmutables", async (_op, sentencia) => {
    await enTransaccion("owner", async (c) => {
      const { alta } = await conHistorial(c);
      const r = await intentar(c, sentencia, paramsDe(sentencia, alta.id));
      expect(errorDe(r)).toMatch(INMUTABLE);
      const sigue = await fila<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.movimientos WHERE id = $1 AND observacion IS NULL", [alta.id]);
      expect(sigue.n).toBe(1);
    });
  });

  describe("con session_replication_role = replica (ENABLE ALWAYS)", () => {
    // Un rol de prueba al que, a propósito, sí se le dan UPDATE, DELETE y
    // TRUNCATE: así lo único que lo frena es el trigger, no los privilegios.
    let rol: RolDePrueba | undefined;
    beforeAll(async () => {
      rol = await crearRolDePrueba("replica_mov", [
        "GRANT cementeria_app TO {rol}",
        "GRANT SET ON PARAMETER session_replication_role TO {rol}",
        "GRANT UPDATE, DELETE, TRUNCATE ON public.movimientos, public.expediente_personas TO {rol}",
        // 26/10/2026: avisos.movimiento_id también apunta a movimientos, así que
        // el TRUNCATE … CASCADE la alcanza; sin esto lo frenaría el privilegio.
        "GRANT TRUNCATE ON public.avisos TO {rol}",
      ]);
    });
    afterAll(async () => borrarRolDePrueba(rol));

    it.each(SENTENCIAS_PROHIBIDAS)("un rol con privilegios y replica no puede: %s", async (_op, sentencia) => {
      if (!rol) throw new Error("No se creó el rol de prueba");
      await enTransaccionCon(rol.url, async (c) => {
        const { alta } = await conHistorial(c);
        await c.query("SET LOCAL session_replication_role = replica");
        const modo = await fila<{ session_replication_role: string }>(c, "SHOW session_replication_role");
        expect(modo.session_replication_role).toBe("replica");
        const r = await intentar(c, sentencia, paramsDe(sentencia, alta.id));
        expect(errorDe(r)).toMatch(INMUTABLE);
      });
    });

    // La fila "Tests" de la sección 6 al pie de la letra: los privilegios de la
    // app y nada más, más el permiso de poner replica.
    let rolApp: RolDePrueba | undefined;
    beforeAll(async () => {
      rolApp = await crearRolDePrueba("replica_app", [
        "GRANT cementeria_app TO {rol}",
        "GRANT SET ON PARAMETER session_replication_role TO {rol}",
      ]);
    });
    afterAll(async () => borrarRolDePrueba(rolApp));

    it.each(SENTENCIAS_PROHIBIDAS)("un rol con los privilegios de la app y replica no puede: %s", async (_op, sentencia) => {
      if (!rolApp) throw new Error("No se creó el rol de prueba");
      await enTransaccionCon(rolApp.url, async (c) => {
        const { alta } = await conHistorial(c);
        await c.query("SET LOCAL session_replication_role = replica");
        const r = await intentar(c, sentencia, paramsDe(sentencia, alta.id));
        expect(r).toMatchObject({ ok: false, codigo: "42501" });
        const sigue = await fila<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.movimientos WHERE id = $1 AND observacion IS NULL", [alta.id]);
        expect(sigue.n).toBe(1);
      });
    });

    it.each(SENTENCIAS_PROHIBIDAS)("ni el superusuario en replica: %s", async (_op, sentencia) => {
      await enTransaccion("superusuario", async (c) => {
        const { alta } = await conHistorial(c);
        await c.query("SET LOCAL session_replication_role = replica");
        const r = await intentar(c, sentencia, paramsDe(sentencia, alta.id));
        expect(errorDe(r)).toMatch(INMUTABLE);
      });
    });
  });

  it("saltear el trigger exige DDL del owner (ALTER TABLE … DISABLE TRIGGER), que la app no puede hacer", async () => {
    await enTransaccion("app", async (c) => {
      await conHistorial(c);
      const r = await intentar(c, "ALTER TABLE public.movimientos DISABLE TRIGGER movimientos_inmutables");
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
      expect(errorDe(r)).toMatch(/must be owner of table movimientos/);
    });
    // El owner sí puede, y es justamente lo que queda en el log con
    // log_statement = 'ddl' (2.13(b)), que el clúster local tiene como se le
    // pide a Sistemas. La transacción se revierte.
    await conPg("superusuario", async (c) => {
      expect((await fila<{ log_statement: string }>(c, "SHOW log_statement")).log_statement).toBe("ddl");
    });
    await enTransaccion("owner", async (c) => {
      const { alta } = await conHistorial(c);
      await c.query("ALTER TABLE public.movimientos DISABLE TRIGGER movimientos_inmutables");
      const r = await intentar(c, "UPDATE public.movimientos SET observacion = 'x' WHERE id = $1", [alta.id]);
      expect(r).toMatchObject({ ok: true });
    });
  });
});

describe("movimientos_sellar", () => {
  it("asigna la secuencia consecutiva por expediente y pisa la que mande la app", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const e = await crearEscenario(c);
      const a = await crearExpediente(c, e);
      const b = await crearExpediente(c, e);
      const pedidos: Array<[string, number]> = [
        [a.id, 99],
        [b.id, 0],
        [a.id, 1],
        [a.id, -5],
        [b.id, 7],
        [a.id, 2],
      ];
      const obtenidas: Array<[string, number]> = [];
      for (const [expedienteId, secuencia] of pedidos) {
        const m = await crearMovimiento(c, expedienteId, { secuencia });
        obtenidas.push([m.expediente_id, m.secuencia]);
      }
      expect(obtenidas).toEqual([
        [a.id, 1],
        [b.id, 1],
        [a.id, 2],
        [a.id, 3],
        [b.id, 2],
        [a.id, 4],
      ]);
    });
  });

  it("pisa registrado_en con now(), venga lo que venga de la app", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e);
      for (const registradoEn of ["2001-01-01T00:00:00Z", sql("now() + interval '3 days'"), sql("now() - interval '1 year'")]) {
        const m = await crearMovimiento(c, exp.id, { registrado_en: registradoEn });
        const r = await fila<{ es_now: boolean }>(c, "SELECT registrado_en = now() AS es_now FROM public.movimientos WHERE id = $1", [m.id]);
        expect(r.es_now).toBe(true);
      }
    });
  });

  it("el id lo asigna la base: un id explícito se rechaza (GENERATED ALWAYS)", async () => {
    // Con BY DEFAULT, un id elegido por un bug dejaba la secuencia apuntando a
    // una fila ocupada que, en una tabla de solo inserción, no se puede borrar.
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e);
      const conId = await intentar(c, "INSERT INTO public.movimientos (id, expediente_id, tipo, fecha_efectiva, usuario_id, comando_id) VALUES (999999999, $1, 'nota', now(), $2, gen_random_uuid())", [exp.id, SISTEMA]);
      expect(errorDe(conId)).toMatch(/cannot insert a non-DEFAULT value into column "id"/);
      const sinId = await intentar(c, "INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, usuario_id, comando_id) VALUES ($1, 'nota', now(), $2, gen_random_uuid())", [exp.id, SISTEMA]);
      expect(sinId).toMatchObject({ ok: true });
    });
  });

  it("rechaza la inserción sin actor (app.usuario_id)", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e);
      await quitarActor(c);
      const r = await intentar(c, "INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, usuario_id, comando_id) VALUES ($1, 'nota', now(), $2, gen_random_uuid())", [exp.id, SISTEMA]);
      expect(errorDe(r)).toMatch(/Falta el actor \(app\.usuario_id\)/);
    });
  });

  it("rechaza un usuario_id distinto del actor de la transacción", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e);
      const r = await intentar(c, "INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, usuario_id, comando_id) VALUES ($1, 'nota', now(), $2, gen_random_uuid())", [exp.id, e.operador]);
      expect(errorDe(r)).toMatch(new RegExp(`declara usuario_id ${e.operador} pero el actor de la transacción es ${SISTEMA}`));

      // El mismo movimiento, con el operador como actor, entra.
      await fijarActor(c, e.operador);
      const m = await crearMovimiento(c, exp.id, { usuario_id: e.operador });
      expect(m.usuario_id).toBe(e.operador);
    });
  });

  it("completa area_usuario_id desde usuarios e ignora lo que mande la app", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e);

      await fijarActor(c, e.operador);
      const delOperador = await crearMovimiento(c, exp.id, { area_usuario_id: e.areaDestino });
      expect(delOperador.area_usuario_id).toBe(e.areaInterna);

      // SISTEMA no tiene área.
      await fijarActor(c, SISTEMA);
      const deSistema = await crearMovimiento(c, exp.id, { area_usuario_id: e.areaInterna });
      expect(deSistema.area_usuario_id).toBeNull();
    });
  });

  it("rechaza un movimiento de un expediente que no existe", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA);
      const r = await intentar(c, "INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, usuario_id, comando_id) VALUES (-1, 'nota', now(), $1, gen_random_uuid())", [SISTEMA]);
      expect(errorDe(r)).toMatch(/No existe el expediente -1/);
    });
  });

  it("serializa los movimientos de un expediente: el segundo espera el lock y toma la secuencia siguiente", async () => {
    // Dos conexiones tienen que ver el mismo expediente, así que esta prueba
    // confirma sus filas (la base efímera se descarta al terminar la corrida).
    const expedienteId = await conPg("app", async (c) => {
      await c.query("BEGIN");
      await fijarActor(c, SISTEMA, MOTIVO);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e);
      await c.query("COMMIT");
      return exp.id;
    });

    const t1 = await clientePg("app");
    const t2 = await clientePg("app");
    try {
      await t1.query("BEGIN");
      await fijarActor(t1, SISTEMA);
      const m1 = await crearMovimiento(t1, expedienteId);

      await t2.query("BEGIN");
      await fijarActor(t2, SISTEMA);
      const pid = (await fila<{ pid: number }>(t2, "SELECT pg_backend_pid() AS pid")).pid;
      const pendiente = crearMovimiento(t2, expedienteId);
      pendiente.catch(() => undefined);

      // t2 tiene que quedar bloqueado por el SELECT … FOR UPDATE de t1.
      const bloqueado = await conPg("superusuario", async (s) => {
        for (let i = 0; i < 100; i++) {
          const r = await s.query<{ wait_event_type: string | null }>("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid]);
          if (r.rows[0]?.wait_event_type === "Lock") return true;
          await new Promise((listo) => setTimeout(listo, 50));
        }
        return false;
      });
      expect(bloqueado).toBe(true);

      await t1.query("COMMIT");
      const m2 = await pendiente;
      await t2.query("COMMIT");
      expect([m1.secuencia, m2.secuencia]).toEqual([1, 2]);
    } finally {
      await t1.end();
      await t2.end();
    }
  });
});

describe("movimientos: CHECKs", () => {
  interface Contexto {
    e: Escenario;
    alta: FilaMovimiento;
  }
  type Caso = [string, (x: Contexto) => Columnas];

  // Cada uno exige motivo de al menos 10 caracteres (sin contar los espacios
  // de los extremos).
  const EXIGEN_MOTIVO: Caso[] = [
    ["devolución", ({ e }) => ({ tipo: "devolucion", paso_destino: "MESA", area_destino_id: e.areaInterna, datos: { subtareas_reiniciadas: [] } })],
    ["corrección", ({ alta }) => ({ tipo: "correccion", corrige_movimiento_id: alta.id, datos: { revertir: true } })],
    ["anulación", () => ({ tipo: "estado", estado_anterior: "en_tramite", estado_nuevo: "anulado" })],
    ["archivar sin concluir", () => ({ tipo: "estado", estado_anterior: "en_tramite", estado_nuevo: "archivado", datos: { ubicacion_archivo: "Caja 12" } })],
    ["archivar desde espera de pago", () => ({ tipo: "estado", estado_anterior: "espera_pago_dim", estado_nuevo: "archivado" })],
    ["desarchivar", () => ({ tipo: "estado", estado_anterior: "archivado", estado_nuevo: "concluido" })],
    ["reabrir un anulado", () => ({ tipo: "estado", estado_anterior: "anulado", estado_nuevo: "en_tramite" })],
    ["destildar una subtarea", () => ({ tipo: "subtarea", datos: { subtarea: "LIQ_PAGO", hecha: false, dato: null } })],
    ["un pase que omite pasos", ({ e }) => ({ tipo: "pase", paso_destino: "LEGAL", area_destino_id: e.areaDestino, datos: { pasos_omitidos: ["COMPUTO"], pasos_salteados: [] } })],
  ];

  const NO_EXIGEN_MOTIVO: Caso[] = [
    ["nota", () => ({ tipo: "nota" })],
    ["recepción", () => ({ tipo: "recepcion", datos: { implicita: false } })],
    ["pase al paso siguiente", ({ e }) => ({ tipo: "pase", paso_destino: "LEGAL", area_destino_id: e.areaDestino, datos: { pasos_omitidos: [], pasos_salteados: [] } })],
    ["pase sin datos", ({ e }) => ({ tipo: "pase", paso_destino: "LEGAL", area_destino_id: e.areaDestino })],
    ["reenvío directo (pasos salteados)", ({ e }) => ({ tipo: "pase", paso_destino: "LEGAL", area_destino_id: e.areaDestino, datos: { pasos_omitidos: [], pasos_salteados: ["COMPUTO"] } })],
    ["tildar una subtarea", () => ({ tipo: "subtarea", datos: { subtarea: "LIQ_PAGO", hecha: true, dato: "2026-10-15" } })],
    ["concluir", () => ({ tipo: "estado", estado_anterior: "en_tramite", estado_nuevo: "concluido" })],
    ["archivar un concluido", () => ({ tipo: "estado", estado_anterior: "concluido", estado_nuevo: "archivado", datos: { ubicacion_archivo: "Caja 3" } })],
  ];

  async function conContexto(rol: Rol, fn: (c: pg.Client, x: Contexto) => Promise<void>): Promise<void> {
    await enTransaccion(rol, async (c) => {
      await fijarActor(c, SISTEMA);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e);
      const alta = await crearMovimiento(c, exp.id, { tipo: "alta" });
      await fn(c, { e, alta });
    });
  }

  async function intentarMovimiento(c: pg.Client, expedienteId: string, columnas: Columnas) {
    await c.query("SAVEPOINT mov");
    try {
      const m = await crearMovimiento(c, expedienteId, columnas);
      await c.query("RELEASE SAVEPOINT mov");
      return { ok: true as const, m };
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT mov");
      return { ok: false as const, error: (e as Error).message };
    }
  }

  it.each(EXIGEN_MOTIVO)("%s exige motivo de al menos 10 caracteres", async (_caso, columnas) => {
    await conContexto("app", async (c, x) => {
      const exp = x.alta.expediente_id;
      for (const motivo of [null, "", "corto", "123456789", "    ab    ", "\t\t  x \n "]) {
        const r = await intentarMovimiento(c, exp, { ...columnas(x), motivo });
        expect(errorDe(r), `motivo ${JSON.stringify(motivo)}`).toMatch(/movimientos_motivo_check/);
      }
      for (const motivo of ["1234567890", "  Falta la firma del Director  "]) {
        const r = await intentarMovimiento(c, exp, { ...columnas(x), motivo });
        expect(r, `motivo ${JSON.stringify(motivo)}`).toMatchObject({ ok: true });
      }
    });
  });

  it.each(NO_EXIGEN_MOTIVO)("%s no exige motivo", async (_caso, columnas) => {
    await conContexto("app", async (c, x) => {
      const r = await intentarMovimiento(c, x.alta.expediente_id, columnas(x));
      expect(r).toMatchObject({ ok: true });
    });
  });

  it("corrige_movimiento_id va si y solo si el tipo es correccion", async () => {
    await conContexto("app", async (c, x) => {
      const exp = x.alta.expediente_id;
      const sinReferencia = await intentarMovimiento(c, exp, { tipo: "correccion", motivo: MOTIVO, datos: { revertir: true } });
      expect(errorDe(sinReferencia)).toMatch(/movimientos_correccion_check/);

      const notaConReferencia = await intentarMovimiento(c, exp, { tipo: "nota", corrige_movimiento_id: x.alta.id });
      expect(errorDe(notaConReferencia)).toMatch(/movimientos_correccion_check/);

      const bien = await intentarMovimiento(c, exp, { tipo: "correccion", corrige_movimiento_id: x.alta.id, motivo: MOTIVO, datos: { observacion: ["a", "b"] } });
      expect(bien).toMatchObject({ ok: true });
    });
  });

  it("fecha_efectiva admite el pasado y hasta 5 minutos después del registro", async () => {
    await conContexto("app", async (c, x) => {
      const exp = x.alta.expediente_id;
      const aceptadas = [
        sql("timestamptz '2019-03-15 00:00 America/Argentina/Tucuman'"),
        sql("now() - interval '30 days'"),
        sql("now()"),
        sql("now() + interval '4 minutes 59 seconds'"),
        sql("now() + interval '5 minutes'"),
      ];
      for (const fecha of aceptadas) {
        const r = await intentarMovimiento(c, exp, { fecha_efectiva: fecha });
        expect(r, fecha.texto).toMatchObject({ ok: true });
      }
      for (const fecha of [sql("now() + interval '5 minutes 1 second'"), sql("now() + interval '1 day'")]) {
        const r = await intentarMovimiento(c, exp, { fecha_efectiva: fecha });
        expect(errorDe(r), fecha.texto).toMatch(/movimientos_fecha_efectiva_check/);
      }
      // Mandar un registrado_en futuro no sirve para colar una fecha futura:
      // el trigger lo pisa antes de que se evalúe el CHECK.
      const trampa = await intentarMovimiento(c, exp, {
        fecha_efectiva: sql("now() + interval '1 hour'"),
        registrado_en: sql("now() + interval '2 hours'"),
      });
      expect(errorDe(trampa)).toMatch(/movimientos_fecha_efectiva_check/);
    });
  });

  it("la carga histórica exige fuente", async () => {
    await conContexto("app", async (c, x) => {
      const exp = x.alta.expediente_id;
      const sinFuente = await intentarMovimiento(c, exp, { carga_historica: true, precision_fecha: "dia" });
      expect(errorDe(sinFuente)).toMatch(/movimientos_fuente_check/);
      const conFuente = await intentarMovimiento(c, exp, { carga_historica: true, precision_fecha: "dia", fuente: "Ficha papel" });
      expect(conFuente).toMatchObject({ ok: true });
      const normal = await intentarMovimiento(c, exp, { carga_historica: false });
      expect(normal).toMatchObject({ ok: true });
    });
  });

  it("pase y devolución exigen paso y área de destino; estado exige estado_nuevo", async () => {
    await conContexto("app", async (c, x) => {
      const exp = x.alta.expediente_id;
      const casos: Columnas[] = [
        { tipo: "pase", area_destino_id: x.e.areaDestino },
        { tipo: "pase", paso_destino: "LEGAL" },
        { tipo: "devolucion", paso_destino: "MESA", motivo: MOTIVO },
      ];
      for (const columnas of casos) {
        expect(errorDe(await intentarMovimiento(c, exp, columnas))).toMatch(/movimientos_destino_check/);
      }
      expect(errorDe(await intentarMovimiento(c, exp, { tipo: "estado" }))).toMatch(/movimientos_estado_nuevo_check/);
    });
  });

  it("tipo, precision_fecha y datos tienen valores acotados", async () => {
    await conContexto("app", async (c, x) => {
      const exp = x.alta.expediente_id;
      expect(errorDe(await intentarMovimiento(c, exp, { tipo: "borrado" }))).toMatch(/movimientos_tipo_check/);
      expect(errorDe(await intentarMovimiento(c, exp, { precision_fecha: "hora" }))).toMatch(/movimientos_precision_fecha_check/);
      expect(errorDe(await intentarMovimiento(c, exp, { datos: "[]" }))).toMatch(/movimientos_datos_check/);
    });
  });

  it("comando_id es idempotente por expediente y tipo", async () => {
    await conContexto("app", async (c, x) => {
      const otro = await crearExpediente(c, x.e);
      const comando = (await fila<{ u: string }>(c, "SELECT gen_random_uuid()::text AS u")).u;
      const exp = x.alta.expediente_id;
      const pase = { tipo: "pase", paso_destino: "LEGAL", area_destino_id: x.e.areaDestino, comando_id: comando };

      expect(await intentarMovimiento(c, exp, pase)).toMatchObject({ ok: true });
      const repetido = await intentarMovimiento(c, exp, pase);
      expect(errorDe(repetido)).toMatch(/movimientos_expediente_id_comando_id_tipo_key/);

      // Un mismo comando puede dejar movimientos de distinto tipo (el pase y
      // la recepción implícita) y repetirse en otro expediente.
      expect(await intentarMovimiento(c, exp, { tipo: "recepcion", comando_id: comando, datos: { implicita: true } })).toMatchObject({ ok: true });
      expect(await intentarMovimiento(c, otro.id, pase)).toMatchObject({ ok: true });
    });
  });
});
