// usuarios: área interna, rol y SISTEMA (propuesta 2.4).

import pg from "pg";
import { describe, expect, it } from "vitest";
import { crearArea, crearCementerio, crearUsuario, cuilFicticio, errorDe, fila } from "./escenario";
import { SISTEMA, enTransaccion, fijarActor, intentar } from "./helper";

interface Areas {
  interna: number;
  externa: number;
}

async function conAreas(fn: (c: pg.Client, a: Areas) => Promise<void>): Promise<void> {
  await enTransaccion("app", async (c) => {
    await fijarActor(c, SISTEMA, "Prueba de usuarios");
    await fn(c, { interna: await crearArea(c), externa: await crearArea(c, { tipo: "externa" }) });
  });
}

const INSERTAR = "INSERT INTO public.usuarios (cuil, nombre, apellido, area_id, rol) VALUES ($1, 'Usuaria', 'De Prueba', $2, $3) RETURNING id";

describe("usuarios_area_interna", () => {
  it("rechaza dar de alta un usuario en un área externa", async () => {
    await conAreas(async (c, a) => {
      const r = await intentar(c, INSERTAR, [cuilFicticio(), a.externa, "operador"]);
      expect(errorDe(r)).toMatch(/no puede pertenecer a un área externa/);
      expect(await intentar(c, INSERTAR, [cuilFicticio(), a.interna, "operador"])).toMatchObject({ ok: true });
    });
  });

  it("rechaza mover un usuario a un área externa", async () => {
    await conAreas(async (c, a) => {
      const id = await crearUsuario(c, { area_id: a.interna });
      const r = await intentar(c, "UPDATE public.usuarios SET area_id = $2 WHERE id = $1", [id, a.externa]);
      expect(errorDe(r)).toMatch(/no puede pertenecer a un área externa/);
    });
  });

  it("un admin tampoco puede estar en un área externa", async () => {
    await conAreas(async (c, a) => {
      const r = await intentar(c, INSERTAR, [cuilFicticio(), a.externa, "admin"]);
      expect(errorDe(r)).toMatch(/no puede pertenecer a un área externa/);
    });
  });
});

describe("areas_tipo_coherente y cementerios_area_externa (2.2, 2.4, 2.13(e))", () => {
  it("un área con usuarios no pasa a externa; sin usuarios, sí", async () => {
    await conAreas(async (c, a) => {
      const id = await crearUsuario(c, { area_id: a.interna });
      const r = await intentar(c, "UPDATE public.areas SET tipo = 'externa' WHERE id = $1", [a.interna]);
      expect(errorDe(r)).toMatch(/tiene usuarios: no puede pasar a externa/);

      // Una vez que el usuario cambió de área, el área queda libre.
      await c.query("UPDATE public.usuarios SET area_id = $2 WHERE id = $1", [id, await crearArea(c)]);
      expect(await intentar(c, "UPDATE public.areas SET tipo = 'externa' WHERE id = $1", [a.interna])).toMatchObject({ ok: true });
    });
  });

  it("un usuario dado de baja también cuenta: sigue siendo de esa área", async () => {
    await conAreas(async (c, a) => {
      await crearUsuario(c, { area_id: a.interna, activo: false });
      const r = await intentar(c, "UPDATE public.areas SET tipo = 'externa' WHERE id = $1", [a.interna]);
      expect(errorDe(r)).toMatch(/tiene usuarios/);
    });
  });

  it("el área de un cementerio sigue siendo externa; una externa sin cementerio puede pasar a interna", async () => {
    await conAreas(async (c, a) => {
      await crearCementerio(c, a.externa);
      const r = await intentar(c, "UPDATE public.areas SET tipo = 'interna' WHERE id = $1", [a.externa]);
      expect(errorDe(r)).toMatch(/es la de un cementerio/);

      // Como la DIM si un día tiene usuarios (2.13(e)).
      const dim = await crearArea(c, { tipo: "externa" });
      expect(await intentar(c, "UPDATE public.areas SET tipo = 'interna' WHERE id = $1", [dim])).toMatchObject({ ok: true });
    });
  });

  it("un cementerio no se da de alta ni se mueve a un área interna", async () => {
    await conAreas(async (c, a) => {
      const alta = await intentar(c, "INSERT INTO public.cementerios (codigo, nombre, area_id) VALUES ('CEM_INTERNO_IT', 'Cementerio de prueba', $1)", [a.interna]);
      expect(errorDe(alta)).toMatch(/tiene que ser externa/);
      const id = await crearCementerio(c, a.externa);
      const mover = await intentar(c, "UPDATE public.cementerios SET area_id = $2 WHERE id = $1", [id, a.interna]);
      expect(errorDe(mover)).toMatch(/tiene que ser externa/);
    });
  });
});

describe("usuarios: CHECKs de rol, área y CUIL", () => {
  it("el rol es operador, lectura o admin", async () => {
    await conAreas(async (c, a) => {
      for (const rol of ["operador", "lectura", "admin"]) {
        expect(await intentar(c, INSERTAR, [cuilFicticio(), a.interna, rol]), rol).toMatchObject({ ok: true });
      }
      for (const rol of ["jefe", "ADMIN", ""]) {
        expect(errorDe(await intentar(c, INSERTAR, [cuilFicticio(), a.interna, rol])), rol).toMatch(/usuarios_rol_check/);
      }
    });
  });

  it("solo el admin puede no tener área", async () => {
    await conAreas(async (c) => {
      expect(await intentar(c, INSERTAR, [cuilFicticio(), null, "admin"])).toMatchObject({ ok: true });
      for (const rol of ["operador", "lectura"]) {
        expect(errorDe(await intentar(c, INSERTAR, [cuilFicticio(), null, rol])), rol).toMatch(/usuarios_area_check/);
      }
    });
  });

  it("dejar a un operador sin área se rechaza", async () => {
    await conAreas(async (c, a) => {
      const id = await crearUsuario(c, { area_id: a.interna });
      const r = await intentar(c, "UPDATE public.usuarios SET area_id = NULL WHERE id = $1", [id]);
      expect(errorDe(r)).toMatch(/usuarios_area_check/);
    });
  });

  it("el CUIL son 11 dígitos y es único", async () => {
    await conAreas(async (c, a) => {
      for (const cuil of ["2012345678", "20-12345678-9", "2012345678X"]) {
        expect(errorDe(await intentar(c, INSERTAR, [cuil, a.interna, "operador"])), cuil).toMatch(/usuarios_cuil_check|value too long/);
      }
      const cuil = cuilFicticio();
      await crearUsuario(c, { cuil, area_id: a.interna });
      expect(errorDe(await intentar(c, INSERTAR, [cuil, a.interna, "operador"]))).toMatch(/usuarios_cuil_key/);
    });
  });
});

describe("usuarios: SISTEMA y bajas", () => {
  it("SISTEMA es el id 1: admin, sin área, inactivo y con CUIL 00000000000", async () => {
    await enTransaccion("app", async (c) => {
      const s = await fila<{ id: number; cuil: string; rol: string; area_id: number | null; activo: boolean }>(
        c,
        "SELECT id, cuil, rol, area_id, activo FROM public.usuarios WHERE id = $1",
        [SISTEMA],
      );
      expect(s).toEqual({ id: 1, cuil: "00000000000", rol: "admin", area_id: null, activo: false });
    });
  });

  it("nadie puede activar a SISTEMA", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "Intento de activar a SISTEMA");
      const r = await intentar(c, "UPDATE public.usuarios SET activo = true WHERE id = 1");
      expect(errorDe(r)).toMatch(/usuarios_sistema_inactivo_check/);
    });
  });

  it("la app no borra usuarios: la baja es activo = false", async () => {
    await conAreas(async (c, a) => {
      const id = await crearUsuario(c, { area_id: a.interna });
      const r = await intentar(c, "DELETE FROM public.usuarios WHERE id = $1", [id]);
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
      expect(await intentar(c, "UPDATE public.usuarios SET activo = false WHERE id = $1", [id])).toMatchObject({ ok: true });
    });
  });
});
