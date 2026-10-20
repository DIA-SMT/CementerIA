import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conPg } from "./helper";

// Si este test falla, el arnés o las migraciones están rotos: el resto de la
// batería no tiene sentido hasta arreglarlo.

const TABLAS_ESPERADAS = [
  "auditoria.accesos",
  "auditoria.cambios",
  "public.areas",
  "public.cementerios",
  "public.expediente_personas",
  "public.expedientes",
  "public.feriados",
  "public.feriados_anios",
  "public.movimientos",
  "public.plantillas",
  "public.tipos_monumento",
  "public.tipos_tramite",
  "public.usuarios",
];

describe("humo: la base efímera quedó como en producción", () => {
  it("aplicó todas las migraciones, tiene las 13 tablas y todas son de cementeria_owner", async () => {
    const carpetas = (await readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    await conPg("owner", async (c) => {
      const migraciones = await c.query<{ migration_name: string }>(
        `SELECT migration_name FROM _prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
          ORDER BY migration_name`,
      );
      expect(migraciones.rows.map((f) => f.migration_name)).toEqual(carpetas);

      const tablas = await c.query<{ tabla: string; dueno: string }>(
        `SELECT schemaname || '.' || tablename AS tabla, tableowner AS dueno
           FROM pg_tables
          WHERE schemaname IN ('public', 'auditoria')
          ORDER BY 1`,
      );
      const dominio = tablas.rows.map((f) => f.tabla).filter((t) => t !== "public._prisma_migrations");
      expect(dominio).toEqual(TABLAS_ESPERADAS);

      // Sección 2: todas, incluida _prisma_migrations, a nombre del owner.
      const ajenas = tablas.rows.filter((f) => f.dueno !== "cementeria_owner");
      expect(ajenas).toEqual([]);
    });
  });
});
