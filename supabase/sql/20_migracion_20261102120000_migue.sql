-- Migración 20261102120000_migue, como cementeria_owner.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: prisma/migrations/20261102120000_migue/migration.sql (checksum da102840f408c0951405dfe0fc41c27472c6a027cbcb0e24023bbfdaf216edc7).
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
  IF EXISTS (SELECT FROM public._prisma_migrations WHERE migration_name = '20261102120000_migue' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'La migración 20261102120000_migue ya está aplicada: no hay nada que hacer (no se cambió nada).';
  END IF;
END
$$;
-- Como `prisma migrate deploy` con cementeria_deploy: su zona horaria.
SET LOCAL timezone = 'America/Argentina/Tucuman';
-- ===== prisma/migrations/20261102120000_migue/migration.sql (sin cambios) =====
-- Migue, el asistente con IA (02/11/2026; docs/api-dominio.md, sección 26).
-- Contesta en la página pública (sin sesión) y en el sistema (con sesión, con
-- herramientas de solo lectura que llaman al dominio con el usuario de la
-- sesión). Esta migración no le abre ninguna puerta al dominio: lo único suyo
-- es qué le preguntaron y cuánto se le preguntó. Escrita a mano a partir de
-- `prisma migrate diff` (las tablas y sus índices son los de
-- prisma/schema.prisma; lo demás Prisma no lo modela):
--
--   1. La guarda de dueño, como las anteriores.
--   2. auditoria.consultas_migue: cada consulta, con el canal (publico o
--      interno), el resultado, las herramientas que usó, la duración, los
--      tokens y el modelo si los hubo, la pantalla (solo en lo interno), la
--      pregunta y la respuesta recortadas a 500 caracteres y, solo en lo
--      interno, el usuario. En lo público no se guarda nada que identifique a
--      la persona: ni la IP ni el usuario (CHECK). Identity GENERATED ALWAYS,
--      como el resto de auditoria.
--   3. consultas_migue_proteger: solo inserción. Nada de UPDATE ni TRUNCATE, y
--      una consulta de menos de 90 días no se borra (ni la app ni el owner).
--   4. public.consumo_migue: el contador de consultas AL MODELO por persona y
--      por hora, para los topes (MIGUE_TOPE_PERSONA y MIGUE_TOPE_GLOBAL), en la
--      base para que valgan con varias instancias en Vercel. La clave es un
--      HMAC con SESSION_SECRET de la IP o del usuario, nunca el dato en claro
--      (CHECK del formato). consumo_migue_proteger: el contador solo sube, la
--      fila no cambia de clave ni de hora, y una ventana se borra recién al
--      día siguiente (el tope de la hora no se limpia a mano).
--   5. f_purgar_migue(): la retención, en la base (la app no elige qué borra):
--      las consultas de más de 90 días y las ventanas de más de un día. La
--      llama la tarea de cada mañana (src/lib/tareas/programadas.ts) con el rol
--      de la app.
--   6. GRANTs mínimos para cementeria_app: consultas_migue, leer, insertar y
--      borrar (solo lo vencido, por el trigger); consumo_migue, además
--      actualizar (el incremento atómico del contador). Nunca TRUNCATE.
--   7. RLS con la política de cementeria_app (como *_rls_defensa).
--
-- Sin SECURITY DEFINER, como las demás funciones. Qué viaja a OpenRouter y la
-- retención están en docs/borrador-tecnico-art22.md.
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
-- 2 y 4. Tablas e índices (lo que genera Prisma, con la identity)
-- ===========================================================================

-- CreateTable
CREATE TABLE "auditoria"."consultas_migue" (
    "id" BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY,
    "en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canal" TEXT NOT NULL,
    "resultado" TEXT NOT NULL,
    "herramientas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duracion_ms" INTEGER NOT NULL,
    "tokens_entrada" INTEGER,
    "tokens_salida" INTEGER,
    "modelo" TEXT,
    "pantalla" TEXT,
    "pregunta" TEXT NOT NULL,
    "respuesta" TEXT NOT NULL,
    "usuario_id" INTEGER,

    CONSTRAINT "consultas_migue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumo_migue" (
    "clave" TEXT NOT NULL,
    "ventana" TIMESTAMPTZ NOT NULL,
    "consultas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "consumo_migue_pkey" PRIMARY KEY ("clave","ventana")
);

-- La purga y el registro miran la fecha; el registro, además, por canal y resultado.
-- CreateIndex
CREATE INDEX "consultas_migue_en_idx" ON "auditoria"."consultas_migue"("en");

-- CreateIndex
CREATE INDEX "consultas_migue_canal_resultado_en_idx" ON "auditoria"."consultas_migue"("canal", "resultado", "en");

-- El tope global suma la hora entera; la purga borra por hora.
-- CreateIndex
CREATE INDEX "consumo_migue_ventana_idx" ON "consumo_migue"("ventana");

-- AddForeignKey
ALTER TABLE "auditoria"."consultas_migue" ADD CONSTRAINT "consultas_migue_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE auditoria.consultas_migue
  ADD CONSTRAINT consultas_migue_canal_check CHECK (canal IN ('publico', 'interno')),
  ADD CONSTRAINT consultas_migue_resultado_check
    CHECK (resultado IN ('respondida', 'sin_respuesta', 'fallback', 'tope', 'rechazada', 'error')),
  -- Lo público no guarda quién preguntó; lo interno, siempre (como el resto del sistema).
  ADD CONSTRAINT consultas_migue_usuario_check CHECK ((canal = 'publico') = (usuario_id IS NULL)),
  ADD CONSTRAINT consultas_migue_pantalla_check CHECK (pantalla IS NULL OR (canal = 'interno' AND pantalla ~ '^[a-z][a-z0-9-]{0,39}$')),
  -- Las herramientas de src/lib/migue/herramientas.ts y nada más; en lo público, ninguna.
  ADD CONSTRAINT consultas_migue_herramientas_check CHECK (
    herramientas IS NOT NULL
    AND cardinality(herramientas) <= 20
    AND herramientas <@ ARRAY['estado_expediente', 'mi_bandeja', 'vencidos_y_demorados', 'plantilla_tramite', 'como_se_hace']::text[]
    AND (canal = 'interno' OR cardinality(herramientas) = 0)),
  ADD CONSTRAINT consultas_migue_textos_check CHECK (char_length(pregunta) <= 500 AND char_length(respuesta) <= 500),
  ADD CONSTRAINT consultas_migue_numeros_check CHECK (
    duracion_ms >= 0 AND (tokens_entrada IS NULL OR tokens_entrada >= 0) AND (tokens_salida IS NULL OR tokens_salida >= 0)),
  ADD CONSTRAINT consultas_migue_modelo_check CHECK (modelo IS NULL OR char_length(modelo) BETWEEN 1 AND 100);

ALTER TABLE public.consumo_migue
  -- El HMAC en base64url, recortado a 32 caracteres (src/lib/migue/tope.ts): nunca una IP ni un id.
  ADD CONSTRAINT consumo_migue_clave_check CHECK (clave ~ '^[A-Za-z0-9_-]{32}$'),
  ADD CONSTRAINT consumo_migue_consultas_check CHECK (consultas >= 0);

-- ===========================================================================
-- 3. consultas_migue: solo inserción, y se borra recién a los 90 días
-- ===========================================================================

CREATE FUNCTION public.consultas_migue_proteger() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.en >= now() - interval '90 days' THEN
      RAISE EXCEPTION 'auditoria.consultas_migue: solo se borran las consultas de más de 90 días (f_purgar_migue)';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'auditoria.consultas_migue es solo inserción: % rechazado', TG_OP;
END
$$;

CREATE TRIGGER consultas_migue_proteger
  BEFORE UPDATE OR DELETE ON auditoria.consultas_migue
  FOR EACH ROW EXECUTE FUNCTION public.consultas_migue_proteger();
CREATE TRIGGER consultas_migue_proteger_truncate
  BEFORE TRUNCATE ON auditoria.consultas_migue
  FOR EACH STATEMENT EXECUTE FUNCTION public.consultas_migue_proteger();
ALTER TABLE auditoria.consultas_migue ENABLE ALWAYS TRIGGER consultas_migue_proteger;
ALTER TABLE auditoria.consultas_migue ENABLE ALWAYS TRIGGER consultas_migue_proteger_truncate;

-- ===========================================================================
-- 4. consumo_migue: el contador solo sube, y la hora no se borra a mano
-- ===========================================================================

CREATE FUNCTION public.consumo_migue_proteger() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.ventana >= now() - interval '1 day' THEN
      RAISE EXCEPTION 'public.consumo_migue: solo se borran las ventanas de más de un día (f_purgar_migue)';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.clave IS DISTINCT FROM OLD.clave OR NEW.ventana IS DISTINCT FROM OLD.ventana OR NEW.consultas < OLD.consultas THEN
      RAISE EXCEPTION 'public.consumo_migue: el contador solo sube, en su misma clave y hora';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'public.consumo_migue: % rechazado (los topes no se limpian a mano)', TG_OP;
END
$$;

CREATE TRIGGER consumo_migue_proteger
  BEFORE UPDATE OR DELETE ON public.consumo_migue
  FOR EACH ROW EXECUTE FUNCTION public.consumo_migue_proteger();
CREATE TRIGGER consumo_migue_proteger_truncate
  BEFORE TRUNCATE ON public.consumo_migue
  FOR EACH STATEMENT EXECUTE FUNCTION public.consumo_migue_proteger();
ALTER TABLE public.consumo_migue ENABLE ALWAYS TRIGGER consumo_migue_proteger;
ALTER TABLE public.consumo_migue ENABLE ALWAYS TRIGGER consumo_migue_proteger_truncate;

-- ===========================================================================
-- 5. f_purgar_migue
-- ===========================================================================
--
-- La retención (90 días el registro, un día los contadores) está en la base,
-- acá y en los triggers. Devuelve cuántas filas borró de cada tabla.
CREATE FUNCTION public.f_purgar_migue(OUT consultas integer, OUT consumo integer)
  LANGUAGE sql VOLATILE
  AS $$
  WITH c AS (
    DELETE FROM auditoria.consultas_migue WHERE en < now() - interval '90 days' RETURNING 1
  ), m AS (
    DELETE FROM public.consumo_migue WHERE ventana < now() - interval '1 day' RETURNING 1
  )
  SELECT (SELECT count(*) FROM c)::integer, (SELECT count(*) FROM m)::integer
$$;

-- ===========================================================================
-- 6 y 7. Privilegios y RLS
-- ===========================================================================

-- El registro: insertar, leer (para revisar las respuestas y para la purga) y
-- borrar solo lo vencido (el trigger). Sin UPDATE.
GRANT SELECT, INSERT, DELETE ON auditoria.consultas_migue TO cementeria_app;
-- Los topes: el incremento atómico es un INSERT … ON CONFLICT DO UPDATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumo_migue TO cementeria_app;

ALTER TABLE auditoria.consultas_migue ENABLE ROW LEVEL SECURITY;
CREATE POLICY cementeria_app ON auditoria.consultas_migue AS PERMISSIVE FOR ALL TO cementeria_app USING (true) WITH CHECK (true);
ALTER TABLE public.consumo_migue ENABLE ROW LEVEL SECURITY;
CREATE POLICY cementeria_app ON public.consumo_migue AS PERMISSIVE FOR ALL TO cementeria_app USING (true) WITH CHECK (true);
-- ===== fin de 20261102120000_migue =====

-- La fila de Prisma, con su checksum (SHA-256 de migration.sql): después
-- `prisma migrate deploy` la da por aplicada.
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'da102840f408c0951405dfe0fc41c27472c6a027cbcb0e24023bbfdaf216edc7', now(), '20261102120000_migue', NULL, NULL, now(), 1);

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
