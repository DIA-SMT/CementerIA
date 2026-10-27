-- Migración 20261026120000_cadena_hash, como cementeria_owner.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: prisma/migrations/20261026120000_cadena_hash/migration.sql (checksum ddfba680fe23587457cf7c4a826ccab564085c10781fcbbbf1a55ee037843008).
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
  IF EXISTS (SELECT FROM public._prisma_migrations WHERE migration_name = '20261026120000_cadena_hash' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'La migración 20261026120000_cadena_hash ya está aplicada: no hay nada que hacer (no se cambió nada).';
  END IF;
END
$$;
-- Como `prisma migrate deploy` con cementeria_deploy: su zona horaria.
SET LOCAL timezone = 'America/Argentina/Tucuman';
-- ===== prisma/migrations/20261026120000_cadena_hash/migration.sql (sin cambios) =====
-- Cadena de hash del historial (26/10/2026). Escrita a mano.
-- Origen: docs/propuesta-mvp.md, sección 8, "Fase 2": "cadena de hash por
-- expediente con una sola función SQL f_hash_movimiento, que usen el trigger
-- y el verificador". Deja de ser fase 2 (Tramita Capital, otro sistema de la
-- Dirección, ya tiene sus fojas encadenadas). El export nocturno firmado con
-- HMAC y el rol cementeria_verificador siguen pendientes.
--
--   1. Columnas hash y hash_anterior en movimientos (también en schema.prisma)
--   2. f_hash_inicial() y f_hash_movimiento(): el formato canónico
--   3. movimientos_sellar: encadena cada movimiento nuevo
--   4. Backfill de los movimientos existentes (con movimientos_inmutables
--      deshabilitado SOLO dentro de esta migración)
--   5. CHECK: hash y hash_anterior siempre presentes y en hex
--   6. f_verificar_cadena(): recalcula la cadena de un expediente
--   7. auditoria.accesos: la acción 'verificar_historial'
--
-- SHA-256 con sha256() de PostgreSQL (nativa desde la versión 11): no hace
-- falta pgcrypto ni ninguna extensión nueva, ni en desarrollo
-- (scripts/db-init.sql) ni en producción (scripts/roles.sql, pedido A2).
--
-- Qué detecta y qué no (docs/propuesta-mvp.md, 2.13(b)): un UPDATE o un
-- DELETE hecho por un superusuario saltando los triggers deja la cadena rota
-- en el primer movimiento tocado, y f_verificar_cadena lo encuentra. La
-- función de hash es pública y no tiene clave: quien pueda reescribir el
-- historial puede también recalcular la cadena desde ese punto hasta el final,
-- o borrar los últimos movimientos. Eso se detecta comparando el hash final
-- con una copia que no esté en la base: la huella impresa en la carátula y en
-- el historial (los primeros 16 caracteres del hash del último movimiento) y,
-- en la fase 2, el export firmado de las cabezas de cada cadena.
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
-- 1. Columnas (también en schema.prisma, como String?)
-- ===========================================================================
--
-- Nulables para Prisma (así el cliente no las pide al crear un movimiento: las
-- fija el trigger, como secuencia y registrado_en); el CHECK del punto 5 las
-- exige después del backfill. Hex en minúsculas de SHA-256: 64 caracteres.

ALTER TABLE "movimientos"
  ADD COLUMN "hash" TEXT,
  ADD COLUMN "hash_anterior" TEXT;

-- ===========================================================================
-- 2. El formato canónico
-- ===========================================================================

-- El "hash anterior" del primer movimiento de cada expediente: no hay
-- movimiento anterior, y en vez de una constante se encadena contra el número
-- interno, que no cambia nunca (lo asigna el alta). Así la cadena queda atada
-- al número que figura en el papel: no se puede trasplantar a otro expediente.
--   f_hash_inicial('CEM-2026-00042') = sha256('cementeria-inicio-v1|CEM-2026-00042') en hex
CREATE FUNCTION public.f_hash_inicial(numero_interno text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT encode(sha256(convert_to('cementeria-inicio-v1|' || numero_interno, 'UTF8')), 'hex') $$;

-- El hash de un movimiento: SHA-256, en hex, de una lista EXPLÍCITA de campos
-- (no to_jsonb de la fila: una columna nueva no tiene que cambiar los hashes
-- viejos, y el orden de las claves no puede depender de nada). La usan el
-- trigger, el backfill y el verificador: una sola definición.
--
-- Formato (versión 1), en UTF-8:
--   cementeria-mov-v1|<c1>|<c2>|…|<c22>
-- donde cada campo es "-" si es NULL y "<largo>:<valor>" si no, con el largo
-- en caracteres. El largo hace que el formato no sea ambiguo aunque un texto
-- traiga "|", ":" o "-" (una observación "-" es "1:-", no NULL).
--
-- Campos, en este orden:
--    1 expediente_id            bigint como texto
--    2 secuencia                entero
--    3 tipo
--    4 fecha_efectiva           UTC, YYYY-MM-DDTHH:MI:SS.ffffffZ (microsegundos)
--    5 precision_fecha
--    6 registrado_en            como fecha_efectiva
--    7 usuario_id
--    8 area_usuario_id          (lo completa el trigger desde usuarios)
--    9 paso_origen
--   10 paso_destino
--   11 area_origen_id
--   12 area_destino_id
--   13 estado_anterior
--   14 estado_nuevo
--   15 observacion
--   16 motivo
--   17 datos                    jsonb::text: PostgreSQL lo escribe siempre igual
--                              para el mismo jsonb (claves ordenadas, sin
--                              duplicados, espacios fijos)
--   18 corrige_movimiento_id
--   19 carga_historica          true o false
--   20 fuente
--   21 comando_id               uuid en minúsculas con guiones
--   22 hash_anterior
--
-- Las fechas van con AT TIME ZONE 'UTC' explícito: el hash no depende de la
-- zona de la sesión (la app escribe en UTC y psql en hora de Tucumán). Ni el
-- id del movimiento ni el hash propio entran: el id lo da la identity (y las
-- correcciones lo referencian con su FK) y el hash es el resultado.
CREATE FUNCTION public.f_hash_movimiento(m public.movimientos) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
  SELECT encode(sha256(convert_to(
           'cementeria-mov-v1' || string_agg(
             '|' || CASE WHEN c.valor IS NULL THEN '-' ELSE char_length(c.valor)::text || ':' || c.valor END,
             '' ORDER BY c.orden),
           'UTF8')), 'hex')
    FROM unnest(ARRAY[
      m.expediente_id::text,
      m.secuencia::text,
      m.tipo,
      to_char(m.fecha_efectiva AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      m.precision_fecha,
      to_char(m.registrado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      m.usuario_id::text,
      m.area_usuario_id::text,
      m.paso_origen,
      m.paso_destino,
      m.area_origen_id::text,
      m.area_destino_id::text,
      m.estado_anterior,
      m.estado_nuevo,
      m.observacion,
      m.motivo,
      m.datos::text,
      m.corrige_movimiento_id::text,
      m.carga_historica::text,
      m.fuente,
      m.comando_id::text,
      m.hash_anterior
    ]) WITH ORDINALITY AS c(valor, orden)
$$;

-- ===========================================================================
-- 3. movimientos_sellar
-- ===========================================================================
--
-- La de reglas_base con dos cambios:
--   - la secuencia y el hash anterior salen del último movimiento del
--     expediente, leído bajo el mismo FOR UPDATE sobre el expediente que ya
--     serializaba la secuencia: dos inserciones simultáneas no pueden
--     encadenarse contra el mismo anterior;
--   - al final fija hash_anterior y hash. Va después de area_usuario_id, que
--     entra en el hash. Lo que mande la app en esas columnas se pisa, como
--     registrado_en.
-- CREATE OR REPLACE conserva el trigger y su ENABLE ALWAYS.

CREATE OR REPLACE FUNCTION public.movimientos_sellar() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  actor integer;
  numero text;
  ultima integer;
  anterior text;
BEGIN
  -- Serializa los movimientos de un mismo expediente: sin el lock, dos
  -- inserciones simultáneas calcularían la misma secuencia y el mismo anterior.
  SELECT e.numero_interno INTO numero FROM public.expedientes e WHERE e.id = NEW.expediente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el expediente %', NEW.expediente_id;
  END IF;

  SELECT m.secuencia, m.hash
    INTO ultima, anterior
    FROM public.movimientos m
   WHERE m.expediente_id = NEW.expediente_id
   ORDER BY m.secuencia DESC
   LIMIT 1;
  NEW.secuencia := coalesce(ultima, 0) + 1;

  -- La fecha de registro no la elige nadie desde la app.
  NEW.registrado_en := now();

  actor := public.f_actor();
  IF NEW.usuario_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'El movimiento declara usuario_id % pero el actor de la transacción es %',
      NEW.usuario_id, actor;
  END IF;

  SELECT u.area_id INTO NEW.area_usuario_id FROM public.usuarios u WHERE u.id = NEW.usuario_id;

  -- La cadena: el primero contra el número interno, el resto contra el anterior.
  NEW.hash_anterior := CASE WHEN ultima IS NULL THEN public.f_hash_inicial(numero) ELSE anterior END;
  NEW.hash := public.f_hash_movimiento(NEW);
  RETURN NEW;
END
$$;

-- ===========================================================================
-- 4. Backfill
-- ===========================================================================
--
-- movimientos_inmutables rechaza todo UPDATE, también al owner. Para escribir
-- el hash de los movimientos que ya existen se deshabilita SOLO acá, dentro de
-- la transacción de esta migración, y se vuelve a habilitar ENABLE ALWAYS
-- antes de terminar. Es aceptable porque:
--   - todavía no hay producción: lo que se encadena son datos ficticios de
--     desarrollo y staging;
--   - es DDL del owner: queda en el log con log_statement = 'ddl' (2.13(b)) y,
--     si algo falla, la transacción entera se deshace con el trigger intacto;
--   - solo se escriben hash y hash_anterior, calculados con la misma función
--     que usa el trigger, en el orden de la secuencia de cada expediente.
-- tests/integracion/semilla-escenarios.test.ts corre este mismo bloque (entre
-- las marcas) sobre los escenarios de la semilla y controla que dé los mismos
-- hashes que el trigger.

-- <backfill>
ALTER TABLE public.movimientos DISABLE TRIGGER movimientos_inmutables;

DO $$
DECLARE
  e record;
  m public.movimientos;
  anterior text;
BEGIN
  FOR e IN SELECT x.id, x.numero_interno FROM public.expedientes x ORDER BY x.id LOOP
    anterior := public.f_hash_inicial(e.numero_interno);
    FOR m IN SELECT * FROM public.movimientos y WHERE y.expediente_id = e.id ORDER BY y.secuencia LOOP
      m.hash_anterior := anterior;
      m.hash := public.f_hash_movimiento(m);
      UPDATE public.movimientos SET hash_anterior = m.hash_anterior, hash = m.hash WHERE id = m.id;
      anterior := m.hash;
    END LOOP;
  END LOOP;
END
$$;

ALTER TABLE public.movimientos ENABLE ALWAYS TRIGGER movimientos_inmutables;
-- </backfill>

-- ===========================================================================
-- 5. CHECK
-- ===========================================================================
--
-- Con IS NOT NULL explícito: con NULL, la expresión regular da "desconocido"
-- y un CHECK lo acepta.
ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_hash_check CHECK (
    hash IS NOT NULL AND hash ~ '^[0-9a-f]{64}$'
    AND hash_anterior IS NOT NULL AND hash_anterior ~ '^[0-9a-f]{64}$'
  );

-- ===========================================================================
-- 6. f_verificar_cadena
-- ===========================================================================
--
-- Recorre los movimientos del expediente por secuencia y devuelve una fila:
--   integra          true si la cadena entera coincide
--   movimientos      cuántos movimientos tiene
--   hash_final       el hash guardado del último (NULL si no tiene ninguno)
--   secuencia_rota   la primera secuencia con problemas (NULL si está íntegra)
--   motivo           por qué (NULL si está íntegra):
--     secuencia_faltante      falta esa secuencia (un movimiento borrado, o
--                             las secuencias no empiezan en 1)
--     hash_anterior_distinto  hash_anterior no es el hash del movimiento
--                             anterior (o el inicial, en el primero)
--     hash_distinto           el hash guardado no es el que da recalcularlo:
--                             cambió algún campo del movimiento
--     sin_movimientos         ni siquiera el alta
-- Solo lee: la puede llamar la app (EXECUTE es de PUBLIC y cementeria_app
-- tiene SELECT sobre movimientos), el script nocturno y la verificación de una
-- restauración (en una transacción de solo lectura). Los últimos movimientos
-- borrados no rompen nada: eso lo muestra la huella impresa (ver arriba).
CREATE FUNCTION public.f_verificar_cadena(expediente bigint)
  RETURNS TABLE (integra boolean, movimientos integer, hash_final text, secuencia_rota integer, motivo text)
  LANGUAGE plpgsql STABLE
  AS $$
#variable_conflict use_column
DECLARE
  numero text;
  m public.movimientos;
  esperada integer := 1;
  anterior text;
  total integer;
  ultimo text;
BEGIN
  SELECT x.numero_interno INTO numero FROM public.expedientes x WHERE x.id = expediente;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el expediente %', expediente;
  END IF;

  SELECT count(*)::integer INTO total FROM public.movimientos y WHERE y.expediente_id = expediente;
  SELECT y.hash INTO ultimo FROM public.movimientos y WHERE y.expediente_id = expediente ORDER BY y.secuencia DESC LIMIT 1;
  IF total = 0 THEN
    RETURN QUERY SELECT false, 0, NULL::text, 1, 'sin_movimientos'::text;
    RETURN;
  END IF;

  anterior := public.f_hash_inicial(numero);
  FOR m IN SELECT * FROM public.movimientos y WHERE y.expediente_id = expediente ORDER BY y.secuencia LOOP
    IF m.secuencia <> esperada THEN
      RETURN QUERY SELECT false, total, ultimo, esperada, 'secuencia_faltante'::text;
      RETURN;
    END IF;
    IF m.hash_anterior IS DISTINCT FROM anterior THEN
      RETURN QUERY SELECT false, total, ultimo, m.secuencia, 'hash_anterior_distinto'::text;
      RETURN;
    END IF;
    IF m.hash IS DISTINCT FROM public.f_hash_movimiento(m) THEN
      RETURN QUERY SELECT false, total, ultimo, m.secuencia, 'hash_distinto'::text;
      RETURN;
    END IF;
    anterior := m.hash;
    esperada := esperada + 1;
  END LOOP;

  RETURN QUERY SELECT true, total, ultimo, NULL::integer, NULL::text;
END
$$;

-- ===========================================================================
-- 7. auditoria.accesos: 'verificar_historial'
-- ===========================================================================
--
-- "Verificar integridad" de la ficha (un expediente) y la verificación de
-- todos los expedientes (el admin y el script nocturno, `npm run
-- historial:verificar`) quedan registradas, con el resultado en `detalle`.
ALTER TABLE auditoria.accesos
  DROP CONSTRAINT accesos_accion_check,
  ADD CONSTRAINT accesos_accion_check CHECK (accion IN (
    'ingreso', 'ingreso_rechazado', 'salida', 'ver_expediente', 'ver_datos_completos',
    'ver_adjunto', 'descargar_adjunto', 'imprimir', 'exportar', 'verificar_historial'));
-- ===== fin de 20261026120000_cadena_hash =====

-- La fila de Prisma, con su checksum (SHA-256 de migration.sql): después
-- `prisma migrate deploy` la da por aplicada.
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'ddfba680fe23587457cf7c4a826ccab564085c10781fcbbbf1a55ee037843008', now(), '20261026120000_cadena_hash', NULL, NULL, now(), 1);

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
