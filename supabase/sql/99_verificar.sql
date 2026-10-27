-- Verificación final: SOLO LECTURA, se puede correr las veces que haga falta.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre entero en el SQL Editor (rol postgres) o con psql.
--
-- Fuente: scripts/supabase/sql/verificar.sql
-- Una fila por control (ok: true bien, false mal, null informativo). Los que leen
-- datos salen en null con el rol postgres: los hace `npm run supabase:verificar`.

-- Verificación final de la base de CementerIA en Supabase. Una sola consulta,
-- de SOLO LECTURA: no cambia nada y se puede correr las veces que haga falta.
-- Devuelve una fila por control: ok = true (bien), false (mal) o null
-- (informativo, o no verificable con el rol que la corre).
--
-- La corre preparar.mjs (y npm run supabase:verificar) como cementeria_app, y
-- es supabase/sql/99_verificar.sql para el SQL Editor (rol postgres). Los
-- controles de catálogo (roles, dueños, triggers, privilegios, RLS) andan con
-- cualquier rol; los que leen datos (semilla, cadena de hash) necesitan los
-- privilegios de la app: con postgres salen en null y los hace
-- `npm run supabase:verificar`. Se ejecutan con query_to_xml para que la falta
-- de permiso no rompa la consulta entera.

WITH
nuestras AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'auditoria')
     AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
),
tablas AS (SELECT * FROM nuestras WHERE relkind IN ('r', 'p')),
funciones AS (
  SELECT p.oid, n.nspname, p.proname, p.proowner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'auditoria')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
     -- Las funciones de event trigger son de la plataforma, no de CementerIA: los
     -- proyectos nuevos de Supabase traen public.rls_auto_enable (activa RLS en
     -- las tablas nuevas), de postgres. Ninguna migración nuestra crea event triggers.
     AND p.prorettype <> 'event_trigger'::regtype
),
api AS (SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')),
ajustes AS (
  SELECT r.rolname, s.setconfig
    FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
   WHERE s.setdatabase = 0 AND r.rolname IN ('cementeria_deploy', 'cementeria_app')
),
datos AS (
  -- Lo que lee filas, solo si este rol puede leerlas (si no, null).
  SELECT
    CASE WHEN has_table_privilege('public.usuarios', 'SELECT') AND has_table_privilege('public.areas', 'SELECT')
              AND has_table_privilege('public.plantillas', 'SELECT') AND has_table_privilege('public.feriados', 'SELECT')
              AND has_table_privilege('public.cementerios', 'SELECT')
      THEN (xpath('/row/v/text()', query_to_xml($q$
        SELECT format('%s áreas, %s cementerios, %s tipos de monumento, %s tipos de trámite, %s feriados, %s plantillas publicadas, %s admin activo(s) con contraseña',
                      (SELECT count(*) FROM public.areas), (SELECT count(*) FROM public.cementerios),
                      (SELECT count(*) FROM public.tipos_monumento), (SELECT count(*) FROM public.tipos_tramite),
                      (SELECT count(*) FROM public.feriados),
                      (SELECT count(*) FROM public.plantillas WHERE estado = 'publicada'),
                      -- Login propio: un admin sin contraseña no puede ingresar.
                      (SELECT count(*) FROM public.usuarios WHERE rol = 'admin' AND activo AND id <> 1 AND clave_hash IS NOT NULL))
               || CASE WHEN (SELECT count(*) FROM public.areas) > 0
                        AND (SELECT count(*) FROM public.cementerios) > 0
                        AND (SELECT count(*) FROM public.plantillas WHERE estado = 'publicada') > 0
                        AND (SELECT count(*) FROM public.feriados) > 0
                        AND (SELECT count(*) FROM public.usuarios WHERE rol = 'admin' AND activo AND id <> 1 AND clave_hash IS NOT NULL) > 0
                       THEN '|ok' ELSE '|mal' END AS v $q$, false, true, '')))[1]::text
    END AS semilla,
    CASE WHEN has_table_privilege('public.usuarios', 'SELECT')
      THEN (xpath('/row/v/text()', query_to_xml($q$
        -- Los CUIL de los usuarios ficticios de prisma/semilla/usuarios.ts
        -- (scripts/supabase/lib.test.ts controla que sean los mismos).
        SELECT count(*) AS v FROM public.usuarios
         WHERE cuil IN ('27000000022', '20000000036', '27000000049', '20000000052',
                        '27000000065', '20000000079', '27000000081') $q$, false, true, '')))[1]::text
    END AS ficticios,
    CASE WHEN has_table_privilege('public.expedientes', 'SELECT') AND has_table_privilege('public.movimientos', 'SELECT')
      THEN (xpath('/row/v/text()', query_to_xml($q$
        SELECT format('%s|%s', count(*), count(*) FILTER (WHERE NOT v.integra)) AS v
          FROM public.expedientes e CROSS JOIN LATERAL public.f_verificar_cadena(e.id) v $q$, false, true, '')))[1]::text
    END AS cadena
)
SELECT control, ok, detalle FROM (
  SELECT 1 AS orden, 'conexión' AS control, NULL::boolean AS ok,
         format('%s en la base %s, PostgreSQL %s, zona de la sesión %s',
                current_user, current_database(), current_setting('server_version'), current_setting('TimeZone')) AS detalle

  UNION ALL
  SELECT 2, 'roles: atributos',
         count(*) = 3 AND bool_and(NOT rolsuper AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb)
           AND bool_and(CASE rolname WHEN 'cementeria_owner' THEN NOT rolcanlogin
                                     WHEN 'cementeria_deploy' THEN rolcanlogin AND NOT rolinherit
                                     ELSE rolcanlogin END),
         string_agg(format('%s (%s%s)', rolname, CASE WHEN rolcanlogin THEN 'login' ELSE 'nologin' END,
                           CASE WHEN rolinherit THEN '' ELSE ', noinherit' END), ', ' ORDER BY rolname)
    FROM pg_roles WHERE rolname IN ('cementeria_owner', 'cementeria_deploy', 'cementeria_app')

  UNION ALL
  SELECT 3, 'deploy entra como owner',
         pg_has_role('cementeria_deploy', 'cementeria_owner', 'MEMBER')
           AND coalesce((SELECT 'role=cementeria_owner' = ANY (setconfig) FROM ajustes WHERE rolname = 'cementeria_deploy'), false),
         'cementeria_deploy es miembro de cementeria_owner y tiene role = cementeria_owner'

  UNION ALL
  SELECT 4, 'la app no es el owner',
         NOT pg_has_role('cementeria_app', 'cementeria_owner', 'MEMBER') AND NOT pg_has_role('postgres', 'cementeria_owner', 'USAGE'),
         'ni cementeria_app ni postgres heredan los privilegios de cementeria_owner'

  UNION ALL
  SELECT 5, 'zona horaria por rol',
         EXISTS (SELECT 1 FROM ajustes a CROSS JOIN LATERAL unnest(a.setconfig) x
                  WHERE a.rolname = 'cementeria_app' AND lower(x) = 'timezone=utc')
           AND EXISTS (SELECT 1 FROM ajustes a CROSS JOIN LATERAL unnest(a.setconfig) x
                        WHERE a.rolname = 'cementeria_deploy' AND lower(x) = 'timezone=america/argentina/tucuman'),
         'cementeria_app en UTC (lo exige @prisma/adapter-pg), cementeria_deploy en America/Argentina/Tucuman'

  UNION ALL
  SELECT 6, 'extensiones en public',
         count(*) = 2 AND bool_and(n.nspname = 'public'),
         string_agg(format('%s %s en %s', x.extname, x.extversion, n.nspname), ', ' ORDER BY x.extname)
    FROM pg_extension x JOIN pg_namespace n ON n.oid = x.extnamespace
   WHERE x.extname IN ('unaccent', 'pg_trgm')

  UNION ALL
  SELECT 7, 'f_normalizar (unaccent)',
         public.f_normalizar('GONZÁLEZ, María-José') = 'gonzalez maria jose',
         format('f_normalizar(''GONZÁLEZ, María-José'') = %L', public.f_normalizar('GONZÁLEZ, María-José'))

  UNION ALL
  SELECT 8, 'dueños: tablas, secuencias y vistas',
         count(*) > 0 AND bool_and(relowner = 'cementeria_owner'::regrole),
         coalesce(nullif(string_agg(CASE WHEN relowner <> 'cementeria_owner'::regrole
                                         THEN format('%I.%I es de %s', nspname, relname, relowner::regrole) END, ', '), ''),
                  format('%s objetos, todos de cementeria_owner', count(*)))
    FROM nuestras

  UNION ALL
  SELECT 9, 'dueños: funciones y esquema auditoria',
         bool_and(proowner = 'cementeria_owner'::regrole)
           AND (SELECT nspowner = 'cementeria_owner'::regrole FROM pg_namespace WHERE nspname = 'auditoria'),
         coalesce(nullif(string_agg(CASE WHEN proowner <> 'cementeria_owner'::regrole
                                         THEN format('%I.%I es de %s', nspname, proname, proowner::regrole) END, ', '), ''),
                  format('%s funciones, todas de cementeria_owner', count(*)))
    FROM funciones

  UNION ALL
  SELECT 10, 'triggers ENABLE ALWAYS',
         count(*) > 0 AND bool_and(t.tgenabled = 'A'),
         coalesce(nullif(string_agg(CASE WHEN t.tgenabled <> 'A' THEN format('%s en %I.%I', t.tgname, ta.nspname, ta.relname) END, ', '), ''),
                  format('%s triggers, todos ALWAYS', count(*)))
    FROM pg_trigger t JOIN tablas ta ON ta.oid = t.tgrelid
   WHERE NOT t.tgisinternal

  UNION ALL
  SELECT 11, 'la app no modifica el historial',
         NOT has_table_privilege('cementeria_app', 'public.movimientos', 'UPDATE,DELETE,TRUNCATE')
           -- Por oid: nombrar auditoria.* exige USAGE sobre el esquema, que postgres no tiene.
           AND NOT EXISTS (SELECT 1 FROM tablas WHERE nspname = 'auditoria' AND relname IN ('cambios', 'accesos')
                              AND has_table_privilege('cementeria_app', oid, 'UPDATE,DELETE,TRUNCATE'))
           AND (SELECT count(*) FROM tablas WHERE nspname = 'auditoria' AND relname IN ('cambios', 'accesos')) = 2,
         'sin UPDATE, DELETE ni TRUNCATE sobre movimientos, auditoria.cambios y auditoria.accesos'

  UNION ALL
  SELECT 12, 'API de Supabase: sin privilegios en tablas',
         NOT EXISTS (SELECT 1 FROM api a CROSS JOIN nuestras o
                      WHERE (o.relkind IN ('r', 'p', 'v', 'm')
                             AND has_table_privilege(a.oid, o.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
                         OR (o.relkind = 'S' AND has_sequence_privilege(a.oid, o.oid, 'USAGE,SELECT,UPDATE'))),
         coalesce((SELECT string_agg(DISTINCT format('%s sobre %I.%I', a.rolname, o.nspname, o.relname), ', ')
                     FROM api a CROSS JOIN nuestras o
                    WHERE (o.relkind IN ('r', 'p', 'v', 'm')
                           AND has_table_privilege(a.oid, o.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
                       OR (o.relkind = 'S' AND has_sequence_privilege(a.oid, o.oid, 'USAGE,SELECT,UPDATE'))),
                  format('anon, authenticated y service_role no tienen nada sobre %s tablas y secuencias', (SELECT count(*) FROM nuestras)))

  UNION ALL
  SELECT 13, 'API de Supabase: esquemas',
         CASE WHEN NOT EXISTS (SELECT 1 FROM api) THEN NULL
              ELSE NOT EXISTS (SELECT 1 FROM api WHERE has_schema_privilege(oid, 'auditoria', 'USAGE,CREATE')
                                                    OR has_schema_privilege(oid, 'public', 'CREATE'))
                   AND NOT EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x
                                    WHERE n.nspname IN ('public', 'auditoria') AND x.grantee IN (SELECT oid FROM api)) END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM api) THEN 'no hay roles de la API (no es Supabase)'
              ELSE 'sin GRANT propio sobre public ni auditoria y sin CREATE; el USAGE sobre public que les queda es el de PUBLIC '
                   || '(default de PostgreSQL, lo usan también los servicios de Supabase): no da acceso a ninguna tabla' END

  UNION ALL
  SELECT 14, 'API de Supabase: privilegios por defecto',
         NOT EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) x
                      WHERE d.defaclrole = 'cementeria_owner'::regrole AND x.grantee IN (SELECT oid FROM api)),
         'lo que cree cementeria_owner en el futuro no les da nada a anon, authenticated ni service_role'

  UNION ALL
  SELECT 15, 'RLS en todas las tablas',
         bool_and(relrowsecurity AND NOT relforcerowsecurity
                  AND (relname = '_prisma_migrations'
                       OR EXISTS (SELECT 1 FROM pg_policies p
                                   WHERE p.schemaname = nspname AND p.tablename = relname
                                     AND p.policyname = 'cementeria_app' AND p.roles = '{cementeria_app}'))),
         coalesce(nullif(string_agg(CASE WHEN NOT relrowsecurity THEN format('%I.%I sin RLS', nspname, relname) END, ', '), ''),
                  format('%s tablas con RLS y la política de cementeria_app', count(*)))
    FROM tablas

  UNION ALL
  SELECT 16, 'semilla de producción',
         CASE WHEN d.semilla IS NULL THEN NULL ELSE d.semilla LIKE '%|ok' END,
         coalesce(split_part(d.semilla, '|', 1), 'sin permiso para leer datos con este rol: npm run supabase:verificar')
    FROM datos d

  UNION ALL
  SELECT 17, 'sin usuarios ficticios',
         CASE WHEN d.ficticios IS NULL THEN NULL ELSE d.ficticios = '0' END,
         coalesce(d.ficticios || ' usuarios ficticios de la semilla de desarrollo',
                  'sin permiso para leer datos con este rol: npm run supabase:verificar')
    FROM datos d

  UNION ALL
  SELECT 18, 'cadena de hash del historial',
         CASE WHEN d.cadena IS NULL THEN NULL ELSE split_part(d.cadena, '|', 2) = '0' END,
         coalesce(format('%s expedientes, %s con la cadena rota', split_part(d.cadena, '|', 1), split_part(d.cadena, '|', 2)),
                  'sin permiso para leer datos con este rol: npm run supabase:verificar')
    FROM datos d
) controles
ORDER BY orden;
