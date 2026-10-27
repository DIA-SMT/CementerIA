-- RLS como defensa extra (27/10/2026; docs/despliegue.md, "Base en Supabase").
-- Escrita a mano: Prisma no modela RLS ni políticas, y `migrate diff` no las
-- toca (no aparecen como diferencia ni las borra).
--
-- La base va a Supabase, que publica el esquema public por su Data API
-- (PostgREST) con los roles anon y authenticated. Las barreras, en orden:
--   1. la Data API apagada en el panel;
--   2. anon, authenticated y service_role sin ningún privilegio sobre las
--      tablas (scripts/supabase/sql/cierre-api-*.sql);
--   3. esta: RLS habilitado en TODAS las tablas de public y auditoria, con una
--      sola política, para cementeria_app. Si alguien le diera un GRANT a anon
--      o authenticated por error, igual no verían ni podrían escribir una fila:
--      sin política para ellos, RLS no deja pasar nada.
--
-- Qué no cambia:
--   * cementeria_app: su política deja todo (USING true, WITH CHECK true). Lo
--     que puede hacer lo siguen decidiendo los GRANTs (sección 2.11) y los
--     triggers; RLS solo filtra a los demás roles. Vale también para los roles
--     miembros de cementeria_app (los de prueba de tests/integracion).
--   * cementeria_owner (y deploy, que entra como owner): es dueño de las tablas
--     y RLS no se FUERZA (no hay FORCE ROW LEVEL SECURITY), así que no lo
--     filtra: migraciones, `pg_dump` con deploy y la verificación nocturna como
--     antes.
--   * Superusuario: nunca lo filtra RLS (restauración de prueba, Sistemas).
--   * Un rol de solo lectura con pg_read_all_data (el `cementeria_backup` que
--     propone docs/despliegue.md para el pg_dump del servidor municipal) SÍ
--     queda filtrado: pg_dump fallaría. Ese rol necesita BYPASSRLS (lo da el
--     superusuario) o hacer el dump con cementeria_deploy.
--
-- Las tablas nuevas de migraciones futuras NO quedan cubiertas solas: cada
-- migración que cree una tabla tiene que agregar
--     ALTER TABLE <tabla> ENABLE ROW LEVEL SECURITY;
--     CREATE POLICY cementeria_app ON <tabla> FOR ALL TO cementeria_app USING (true) WITH CHECK (true);
-- tests/integracion/rls.test.ts falla si alguna tabla queda sin RLS o sin la
-- política.

DO $$
BEGIN
  IF current_user <> 'cementeria_owner' THEN
    RAISE EXCEPTION 'Las migraciones deben correr como cementeria_owner (vía cementeria_deploy), no como %', current_user;
  END IF;
END
$$;

-- Todas las tablas de CementerIA (las del owner en public y auditoria), sin
-- lista escrita a mano para que no se escape ninguna. _prisma_migrations
-- también: es del owner, la app no tiene privilegios sobre ella y no lleva
-- política (nadie más que el owner la lee).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname AS esquema, c.relname AS tabla
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname IN ('public', 'auditoria')
       AND c.relowner = 'cementeria_owner'::regrole
     ORDER BY 1, 2
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.esquema, t.tabla);
    IF t.tabla <> '_prisma_migrations' THEN
      EXECUTE format(
        'CREATE POLICY cementeria_app ON %I.%I AS PERMISSIVE FOR ALL TO cementeria_app USING (true) WITH CHECK (true)',
        t.esquema, t.tabla);
    END IF;
  END LOOP;
END
$$;
