-- Migración 20261028120000_consulta_publica, como cementeria_owner.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: prisma/migrations/20261028120000_consulta_publica/migration.sql (checksum 7a50fa9b5b7b44fcdd4fc2042682003d78bc7733532597ebb3d43c1cd0393d12).
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
  IF EXISTS (SELECT FROM public._prisma_migrations WHERE migration_name = '20261028120000_consulta_publica' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'La migración 20261028120000_consulta_publica ya está aplicada: no hay nada que hacer (no se cambió nada).';
  END IF;
END
$$;
-- Como `prisma migrate deploy` con cementeria_deploy: su zona horaria.
SET LOCAL timezone = 'America/Argentina/Tucuman';
-- ===== prisma/migrations/20261028120000_consulta_publica/migration.sql (sin cambios) =====
-- Consulta pública del trámite (28/10/2026; docs/api-dominio.md, sección 24).
-- El concesionario sigue su expediente desde /consulta con el número y un
-- código de consulta que le da Mesa de Entradas en un comprobante. Escrita a
-- mano (la columna, la tabla y sus índices son los que genera `prisma migrate
-- diff` para prisma/schema.prisma; lo demás Prisma no lo modela):
--
--   1. La guarda de dueño, como las anteriores.
--   2. f_codigo_consulta_aleatorio(): un código de 8 caracteres de Crockford
--      base32 sin I, L, O ni U (0-9 y A-Z menos esas cuatro), con 40 bits del
--      generador criptográfico de PostgreSQL. Sin pgcrypto (no está en
--      scripts/db-init.sql ni en 01_extensiones.sql de Supabase):
--      gen_random_uuid() es nativa desde PostgreSQL 13 y usa
--      pg_strong_random(); de un UUID v4 los 5 primeros bytes son aleatorios
--      enteros (la versión y la variante están en los bytes 6 y 8).
--   3. expedientes.codigo_consulta: se agrega nulable, se rellena en los
--      expedientes que ya existen (con una vuelta más para las colisiones, por
--      improbables que sean), y queda NOT NULL, UNIQUE, con un CHECK del
--      formato y un DEFAULT con la función del punto 2 (para lo que se inserta
--      por SQL, como las pruebas: el alta del dominio lo genera y lo pasa).
--      Se guarda sin guion; la pantalla lo muestra XXXX-XXXX.
--   4. expedientes_codigo_consulta: el código no cambia con un UPDATE suelto,
--      ni de la app ni del owner. Solo con "Regenerar código de consulta": la
--      transacción lo pide para ESE expediente (app.regenerar_codigo_consulta)
--      y trae motivo (app.motivo, 10 caracteres o más). El mismo trigger deja
--      `regenerar_codigo_consulta` en auditoria.accesos con el motivo (nunca el
--      código): no hay cambio del código sin su constancia. No es un
--      movimiento: el código no es parte del expediente de papel (como una
--      contraseña blanqueada, 'blanqueo_clave'), así que no toca el historial,
--      la versión ni la cadena de hash.
--   5. auditoria.intentos_consulta: los intentos FALLIDOS de la consulta
--      pública, para el límite por IP y por número (en la base: vale con
--      varias instancias en Vercel). La app inserta y lee; borra solo lo
--      vencido (trigger intentos_consulta_proteger): nada de UPDATE, y un
--      intento de menos de 7 días no se borra. RLS con la política de
--      cementeria_app (como *_rls_defensa).
--   6. f_purgar_intentos_consulta(): borra los intentos de más de 7 días
--      (retención corta: alcanzan para ver un ataque, y la IP es un dato
--      personal). La llama la tarea de cada mañana
--      (src/lib/tareas/programadas.ts) con el rol de la app.
--   7. auditoria.accesos: acciones nuevas 'consulta_publica' (una consulta
--      correcta, sin usuario: para las métricas) y 'regenerar_codigo_consulta'.
--
-- Sin SECURITY DEFINER, como las demás funciones (las funciones propias
-- corren con los privilegios de quien escribe: tests/integracion/privilegios.test.ts).
--
-- Qué expone la consulta pública (sin datos personales) y la retención están
-- en docs/borrador-tecnico-art22.md.
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
-- 2. El generador en SQL
-- ===========================================================================

-- El mismo alfabeto que src/lib/dominio/expedientes/codigo-consulta.ts.
-- 40 bits = 8 grupos de 5 bits = 8 caracteres, sin sesgo.
CREATE FUNCTION public.f_codigo_consulta_aleatorio() RETURNS text
  LANGUAGE sql VOLATILE PARALLEL SAFE
  AS $$
  SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((r.b >> (35 - 5 * i)) & 31)::integer + 1, 1), '' ORDER BY i)
    FROM (SELECT ('x' || substr(encode(uuid_send(gen_random_uuid()), 'hex'), 1, 10))::bit(40)::bigint AS b) r,
         generate_series(0, 7) AS i
$$;

-- ===========================================================================
-- 3. La columna y el relleno
-- ===========================================================================

ALTER TABLE "expedientes" ADD COLUMN "codigo_consulta" TEXT;

-- El relleno no es un cambio del expediente: expedientes_preparar (que exige
-- actor y mueve actualizado_en) se apaga SOLO dentro de esta migración, que es
-- una única transacción, y vuelve a ALWAYS al terminar.
ALTER TABLE public.expedientes DISABLE TRIGGER expedientes_preparar;

UPDATE public.expedientes SET codigo_consulta = public.f_codigo_consulta_aleatorio() WHERE codigo_consulta IS NULL;

-- Las colisiones (1 en un billón por par de expedientes): se queda con el
-- código el de id menor y los demás sacan otro, hasta que no quede ninguna.
DO $$
DECLARE
  vuelta integer := 0;
BEGIN
  LOOP
    UPDATE public.expedientes e
       SET codigo_consulta = public.f_codigo_consulta_aleatorio()
     WHERE e.id IN (SELECT d.id
                      FROM (SELECT x.id, row_number() OVER (PARTITION BY x.codigo_consulta ORDER BY x.id) AS n
                              FROM public.expedientes x) d
                     WHERE d.n > 1);
    EXIT WHEN NOT FOUND;
    vuelta := vuelta + 1;
    IF vuelta > 50 THEN
      RAISE EXCEPTION 'No se pudieron asignar códigos de consulta únicos después de 50 vueltas';
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.expedientes ENABLE ALWAYS TRIGGER expedientes_preparar;

ALTER TABLE "expedientes"
  ALTER COLUMN "codigo_consulta" SET NOT NULL,
  ALTER COLUMN "codigo_consulta" SET DEFAULT f_codigo_consulta_aleatorio();

-- CreateIndex
CREATE UNIQUE INDEX "expedientes_codigo_consulta_key" ON "expedientes"("codigo_consulta");

ALTER TABLE public.expedientes
  ADD CONSTRAINT expedientes_codigo_consulta_check CHECK (codigo_consulta ~ '^[0-9A-HJKMNP-TV-Z]{8}$');

-- ===========================================================================
-- 4. "Regenerar código de consulta": el único cambio, y con constancia
-- ===========================================================================
--
-- cementeria_app tiene UPDATE sobre toda la tabla expedientes (reglas_base,
-- 2.11): un GRANT por columna obligaría a enumerar las demás en cada migración
-- futura. En cambio, este trigger rechaza todo cambio del código salvo el que
-- la transacción pidió para ese expediente, con
--   set_config('app.regenerar_codigo_consulta', '<id del expediente>', true)
-- y con motivo (app.motivo, el de conActor()). Lo hace
-- src/lib/dominio/expedientes/comprobante.ts. El pedido vale para UN cambio:
-- el trigger lo borra al usarlo. La IP, si viene, en app.ip (como la guarda
-- el resto de auditoria.accesos).
CREATE FUNCTION public.expedientes_codigo_consulta() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  motivo text := btrim(coalesce(current_setting('app.motivo', true), ''));
  ip text := nullif(btrim(coalesce(current_setting('app.ip', true), '')), '');
BEGIN
  IF NEW.codigo_consulta IS NOT DISTINCT FROM OLD.codigo_consulta THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('app.regenerar_codigo_consulta', true), '') <> OLD.id::text THEN
    RAISE EXCEPTION 'El código de consulta solo cambia con "Regenerar código de consulta" (app.regenerar_codigo_consulta)';
  END IF;
  IF char_length(motivo) < 10 THEN
    RAISE EXCEPTION 'Regenerar el código de consulta exige un motivo de 10 caracteres o más (app.motivo)';
  END IF;
  PERFORM set_config('app.regenerar_codigo_consulta', '', true);
  -- El motivo y nada del código: ni el viejo ni el nuevo quedan en la auditoría.
  INSERT INTO auditoria.accesos (usuario_id, accion, expediente_id, detalle, ip)
  VALUES (public.f_actor(), 'regenerar_codigo_consulta', OLD.id, jsonb_build_object('motivo', motivo), ip::inet);
  RETURN NEW;
END
$$;

CREATE TRIGGER expedientes_codigo_consulta
  BEFORE UPDATE OF codigo_consulta ON public.expedientes
  FOR EACH ROW EXECUTE FUNCTION public.expedientes_codigo_consulta();
ALTER TABLE public.expedientes ENABLE ALWAYS TRIGGER expedientes_codigo_consulta;

-- ===========================================================================
-- 5. auditoria.intentos_consulta (lo que genera Prisma, con la identity)
-- ===========================================================================

-- CreateTable
CREATE TABLE "auditoria"."intentos_consulta" (
    "id" BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY,
    "en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" INET,
    "numero" TEXT,
    "resultado" TEXT NOT NULL,

    CONSTRAINT "intentos_consulta_pkey" PRIMARY KEY ("id")
);

-- Los dos conteos del límite: por IP y por número, en los últimos 15 minutos.
-- CreateIndex
CREATE INDEX "intentos_consulta_ip_en_idx" ON "auditoria"."intentos_consulta"("ip", "en");

-- CreateIndex
CREATE INDEX "intentos_consulta_numero_en_idx" ON "auditoria"."intentos_consulta"("numero", "en");

ALTER TABLE auditoria.intentos_consulta
  ADD CONSTRAINT intentos_consulta_resultado_check CHECK (resultado IN ('fallido', 'bloqueado')),
  -- El número canónico (CEM-AAAA-NNNNN, hasta 6 dígitos de secuencia), nunca un texto libre.
  ADD CONSTRAINT intentos_consulta_numero_check CHECK (numero ~ '^CEM-[0-9]{4}-[0-9]{5,6}$');

-- Un intento no se modifica, y no se borra antes de los 7 días (ni la app ni
-- el owner): así el límite de 15 minutos no se puede limpiar a mano.
CREATE FUNCTION public.intentos_consulta_proteger() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.en >= now() - interval '7 days' THEN
      RAISE EXCEPTION 'auditoria.intentos_consulta: solo se borran los intentos de más de 7 días (f_purgar_intentos_consulta)';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'auditoria.intentos_consulta es solo inserción: % rechazado', TG_OP;
END
$$;

CREATE TRIGGER intentos_consulta_proteger
  BEFORE UPDATE OR DELETE ON auditoria.intentos_consulta
  FOR EACH ROW EXECUTE FUNCTION public.intentos_consulta_proteger();
CREATE TRIGGER intentos_consulta_proteger_truncate
  BEFORE TRUNCATE ON auditoria.intentos_consulta
  FOR EACH STATEMENT EXECUTE FUNCTION public.intentos_consulta_proteger();
ALTER TABLE auditoria.intentos_consulta ENABLE ALWAYS TRIGGER intentos_consulta_proteger;
ALTER TABLE auditoria.intentos_consulta ENABLE ALWAYS TRIGGER intentos_consulta_proteger_truncate;

-- Insertar y leer (para contar); DELETE solo para la purga, que el trigger
-- limita a lo vencido. Sin UPDATE.
GRANT SELECT, INSERT, DELETE ON auditoria.intentos_consulta TO cementeria_app;

-- RLS como en *_rls_defensa: una sola política, para cementeria_app.
ALTER TABLE auditoria.intentos_consulta ENABLE ROW LEVEL SECURITY;
CREATE POLICY cementeria_app ON auditoria.intentos_consulta AS PERMISSIVE FOR ALL TO cementeria_app USING (true) WITH CHECK (true);

-- ===========================================================================
-- 6. f_purgar_intentos_consulta
-- ===========================================================================
--
-- La retención (7 días) está en la base, acá y en el trigger: la app no elige
-- qué borra. Devuelve cuántos borró.
CREATE FUNCTION public.f_purgar_intentos_consulta() RETURNS integer
  LANGUAGE sql VOLATILE
  AS $$
  WITH borrados AS (
    DELETE FROM auditoria.intentos_consulta WHERE en < now() - interval '7 days' RETURNING 1
  )
  SELECT count(*)::integer FROM borrados
$$;

-- ===========================================================================
-- 7. auditoria.accesos: la consulta pública y la regeneración del código
-- ===========================================================================
ALTER TABLE auditoria.accesos
  DROP CONSTRAINT accesos_accion_check,
  ADD CONSTRAINT accesos_accion_check CHECK (accion IN (
    'ingreso', 'ingreso_rechazado', 'salida', 'ver_expediente', 'ver_datos_completos',
    'ver_adjunto', 'descargar_adjunto', 'imprimir', 'exportar', 'verificar_historial',
    'bloqueo', 'desbloqueo', 'cambio_clave', 'blanqueo_clave',
    'consulta_publica', 'regenerar_codigo_consulta'));
-- ===== fin de 20261028120000_consulta_publica =====

-- La fila de Prisma, con su checksum (SHA-256 de migration.sql): después
-- `prisma migrate deploy` la da por aplicada.
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '7a50fa9b5b7b44fcdd4fc2042682003d78bc7733532597ebb3d43c1cd0393d12', now(), '20261028120000_consulta_publica', NULL, NULL, now(), 1);

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
