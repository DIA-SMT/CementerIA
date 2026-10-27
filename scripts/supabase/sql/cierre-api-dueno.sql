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
