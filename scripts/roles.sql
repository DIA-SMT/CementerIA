-- Roles de CementerIA para PRODUCCIÓN, staging y la restauración de prueba.
-- Ver docs/propuesta-mvp.md, sección 2 ("Roles de base") y sección 6
-- ("Backups"), y docs/pedidos-dia-1.md (A2 y A7).
--
-- Los roles son globales del clúster y `pg_dump` no los incluye: este script se
-- corre antes de la primera migración y antes de restaurar un dump. Lo corre el
-- superusuario (Sistemas), con psql:
--
--   psql -h <host> -U postgres -d postgres -v ON_ERROR_STOP=1 -f scripts/roles.sql
--
-- Es idempotente: crea lo que falta y reafirma los atributos de lo que existe.
--
-- No lleva contraseñas, para que el archivo se pueda versionar. Después de
-- correrlo, el superusuario les pone clave a los dos roles con login, sin que
-- quede en el historial de la consola:
--
--   \password cementeria_app
--   \password cementeria_deploy
--
-- Diferencias con scripts/db-init.sql (que es de desarrollo y tests): acá el
-- owner NO tiene CREATEDB (no hay shadow database en producción), no se crea
-- la base ni las extensiones (eso es A2: la base la crea Sistemas con dueño
-- cementeria_owner, y las extensiones las crea la migración inicial si faltan)
-- y no se tocan contraseñas.

\set ON_ERROR_STOP on

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

-- Atributos mínimos, reafirmados en cada corrida. Ninguno es superusuario ni
-- puede crear bases o roles: lo único que puede alterar el historial es el
-- superusuario del clúster (riesgo residual documentado en la propuesta, 2.13(b)).
ALTER ROLE cementeria_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE cementeria_deploy LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE cementeria_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- deploy no hereda los privilegios del owner (NOINHERIT): los toma con SET ROLE
-- al conectarse. Así todo lo que crea `prisma migrate deploy`, incluida
-- `_prisma_migrations`, queda a nombre de cementeria_owner y no del login. La
-- primera migración se niega a correr si current_user no es cementeria_owner.
GRANT cementeria_owner TO cementeria_deploy;
ALTER ROLE cementeria_deploy SET role = 'cementeria_owner';

-- cementeria_app no pertenece a ningún otro rol: sus permisos sobre las tablas
-- los otorgan las migraciones, uno por uno (sección 2.11).
DO $$
DECLARE
  sobrante record;
BEGIN
  FOR sobrante IN
    SELECT r.rolname
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
     WHERE m.member = 'cementeria_app'::regrole
  LOOP
    RAISE WARNING 'cementeria_app es miembro de % y no debería: revisar y quitarlo con REVOKE', sobrante.rolname;
  END LOOP;
END
$$;

-- Control final: lo mismo que pide verificar el pedido A2.
SELECT rolname, rolsuper, rolinherit, rolcanlogin, rolcreaterole, rolcreatedb
  FROM pg_roles
 WHERE rolname LIKE 'cementeria%'
 ORDER BY rolname;
