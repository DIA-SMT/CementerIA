-- Roles, bases y extensiones de CementerIA. Ver docs/propuesta-mvp.md, sección 2
-- ("Roles de base") y sección 6 ("Desarrollo local").
--
-- Se corre como superusuario y es idempotente: se puede correr las veces que
-- haga falta. Lo corre solo `scripts/db-local.mjs` al crear el clúster local y
-- el arnés de integración (tests/integracion/global-setup.ts). Con psql, sobre
-- cualquier PostgreSQL 15:
--
--   PGOPTIONS="-c cementeria.clave_app=... -c cementeria.clave_deploy=..." \
--     psql -h localhost -U postgres -d postgres -f scripts/db-init.sql
--
-- Las contraseñas llegan como parámetros de sesión (`cementeria.clave_*`) y no
-- escritas acá, para que el archivo se pueda versionar. Si un parámetro falta,
-- la contraseña de ese rol no se toca.
--
-- Es para DESARROLLO y tests: el owner recibe CREATEDB para la shadow database
-- de `prisma migrate dev`. En producción los roles los crea Sistemas, sin
-- CREATEDB y con la credencial de deploy fuera del servidor.
--
-- Solo usa lo que entiende el ejecutor de db-local.mjs: sentencias terminadas en
-- `;`, bloques DO con $$, `\gexec` y `\connect`. No agregar otros comandos de
-- psql sin enseñárselos al ejecutor.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

DO $$
BEGIN
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

-- Los atributos se reafirman siempre: si alguien los tocó a mano, correr el
-- script los devuelve al estado esperado.
ALTER ROLE cementeria_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS CREATEDB;
ALTER ROLE cementeria_deploy LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE cementeria_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- deploy no hereda los privilegios del owner (NOINHERIT): los toma con SET ROLE
-- al conectarse. Así todo lo que crea `prisma migrate deploy`, incluida
-- `_prisma_migrations`, queda a nombre de cementeria_owner y no del login.
GRANT cementeria_owner TO cementeria_deploy;
ALTER ROLE cementeria_deploy SET role = 'cementeria_owner';

-- Contraseñas: solo si llegaron por parámetro.
DO $$
DECLARE
  clave text;
BEGIN
  clave := current_setting('cementeria.clave_app', true);
  IF coalesce(clave, '') <> '' THEN
    EXECUTE format('ALTER ROLE cementeria_app PASSWORD %L', clave);
  END IF;
  clave := current_setting('cementeria.clave_deploy', true);
  IF coalesce(clave, '') <> '' THEN
    EXECUTE format('ALTER ROLE cementeria_deploy PASSWORD %L', clave);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Bases
-- ---------------------------------------------------------------------------

-- CREATE DATABASE no admite IF NOT EXISTS ni corre dentro de un bloque DO.
SELECT 'CREATE DATABASE cementeria OWNER cementeria_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cementeria') \gexec

-- La shadow database de `prisma migrate dev` y `prisma migrate diff`. Prisma la
-- vacía cada vez que la usa; nunca guarda nada que importe.
SELECT 'CREATE DATABASE cementeria_shadow OWNER cementeria_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cementeria_shadow') \gexec

ALTER DATABASE cementeria OWNER TO cementeria_owner;
ALTER DATABASE cementeria_shadow OWNER TO cementeria_owner;

-- La zona horaria va en la base y no en el servidor: el PostgreSQL municipal es
-- compartido y no se le puede cambiar el default.
ALTER DATABASE cementeria SET timezone TO 'America/Argentina/Tucuman';
ALTER DATABASE cementeria_shadow SET timezone TO 'America/Argentina/Tucuman';

-- Que solo entren los roles de la aplicación (y el superusuario).
REVOKE ALL ON DATABASE cementeria FROM PUBLIC;
REVOKE ALL ON DATABASE cementeria_shadow FROM PUBLIC;
GRANT CONNECT ON DATABASE cementeria TO cementeria_app, cementeria_deploy;
GRANT CONNECT ON DATABASE cementeria_shadow TO cementeria_deploy;

-- ---------------------------------------------------------------------------
-- Extensiones (dentro de la base)
-- ---------------------------------------------------------------------------

\connect cementeria

-- PG15 ya le saca CREATE a PUBLIC sobre el esquema public; se repite por si el
-- motor de desarrollo es otro.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Se crean como el owner y no como superusuario. Las dos son extensiones
-- "trusted", así que el owner puede crearlas y queda como su dueño; si quedaran
-- a nombre del superusuario, un `prisma migrate reset` (que borra el esquema
-- public) fallaría por no poder borrarlas. La migración inicial también las
-- crea con IF NOT EXISTS, para la shadow database y para producción.
SET ROLE cementeria_owner;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
RESET ROLE;
