-- Migración 20261026180000_avisos, como cementeria_owner.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: prisma/migrations/20261026180000_avisos/migration.sql (checksum f7cf12d0af1c7d26d3f730be5df52d414a386e35bda6ef83071345bb547709ee).
-- NO es idempotente a propósito: si ya está aplicada, el archivo se niega y no cambia nada.

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Este archivo lo corre el rol postgres de Supabase (SQL Editor), no %', current_user;
  END IF;
END
$$;

-- Si ya está aplicada, se corta acá y no cambia nada.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Falta public._prisma_migrations: corré antes 02_prisma_migrations.sql';
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

DO $$
BEGIN
  IF EXISTS (SELECT FROM public._prisma_migrations WHERE migration_name = '20261026180000_avisos' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'La migración 20261026180000_avisos ya está aplicada: no hay nada que hacer (no se cambió nada).';
  END IF;
END
$$;
-- Como `prisma migrate deploy` con cementeria_deploy: su zona horaria.
SET LOCAL timezone = 'America/Argentina/Tucuman';
-- ===== prisma/migrations/20261026180000_avisos/migration.sql (sin cambios) =====
-- Avisos en el sistema (26/10/2026). Generada con `prisma migrate diff
-- --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
-- y retocada a mano:
--
--   1. La guarda de dueño, como las anteriores.
--   2. avisos.id es identity ALWAYS y no BIGSERIAL (como movimientos): la app
--      no tiene privilegios sobre secuencias, y una identity no los necesita.
--   3. CHECKs: tipo, prioridad, canal, largos y que el enlace sea una ruta
--      relativa de la app (nunca "//otro.host" ni "javascript:").
--   4. GRANTs mínimos para cementeria_app: inserta avisos y marca leído o no
--      leído (UPDATE solo de leido_en); no borra. La purga de los leídos viejos
--      la hace el admin con las credenciales de despliegue (npm run
--      avisos:purgar, docs/despliegue.md).
--
-- Tres tablas (docs/api-dominio.md, sección 21):
--
--   avisos               un aviso por destinatario: el canal "sistema" (la
--                        campana y /avisos). Un canal nuevo (correo, WhatsApp)
--                        manda copias de estas filas; la fila es la fuente.
--   avisos_preferencias  lo que cada usuario apagó, por tipo y canal (sin fila
--                        = activo).
--   avisos_corridas      los días en que corrió la generación por tiempo (plazo
--                        DIM, sin confirmar, demorado).
--
-- Sin datos personales del contacto: número, trámite, paso, área y, en una
-- devolución, el motivo (que ya está en el historial). Sin triggers ni
-- auditoría propia: un aviso no cambia el expediente, y los que nacen de un
-- pase o una devolución se insertan en la misma transacción que el movimiento.
--
-- Las migraciones anteriores ya están en main y no se tocan.

DO $$
BEGIN
  IF current_user <> 'cementeria_owner' THEN
    RAISE EXCEPTION 'Las migraciones deben correr como cementeria_owner (vía cementeria_deploy), no como %', current_user;
  END IF;
END
$$;

-- ===========================================================================
-- 1. Tablas, índices y claves (lo que genera Prisma, con la identity)
-- ===========================================================================

-- CreateTable
CREATE TABLE "avisos" (
    "id" BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY,
    "usuario_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL DEFAULT 'normal',
    "expediente_id" BIGINT NOT NULL,
    "movimiento_id" BIGINT,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "enlace" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leido_en" TIMESTAMPTZ,

    CONSTRAINT "avisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos_preferencias" (
    "usuario_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'sistema',
    "activo" BOOLEAN NOT NULL,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_preferencias_pkey" PRIMARY KEY ("usuario_id","tipo","canal")
);

-- CreateTable
CREATE TABLE "avisos_corridas" (
    "dia" DATE NOT NULL,
    "corrido_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avisos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "avisos_corridas_pkey" PRIMARY KEY ("dia")
);

-- La lista de /avisos y el panel de la campana: los de un usuario, del más nuevo al más viejo.
-- CreateIndex
CREATE INDEX "avisos_usuario_id_creado_en_idx" ON "avisos"("usuario_id", "creado_en" DESC);

-- "Mis no leídos": el contador del encabezado, en cada pantalla.
-- CreateIndex
CREATE INDEX "avisos_no_leidos_idx" ON "avisos"("usuario_id", "creado_en" DESC) WHERE (leido_en IS NULL);

-- No duplicar: la clave arma cada generador ("llego:<movimiento>",
-- "plazo_vencido:<expediente>:<inicio del plazo>"…); con ON CONFLICT DO
-- NOTHING, generar dos veces no crea nada.
-- CreateIndex
CREATE UNIQUE INDEX "avisos_usuario_id_clave_key" ON "avisos"("usuario_id", "clave");

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avisos_preferencias" ADD CONSTRAINT "avisos_preferencias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ===========================================================================
-- 2. CHECKs (src/lib/dominio/avisos/tipos.ts tiene las mismas listas)
-- ===========================================================================

ALTER TABLE public.avisos
  ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
    'llego', 'devuelto', 'plazo_por_vencer', 'plazo_vencido', 'sin_confirmar', 'demorado', 'cerrado')),
  ADD CONSTRAINT avisos_prioridad_check CHECK (prioridad IN ('baja', 'normal', 'alta')),
  ADD CONSTRAINT avisos_titulo_check CHECK (char_length(titulo) BETWEEN 1 AND 160),
  ADD CONSTRAINT avisos_texto_check CHECK (char_length(texto) <= 600),
  ADD CONSTRAINT avisos_clave_check CHECK (char_length(clave) BETWEEN 1 AND 200),
  -- Una ruta de la app: empieza con "/" y sigue con una letra o un dígito
  -- (descarta "//host", "/\host" y cualquier esquema).
  ADD CONSTRAINT avisos_enlace_check CHECK (enlace ~ '^/[A-Za-z0-9]' AND char_length(enlace) <= 300);

ALTER TABLE public.avisos_preferencias
  ADD CONSTRAINT avisos_preferencias_tipo_check CHECK (tipo IN (
    'llego', 'devuelto', 'plazo_por_vencer', 'plazo_vencido', 'sin_confirmar', 'demorado', 'cerrado')),
  -- Hoy solo el sistema. Correo y WhatsApp se suman acá cuando existan.
  ADD CONSTRAINT avisos_preferencias_canal_check CHECK (canal IN ('sistema'));

ALTER TABLE public.avisos_corridas
  ADD CONSTRAINT avisos_corridas_avisos_check CHECK (avisos >= 0);

-- ===========================================================================
-- 3. Privilegios de cementeria_app (mínimos)
-- ===========================================================================
--
-- Sin DELETE en ninguna. UPDATE solo de las columnas que la app cambia: marcar
-- leído o no leído, prender o apagar una preferencia y anotar la corrida del
-- día. El resto de un aviso no se modifica.

GRANT SELECT, INSERT ON public.avisos TO cementeria_app;
GRANT UPDATE (leido_en) ON public.avisos TO cementeria_app;

GRANT SELECT, INSERT ON public.avisos_preferencias TO cementeria_app;
GRANT UPDATE (activo, actualizado_en) ON public.avisos_preferencias TO cementeria_app;

GRANT SELECT, INSERT ON public.avisos_corridas TO cementeria_app;
GRANT UPDATE (corrido_en, avisos) ON public.avisos_corridas TO cementeria_app;
-- ===== fin de 20261026180000_avisos =====

-- La fila de Prisma, con su checksum (SHA-256 de migration.sql): después
-- `prisma migrate deploy` la da por aplicada.
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'f7cf12d0af1c7d26d3f730be5df52d414a386e35bda6ef83071345bb547709ee', now(), '20261026180000_avisos', NULL, NULL, now(), 1);

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
