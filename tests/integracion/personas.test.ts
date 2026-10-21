// expediente_personas: copia versionada de las personas (propuesta 2.7 y 2.13(b)).

import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  crearEscenario,
  crearExpediente,
  crearMovimiento,
  crearPersona,
  errorDe,
  fila,
  type Escenario,
  type FilaPersona,
} from "./escenario";
import { SISTEMA, enTransaccion, fijarActor, intentar, type Rol } from "./helper";

const MOTIVO = "Datos de un tercero cargados por error";
const SOLO_BAJA_O_SUPRESION = /solo admite la baja \(vigente\/reemplazada_por_id\) o la supresión/;

const SUPRIMIR = `
  UPDATE public.expediente_personas
     SET apellido = NULL, nombres = NULL, dni = NULL, telefono = NULL,
         email = NULL, domicilio = NULL, vinculo = NULL, suprimida_en = now()
   WHERE id = $1`;

interface Contexto {
  e: Escenario;
  expedienteId: string;
  persona: FilaPersona;
}

async function conPersona(rol: Rol, fn: (c: pg.Client, x: Contexto) => Promise<void>): Promise<void> {
  await enTransaccion(rol, async (c) => {
    await fijarActor(c, SISTEMA, MOTIVO);
    const e = await crearEscenario(c);
    const exp = await crearExpediente(c, e);
    const persona = await crearPersona(c, exp.id);
    await fn(c, { e, expedienteId: exp.id, persona });
  });
}

async function leer(c: pg.Client, id: string): Promise<FilaPersona> {
  return fila<FilaPersona>(c, "SELECT * FROM public.expediente_personas WHERE id = $1", [id]);
}

describe("expediente_personas_proteger: baja y reemplazo", () => {
  it("arma nombre_norm al insertar", async () => {
    await conPersona("app", async (c, x) => {
      const p = await crearPersona(c, x.expedienteId, { rol: "solicitante", apellido: "GONZÁLEZ", nombres: "María-José  Peña" });
      expect(p.nombre_norm).toBe("gonzalez maria jose pena");
    });
  });

  it("quitar una persona es pasarla a vigente = false", async () => {
    await conPersona("app", async (c, x) => {
      const r = await intentar(c, "UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id]);
      expect(r).toMatchObject({ ok: true });
      expect((await leer(c, x.persona.id)).vigente).toBe(false);
    });
  });

  it("editar es dar de baja la versión vieja, insertar la nueva y enlazarlas", async () => {
    await conPersona("app", async (c, x) => {
      // El índice único de vigentes obliga a este orden.
      const duplicada = await intentar(c, "INSERT INTO public.expediente_personas (expediente_id, rol, orden, apellido, nombres, creada_mov_id) VALUES ($1, 'titular', 1, 'OTRA', 'Versión', $2)", [x.expedienteId, x.persona.creada_mov_id]);
      expect(errorDe(duplicada)).toMatch(/expediente_personas_vigente_key/);

      expect(await intentar(c, "UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id])).toMatchObject({ ok: true });
      const nueva = await crearPersona(c, x.expedienteId, { telefono: "0381 111-1111" });
      expect(await intentar(c, "UPDATE public.expediente_personas SET reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, nueva.id])).toMatchObject({ ok: true });

      const vieja = await leer(c, x.persona.id);
      expect(vieja).toMatchObject({ vigente: false, reemplazada_por_id: nueva.id, apellido: "PRUEBA" });
    });
  });

  it("la baja y el reemplazo también entran en un solo UPDATE", async () => {
    await conPersona("app", async (c, x) => {
      const otra = await crearPersona(c, x.expedienteId, { orden: 2 });
      const r = await intentar(c, "UPDATE public.expediente_personas SET vigente = false, reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, otra.id]);
      expect(r).toMatchObject({ ok: true });
    });
  });

  it("una persona dada de baja no vuelve a vigente", async () => {
    await conPersona("app", async (c, x) => {
      await c.query("UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id]);
      const r = await intentar(c, "UPDATE public.expediente_personas SET vigente = true WHERE id = $1", [x.persona.id]);
      expect(errorDe(r)).toMatch(/no vuelve a vigente/);
    });
  });

  it("no se fija reemplazada_por_id en una persona vigente", async () => {
    await conPersona("app", async (c, x) => {
      const otra = await crearPersona(c, x.expedienteId, { orden: 2 });
      const r = await intentar(c, "UPDATE public.expediente_personas SET reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, otra.id]);
      expect(errorDe(r)).toMatch(/Primero se da de baja la versión vieja/);
    });
  });

  it("reemplazada_por_id se fija una sola vez", async () => {
    await conPersona("app", async (c, x) => {
      await c.query("UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id]);
      const v2 = await crearPersona(c, x.expedienteId);
      await c.query("UPDATE public.expediente_personas SET reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, v2.id]);
      await c.query("UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [v2.id]);
      const v3 = await crearPersona(c, x.expedienteId);
      for (const nuevo of [v3.id, null]) {
        const r = await intentar(c, "UPDATE public.expediente_personas SET reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, nuevo]);
        expect(errorDe(r)).toMatch(/ya fue reemplazada/);
      }
    });
  });

  it("el reemplazo se insertó después: la cadena de versiones no tiene ciclos", async () => {
    await conPersona("app", async (c, x) => {
      // A reemplazada por B, y después B dada de baja apuntando a A.
      await c.query("UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id]);
      const b = await crearPersona(c, x.expedienteId);
      await c.query("UPDATE public.expediente_personas SET reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, b.id]);
      const ciclo = await intentar(c, "UPDATE public.expediente_personas SET vigente = false, reemplazada_por_id = $2 WHERE id = $1", [b.id, x.persona.id]);
      expect(errorDe(ciclo)).toMatch(/insertada después que esta/);

      // Tampoco una versión anterior que no forma ciclo.
      const otra = await crearPersona(c, x.expedienteId, { orden: 2 });
      const anterior = await intentar(c, "UPDATE public.expediente_personas SET vigente = false, reemplazada_por_id = $2 WHERE id = $1", [otra.id, b.id]);
      expect(errorDe(anterior)).toMatch(/insertada después que esta/);
    });
  });

  it("el reemplazo es otra persona del mismo expediente", async () => {
    await conPersona("app", async (c, x) => {
      const otroExpediente = await crearExpediente(c, x.e);
      const ajena = await crearPersona(c, otroExpediente.id);
      await c.query("UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id]);
      for (const reemplazo of [x.persona.id, ajena.id]) {
        const r = await intentar(c, "UPDATE public.expediente_personas SET reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, reemplazo]);
        expect(errorDe(r)).toMatch(/otra persona del mismo expediente/);
      }
    });
  });

  it("un solo contacto vigente por expediente", async () => {
    await conPersona("app", async (c, x) => {
      await crearPersona(c, x.expedienteId, { rol: "solicitante", es_contacto: true });
      const segundo = await intentar(c, "INSERT INTO public.expediente_personas (expediente_id, rol, orden, apellido, nombres, es_contacto, creada_mov_id) VALUES ($1, 'solicitante', 2, 'OTRO', 'Contacto', true, $2)", [x.expedienteId, x.persona.creada_mov_id]);
      expect(errorDe(segundo)).toMatch(/expediente_personas_contacto_key/);
    });
  });
});

describe("expediente_personas_proteger: una versión nace vigente y con actor", () => {
  const NACIMIENTOS: Array<[string, string, (x: Contexto) => unknown]> = [
    ["dada de baja", "vigente", () => false],
    ["ya reemplazada", "reemplazada_por_id", (x) => x.persona.id],
    ["ya suprimida", "suprimida_en", () => new Date()],
  ];

  it.each(NACIMIENTOS)("no nace %s", async (_como, columna, valor) => {
    await conPersona("app", async (c, x) => {
      const r = await intentar(
        c,
        `INSERT INTO public.expediente_personas (expediente_id, rol, orden, apellido, nombres, creada_mov_id, ${columna}) VALUES ($1, 'solicitante', 1, 'PRUEBA', 'Ficticia', $2, $3)`,
        [x.expedienteId, x.persona.creada_mov_id, valor(x)],
      );
      expect(errorDe(r)).toMatch(/nace vigente, sin reemplazo y sin suprimir/);
    });
  });

  it("sin actor no se inserta ni se modifica", async () => {
    await conPersona("app", async (c, x) => {
      await c.query("SELECT set_config('app.usuario_id', '', true)");
      const alta = await intentar(c, "INSERT INTO public.expediente_personas (expediente_id, rol, orden, apellido, nombres, creada_mov_id) VALUES ($1, 'solicitante', 1, 'PRUEBA', 'Sin actor', $2)", [x.expedienteId, x.persona.creada_mov_id]);
      expect(errorDe(alta)).toMatch(/Falta el actor/);
      const baja = await intentar(c, "UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id]);
      expect(errorDe(baja)).toMatch(/Falta el actor/);
    });
  });
});

describe("expediente_personas_proteger: supresión (Ley 25.326)", () => {
  it("con motivo, borra los datos personales y conserva el rol y la constancia", async () => {
    await conPersona("app", async (c, x) => {
      expect(await intentar(c, SUPRIMIR, [x.persona.id])).toMatchObject({ ok: true });
      const p = await leer(c, x.persona.id);
      expect(p).toMatchObject({
        apellido: null,
        nombres: null,
        dni: null,
        rol: "titular",
        orden: 1,
        vigente: true,
        creada_mov_id: x.persona.creada_mov_id,
        // Tampoco queda una copia normalizada del nombre.
        nombre_norm: "",
      });
      expect(p.suprimida_en).toBeInstanceOf(Date);
      const resto = await fila<{ telefono: string | null; email: string | null; domicilio: string | null; vinculo: string | null }>(c, "SELECT telefono, email, domicilio, vinculo FROM public.expediente_personas WHERE id = $1", [x.persona.id]);
      expect(resto).toEqual({ telefono: null, email: null, domicilio: null, vinculo: null });
    });
  });

  it("sin app.motivo se rechaza", async () => {
    await conPersona("app", async (c, x) => {
      for (const motivo of [null, "   "]) {
        await fijarActor(c, SISTEMA, motivo);
        expect(errorDe(await intentar(c, SUPRIMIR, [x.persona.id]))).toMatch(/exige motivo \(app\.motivo\)/);
      }
    });
  });

  it("una supresión parcial se rechaza", async () => {
    await conPersona("app", async (c, x) => {
      const parciales = [
        "UPDATE public.expediente_personas SET apellido = NULL, nombres = NULL, suprimida_en = now() WHERE id = $1",
        "UPDATE public.expediente_personas SET apellido = NULL, nombres = NULL, dni = NULL, telefono = NULL, email = NULL, domicilio = NULL, suprimida_en = now() WHERE id = $1",
        "UPDATE public.expediente_personas SET suprimida_en = now() WHERE id = $1",
        // Borrar los datos sin dejar constancia tampoco.
        "UPDATE public.expediente_personas SET apellido = NULL, nombres = NULL, dni = NULL, telefono = NULL, email = NULL, domicilio = NULL, vinculo = NULL WHERE id = $1",
      ];
      for (const sentencia of parciales) {
        // El mensaje del trigger, no el CHECK de nombre: el trigger corre antes
        // y es el que tiene que frenar la supresión a medias.
        expect(errorDe(await intentar(c, sentencia, [x.persona.id])), sentencia).toMatch(SOLO_BAJA_O_SUPRESION);
      }
    });
  });

  it("una persona suprimida no se vuelve a suprimir ni a completar", async () => {
    await conPersona("app", async (c, x) => {
      await c.query(SUPRIMIR, [x.persona.id]);
      for (const sentencia of [
        "UPDATE public.expediente_personas SET suprimida_en = now() + interval '1 day' WHERE id = $1",
        "UPDATE public.expediente_personas SET apellido = 'DE NUEVO', nombres = 'Recargado' WHERE id = $1",
        "UPDATE public.expediente_personas SET suprimida_en = NULL WHERE id = $1",
      ]) {
        expect(errorDe(await intentar(c, sentencia, [x.persona.id])), sentencia).toMatch(SOLO_BAJA_O_SUPRESION);
      }
    });
  });

  it("también se suprime una versión ya reemplazada (si no, el dato seguiría en la versión vieja)", async () => {
    await conPersona("app", async (c, x) => {
      await c.query("UPDATE public.expediente_personas SET vigente = false WHERE id = $1", [x.persona.id]);
      const nueva = await crearPersona(c, x.expedienteId, { telefono: "0381 111-1111" });
      await c.query("UPDATE public.expediente_personas SET reemplazada_por_id = $2 WHERE id = $1", [x.persona.id, nueva.id]);
      for (const id of [x.persona.id, nueva.id]) {
        expect(await intentar(c, SUPRIMIR, [id]), id).toMatchObject({ ok: true });
      }
      const vieja = await leer(c, x.persona.id);
      expect(vieja).toMatchObject({ apellido: null, dni: null, vigente: false, reemplazada_por_id: nueva.id });
    });
  });

  it("baja y supresión no se mezclan en un mismo UPDATE", async () => {
    await conPersona("app", async (c, x) => {
      const r = await intentar(c, SUPRIMIR.replace("suprimida_en = now()", "suprimida_en = now(), vigente = false"), [x.persona.id]);
      expect(errorDe(r)).toMatch(SOLO_BAJA_O_SUPRESION);
    });
  });
});

describe("expediente_personas_proteger: cualquier otro UPDATE se rechaza", () => {
  const CAMBIOS: Array<[string, string]> = [
    ["apellido", "apellido = 'OTRO'"],
    ["nombres", "nombres = 'Otro Nombre'"],
    ["dni", "dni = '99000002'"],
    ["teléfono", "telefono = '0381 999-9999'"],
    ["WhatsApp", "telefono_whatsapp = true"],
    ["email", "email = 'otra@ejemplo.test'"],
    ["domicilio", "domicilio = 'Otra Calle 1'"],
    ["vínculo", "vinculo = 'hijo'"],
    ["fallecido", "fallecido = true, fecha_defuncion = DATE '2020-01-01'"],
    ["contacto", "es_contacto = true"],
    ["rol", "rol = 'solicitante'"],
    ["orden", "orden = 2"],
    ["una baja con otro cambio", "vigente = false, telefono = '0381 999-9999'"],
  ];

  it.each(CAMBIOS)("%s", async (_campo, asignacion) => {
    await conPersona("app", async (c, x) => {
      const r = await intentar(c, `UPDATE public.expediente_personas SET ${asignacion} WHERE id = $1`, [x.persona.id]);
      expect(errorDe(r)).toMatch(SOLO_BAJA_O_SUPRESION);
    });
  });

  it("mover la persona a otro expediente", async () => {
    await conPersona("app", async (c, x) => {
      const otro = await crearExpediente(c, x.e);
      const r = await intentar(c, "UPDATE public.expediente_personas SET expediente_id = $2 WHERE id = $1", [x.persona.id, otro.id]);
      expect(errorDe(r)).toMatch(SOLO_BAJA_O_SUPRESION);
    });
  });

  it("cambiar el movimiento que la creó", async () => {
    await conPersona("app", async (c, x) => {
      const edicion = await crearMovimiento(c, x.expedienteId, { tipo: "edicion" });
      const r = await intentar(c, "UPDATE public.expediente_personas SET creada_mov_id = $2 WHERE id = $1", [x.persona.id, edicion.id]);
      expect(errorDe(r)).toMatch(SOLO_BAJA_O_SUPRESION);
    });
  });

  it("nombre_norm lo arma el trigger: escribirlo no tiene efecto", async () => {
    await conPersona("app", async (c, x) => {
      await c.query("UPDATE public.expediente_personas SET nombre_norm = 'falso' WHERE id = $1", [x.persona.id]);
      expect((await leer(c, x.persona.id)).nombre_norm).toBe("prueba persona ficticia");
    });
  });
});

describe("expediente_personas: CHECKs (2.7)", () => {
  const INSERTAR = `
    INSERT INTO public.expediente_personas (expediente_id, rol, orden, apellido, nombres, dni, fallecido, fecha_defuncion, creada_mov_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

  interface Persona {
    rol?: string;
    apellido?: string | null;
    nombres?: string | null;
    dni?: string | null;
    fallecido?: boolean;
    fecha_defuncion?: string | null;
  }

  async function insertarPersona(c: pg.Client, x: Contexto, orden: number, p: Persona) {
    return intentar(c, INSERTAR, [
      x.expedienteId,
      p.rol ?? "solicitante",
      orden,
      p.apellido === undefined ? "PRUEBA" : p.apellido,
      p.nombres === undefined ? "Ficticia" : p.nombres,
      p.dni ?? null,
      p.fallecido ?? false,
      p.fecha_defuncion ?? null,
      x.persona.creada_mov_id,
    ]);
  }

  it("el rol va en minúsculas y guion bajo", async () => {
    await conPersona("app", async (c, x) => {
      expect(await insertarPersona(c, x, 1, { rol: "cesionario" })).toMatchObject({ ok: true });
      for (const [i, rol] of ["Titular", "co-titular", "difunto1", ""].entries()) {
        expect(errorDe(await insertarPersona(c, x, 10 + i, { rol })), rol).toMatch(/expediente_personas_rol_check/);
      }
    });
  });

  it("apellido y nombres son obligatorios salvo en una persona suprimida", async () => {
    await conPersona("app", async (c, x) => {
      expect(errorDe(await insertarPersona(c, x, 1, { apellido: null }))).toMatch(/expediente_personas_nombre_check/);
      expect(errorDe(await insertarPersona(c, x, 2, { nombres: null }))).toMatch(/expediente_personas_nombre_check/);
    });
  });

  it("el DNI son de 6 a 9 dígitos, sin puntos", async () => {
    await conPersona("app", async (c, x) => {
      for (const [i, dni] of ["123456", "99000003", "123456789"].entries()) {
        expect(await insertarPersona(c, x, 1 + i, { dni }), dni).toMatchObject({ ok: true });
      }
      for (const [i, dni] of ["12345", "1234567890", "99.000.004", "99000004X", ""].entries()) {
        expect(errorDe(await insertarPersona(c, x, 10 + i, { dni })), dni).toMatch(/expediente_personas_dni_check/);
      }
    });
  });

  it("la fecha de defunción va solo si la persona es fallecida", async () => {
    await conPersona("app", async (c, x) => {
      expect(errorDe(await insertarPersona(c, x, 1, { fecha_defuncion: "2020-01-01" }))).toMatch(/expediente_personas_defuncion_check/);
      expect(await insertarPersona(c, x, 2, { fallecido: true, fecha_defuncion: "2020-01-01" })).toMatchObject({ ok: true });
      expect(await insertarPersona(c, x, 3, { fallecido: true })).toMatchObject({ ok: true });
    });
  });
});

describe("expediente_personas: no hay DELETE", () => {
  it("la app no tiene el privilegio", async () => {
    await conPersona("app", async (c, x) => {
      const r = await intentar(c, "DELETE FROM public.expediente_personas WHERE id = $1", [x.persona.id]);
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
    });
  });

  it("y al owner lo frena el trigger", async () => {
    await conPersona("owner", async (c, x) => {
      const r = await intentar(c, "DELETE FROM public.expediente_personas WHERE id = $1", [x.persona.id]);
      expect(errorDe(r)).toMatch(/no admite DELETE/);
    });
  });
});

describe("expediente_personas: personas jurídicas (semana 4, *_personas_juridicas)", () => {
  // CUIT ficticio con dígito verificador válido (rango 30-99999…, como la semilla).
  const CUIT = "30999990130";
  const INSERTAR = `
    INSERT INTO public.expediente_personas
      (expediente_id, rol, orden, tipo_persona, apellido, nombres, dni, razon_social, cuit, fallecido, email, creada_mov_id)
    VALUES ($1, 'titular', $2, $3, $4, $5, $6, $7, $8, $9, 'asociacion@ejemplo.test', $10)`;
  const SUPRIMIR_TODO = `
    UPDATE public.expediente_personas
       SET apellido = NULL, nombres = NULL, dni = NULL, razon_social = NULL, cuit = NULL, telefono = NULL,
           email = NULL, domicilio = NULL, vinculo = NULL, suprimida_en = now()
     WHERE id = $1`;

  interface Juridica {
    tipo?: string;
    apellido?: string | null;
    nombres?: string | null;
    dni?: string | null;
    razon_social?: string | null;
    cuit?: string | null;
    fallecido?: boolean;
  }

  async function insertar(c: pg.Client, x: Contexto, orden: number, p: Juridica = {}) {
    return intentar(c, `${INSERTAR} RETURNING id, nombre_norm, tipo_persona`, [
      x.expedienteId,
      orden,
      p.tipo ?? "juridica",
      p.apellido ?? null,
      p.nombres ?? null,
      p.dni ?? null,
      p.razon_social === undefined ? "Asociación Ficticia de Socorros Mutuos" : p.razon_social,
      p.cuit === undefined ? CUIT : p.cuit,
      p.fallecido ?? false,
      x.persona.creada_mov_id,
    ]);
  }

  it("razón social y CUIT, sin apellido ni DNI; nombre_norm sale de la razón social", async () => {
    await conPersona("app", async (c, x) => {
      const r = await insertar(c, x, 2);
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect(r.filas[0]).toMatchObject({ tipo_persona: "juridica", nombre_norm: "asociacion ficticia de socorros mutuos" });
      // Las existentes (y las nuevas sin decir nada) son personas físicas.
      expect((await fila<{ tipo_persona: string }>(c, "SELECT tipo_persona FROM public.expediente_personas WHERE id = $1", [x.persona.id])).tipo_persona).toBe("fisica");
    });
  });

  it("el CUIT tiene 11 dígitos y el dígito verificador correcto (f_cuit_valido)", async () => {
    await conPersona("app", async (c, x) => {
      for (const [i, cuit] of ["30999990131", "3099999013", "30-99999013-0", "3099999013X"].entries()) {
        expect(errorDe(await insertar(c, x, 10 + i, { cuit })), cuit).toMatch(/expediente_personas_cuit_check/);
      }
      const v = await fila<{ ok: boolean; mal: boolean; nulo: boolean | null }>(
        c,
        "SELECT public.f_cuit_valido('30999990130') AS ok, public.f_cuit_valido('20-3011') AS mal, public.f_cuit_valido(NULL) AS nulo",
      );
      expect(v).toEqual({ ok: true, mal: false, nulo: null });
    });
  });

  it("una jurídica necesita razón social y CUIT", async () => {
    await conPersona("app", async (c, x) => {
      expect(errorDe(await insertar(c, x, 2, { razon_social: null }))).toMatch(/expediente_personas_nombre_check/);
      expect(errorDe(await insertar(c, x, 3, { cuit: null }))).toMatch(/expediente_personas_nombre_check/);
    });
  });

  it("cada tipo con sus datos: una jurídica no tiene apellido, DNI ni fallece; una física no tiene razón social ni CUIT", async () => {
    await conPersona("app", async (c, x) => {
      expect(errorDe(await insertar(c, x, 2, { apellido: "PRUEBA" }))).toMatch(/expediente_personas_tipo_datos_check/);
      expect(errorDe(await insertar(c, x, 3, { dni: "99000009" }))).toMatch(/expediente_personas_tipo_datos_check/);
      expect(errorDe(await insertar(c, x, 4, { fallecido: true }))).toMatch(/expediente_personas_tipo_datos_check/);
      const fisicaConCuit = { tipo: "fisica", apellido: "PRUEBA", nombres: "Ficticia", razon_social: null };
      expect(errorDe(await insertar(c, x, 5, fisicaConCuit))).toMatch(/expediente_personas_tipo_datos_check/);
      // PostgreSQL prueba los CHECK por nombre: el de nombre falla antes que el de tipo.
      expect(errorDe(await insertar(c, x, 6, { tipo: "otra" }))).toMatch(/expediente_personas_(nombre|tipo_persona)_check/);
    });
  });

  it("el tipo no cambia con un UPDATE: se corrige con una versión nueva", async () => {
    await conPersona("app", async (c, x) => {
      const r = await intentar(
        c,
        "UPDATE public.expediente_personas SET tipo_persona = 'juridica', apellido = NULL, nombres = NULL, dni = NULL, razon_social = 'X', cuit = $2 WHERE id = $1",
        [x.persona.id, CUIT],
      );
      expect(errorDe(r)).toMatch(SOLO_BAJA_O_SUPRESION);
    });
  });

  it("supresión de una jurídica: también la razón social y el CUIT; conserva el tipo", async () => {
    await conPersona("app", async (c, x) => {
      const r = await insertar(c, x, 2);
      if (!r.ok) throw new Error(r.error);
      const id = String(r.filas[0].id);
      // Sin borrar el CUIT no es una supresión: la rechaza el trigger.
      expect(errorDe(await intentar(c, SUPRIMIR, [id]))).toMatch(SOLO_BAJA_O_SUPRESION);
      expect(await intentar(c, SUPRIMIR_TODO, [id])).toMatchObject({ ok: true });
      const p = await fila<{ razon_social: string | null; cuit: string | null; tipo_persona: string; nombre_norm: string }>(
        c,
        "SELECT razon_social, cuit, tipo_persona, nombre_norm FROM public.expediente_personas WHERE id = $1",
        [id],
      );
      expect(p).toEqual({ razon_social: null, cuit: null, tipo_persona: "juridica", nombre_norm: "" });
      // Una física se suprime igual que antes.
      expect(await intentar(c, SUPRIMIR, [x.persona.id])).toMatchObject({ ok: true });
    });
  });
});
