-- Roles de CementerIA en Supabase. Lo corre el rol `postgres` de Supabase (que
-- no es superusuario: tiene CREATEROLE y CREATEDB). Es la adaptación de
-- scripts/db-init.sql y scripts/roles.sql (docs/propuesta-mvp.md, sección 2,
-- "Roles de base"):
--
-- * No hay CREATE DATABASE: en Supabase la base es `postgres`, la del proyecto.
--   Se le da CONNECT a los dos roles con login y CREATE al owner (para crear el
--   esquema auditoria), y el owner recibe CREATE sobre el esquema public.
-- * No se le saca CONNECT a PUBLIC sobre la base: es la de Supabase y la usan
--   sus servicios. Lo que protege los datos son los privilegios sobre las
--   tablas (ver cierre-api-*.sql) y que la Data API esté apagada.
-- * La zona horaria va por rol y no por base: Supabase recomienda dejar la
--   base en UTC, y la app NECESITA sesiones UTC (src/lib/db/crear-cliente.ts:
--   @prisma/adapter-pg da por hecho UTC). La app la pide con `-c TimeZone=UTC`
--   al conectarse, pero Supavisor no le pasa al servidor las opciones de
--   inicio, así que acá cementeria_app queda en UTC. cementeria_deploy (psql,
--   migraciones) en America/Argentina/Tucuman, como la base local. Nada de la
--   base depende de la zona de la sesión: los triggers y las consultas usan
--   AT TIME ZONE explícito.
-- * Sin contraseñas: las pone preparar.mjs, o supabase/sql/.local/05_claves.sql
--   (verificadores SCRAM, nunca la clave en texto plano).
-- * SUPERUSER, REPLICATION y BYPASSRLS no se pueden tocar sin ser superusuario:
--   no se nombran en los ALTER ROLE y se controla al final que estén apagados
--   (un rol recién creado los tiene apagados).
--
-- Idempotente: crea lo que falta y reafirma lo demás.

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Este script lo corre el rol postgres de Supabase, no %', current_user;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cementeria_owner') THEN
    CREATE ROLE cementeria_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cementeria_deploy') THEN
    CREATE ROLE cementeria_deploy LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cementeria_app') THEN
    CREATE ROLE cementeria_app LOGIN;
  END IF;
END
$$;

ALTER ROLE cementeria_owner NOLOGIN INHERIT NOCREATEDB NOCREATEROLE;
ALTER ROLE cementeria_deploy LOGIN NOINHERIT NOCREATEDB NOCREATEROLE;
ALTER ROLE cementeria_app LOGIN INHERIT NOCREATEDB NOCREATEROLE;

-- deploy entra como owner (SET ROLE automático al conectarse): todo lo que
-- crea `prisma migrate deploy`, incluida _prisma_migrations, queda a nombre de
-- cementeria_owner. Las migraciones se niegan a correr con otro current_user.
GRANT cementeria_owner TO cementeria_deploy;
ALTER ROLE cementeria_deploy SET role = 'cementeria_owner';

ALTER ROLE cementeria_deploy SET timezone = 'America/Argentina/Tucuman';
ALTER ROLE cementeria_app SET timezone = 'UTC';

-- La base y el esquema public (el owner crea ahí las tablas y el esquema auditoria).
GRANT CONNECT ON DATABASE postgres TO cementeria_app, cementeria_deploy;
GRANT CREATE ON DATABASE postgres TO cementeria_owner;
GRANT USAGE, CREATE ON SCHEMA public TO cementeria_owner;

-- Controles: un GRANT sin permiso para darlo solo avisa (WARNING) y sigue; acá
-- se corta con un mensaje claro.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('cementeria_owner', 'cementeria_deploy', 'cementeria_app')
       AND (rolsuper OR rolreplication OR rolbypassrls)
  LOOP
    RAISE EXCEPTION '% tiene SUPERUSER, REPLICATION o BYPASSRLS: lo tiene que sacar Supabase (soporte) o hay que borrarlo y crearlo de nuevo', r.rolname;
  END LOOP;
  IF pg_has_role('cementeria_app', 'cementeria_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'cementeria_app es miembro de cementeria_owner y no debe: REVOKE cementeria_owner FROM cementeria_app';
  END IF;
  IF NOT has_database_privilege('cementeria_owner', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'postgres no pudo darle CREATE sobre la base % a cementeria_owner', current_database();
  END IF;
  IF NOT has_schema_privilege('cementeria_owner', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'postgres no pudo darle CREATE sobre el esquema public a cementeria_owner';
  END IF;
  IF NOT has_database_privilege('cementeria_app', current_database(), 'CONNECT')
     OR NOT has_database_privilege('cementeria_deploy', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'cementeria_app o cementeria_deploy no pueden conectarse a la base %', current_database();
  END IF;
END
$$;
