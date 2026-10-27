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
