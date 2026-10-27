// RLS como defensa extra (migración *_rls_defensa, 27/10/2026; docs/despliegue.md,
// "Base en Supabase"): todas las tablas con RLS y una sola política, para
// cementeria_app. Si una migración futura crea una tabla sin RLS o sin la
// política, el primer test lo dice.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { borrarRolDePrueba, crearRolDePrueba, enTransaccionCon, errorDe, type RolDePrueba } from "./escenario";
import { SISTEMA, conPg, enTransaccion, fijarActor, intentar } from "./helper";

interface FilaRls {
  tabla: string;
  rls: boolean;
  forzado: boolean;
  politicas: { nombre: string; comando: string; roles: string[]; permisiva: string; usando: string | null; chequeo: string | null }[];
}

describe("RLS en todas las tablas", () => {
  it("cada tabla de public y auditoria tiene RLS (sin FORCE) y la política de cementeria_app, y ninguna otra", async () => {
    const filas = await conPg("superusuario", async (c) =>
      (
        await c.query<FilaRls>(`
          SELECT n.nspname || '.' || c.relname AS tabla,
                 c.relrowsecurity AS rls,
                 c.relforcerowsecurity AS forzado,
                 coalesce((SELECT json_agg(json_build_object(
                                    'nombre', p.policyname, 'comando', p.cmd, 'roles', p.roles,
                                    'permisiva', p.permissive, 'usando', p.qual, 'chequeo', p.with_check))
                             FROM pg_policies p
                            WHERE p.schemaname = n.nspname AND p.tablename = c.relname), '[]') AS politicas
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('public', 'auditoria')
           ORDER BY 1`)
      ).rows,
    );
    expect(filas.length).toBeGreaterThan(10);
    for (const f of filas) {
      expect({ tabla: f.tabla, rls: f.rls, forzado: f.forzado }).toEqual({ tabla: f.tabla, rls: true, forzado: false });
      const esperadas =
        f.tabla === "public._prisma_migrations"
          ? []
          : [{ nombre: "cementeria_app", comando: "ALL", roles: ["cementeria_app"], permisiva: "PERMISSIVE", usando: "true", chequeo: "true" }];
      expect({ tabla: f.tabla, politicas: f.politicas }).toEqual({ tabla: f.tabla, politicas: esperadas });
    }
  });

  it("la app (que no es dueña) sigue leyendo y escribiendo", async () => {
    const contar = "SELECT (SELECT count(*) FROM public.usuarios) + (SELECT count(*) FROM auditoria.cambios) AS n";
    const segunSuperusuario = await conPg("superusuario", async (c) => Number((await c.query<{ n: string }>(contar)).rows[0].n));
    await enTransaccion("app", async (c) => {
      // Ve lo mismo que el superusuario (al menos SISTEMA, que inserta la migración).
      expect(Number((await c.query<{ n: string }>(contar)).rows[0].n)).toBe(segunSuperusuario);
      expect(segunSuperusuario).toBeGreaterThan(0);
      await fijarActor(c, SISTEMA, "Prueba de RLS");
      const r = await intentar(c, "INSERT INTO public.tipos_monumento (codigo, nombre) VALUES ('RLS_PRUEBA', 'Prueba de RLS') RETURNING codigo");
      expect(r.ok && r.filas).toEqual([{ codigo: "RLS_PRUEBA" }]);
      // Y lo que escribió el trigger de auditoría con su rol también.
      const auditado = await c.query("SELECT 1 FROM auditoria.cambios WHERE tabla = 'tipos_monumento' AND despues ->> 'codigo' = 'RLS_PRUEBA'");
      expect(auditado.rowCount).toBe(1);
    });
  });
});

describe("un rol con GRANT pero sin política", () => {
  // Lo que pasaría si a anon o authenticated de Supabase les quedara un GRANT
  // por error: con RLS y sin política para ellos, no ven ni escriben nada.
  let rol: RolDePrueba | undefined;
  beforeAll(async () => {
    rol = await crearRolDePrueba("rls", [
      "GRANT USAGE ON SCHEMA public, auditoria TO {rol}",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.areas, public.usuarios, auditoria.cambios TO {rol}",
    ]);
  });
  afterAll(async () => borrarRolDePrueba(rol));

  it("no ve filas aunque tenga SELECT", async () => {
    if (!rol) throw new Error("No se creó el rol de prueba");
    await enTransaccionCon(rol.url, async (c) => {
      for (const tabla of ["public.areas", "public.usuarios", "auditoria.cambios"]) {
        const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${tabla}`);
        expect({ tabla, n: Number(r.rows[0].n) }).toEqual({ tabla, n: 0 });
      }
    });
  });

  it("no puede insertar, y un UPDATE o DELETE no alcanza ninguna fila", async () => {
    if (!rol) throw new Error("No se creó el rol de prueba");
    await enTransaccionCon(rol.url, async (c) => {
      await c.query("SELECT set_config('app.usuario_id', '1', true)");
      const insertar = await intentar(c, "INSERT INTO public.areas (codigo, nombre) VALUES ('RLS_X', 'No')");
      expect(errorDe(insertar)).toMatch(/row-level security/);
    });
    await enTransaccionCon(rol.url, async (c) => {
      expect((await c.query("UPDATE public.areas SET nombre = nombre")).rowCount).toBe(0);
      expect((await c.query("DELETE FROM public.usuarios")).rowCount).toBe(0);
    });
  });
});
