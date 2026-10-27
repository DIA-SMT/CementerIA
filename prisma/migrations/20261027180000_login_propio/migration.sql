-- Login propio con usuario y contraseña (27/10/2026; docs/api-dominio.md,
-- sección 22). El ingreso con Cidituc queda en pausa (CIDITUC_HABILITADO=0):
-- su código sigue, y `cidituc_id` también.
--
-- Escrita a mano (las columnas son las que genera `prisma migrate diff` para
-- prisma/schema.prisma; lo demás Prisma no lo modela):
--
--   1. La guarda de dueño, como las anteriores.
--   2. Cinco columnas nuevas en usuarios:
--        clave_hash          el hash scrypt de la contraseña, con los parámetros
--                            adentro: scrypt$N$r$p$<sal>$<hash> (base64url).
--                            Así se puede subir el costo más adelante sin
--                            invalidar los hashes viejos (se rehacen al ingresar).
--                            NULL = sin contraseña: no puede ingresar por el
--                            formulario hasta que un admin se la blanquee.
--        debe_cambiar_clave  la contraseña es temporal (alta, blanqueo, admin
--                            inicial): después de ingresar solo puede cambiarla.
--        clave_cambiada_en   cuándo cambió `clave_hash` por última vez.
--        intentos_fallidos   fallos seguidos; al quinto, bloqueo de 15 minutos
--                            (`bloqueado_hasta`) y vuelve a 0.
--   3. CHECKs: el formato del hash (para que nunca se guarde una contraseña en
--      texto por error), intentos no negativos y SISTEMA (id 1) sin contraseña.
--   4. auditar_cambio de usuarios: además de id, cuil, área, rol y activo,
--      `debe_cambiar_clave`, así los blanqueos (no → sí) y el primer cambio
--      (sí → no) quedan en auditoria.cambios con su autor y motivo. NUNCA el
--      hash ni el contador de intentos: el trigger guarda solo la lista de
--      columnas que recibe.
--   5. auditoria.accesos: acciones nuevas 'bloqueo' (cinco fallos seguidos),
--      'desbloqueo' (un admin), 'cambio_clave' (el usuario) y 'blanqueo_clave'
--      (un admin).
--
-- Privilegios: cementeria_app ya tiene SELECT, INSERT y UPDATE sobre
-- public.usuarios a nivel de tabla (reglas_base, sección 2.11), que alcanza a
-- las columnas nuevas; no hace falta ningún GRANT. No hay tabla nueva: el
-- límite de intentos por IP vive en la memoria del proceso
-- (src/lib/auth/limite-intentos.ts), así que la defensa RLS de *_rls_defensa no
-- necesita nada más (tests/integracion/rls.test.ts).
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
-- 1. Columnas
-- ===========================================================================

ALTER TABLE "usuarios"
  ADD COLUMN "clave_hash" TEXT,
  ADD COLUMN "debe_cambiar_clave" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clave_cambiada_en" TIMESTAMPTZ,
  ADD COLUMN "intentos_fallidos" SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN "bloqueado_hasta" TIMESTAMPTZ;

-- ===========================================================================
-- 2. CHECKs
-- ===========================================================================

ALTER TABLE public.usuarios
  -- scrypt$N$r$p$<sal>$<hash>: N, r y p enteros; sal y hash en base64url, de
  -- 16 bytes o más (22 caracteres). Una contraseña en texto no pasa.
  ADD CONSTRAINT usuarios_clave_hash_check CHECK (
    clave_hash IS NULL
    OR clave_hash ~ '^scrypt\$[1-9][0-9]{0,7}\$[1-9][0-9]{0,2}\$[1-9][0-9]{0,2}\$[A-Za-z0-9_-]{22,}\$[A-Za-z0-9_-]{22,}$'),
  ADD CONSTRAINT usuarios_intentos_fallidos_check CHECK (intentos_fallidos >= 0),
  -- SISTEMA firma lo automático y no ingresa nunca (ya es inactivo por CHECK).
  ADD CONSTRAINT usuarios_sistema_sin_clave_check CHECK (id <> 1 OR clave_hash IS NULL);

-- ===========================================================================
-- 3. Auditoría de usuarios: también debe_cambiar_clave
-- ===========================================================================
--
-- El ingreso (ultimo_ingreso, intentos_fallidos, bloqueado_hasta, un hash
-- rehecho) y la salida (sesion_version) siguen sin generar filas. Cambiar la
-- contraseña sí cambia `clave_hash`, pero lo que queda en auditoria.cambios es
-- solo `debe_cambiar_clave`; el hecho queda en auditoria.accesos
-- ('cambio_clave', 'blanqueo_clave').
DROP TRIGGER auditar_cambio ON public.usuarios;
CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OF cuil, area_id, rol, activo, debe_cambiar_clave ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id', 'id,cuil,area_id,rol,activo,debe_cambiar_clave');
ALTER TABLE public.usuarios ENABLE ALWAYS TRIGGER auditar_cambio;

-- ===========================================================================
-- 4. auditoria.accesos: bloqueo, desbloqueo, cambio y blanqueo de contraseña
-- ===========================================================================
ALTER TABLE auditoria.accesos
  DROP CONSTRAINT accesos_accion_check,
  ADD CONSTRAINT accesos_accion_check CHECK (accion IN (
    'ingreso', 'ingreso_rechazado', 'salida', 'ver_expediente', 'ver_datos_completos',
    'ver_adjunto', 'descargar_adjunto', 'imprimir', 'exportar', 'verificar_historial',
    'bloqueo', 'desbloqueo', 'cambio_clave', 'blanqueo_clave'));
