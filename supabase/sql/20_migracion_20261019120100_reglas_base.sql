-- Migración 20261019120100_reglas_base, como cementeria_owner.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Fuente: prisma/migrations/20261019120100_reglas_base/migration.sql (checksum 02d0deb5f9f7a47d3501f8425dda267f19fa410c6981b4d598a8773ec8663492).
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
  IF EXISTS (SELECT FROM public._prisma_migrations WHERE migration_name = '20261019120100_reglas_base' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'La migración 20261019120100_reglas_base ya está aplicada: no hay nada que hacer (no se cambió nada).';
  END IF;
END
$$;
-- Como `prisma migrate deploy` con cementeria_deploy: su zona horaria.
SET LOCAL timezone = 'America/Argentina/Tucuman';
-- ===== prisma/migrations/20261019120100_reglas_base/migration.sql (sin cambios) =====
-- Reglas de la base que Prisma no sabe expresar. Escrita a mano.
-- Especificación: docs/propuesta-mvp.md, secciones 2.1 a 2.11.
--
--   1. CHECKs
--   2. Funciones (f_unaccent, f_normalizar, f_actor, días hábiles)
--   3. Usuario técnico SISTEMA (id 1), antes de los triggers de auditoría
--   4. Triggers, todos ENABLE ALWAYS
--   5. Privilegios de cementeria_app
--
-- Prisma no ve CHECKs, funciones, triggers ni GRANTs, así que `migrate diff`
-- tampoco los propone borrar. Lo que sí ve (tablas, índices) está en
-- schema.prisma; no agregar índices acá sin declararlos también allá.
--
-- Las funciones y los triggers nombran siempre las tablas con su esquema: corren
-- con el search_path de quien escribe, que no controlamos.

DO $$
BEGIN
  IF current_user <> 'cementeria_owner' THEN
    RAISE EXCEPTION 'Las migraciones deben correr como cementeria_owner (vía cementeria_deploy), no como %', current_user;
  END IF;
END
$$;

-- ===========================================================================
-- 1. CHECKs
-- ===========================================================================

-- 2.1 areas
ALTER TABLE public.areas
  ADD CONSTRAINT areas_tipo_check CHECK (tipo IN ('interna', 'externa')),
  -- Un área externa no tiene usuarios que decidan no recibir: siempre recibe.
  ADD CONSTRAINT areas_recibe_pases_check CHECK (tipo = 'interna' OR recibe_pases);

-- 2.2 cementerios
ALTER TABLE public.cementerios
  ADD CONSTRAINT cementerios_campos_ubicacion_check CHECK (jsonb_typeof(campos_ubicacion) = 'array');

-- 2.3 tipos_monumento
ALTER TABLE public.tipos_monumento
  ADD CONSTRAINT tipos_monumento_codigo_check CHECK (codigo ~ '^[A-Z_]+$');

-- 2.4 usuarios
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_cuil_check CHECK (cuil ~ '^[0-9]{11}$'),
  ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('operador', 'lectura', 'admin')),
  ADD CONSTRAINT usuarios_area_check CHECK (rol = 'admin' OR area_id IS NOT NULL),
  -- SISTEMA (id 1) firma la semilla y los scripts; nadie ingresa con él. La app
  -- tiene UPDATE sobre usuarios, así que la regla tiene que estar en la base.
  ADD CONSTRAINT usuarios_sistema_inactivo_check CHECK (id <> 1 OR NOT activo);

-- 2.5 plantillas
ALTER TABLE public.plantillas
  ADD CONSTRAINT plantillas_codigo_check CHECK (codigo ~ '^[A-Z0-9_]+$'),
  ADD CONSTRAINT plantillas_version_check CHECK (version >= 1),
  ADD CONSTRAINT plantillas_estado_check CHECK (estado IN ('borrador', 'publicada', 'retirada')),
  ADD CONSTRAINT plantillas_definicion_check CHECK (jsonb_typeof(definicion) = 'object'),
  -- Publicar exige notas de cambio, y la fecha queda registrada.
  ADD CONSTRAINT plantillas_publicacion_check
    CHECK (estado = 'borrador' OR (publicado_en IS NOT NULL AND notas_cambio IS NOT NULL));

-- 2.6 expedientes
ALTER TABLE public.expedientes
  ADD CONSTRAINT expedientes_fecha_inicio_check CHECK (fecha_inicio >= DATE '1950-01-01'),
  ADD CONSTRAINT expedientes_ubicacion_check CHECK (jsonb_typeof(ubicacion) = 'object'),
  ADD CONSTRAINT expedientes_datos_extra_check CHECK (jsonb_typeof(datos_extra) = 'object'),
  ADD CONSTRAINT expedientes_items_check CHECK (jsonb_typeof(items) = 'object'),
  ADD CONSTRAINT expedientes_forma_pago_check CHECK (forma_pago IN ('contado', 'plan_pagos')),
  ADD CONSTRAINT expedientes_estado_check
    CHECK (estado IN ('en_tramite', 'espera_pago_dim', 'concluido', 'archivado', 'anulado')),
  -- Archivar y anular guardan a dónde volver al desarchivar o reabrir.
  ADD CONSTRAINT expedientes_estado_previo_check
    CHECK ((estado IN ('archivado', 'anulado')) = (estado_previo IS NOT NULL)),
  ADD CONSTRAINT expedientes_ubicacion_archivo_check
    CHECK (estado <> 'archivado' OR ubicacion_archivo IS NOT NULL),
  ADD CONSTRAINT expedientes_plazo_check
    CHECK (plazo_desde IS NULL OR plazo_dias_habiles IS NOT NULL);

-- 2.7 expediente_personas
ALTER TABLE public.expediente_personas
  ADD CONSTRAINT expediente_personas_rol_check CHECK (rol ~ '^[a-z_]+$'),
  -- Una persona suprimida (Ley 25.326) conserva el rol y la constancia, sin nombre.
  ADD CONSTRAINT expediente_personas_nombre_check
    CHECK (suprimida_en IS NOT NULL OR (apellido IS NOT NULL AND nombres IS NOT NULL)),
  ADD CONSTRAINT expediente_personas_dni_check CHECK (dni ~ '^[0-9]{6,9}$'),
  ADD CONSTRAINT expediente_personas_defuncion_check CHECK (fecha_defuncion IS NULL OR fallecido);

-- 2.8 movimientos
ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_tipo_check CHECK (tipo IN (
    'alta', 'recepcion', 'pase', 'devolucion', 'subtarea', 'documento',
    'adjunto', 'edicion', 'estado', 'nota', 'correccion')),
  ADD CONSTRAINT movimientos_precision_fecha_check CHECK (precision_fecha IN ('dia', 'minuto')),
  ADD CONSTRAINT movimientos_datos_check CHECK (jsonb_typeof(datos) = 'object'),
  ADD CONSTRAINT movimientos_destino_check
    CHECK (tipo NOT IN ('pase', 'devolucion') OR (paso_destino IS NOT NULL AND area_destino_id IS NOT NULL)),
  ADD CONSTRAINT movimientos_correccion_check
    CHECK ((tipo = 'correccion') = (corrige_movimiento_id IS NOT NULL)),
  ADD CONSTRAINT movimientos_estado_nuevo_check CHECK (tipo <> 'estado' OR estado_nuevo IS NOT NULL),
  -- Las acciones excepcionales dejan su porqué. Cada condición va con coalesce:
  -- con un NULL en el medio, un CHECK da "desconocido" y PostgreSQL lo acepta.
  ADD CONSTRAINT movimientos_motivo_check CHECK (
    NOT (
      tipo IN ('devolucion', 'correccion')
      OR coalesce(tipo = 'estado' AND estado_nuevo = 'anulado', false)
      -- Archivar sin concluir.
      OR coalesce(estado_nuevo = 'archivado' AND coalesce(estado_anterior, '') <> 'concluido', false)
      -- Desarchivar o reabrir.
      OR coalesce(estado_anterior IN ('archivado', 'anulado'), false)
      -- Destildar una subtarea.
      OR coalesce(tipo = 'subtarea' AND datos ->> 'hecha' = 'false', false)
      -- Un pase que saltea pasos omitibles.
      OR coalesce(tipo = 'pase' AND jsonb_array_length(coalesce(datos -> 'pasos_omitidos', '[]'::jsonb)) > 0, false)
    )
    OR length(btrim(coalesce(motivo, ''))) >= 10
  ),
  -- Margen para relojes y transacciones largas; lo que pasó antes se carga con
  -- fecha efectiva pasada, nunca futura. registrado_en lo fija el trigger.
  ADD CONSTRAINT movimientos_fecha_efectiva_check
    CHECK (fecha_efectiva <= registrado_en + interval '5 minutes'),
  ADD CONSTRAINT movimientos_fuente_check CHECK (NOT carga_historica OR fuente IS NOT NULL);

-- 2.9 feriados
ALTER TABLE public.feriados
  ADD CONSTRAINT feriados_ambito_check
    CHECK (ambito IN ('nacional', 'provincial', 'municipal', 'asueto', 'feria'));

-- 2.10 auditoria
ALTER TABLE auditoria.cambios
  ADD CONSTRAINT cambios_operacion_check CHECK (operacion IN ('I', 'U', 'D'));

ALTER TABLE auditoria.accesos
  ADD CONSTRAINT accesos_accion_check CHECK (accion IN (
    'ingreso', 'ingreso_rechazado', 'salida', 'ver_expediente', 'ver_datos_completos',
    'ver_adjunto', 'descargar_adjunto', 'imprimir', 'exportar')),
  ADD CONSTRAINT accesos_detalle_check CHECK (jsonb_typeof(detalle) = 'object');

-- ===========================================================================
-- 2. Funciones
-- ===========================================================================

-- unaccent() es STABLE (depende del diccionario que encuentre en el
-- search_path); fijando el diccionario se puede declarar IMMUTABLE y usar en
-- índices y en columnas normalizadas.
CREATE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Sin acentos, minúsculas, todo lo que no sea [a-z0-9] pasa a un espacio y los
-- espacios se colapsan: "GONZÁLEZ, María-José" → "gonzalez maria jose".
CREATE FUNCTION public.f_normalizar(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT btrim(regexp_replace(lower(public.f_unaccent(t)), '[^a-z0-9]+', ' ', 'g')) $$;

-- El usuario que conActor() fijó para la transacción. Sin actor no se escribe
-- nada auditable: mejor un error que una fila sin autor.
CREATE FUNCTION public.f_actor() RETURNS integer
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  actor integer := nullif(current_setting('app.usuario_id', true), '')::integer;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Falta el actor (app.usuario_id)'
      USING HINT = 'Toda escritura pasa por conActor() (src/lib/db/transaccion.ts).';
  END IF;
  RETURN actor;
END
$$;

-- El n-ésimo día hábil posterior a `desde` (cuenta desde el día hábil
-- siguiente). Saltea sábados, domingos y `feriados` de cualquier ámbito. Se
-- calcula al leer: si después se carga un asueto, el vencimiento se corrige solo.
-- Es un bucle y no un generate_series con tope porque una feria puede durar un
-- mes y ningún tope fijo alcanza.
CREATE FUNCTION public.f_sumar_dias_habiles(desde date, n integer) RETURNS date
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  dia date := desde;
  contados integer := 0;
BEGIN
  IF desde IS NULL OR n IS NULL THEN
    RETURN NULL;
  END IF;
  IF n < 0 THEN
    RAISE EXCEPTION 'f_sumar_dias_habiles: n no puede ser negativo (%)', n;
  END IF;
  WHILE contados < n LOOP
    dia := dia + 1;
    IF extract(isodow FROM dia) < 6
       AND NOT EXISTS (SELECT 1 FROM public.feriados f WHERE f.fecha = dia) THEN
      contados := contados + 1;
    END IF;
  END LOOP;
  RETURN dia;
END
$$;

-- Días hábiles en el intervalo (desde, hasta]: los transcurridos ("días en el
-- área") o los que faltan ("faltan N días hábiles"). Negativo si hasta < desde,
-- para que un plazo vencido se lea como "vencido hace N". Es la inversa de
-- f_sumar_dias_habiles: f_dias_habiles_entre(d, f_sumar_dias_habiles(d, n)) = n.
-- STRICT: con una fecha NULL (un plazo DIM cuyo inicio todavía no se tildó) da
-- NULL, como f_sumar_dias_habiles. Sin STRICT daba 0, y "faltan 0 días" pinta
-- el semáforo como plazo por vencer.
CREATE FUNCTION public.f_dias_habiles_entre(desde date, hasta date) RETURNS integer
  LANGUAGE sql STABLE STRICT
  AS $$
  SELECT CASE WHEN hasta >= desde THEN 1 ELSE -1 END * (
    SELECT count(*)::integer
    FROM generate_series((least(desde, hasta) + 1)::timestamp, greatest(desde, hasta)::timestamp, interval '1 day') AS g(dia)
    WHERE extract(isodow FROM g.dia) < 6
      AND NOT EXISTS (SELECT 1 FROM public.feriados f WHERE f.fecha = g.dia::date)
  )
$$;

-- ===========================================================================
-- 3. Usuario técnico SISTEMA
-- ===========================================================================

-- Antes de los triggers: auditar_cambio() exige un actor, y el primer actor es
-- este. Inactivo y sin CUIL real, así que nadie puede ingresar con él.
INSERT INTO public.usuarios (id, cuil, nombre, apellido, email, area_id, rol, activo)
VALUES (1, '00000000000', 'Usuario técnico', 'SISTEMA', NULL, NULL, 'admin', false);

-- El id 1 se insertó a mano y la identity no se enteró: sin esto, el primer
-- usuario real recibiría también el 1 y chocaría con la clave primaria.
SELECT setval(pg_get_serial_sequence('public.usuarios', 'id'), 1, true);

-- ===========================================================================
-- 4. Triggers
-- ===========================================================================
--
-- Todos van ENABLE ALWAYS: se disparan también con session_replication_role =
-- replica. Saltearlos exige ALTER TABLE … DISABLE TRIGGER, que es DDL, lo puede
-- hacer solo el owner y queda en el log con log_statement = 'ddl'.

-- ---------------------------------------------------------------------------
-- expedientes_preparar: actor, columnas derivadas y control de fecha_inicio.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.expedientes_preparar() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  hoy date := (now() AT TIME ZONE 'America/Argentina/Tucuman')::date;
BEGIN
  -- La proyección cambia solo junto con un movimiento, dentro de conActor().
  -- La base no puede exigir el movimiento, pero sí el actor: una escritura
  -- suelta (fuera de conActor) falla acá en vez de pasar sin autor.
  PERFORM public.f_actor();

  -- Mayúsculas y solo alfanuméricos: "12.345/2026" y "12345-2026" son el mismo
  -- número para buscar, aunque se muestre como se escribió.
  NEW.numero_municipal_norm := nullif(upper(regexp_replace(
    public.f_unaccent(coalesce(NEW.numero_municipal, '')), '[^A-Za-z0-9]', '', 'g')), '');
  NEW.padron_norm := nullif(upper(regexp_replace(
    public.f_unaccent(coalesce(NEW.padron, '')), '[^A-Za-z0-9]', '', 'g')), '');

  -- Solo cuando cambia la ubicación: agregar o desactivar un campo de ubicación
  -- en el cementerio no tiene que mover la clave de los expedientes cargados.
  -- Formato: clave=valor;clave=valor, por clave en orden C. Si la ubicación no
  -- cambió se conserva la clave anterior aunque el UPDATE traiga otra: la clave
  -- la arma solo el trigger, y una escrita a mano engañaría (o apagaría) el
  -- aviso de "otro expediente sobre el mismo espacio" (2.13(d)).
  IF TG_OP = 'INSERT' OR NEW.ubicacion IS DISTINCT FROM OLD.ubicacion THEN
    SELECT string_agg(e.key || '=' || btrim(e.value), ';' ORDER BY e.key COLLATE "C")
      INTO NEW.ubicacion_clave
      FROM jsonb_each_text(NEW.ubicacion) AS e
     WHERE btrim(coalesce(e.value, '')) <> '';
  ELSE
    NEW.ubicacion_clave := OLD.ubicacion_clave;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.fecha_inicio IS DISTINCT FROM OLD.fecha_inicio)
     AND NEW.fecha_inicio > hoy THEN
    RAISE EXCEPTION 'fecha_inicio (%) no puede ser posterior a hoy (%, hora de Tucumán)',
      NEW.fecha_inicio, hoy;
  END IF;

  NEW.actualizado_en := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER expedientes_preparar
  BEFORE INSERT OR UPDATE ON public.expedientes
  FOR EACH ROW EXECUTE FUNCTION public.expedientes_preparar();
ALTER TABLE public.expedientes ENABLE ALWAYS TRIGGER expedientes_preparar;

-- ---------------------------------------------------------------------------
-- expediente_personas_proteger: personas versionadas.
-- Admite dos clases de UPDATE y nada más:
--   a) la baja: vigente pasa a false y, una sola vez, se fija reemplazada_por_id
--      (puede ir en un segundo UPDATE: la versión nueva se inserta después de
--      dar de baja la vieja, porque el índice único de vigentes no deja tener
--      las dos a la vez);
--   b) la supresión (Ley 25.326): datos personales en NULL, suprimida_en fijada
--      y app.motivo presente.
-- Una versión nace siempre vigente, sin reemplazo y sin suprimir: si naciera
-- dada de baja o enlazada, la cadena de versiones se podría armar a gusto. El
-- reemplazo es una persona insertada después (id mayor), así la cadena no
-- tiene ciclos. Además exige el actor, arma nombre_norm y rechaza DELETE.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.expediente_personas_proteger() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  cols_baja constant text[] := ARRAY['vigente', 'reemplazada_por_id'];
  cols_supresion constant text[] := ARRAY[
    'apellido', 'nombres', 'dni', 'telefono', 'email', 'domicilio', 'vinculo', 'suprimida_en'];
  viejo jsonb;
  nuevo jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expediente_personas no admite DELETE: la baja es vigente = false';
  END IF;

  -- Las personas cambian solo junto con el movimiento alta o edicion que las
  -- crea, dentro de conActor().
  PERFORM public.f_actor();

  NEW.nombre_norm := coalesce(public.f_normalizar(concat_ws(' ', NEW.apellido, NEW.nombres)), '');
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.vigente OR NEW.reemplazada_por_id IS NOT NULL OR NEW.suprimida_en IS NOT NULL THEN
      RAISE EXCEPTION 'Una persona nace vigente, sin reemplazo y sin suprimir: la baja, el enlace y la supresión son UPDATE posteriores';
    END IF;
    RETURN NEW;
  END IF;

  viejo := to_jsonb(OLD) - 'nombre_norm';
  nuevo := to_jsonb(NEW) - 'nombre_norm';
  IF nuevo = viejo THEN
    RETURN NEW;
  END IF;

  -- a) Baja o reemplazo.
  IF (nuevo - cols_baja) = (viejo - cols_baja) THEN
    IF NEW.vigente AND OLD.vigente THEN
      RAISE EXCEPTION 'Primero se da de baja la versión vieja (vigente = false); recién después se fija reemplazada_por_id';
    END IF;
    IF NEW.vigente THEN
      RAISE EXCEPTION 'Una persona dada de baja no vuelve a vigente: se inserta una versión nueva';
    END IF;
    IF OLD.reemplazada_por_id IS NOT NULL
       AND NEW.reemplazada_por_id IS DISTINCT FROM OLD.reemplazada_por_id THEN
      RAISE EXCEPTION 'La persona % ya fue reemplazada por %', OLD.id, OLD.reemplazada_por_id;
    END IF;
    IF NEW.reemplazada_por_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.expediente_personas p
       WHERE p.id = NEW.reemplazada_por_id
         AND p.id > NEW.id
         AND p.expediente_id = NEW.expediente_id) THEN
      RAISE EXCEPTION 'reemplazada_por_id tiene que ser otra persona del mismo expediente, insertada después que esta';
    END IF;
    RETURN NEW;
  END IF;

  -- b) Supresión.
  IF (nuevo - cols_supresion) = (viejo - cols_supresion)
     AND OLD.suprimida_en IS NULL
     AND NEW.suprimida_en IS NOT NULL
     AND num_nulls(NEW.apellido, NEW.nombres, NEW.dni, NEW.telefono,
                   NEW.email, NEW.domicilio, NEW.vinculo) = 7 THEN
    IF coalesce(btrim(current_setting('app.motivo', true)), '') = '' THEN
      RAISE EXCEPTION 'La supresión de una persona exige motivo (app.motivo)';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'expediente_personas solo admite la baja (vigente/reemplazada_por_id) o la supresión. Para corregir datos se inserta una versión nueva de la persona.';
END
$$;

CREATE TRIGGER expediente_personas_proteger
  BEFORE INSERT OR UPDATE OR DELETE ON public.expediente_personas
  FOR EACH ROW EXECUTE FUNCTION public.expediente_personas_proteger();
ALTER TABLE public.expediente_personas ENABLE ALWAYS TRIGGER expediente_personas_proteger;

-- ---------------------------------------------------------------------------
-- movimientos_sellar: secuencia, fecha de registro y autor.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.movimientos_sellar() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  actor integer;
BEGIN
  -- Serializa los movimientos de un mismo expediente: sin el lock, dos
  -- inserciones simultáneas calcularían la misma secuencia.
  PERFORM 1 FROM public.expedientes e WHERE e.id = NEW.expediente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el expediente %', NEW.expediente_id;
  END IF;

  SELECT coalesce(max(m.secuencia), 0) + 1
    INTO NEW.secuencia
    FROM public.movimientos m
   WHERE m.expediente_id = NEW.expediente_id;

  -- La fecha de registro no la elige nadie desde la app.
  NEW.registrado_en := now();

  actor := public.f_actor();
  IF NEW.usuario_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'El movimiento declara usuario_id % pero el actor de la transacción es %',
      NEW.usuario_id, actor;
  END IF;

  SELECT u.area_id INTO NEW.area_usuario_id FROM public.usuarios u WHERE u.id = NEW.usuario_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER movimientos_sellar
  BEFORE INSERT ON public.movimientos
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_sellar();
ALTER TABLE public.movimientos ENABLE ALWAYS TRIGGER movimientos_sellar;

-- ---------------------------------------------------------------------------
-- movimientos_inmutables: el historial es solo inserción, también para el owner.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.movimientos_inmutables() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'movimientos es solo inserción: % rechazado. Los errores se corrigen agregando un movimiento de corrección.', TG_OP;
END
$$;

CREATE TRIGGER movimientos_inmutables
  BEFORE UPDATE OR DELETE ON public.movimientos
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_inmutables();
CREATE TRIGGER movimientos_inmutables_truncate
  BEFORE TRUNCATE ON public.movimientos
  FOR EACH STATEMENT EXECUTE FUNCTION public.movimientos_inmutables();
ALTER TABLE public.movimientos ENABLE ALWAYS TRIGGER movimientos_inmutables;
ALTER TABLE public.movimientos ENABLE ALWAYS TRIGGER movimientos_inmutables_truncate;

-- ---------------------------------------------------------------------------
-- plantillas_congelar: una versión publicada o retirada no cambia.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.plantillas_congelar() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN
      RAISE EXCEPTION 'Solo se borran borradores: la plantilla % v% está %', OLD.codigo, OLD.version, OLD.estado;
    END IF;
    RETURN OLD;
  END IF;

  -- Toda versión nace borrador y se publica con un UPDATE (la acción
  -- "Publicar"): si pudiera nacer publicada o retirada, las transiciones de
  -- abajo se saltearían con un INSERT.
  IF TG_OP = 'INSERT' AND NEW.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Una plantilla nace como borrador (llegó %): se publica después, con "Publicar"', NEW.estado;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.estado <> 'borrador' AND (
         NEW.definicion IS DISTINCT FROM OLD.definicion
      OR NEW.nombre IS DISTINCT FROM OLD.nombre
      OR NEW.codigo IS DISTINCT FROM OLD.codigo
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.tipo_tramite_id IS DISTINCT FROM OLD.tipo_tramite_id) THEN
      RAISE EXCEPTION 'La plantilla % v% está % y no se modifica: se crea una versión nueva',
        OLD.codigo, OLD.version, OLD.estado;
    END IF;
    IF NEW.estado IS DISTINCT FROM OLD.estado
       AND NOT ((OLD.estado = 'borrador' AND NEW.estado = 'publicada')
             OR (OLD.estado = 'publicada' AND NEW.estado = 'retirada')) THEN
      RAISE EXCEPTION 'Transición de plantilla no permitida: % → %', OLD.estado, NEW.estado;
    END IF;
  END IF;

  -- Las versiones de un código son del mismo tipo de trámite: si no, las
  -- estadísticas por tipo mezclarían expedientes de un mismo trámite.
  IF EXISTS (
    SELECT 1 FROM public.plantillas p
     WHERE p.codigo = NEW.codigo
       AND p.id <> NEW.id
       AND p.tipo_tramite_id <> NEW.tipo_tramite_id) THEN
    RAISE EXCEPTION 'Todas las versiones de la plantilla % tienen que ser del mismo tipo de trámite', NEW.codigo;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER plantillas_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON public.plantillas
  FOR EACH ROW EXECUTE FUNCTION public.plantillas_congelar();
ALTER TABLE public.plantillas ENABLE ALWAYS TRIGGER plantillas_congelar;

-- ---------------------------------------------------------------------------
-- usuarios_area_interna: las áreas externas (DIM, cementerios) no tienen usuarios.
-- ---------------------------------------------------------------------------
-- El FOR SHARE sobre el área serializa con areas_tipo_coherente: sin él, dar de
-- alta un usuario y pasar su área a externa en dos transacciones simultáneas
-- pasarían las dos.
CREATE FUNCTION public.usuarios_area_interna() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  tipo_area text;
BEGIN
  IF NEW.area_id IS NOT NULL THEN
    SELECT a.tipo INTO tipo_area FROM public.areas a WHERE a.id = NEW.area_id FOR SHARE;
    IF tipo_area = 'externa' THEN
      RAISE EXCEPTION 'Un usuario no puede pertenecer a un área externa (area_id %)', NEW.area_id;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER usuarios_area_interna
  BEFORE INSERT OR UPDATE OF area_id ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_area_interna();
ALTER TABLE public.usuarios ENABLE ALWAYS TRIGGER usuarios_area_interna;

-- ---------------------------------------------------------------------------
-- cementerios_area_externa: el área de un cementerio es externa (2.2, 2.13(e)).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.cementerios_area_externa() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  tipo_area text;
BEGIN
  SELECT a.tipo INTO tipo_area FROM public.areas a WHERE a.id = NEW.area_id FOR SHARE;
  IF tipo_area IS DISTINCT FROM 'externa' THEN
    RAISE EXCEPTION 'El área de un cementerio tiene que ser externa (area_id %)', NEW.area_id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cementerios_area_externa
  BEFORE INSERT OR UPDATE OF area_id ON public.cementerios
  FOR EACH ROW EXECUTE FUNCTION public.cementerios_area_externa();
ALTER TABLE public.cementerios ENABLE ALWAYS TRIGGER cementerios_area_externa;

-- ---------------------------------------------------------------------------
-- areas_tipo_coherente: las dos reglas anteriores, vistas desde el área. Sin
-- esto, pasar a 'externa' un área con usuarios (o a 'interna' la de un
-- cementerio) esquivaba usuarios_area_interna y cementerios_area_externa.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.areas_tipo_coherente() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.tipo = 'externa' AND EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.area_id = NEW.id) THEN
    RAISE EXCEPTION 'El área % tiene usuarios: no puede pasar a externa (primero se los cambia de área)', NEW.codigo;
  END IF;
  IF NEW.tipo <> 'externa' AND EXISTS (
    SELECT 1 FROM public.cementerios c WHERE c.area_id = NEW.id) THEN
    RAISE EXCEPTION 'El área % es la de un cementerio: tiene que seguir siendo externa', NEW.codigo;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER areas_tipo_coherente
  BEFORE UPDATE OF tipo ON public.areas
  FOR EACH ROW EXECUTE FUNCTION public.areas_tipo_coherente();
ALTER TABLE public.areas ENABLE ALWAYS TRIGGER areas_tipo_coherente;

-- ---------------------------------------------------------------------------
-- auditar_cambio: antes y después de la configuración, en auditoria.cambios.
--   TG_ARGV[0]: columna que identifica la fila (registro_id).
--   TG_ARGV[1]: opcional, columnas a guardar separadas por coma. En usuarios
--               se guarda solo lo que da o quita acceso, no nombre ni email.
-- Un UPDATE que no cambia nada de lo guardado no deja fila.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.auditar_cambio() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  antes jsonb;
  despues jsonb;
  registro text;
  columnas text[];
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    antes := to_jsonb(OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    despues := to_jsonb(NEW);
  END IF;
  registro := coalesce(despues, antes) ->> TG_ARGV[0];

  IF TG_NARGS > 1 THEN
    columnas := string_to_array(TG_ARGV[1], ',');
    antes := (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(antes) AS e
               WHERE e.key = ANY (columnas));
    despues := (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(despues) AS e
                 WHERE e.key = ANY (columnas));
  END IF;

  IF TG_OP = 'UPDATE' AND antes IS NOT DISTINCT FROM despues THEN
    RETURN NULL;
  END IF;

  INSERT INTO auditoria.cambios (tabla, registro_id, operacion, antes, despues, usuario_id, motivo)
  VALUES (TG_TABLE_NAME, registro, left(TG_OP, 1), antes, despues, public.f_actor(),
          nullif(btrim(current_setting('app.motivo', true)), ''));
  RETURN NULL;
END
$$;

CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.plantillas
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id');
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.areas
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id');
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.cementerios
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id');
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.tipos_monumento
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id');
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.tipos_tramite
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id');
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.feriados
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('fecha');
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.feriados_anios
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('anio');
-- El login (nombre, email, ultimo_ingreso, cidituc_id) y la salida
-- (sesion_version) no generan filas: solo lo que cambia el acceso.
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OF cuil, area_id, rol, activo ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id', 'id,cuil,area_id,rol,activo');

ALTER TABLE public.plantillas ENABLE ALWAYS TRIGGER auditar_cambio;
ALTER TABLE public.areas ENABLE ALWAYS TRIGGER auditar_cambio;
ALTER TABLE public.cementerios ENABLE ALWAYS TRIGGER auditar_cambio;
ALTER TABLE public.tipos_monumento ENABLE ALWAYS TRIGGER auditar_cambio;
ALTER TABLE public.tipos_tramite ENABLE ALWAYS TRIGGER auditar_cambio;
ALTER TABLE public.feriados ENABLE ALWAYS TRIGGER auditar_cambio;
ALTER TABLE public.feriados_anios ENABLE ALWAYS TRIGGER auditar_cambio;
ALTER TABLE public.usuarios ENABLE ALWAYS TRIGGER auditar_cambio;

-- ===========================================================================
-- 5. Privilegios de cementeria_app (sección 2.11)
-- ===========================================================================
--
-- Sin DEFAULT PRIVILEGES a propósito: una tabla nueva no le da nada a la app
-- hasta que su migración lo diga explícitamente. Las columnas identity no
-- necesitan privilegio sobre su secuencia.

GRANT USAGE ON SCHEMA public, auditoria TO cementeria_app;

-- Historial y auditoría: solo inserción.
GRANT SELECT, INSERT ON public.movimientos, auditoria.cambios, auditoria.accesos TO cementeria_app;

-- La proyección y las personas (el UPDATE de personas lo acota el trigger).
GRANT SELECT, INSERT, UPDATE ON public.expedientes, public.expediente_personas TO cementeria_app;

-- Catálogos, usuarios y años de feriados: sin DELETE (la baja es activo = false).
GRANT SELECT, INSERT, UPDATE ON
  public.areas, public.cementerios, public.tipos_monumento, public.tipos_tramite,
  public.usuarios, public.feriados_anios
  TO cementeria_app;

-- Plantillas (el trigger solo deja borrar borradores) y feriados (quitar uno es
-- legítimo y queda auditado).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantillas, public.feriados TO cementeria_app;
-- ===== fin de 20261019120100_reglas_base =====

-- La fila de Prisma, con su checksum (SHA-256 de migration.sql): después
-- `prisma migrate deploy` la da por aplicada.
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '02d0deb5f9f7a47d3501f8425dda267f19fa410c6981b4d598a8773ec8663492', now(), '20261019120100_reglas_base', NULL, NULL, now(), 1);

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
