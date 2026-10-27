-- La tabla de control de Prisma, a nombre de cementeria_owner. Idempotente.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: scripts/supabase/sql/prisma-migrations.sql

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Este archivo lo corre el rol postgres de Supabase (SQL Editor), no %', current_user;
  END IF;
END
$$;

-- postgres toma el rol del dueño SOLO durante este archivo: el GRANT y el
-- REVOKE del final van en la misma transacción.
GRANT cementeria_owner TO postgres;
SET LOCAL ROLE cementeria_owner;
SET LOCAL search_path = "$user", public;
DO $$
BEGIN
  IF current_user <> 'cementeria_owner' THEN
    RAISE EXCEPTION 'No se pudo tomar el rol cementeria_owner: ¿se corrió el archivo entero de una sola vez?';
  END IF;
END
$$;

-- La tabla de control de Prisma, como la crea `prisma migrate deploy` (Prisma
-- 7.9; scripts/supabase/probar-local.mjs compara columnas, tipos, defaults y
-- clave contra la que crea Prisma). Corre como cementeria_owner, que queda
-- como dueño, igual que cuando la crea Prisma con el rol de deploy.
--
-- Solo hace falta para aplicar las migraciones a mano (supabase/sql/): cada
-- archivo 20_migracion_* anota acá su fila con el checksum de Prisma, y después
-- `prisma migrate deploy` las ve aplicadas y solo corre las nuevas.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
);

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
