-- unaccent y pg_trgm en el esquema public. Idempotente.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: scripts/supabase/sql/extensiones.sql

-- unaccent y pg_trgm en el esquema PUBLIC. Lo corre el rol `postgres` de
-- Supabase, antes de la primera migración.
--
-- Por qué en public y no en `extensions` (donde las pone Supabase por
-- defecto): las migraciones ya aplicadas no se editan, y la segunda
-- (20261019120100_reglas_base) crea
--     f_unaccent(text) = public.unaccent('public.unaccent'::regdictionary, $1)
-- con el esquema escrito: es lo que le permite ser IMMUTABLE y usarse en
-- índices y columnas normalizadas. PostgreSQL valida el cuerpo de una función
-- SQL al crearla, así que con unaccent en otro esquema esa migración falla y
-- una migración posterior no llega a arreglarla. La primera migración ya hace
-- `CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA public` (como owner); si
-- Supabase la hubiera creado en `extensions`, ese IF NOT EXISTS la daría por
-- creada y la segunda fallaría. Por eso acá se crean en public o se mueven a
-- public (las dos son relocatable).
--
-- Supabase lo permite (el panel deja elegir el esquema al habilitar una
-- extensión); su Security Advisor lo marca como advertencia (lint 0014,
-- "extension in public": sus funciones quedarían expuestas por la Data API).
-- Acá la Data API está apagada y el esquema public cerrado para los roles de
-- la API (cierre-api-*.sql), así que la advertencia no aplica.
--
-- Idempotente.

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Este script lo corre el rol postgres de Supabase, no %', current_user;
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Si ya estaban en otro esquema (alguien las habilitó desde el panel), se
-- mueven a public. Solo antes de la primera migración: después ya dependen de
-- ellas f_unaccent y los índices, y tienen que estar en public desde entonces.
-- Moverlas (ALTER EXTENSION … SET SCHEMA) exige ser dueño de sus funciones, que
-- en una extensión "trusted" creada sin ser superusuario son del superusuario:
-- si no se puede, se borran y se crean de nuevo en public. El DROP es RESTRICT:
-- si algo ya depende de ellas, falla y no borra nada.
DO $$
DECLARE
  e record;
BEGIN
  FOR e IN
    SELECT x.extname, n.nspname
      FROM pg_extension x JOIN pg_namespace n ON n.oid = x.extnamespace
     WHERE x.extname IN ('unaccent', 'pg_trgm') AND n.nspname <> 'public'
  LOOP
    RAISE NOTICE 'La extensión % estaba en el esquema %: se mueve a public', e.extname, e.nspname;
    BEGIN
      EXECUTE format('ALTER EXTENSION %I SET SCHEMA public', e.extname);
    EXCEPTION WHEN insufficient_privilege THEN
      BEGIN
        EXECUTE format('DROP EXTENSION %I RESTRICT', e.extname);
      EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE EXCEPTION 'La extensión % está en el esquema % y ya hay objetos que dependen de ella: no se puede mover a public. Revisalo antes de seguir (docs/despliegue.md, "Base en Supabase").', e.extname, e.nspname;
      END;
      EXECUTE format('CREATE EXTENSION %I WITH SCHEMA public', e.extname);
    END;
  END LOOP;
END
$$;

-- Las funciones de las extensiones se usan desde f_unaccent (y la búsqueda):
-- las ejecutan el owner (migraciones) y la app (triggers y consultas).
-- PostgreSQL le da EXECUTE a PUBLIC; si en este proyecto no fuera así, se les
-- da a los dos roles y, si postgres no puede, se corta.
DO $$
DECLARE
  f text;
  rol text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.unaccent(regdictionary, text)', 'public.unaccent(text)', 'public.similarity(text, text)', 'public.word_similarity(text, text)'] LOOP
    FOREACH rol IN ARRAY ARRAY['cementeria_owner', 'cementeria_app'] LOOP
      IF NOT has_function_privilege(rol, f, 'EXECUTE') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', f, rol);
      END IF;
      IF NOT has_function_privilege(rol, f, 'EXECUTE') THEN
        RAISE EXCEPTION '% no puede ejecutar % y postgres no pudo dárselo', rol, f;
      END IF;
    END LOOP;
  END LOOP;
  IF public.unaccent('public.unaccent'::regdictionary, 'GONZÁLEZ') <> 'GONZALEZ' THEN
    RAISE EXCEPTION 'unaccent no funciona como se espera';
  END IF;
END
$$;
