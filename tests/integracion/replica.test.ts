// session_replication_role = replica no apaga ningún trigger (propuesta 2.11:
// todos ENABLE ALWAYS). Con replica, PostgreSQL saltea los triggers comunes y
// las FK; los de CementerIA se tienen que seguir disparando.
//
// La inmutabilidad de movimientos en replica está en movimientos.test.ts; acá
// van los demás triggers. Se prueba con el superusuario (que es quien puede
// poner replica) y con un rol de prueba que tiene permiso para ponerla.

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
  type Escenario,
  type FilaPersona,
  type RolDePrueba,
} from "./escenario";
import { SISTEMA, enTransaccion, fijarActor, intentar, unico } from "./helper";

const MOTIVO = "Prueba con replica";

interface Contexto {
  e: Escenario;
  expedienteId: string;
  persona: FilaPersona;
}

type Prueba = (c: pg.Client, x: Contexto) => Promise<void>;

/** Arma los datos con el modo normal y recién después pasa la sesión a replica. */
async function preparar(c: pg.Client): Promise<Contexto> {
  await fijarActor(c, SISTEMA, MOTIVO);
  const e = await crearEscenario(c);
  const exp = await crearExpediente(c, e);
  const persona = await crearPersona(c, exp.id);
  await c.query("SET LOCAL session_replication_role = replica");
  const modo = await fila<{ session_replication_role: string }>(c, "SHOW session_replication_role");
  expect(modo.session_replication_role).toBe("replica");
  return { e, expedienteId: exp.id, persona };
}

const PRUEBAS: Array<[string, Prueba]> = [
  [
    "movimientos_sellar: exige el actor y pisa secuencia y fecha de registro",
    async (c, x) => {
      const m = await crearMovimiento(c, x.expedienteId, { secuencia: 50, registrado_en: "2001-01-01T00:00:00Z" });
      const r = await fila<{ secuencia: number; es_now: boolean }>(c, "SELECT secuencia, registrado_en = now() AS es_now FROM public.movimientos WHERE id = $1", [m.id]);
      expect(r).toEqual({ secuencia: 2, es_now: true });
      const ajeno = await intentar(c, "INSERT INTO public.movimientos (expediente_id, tipo, fecha_efectiva, usuario_id, comando_id) VALUES ($1, 'nota', now(), $2, gen_random_uuid())", [x.expedienteId, x.e.operador]);
      expect(errorDe(ajeno)).toMatch(/el actor de la transacción es/);
    },
  ],
  [
    "expediente_personas_proteger: rechaza la edición y el DELETE",
    async (c, x) => {
      const edicion = await intentar(c, "UPDATE public.expediente_personas SET telefono = '0381 999-9999' WHERE id = $1", [x.persona.id]);
      expect(errorDe(edicion)).toMatch(/solo admite la baja/);
      // El superusuario y el rol de prueba tienen DELETE: lo frena el trigger.
      const borrado = await intentar(c, "DELETE FROM public.expediente_personas WHERE id = $1", [x.persona.id]);
      expect(errorDe(borrado)).toMatch(/no admite DELETE/);
      const nacida = await intentar(c, "INSERT INTO public.expediente_personas (expediente_id, rol, orden, apellido, nombres, vigente, creada_mov_id) VALUES ($1, 'titular', 9, 'PRUEBA', 'Dada de baja', false, $2)", [x.expedienteId, x.persona.creada_mov_id]);
      expect(errorDe(nacida)).toMatch(/nace vigente/);
    },
  ],
  [
    "expediente_personas_proteger: la supresión sigue exigiendo motivo",
    async (c, x) => {
      await fijarActor(c, SISTEMA, null);
      const r = await intentar(c, "UPDATE public.expediente_personas SET apellido = NULL, nombres = NULL, dni = NULL, telefono = NULL, email = NULL, domicilio = NULL, vinculo = NULL, suprimida_en = now() WHERE id = $1", [x.persona.id]);
      expect(errorDe(r)).toMatch(/exige motivo/);
    },
  ],
  [
    "plantillas_congelar: una publicada no cambia ni se borra",
    async (c, x) => {
      const cambio = await intentar(c, "UPDATE public.plantillas SET definicion = '{}' WHERE id = $1", [x.e.plantilla]);
      expect(errorDe(cambio)).toMatch(/no se modifica/);
      const borrado = await intentar(c, "DELETE FROM public.plantillas WHERE id = $1", [x.e.plantilla]);
      expect(errorDe(borrado)).toMatch(/Solo se borran borradores/);
    },
  ],
  [
    "plantillas_congelar: una plantilla no nace publicada",
    async (c, x) => {
      const r = await intentar(c, "INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, estado, definicion, notas_cambio, creado_por, publicado_por, publicado_en) VALUES ($1, 1, $2, 'Nace publicada', 'publicada', '{}', 'Notas', 1, 1, now())", [unico("PL"), x.e.tipoTramite]);
      expect(errorDe(r)).toMatch(/nace como borrador/);
    },
  ],
  [
    "areas_tipo_coherente y cementerios_area_externa: el tipo de área sigue siendo coherente",
    async (c, x) => {
      const conUsuarios = await intentar(c, "UPDATE public.areas SET tipo = 'externa' WHERE id = $1", [x.e.areaInterna]);
      expect(errorDe(conUsuarios)).toMatch(/tiene usuarios: no puede pasar a externa/);
      const deCementerio = await intentar(c, "UPDATE public.areas SET tipo = 'interna' WHERE id = $1", [x.e.areaExterna]);
      expect(errorDe(deCementerio)).toMatch(/es la de un cementerio/);
      const cementerio = await intentar(c, "UPDATE public.cementerios SET area_id = $2 WHERE id = $1", [x.e.cementerio, x.e.areaDestino]);
      expect(errorDe(cementerio)).toMatch(/tiene que ser externa/);
    },
  ],
  [
    "usuarios_area_interna: rechaza un área externa",
    async (c, x) => {
      const r = await intentar(c, "UPDATE public.usuarios SET area_id = $2 WHERE id = $1", [x.e.operador, x.e.areaExterna]);
      expect(errorDe(r)).toMatch(/no puede pertenecer a un área externa/);
    },
  ],
  [
    "auditar_cambio: registra el cambio y exige actor",
    async (c, x) => {
      await c.query("UPDATE public.areas SET nombre = 'Cambiada en replica' WHERE id = $1", [x.e.areaInterna]);
      const n = await fila<{ n: number }>(c, "SELECT count(*)::int AS n FROM auditoria.cambios WHERE tabla = 'areas' AND registro_id = $1 AND operacion = 'U'", [String(x.e.areaInterna)]);
      expect(n.n).toBe(1);
      await quitarActor(c);
      const sinActor = await intentar(c, "UPDATE public.areas SET nombre = 'Sin actor' WHERE id = $1", [x.e.areaInterna]);
      expect(errorDe(sinActor)).toMatch(/Falta el actor/);
    },
  ],
  [
    "expedientes_preparar: normaliza, controla fecha_inicio y exige actor",
    async (c, x) => {
      await c.query("UPDATE public.expedientes SET numero_municipal = '12.345/2026' WHERE id = $1", [x.expedienteId]);
      const exp = await fila<{ numero_municipal_norm: string }>(c, "SELECT numero_municipal_norm FROM public.expedientes WHERE id = $1", [x.expedienteId]);
      expect(exp.numero_municipal_norm).toBe("123452026");
      const futura = await intentar(c, "UPDATE public.expedientes SET fecha_inicio = (now() AT TIME ZONE 'America/Argentina/Tucuman')::date + 1 WHERE id = $1", [x.expedienteId]);
      expect(errorDe(futura)).toMatch(/no puede ser posterior a hoy/);
      await quitarActor(c);
      const sinActor = await intentar(c, "UPDATE public.expedientes SET observaciones = 'Sin actor' WHERE id = $1", [x.expedienteId]);
      expect(errorDe(sinActor)).toMatch(/Falta el actor/);
    },
  ],
];

describe("con session_replication_role = replica los triggers siguen activos", () => {
  describe("superusuario", () => {
    it.each(PRUEBAS)("%s", async (_que, prueba) => {
      await enTransaccion("superusuario", async (c) => prueba(c, await preparar(c)));
    });
  });

  describe("rol de prueba con permiso para replica", () => {
    let rol: RolDePrueba | undefined;
    beforeAll(async () => {
      rol = await crearRolDePrueba("replica", [
        "GRANT cementeria_app TO {rol}",
        "GRANT SET ON PARAMETER session_replication_role TO {rol}",
        // DELETE de más, para que lo que frene sea el trigger.
        "GRANT DELETE ON public.expediente_personas TO {rol}",
      ]);
    });
    afterAll(async () => borrarRolDePrueba(rol));

    it.each(PRUEBAS)("%s", async (_que, prueba) => {
      if (!rol) throw new Error("No se creó el rol de prueba");
      await enTransaccionCon(rol.url, async (c) => prueba(c, await preparar(c)));
    });

    it("sin GRANT SET, cementeria_app no puede pasar a replica", async () => {
      await enTransaccion("app", async (c) => {
        const r = await intentar(c, "SET LOCAL session_replication_role = replica");
        expect(r).toMatchObject({ ok: false, codigo: "42501" });
      });
    });
  });

  it("control: replica sí apaga las FK (los triggers internos no son ALWAYS)", async () => {
    // Si este test fallara, replica no estaría haciendo efecto y los demás
    // pasarían sin probar nada.
    await enTransaccion("superusuario", async (c) => {
      const x = await preparar(c);
      const sinFk = await intentar(c, "UPDATE public.expedientes SET area_actual_id = 32000 WHERE id = $1", [x.expedienteId]);
      expect(sinFk).toMatchObject({ ok: true });
      await c.query("SET LOCAL session_replication_role = origin");
      const conFk = await intentar(c, "UPDATE public.expedientes SET area_actual_id = 32001 WHERE id = $1", [x.expedienteId]);
      expect(conFk).toMatchObject({ ok: false, codigo: "23503" });
    });
  });
});
