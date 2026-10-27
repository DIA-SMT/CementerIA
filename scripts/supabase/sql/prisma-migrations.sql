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
