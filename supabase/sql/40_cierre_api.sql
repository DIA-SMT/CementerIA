-- Cierre de la API pública de Supabase (anon, authenticated, service_role).
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuentes: scripts/supabase/sql/cierre-api-dueno.sql (como cementeria_owner) y
-- scripts/supabase/sql/cierre-api-postgres.sql (como postgres). Idempotente.

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

-- Cierre de la API pública de Supabase, parte del DUEÑO: corre como
-- cementeria_owner (preparar.mjs, con el rol de deploy; el SQL Editor, con
-- SET ROLE), después de las migraciones.
--
-- Supabase expone el esquema public por la Data API (PostgREST) con los roles
-- anon (sin sesión), authenticated y service_role, y les da privilegios por
-- defecto sobre lo que crean `postgres` y `supabase_admin`. Lo de CementerIA
-- lo crea cementeria_owner, así que esos defaults no lo alcanzan; igual se
-- revoca todo explícitamente (si alguien lo hubiera dado a mano) y se fijan
-- los privilegios por defecto del owner, para que tampoco les quede nada de
-- las tablas futuras. La primera barrera es apagar la Data API en el panel
-- (docs/despliegue.md, "Base en Supabase"); esto y RLS
-- (migración *_rls_defensa) son las siguientes.
--
-- EXECUTE de las funciones: PostgreSQL se lo da a PUBLIC, y anon lo tiene por
-- ahí aunque se le revoque a él. No es un problema: ninguna función de
-- CementerIA es SECURITY DEFINER (tests/integracion/privilegios.test.ts), así
-- que corren con los privilegios de quien llama, y anon no tiene ninguno sobre
-- las tablas. Sacárselo a PUBLIC obligaría a cada migración futura a dárselo
-- a la app, distinto de la base local.
--
-- Idempotente. Si un rol de la API no existe (no es Supabase), se saltea.

DO $$
DECLARE
  rol text;
  esquema text;
BEGIN
  IF current_user <> 'cementeria_owner' THEN
    RAISE EXCEPTION 'Esta parte corre como cementeria_owner, no como %', current_user;
  END IF;
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = rol) THEN
      RAISE NOTICE 'No existe el rol %: se saltea', rol;
      CONTINUE;
    END IF;
    FOREACH esquema IN ARRAY ARRAY['public', 'auditoria'] LOOP
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', esquema, rol);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', esquema, rol);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', esquema, rol);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE cementeria_owner IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', esquema, rol);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE cementeria_owner IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', esquema, rol);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE cementeria_owner IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I', esquema, rol);
    END LOOP;
    -- El esquema auditoria es del owner: nadie de la API lo usa.
    EXECUTE format('REVOKE ALL ON SCHEMA auditoria FROM %I', rol);
  END LOOP;
END
$$;

RESET ROLE;
REVOKE cementeria_owner FROM postgres;

-- Cierre de la API pública de Supabase, parte de POSTGRES: corre como el rol
-- postgres de Supabase, después de cierre-api-dueno.sql.
--
-- Supabase les da USAGE (y a veces más) sobre el esquema public a anon,
-- authenticated y service_role para la Data API. El proyecto es solo de
-- CementerIA y la Data API va apagada: se les saca ese GRANT propio. Les sigue
-- quedando el USAGE que PostgreSQL le da a PUBLIC sobre public: no se toca
-- porque lo usan todos los roles (los servicios de Supabase también), y USAGE
-- solo deja nombrar objetos; no da acceso a ninguna tabla (eso son los
-- privilegios de las tablas, en la parte del dueño, y RLS). La verificación
-- controla que no quede un GRANT propio ni CREATE.
--
-- Idempotente.

DO $$
DECLARE
  rol text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Esta parte corre como el rol postgres de Supabase, no como %', current_user;
  END IF;
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', rol);
    END IF;
  END LOOP;
END
$$;
