// auditar_cambio y el esquema auditoria (propuesta 2.10, 2.11 y 2.13(b) punto 4).

import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  crearArea,
  crearCementerio,
  crearEscenario,
  crearExpediente,
  crearMovimiento,
  crearPersona,
  crearPlantilla,
  crearTipoMonumento,
  crearTipoTramite,
  crearUsuario,
  cuilFicticio,
  errorDe,
  fila,
  quitarActor,
} from "./escenario";
import { SISTEMA, enTransaccion, fijarActor, intentar } from "./helper";

const MOTIVO = "Alta de configuración para la prueba";

interface Cambio {
  operacion: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  usuario_id: number;
  motivo: string | null;
  de_esta_transaccion: boolean;
}

async function cambios(c: pg.Client, tabla: string, registroId: string | number): Promise<Cambio[]> {
  const r = await c.query<Cambio>(
    `SELECT operacion, antes, despues, usuario_id, motivo, txid = txid_current() AS de_esta_transaccion
       FROM auditoria.cambios
      WHERE tabla = $1 AND registro_id = $2
      ORDER BY id`,
    [tabla, String(registroId)],
  );
  return r.rows;
}

/** Corre con un admin como actor, para que el autor no sea SISTEMA por casualidad. */
async function conAdmin(fn: (c: pg.Client, admin: number) => Promise<void>): Promise<void> {
  await enTransaccion("app", async (c) => {
    await fijarActor(c, SISTEMA);
    const admin = await crearUsuario(c, { rol: "admin" });
    await fijarActor(c, admin, MOTIVO);
    await fn(c, admin);
  });
}

describe("auditar_cambio: catálogos", () => {
  const CATALOGOS: Array<[string, (c: pg.Client) => Promise<number>, string]> = [
    ["areas", (c) => crearArea(c), "nombre = 'Renombrada'"],
    ["cementerios", async (c) => crearCementerio(c, await crearArea(c, { tipo: "externa" })), "nombre = 'Renombrado'"],
    ["tipos_monumento", async (c) => (await fila<{ id: number }>(c, "SELECT id FROM public.tipos_monumento WHERE codigo = $1", [await crearTipoMonumento(c)])).id, "activo = false"],
    ["tipos_tramite", (c) => crearTipoTramite(c), "activo = false"],
  ];

  it.each(CATALOGOS)("%s: alta y modificación con antes, después, actor y motivo", async (tabla, crear, cambio) => {
    await conAdmin(async (c, admin) => {
      const id = await crear(c);
      await fijarActor(c, admin, "Corrección del catálogo");
      await c.query(`UPDATE public.${tabla} SET ${cambio} WHERE id = $1`, [id]);

      const filas = await cambios(c, tabla, id);
      expect(filas.map((f) => f.operacion)).toEqual(["I", "U"]);
      const [alta, modificacion] = filas;
      expect(alta).toMatchObject({ antes: null, usuario_id: admin, motivo: MOTIVO, de_esta_transaccion: true });
      expect(alta.despues).toMatchObject({ id });
      expect(modificacion).toMatchObject({ usuario_id: admin, motivo: "Corrección del catálogo" });
      expect(modificacion.antes).toEqual(alta.despues);
      expect(modificacion.despues).not.toEqual(modificacion.antes);
    });
  });

  it("feriados: alta, modificación y baja, identificados por la fecha", async () => {
    await conAdmin(async (c, admin) => {
      await c.query("INSERT INTO public.feriados (fecha, descripcion, ambito) VALUES ('2031-07-10', 'Asueto de prueba', 'asueto')");
      await c.query("UPDATE public.feriados SET descripcion = 'Asueto corregido' WHERE fecha = '2031-07-10'");
      await c.query("DELETE FROM public.feriados WHERE fecha = '2031-07-10'");

      const filas = await cambios(c, "feriados", "2031-07-10");
      expect(filas.map((f) => [f.operacion, f.antes?.descripcion ?? null, f.despues?.descripcion ?? null])).toEqual([
        ["I", null, "Asueto de prueba"],
        ["U", "Asueto de prueba", "Asueto corregido"],
        ["D", "Asueto corregido", null],
      ]);
      expect(filas.every((f) => f.usuario_id === admin)).toBe(true);
    });
  });

  it("feriados_anios: el cierre de un año queda registrado", async () => {
    await conAdmin(async (c, admin) => {
      await c.query("INSERT INTO public.feriados_anios (anio) VALUES (2031)");
      await c.query("UPDATE public.feriados_anios SET cerrado = true, cerrado_por = $1, cerrado_en = now() WHERE anio = 2031", [admin]);
      const filas = await cambios(c, "feriados_anios", 2031);
      expect(filas.map((f) => [f.operacion, f.antes?.cerrado ?? null, f.despues?.cerrado ?? null])).toEqual([
        ["I", null, false],
        ["U", false, true],
      ]);
    });
  });

  it("plantillas: alta, edición del borrador y baja", async () => {
    await conAdmin(async (c, admin) => {
      const p = await crearPlantilla(c, await crearTipoTramite(c), { estado: "borrador" });
      await c.query("UPDATE public.plantillas SET nombre = 'Borrador editado' WHERE id = $1", [p.id]);
      await c.query("DELETE FROM public.plantillas WHERE id = $1", [p.id]);
      const filas = await cambios(c, "plantillas", p.id);
      expect(filas.map((f) => [f.operacion, f.antes?.nombre ?? null, f.despues?.nombre ?? null])).toEqual([
        ["I", null, "Plantilla de prueba"],
        ["U", "Plantilla de prueba", "Borrador editado"],
        ["D", "Borrador editado", null],
      ]);
      expect(filas[0].despues).toHaveProperty("definicion");
      expect(filas.every((f) => f.usuario_id === admin)).toBe(true);
    });
  });

  it("un UPDATE que no cambia nada no deja fila", async () => {
    await conAdmin(async (c) => {
      const id = await crearTipoTramite(c);
      await c.query("UPDATE public.tipos_tramite SET nombre = nombre WHERE id = $1", [id]);
      expect((await cambios(c, "tipos_tramite", id)).map((f) => f.operacion)).toEqual(["I"]);
    });
  });

  it("sin motivo, motivo queda NULL", async () => {
    await conAdmin(async (c, admin) => {
      await fijarActor(c, admin, null);
      const id = await crearTipoTramite(c);
      expect((await cambios(c, "tipos_tramite", id))[0].motivo).toBeNull();
    });
  });

  it("sin actor no se escribe configuración", async () => {
    await enTransaccion("app", async (c) => {
      await quitarActor(c);
      const r = await intentar(c, "INSERT INTO public.tipos_tramite (codigo, nombre) VALUES ('SIN_ACTOR', 'Sin actor')");
      expect(errorDe(r)).toMatch(/Falta el actor \(app\.usuario_id\)/);
    });
  });
});

describe("auditar_cambio: usuarios", () => {
  it("registra el alta con id, cuil, área, rol, activo y debe_cambiar_clave, sin nombre, email ni contraseña", async () => {
    await conAdmin(async (c, admin) => {
      const area = await crearArea(c);
      const id = await crearUsuario(c, { area_id: area, rol: "lectura" });
      const [alta] = await cambios(c, "usuarios", id);
      expect(alta.operacion).toBe("I");
      expect(alta.usuario_id).toBe(admin);
      expect(Object.keys(alta.despues ?? {}).sort()).toEqual(["activo", "area_id", "cuil", "debe_cambiar_clave", "id", "rol"]);
      expect(alta.despues).toMatchObject({ id, area_id: area, rol: "lectura", activo: true });
    });
  });

  const CAMBIOS_DE_ACCESO: Array<[string, string, (c: pg.Client) => Promise<unknown>]> = [
    ["el área", "area_id = $2", (c) => crearArea(c)],
    ["el rol", "rol = $2", async () => "admin"],
    ["la baja", "activo = $2", async () => false],
    ["el CUIL", "cuil = $2", async () => cuilFicticio()],
    // Login propio (27/10/2026): un blanqueo (no → sí) o el primer cambio (sí → no).
    ["la contraseña temporal", "debe_cambiar_clave = $2", async () => true],
  ];

  it.each(CAMBIOS_DE_ACCESO)("registra el cambio de %s", async (_que, asignacion, valor) => {
    await conAdmin(async (c) => {
      const id = await crearUsuario(c, { area_id: await crearArea(c) });
      await c.query(`UPDATE public.usuarios SET ${asignacion} WHERE id = $1`, [id, await valor(c)]);
      const filas = await cambios(c, "usuarios", id);
      expect(filas.map((f) => f.operacion)).toEqual(["I", "U"]);
      expect(Object.keys(filas[1].antes ?? {}).sort()).toEqual(["activo", "area_id", "cuil", "debe_cambiar_clave", "id", "rol"]);
      expect(filas[1].antes).not.toEqual(filas[1].despues);
    });
  });

  it.each([
    ["nombre y apellido", "nombre = 'Otro', apellido = 'Distinto'"],
    ["email", "email = 'otro@ejemplo.test'"],
    ["ultimo_ingreso", "ultimo_ingreso = now()"],
    ["cidituc_id", "cidituc_id = 'ficticio-123'"],
    ["sesion_version (salida)", "sesion_version = sesion_version + 1"],
    ["el rol, sin cambiarlo", "rol = rol"],
    // Login propio: el hash (rehecho al ingresar), los fallos y el bloqueo.
    ["clave_hash", "clave_hash = 'scrypt$1024$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'"],
    ["intentos_fallidos", "intentos_fallidos = intentos_fallidos + 1"],
    ["bloqueado_hasta", "bloqueado_hasta = now() + interval '15 minutes', intentos_fallidos = 0"],
  ])("el login no deja filas: %s", async (_que, asignacion) => {
    await conAdmin(async (c) => {
      const id = await crearUsuario(c, { area_id: await crearArea(c) });
      await c.query(`UPDATE public.usuarios SET ${asignacion} WHERE id = $1`, [id]);
      expect((await cambios(c, "usuarios", id)).map((f) => f.operacion)).toEqual(["I"]);
    });
  });

  it("un blanqueo deja la fila de debe_cambiar_clave, pero nunca el hash ni el contador", async () => {
    await conAdmin(async (c) => {
      const id = await crearUsuario(c, { area_id: await crearArea(c) });
      const hash = "scrypt$1024$8$1$QUFBQUFBQUFBQUFBQUFBQUFB$QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJC";
      await c.query("UPDATE public.usuarios SET clave_hash = $2, debe_cambiar_clave = true, intentos_fallidos = 3 WHERE id = $1", [id, hash]);
      const [, blanqueo] = await cambios(c, "usuarios", id);
      expect(blanqueo.antes).toMatchObject({ debe_cambiar_clave: false });
      expect(blanqueo.despues).toMatchObject({ debe_cambiar_clave: true });
      for (const lado of [blanqueo.antes, blanqueo.despues]) {
        expect(lado).not.toHaveProperty("clave_hash");
        expect(lado).not.toHaveProperty("intentos_fallidos");
      }
      const todo = await c.query("SELECT count(*)::int AS n FROM auditoria.cambios WHERE antes::text LIKE '%scrypt%' OR despues::text LIKE '%scrypt%'");
      expect(todo.rows[0].n).toBe(0);
    });
  });

  it("si el login cambia también el rol, la fila no lleva nombre ni email", async () => {
    await conAdmin(async (c) => {
      const id = await crearUsuario(c, { area_id: await crearArea(c) });
      await c.query("UPDATE public.usuarios SET nombre = 'Otro', email = 'otro@ejemplo.test', rol = 'lectura' WHERE id = $1", [id]);
      const [, modificacion] = await cambios(c, "usuarios", id);
      expect(modificacion.despues).toMatchObject({ rol: "lectura" });
      expect(modificacion.despues).not.toHaveProperty("nombre");
      expect(modificacion.despues).not.toHaveProperty("email");
    });
  });
});

describe("auditoria.cambios no guarda expedientes ni personas", () => {
  it("las altas de expedientes, movimientos y personas no se auditan", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, MOTIVO);
      const e = await crearEscenario(c);
      const exp = await crearExpediente(c, e, { numero_municipal: "12.345/2026" });
      await crearMovimiento(c, exp.id);
      await crearPersona(c, exp.id);
      await c.query("UPDATE public.expedientes SET observaciones = 'Cambio' WHERE id = $1", [exp.id]);
      const n = await fila<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM auditoria.cambios WHERE tabla IN ('expedientes', 'movimientos', 'expediente_personas')",
      );
      expect(n.n).toBe(0);
    });
  });
});

describe("auditoria: solo inserción para la app", () => {
  it.each([
    "UPDATE auditoria.cambios SET motivo = 'reescrito'",
    "DELETE FROM auditoria.cambios",
    "TRUNCATE auditoria.cambios",
    "UPDATE auditoria.accesos SET detalle = '{}'",
    "DELETE FROM auditoria.accesos",
    "TRUNCATE auditoria.accesos",
  ])("%s", async (sentencia) => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, MOTIVO);
      await crearTipoTramite(c);
      await c.query("INSERT INTO auditoria.accesos (usuario_id, accion, detalle) VALUES (1, 'exportar', '{\"prueba\": true}')");
      const r = await intentar(c, sentencia);
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
    });
  });

  it("accesos: la acción y el detalle tienen valores acotados", async () => {
    await enTransaccion("app", async (c) => {
      const accionInvalida = await intentar(c, "INSERT INTO auditoria.accesos (usuario_id, accion) VALUES (1, 'borrar')");
      expect(errorDe(accionInvalida)).toMatch(/accesos_accion_check/);
      const detalleInvalido = await intentar(c, "INSERT INTO auditoria.accesos (usuario_id, accion, detalle) VALUES (1, 'imprimir', '[]')");
      expect(errorDe(detalleInvalido)).toMatch(/accesos_detalle_check/);
    });
  });
});
