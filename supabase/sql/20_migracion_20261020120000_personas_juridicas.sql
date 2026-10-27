-- Migración 20261020120000_personas_juridicas, como cementeria_owner.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: prisma/migrations/20261020120000_personas_juridicas/migration.sql (checksum 013bedb4dfa7299f59fcbf783b18742a5b02fa4b4f9da485e53e7cb15768e5f9).
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
  IF EXISTS (SELECT FROM public._prisma_migrations WHERE migration_name = '20261020120000_personas_juridicas' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'La migración 20261020120000_personas_juridicas ya está aplicada: no hay nada que hacer (no se cambió nada).';
  END IF;
END
$$;
-- Como `prisma migrate deploy` con cementeria_deploy: su zona horaria.
SET LOCAL timezone = 'America/Argentina/Tucuman';
-- ===== prisma/migrations/20261020120000_personas_juridicas/migration.sql (sin cambios) =====
-- Personas jurídicas en expediente_personas (semana 4). Escrita a mano.
-- Origen: docs/fuentes/README.md, "Cambios que esto implica", punto 3: las
-- asociaciones o sociedades con panteón son titulares de la concesión y
-- presentan designación de asamblea y personería. No tienen apellido, nombres
-- ni DNI: tienen razón social y CUIT.
--
--   1. Columnas tipo_persona, razon_social y cuit, e índice por CUIT
--   2. f_cuit_valido(): 11 dígitos y dígito verificador
--   3. CHECKs: qué datos lleva cada tipo (el de nombre se reemplaza)
--   4. expediente_personas_proteger: la supresión también borra razón social y
--      CUIT, y nombre_norm sale de la razón social en una jurídica
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
-- 1. Columnas e índice (también en schema.prisma)
-- ===========================================================================

-- Con DEFAULT 'fisica', las personas que ya existen quedan como lo que son.
ALTER TABLE "expediente_personas"
  ADD COLUMN "tipo_persona" TEXT NOT NULL DEFAULT 'fisica',
  ADD COLUMN "razon_social" TEXT,
  ADD COLUMN "cuit" TEXT;

-- La caja única busca un número de 11 dígitos por igualdad: además del DNI que
-- contiene un CUIL, el CUIT de una persona jurídica.
CREATE INDEX "expediente_personas_cuit_idx" ON "expediente_personas"("cuit");

-- ===========================================================================
-- 2. f_cuit_valido
-- ===========================================================================

-- Módulo 11 con pesos 5432765432, como cuilValido() de src/lib/dominio/cuil.ts.
-- Un resto de 10 no es un CUIT posible (ARCA cambia el prefijo). El prefijo no
-- se controla acá: la app exige 30, 33 o 34 al cargar una persona jurídica, y
-- la base solo garantiza que el número esté bien formado.
-- plpgsql y no sql: con el AND de SQL, PostgreSQL puede evaluar el ::int
-- antes que la expresión regular y fallar con un texto que no es número.
CREATE FUNCTION public.f_cuit_valido(c text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE STRICT
  AS $$
DECLARE
  pesos constant integer[] := ARRAY[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  suma integer := 0;
  digito integer;
BEGIN
  IF c !~ '^[0-9]{11}$' THEN
    RETURN false;
  END IF;
  FOR i IN 1..10 LOOP
    suma := suma + substr(c, i, 1)::integer * pesos[i];
  END LOOP;
  digito := 11 - suma % 11;
  IF digito = 11 THEN
    digito := 0;
  ELSIF digito = 10 THEN
    RETURN false;
  END IF;
  RETURN digito = substr(c, 11, 1)::integer;
END
$$;

-- ===========================================================================
-- 3. CHECKs
-- ===========================================================================

ALTER TABLE public.expediente_personas
  ADD CONSTRAINT expediente_personas_tipo_persona_check CHECK (tipo_persona IN ('fisica', 'juridica')),
  ADD CONSTRAINT expediente_personas_cuit_check CHECK (cuit IS NULL OR public.f_cuit_valido(cuit)),
  -- El de reglas_base pedía apellido y nombres a toda persona no suprimida;
  -- ahora depende del tipo. Una persona suprimida (Ley 25.326) sigue sin datos.
  DROP CONSTRAINT expediente_personas_nombre_check,
  ADD CONSTRAINT expediente_personas_nombre_check CHECK (
    suprimida_en IS NOT NULL
    OR (tipo_persona = 'fisica' AND apellido IS NOT NULL AND nombres IS NOT NULL)
    OR (tipo_persona = 'juridica' AND razon_social IS NOT NULL AND cuit IS NOT NULL)
  ),
  -- Cada tipo con sus datos y no los del otro: una jurídica no tiene DNI ni
  -- fallece, y la razón social y el CUIT son solo de las jurídicas (el CUIL de
  -- una persona física no se pide). El vínculo y el contacto valen para las dos.
  ADD CONSTRAINT expediente_personas_tipo_datos_check CHECK (
    CASE WHEN tipo_persona = 'juridica'
      THEN apellido IS NULL AND nombres IS NULL AND dni IS NULL AND NOT fallecido AND fecha_defuncion IS NULL
      ELSE razon_social IS NULL AND cuit IS NULL
    END
  );

-- ===========================================================================
-- 4. expediente_personas_proteger
-- ===========================================================================
--
-- La misma función de reglas_base con dos cambios:
--   - la supresión (b) también lleva a NULL razon_social y cuit: la Ley 25.326
--     protege también a las personas de existencia ideal (art. 1), y el CUIT
--     identifica a la asociación igual que el DNI a una persona;
--   - nombre_norm suma la razón social, para que la búsqueda por nombre
--     encuentre a la asociación.
-- tipo_persona no está en ninguna de las dos listas: no cambia nunca (para
-- corregirlo se inserta una versión nueva), y una suprimida conserva el tipo,
-- que no es un dato personal y dice qué documentos le correspondían.
-- CREATE OR REPLACE conserva el trigger y su ENABLE ALWAYS.

CREATE OR REPLACE FUNCTION public.expediente_personas_proteger() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  cols_baja constant text[] := ARRAY['vigente', 'reemplazada_por_id'];
  cols_supresion constant text[] := ARRAY[
    'apellido', 'nombres', 'dni', 'razon_social', 'cuit', 'telefono', 'email', 'domicilio', 'vinculo', 'suprimida_en'];
  viejo jsonb;
  nuevo jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expediente_personas no admite DELETE: la baja es vigente = false';
  END IF;

  -- Las personas cambian solo junto con el movimiento alta o edicion que las
  -- crea, dentro de conActor().
  PERFORM public.f_actor();

  NEW.nombre_norm := coalesce(public.f_normalizar(concat_ws(' ', NEW.apellido, NEW.nombres, NEW.razon_social)), '');
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.vigente OR NEW.reemplazada_por_id IS NOT NULL OR NEW.suprimida_en IS NOT NULL THEN
      RAISE EXCEPTION 'Una persona nace vigente, sin reemplazo y sin suprimir: la baja, el enlace y la supresión son UPDATE posteriores';
    END IF;
    RETURN NEW;
  END IF;

  viejo := to_jsonb(OLD) - 'nombre_norm';
  nuevo := to_jsonb(NEW) - 'nombre_norm';
  IF nuevo = viejo THEN
    RETURN NEW;
  END IF;

  -- a) Baja o reemplazo.
  IF (nuevo - cols_baja) = (viejo - cols_baja) THEN
    IF NEW.vigente AND OLD.vigente THEN
      RAISE EXCEPTION 'Primero se da de baja la versión vieja (vigente = false); recién después se fija reemplazada_por_id';
    END IF;
    IF NEW.vigente THEN
      RAISE EXCEPTION 'Una persona dada de baja no vuelve a vigente: se inserta una versión nueva';
    END IF;
    IF OLD.reemplazada_por_id IS NOT NULL
       AND NEW.reemplazada_por_id IS DISTINCT FROM OLD.reemplazada_por_id THEN
      RAISE EXCEPTION 'La persona % ya fue reemplazada por %', OLD.id, OLD.reemplazada_por_id;
    END IF;
    IF NEW.reemplazada_por_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.expediente_personas p
       WHERE p.id = NEW.reemplazada_por_id
         AND p.id > NEW.id
         AND p.expediente_id = NEW.expediente_id) THEN
      RAISE EXCEPTION 'reemplazada_por_id tiene que ser otra persona del mismo expediente, insertada después que esta';
    END IF;
    RETURN NEW;
  END IF;

  -- b) Supresión: todos los datos personales en NULL, de los dos tipos.
  IF (nuevo - cols_supresion) = (viejo - cols_supresion)
     AND OLD.suprimida_en IS NULL
     AND NEW.suprimida_en IS NOT NULL
     AND num_nulls(NEW.apellido, NEW.nombres, NEW.dni, NEW.razon_social, NEW.cuit, NEW.telefono,
                   NEW.email, NEW.domicilio, NEW.vinculo) = 9 THEN
    IF coalesce(btrim(current_setting('app.motivo', true)), '') = '' THEN
      RAISE EXCEPTION 'La supresión de una persona exige motivo (app.motivo)';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'expediente_personas solo admite la baja (vigente/reemplazada_por_id) o la supresión. Para corregir datos se inserta una versión nueva de la persona.';
END
$$;
-- ===== fin de 20261020120000_personas_juridicas =====

-- La fila de Prisma, con su checksum (SHA-256 de migration.sql): después
-- `prisma migrate deploy` la da por aplicada.
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '013bedb4dfa7299f59fcbf783b18742a5b02fa4b4f9da485e53e7cb15768e5f9', now(), '20261020120000_personas_juridicas', NULL, NULL, now(), 1);

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
