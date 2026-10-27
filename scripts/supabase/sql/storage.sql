-- Bucket de adjuntos en Supabase Storage (ADJUNTOS_ALMACEN=supabase: el
-- despliegue en Vercel, docs/despliegue-vercel.md). Corre como el rol postgres
-- de Supabase (SQL Editor o preparar.mjs). Idempotente.
--
-- PRIVADO (public = false): no hay URL pública de ningún objeto. SIN POLÍTICAS
-- en storage.objects ni storage.buckets: con RLS habilitado (lo trae
-- Supabase) y sin políticas, anon y authenticated no leen, no listan y no
-- escriben nada. Solo entra la clave secreta del servidor (SUPABASE_SECRET_KEY,
-- que actúa como service_role) y, para subir UN objeto en tmp/<uuid>, la URL
-- firmada que la app le da al navegador después de controlar los permisos.
-- La lectura pasa siempre por la app (/adjuntos/[movimientoId]).
--
-- Límites del bucket, además de los de la app (que vuelve a medir y a mirar
-- los magic bytes al confirmar): 10 MB (10485760 bytes) y solo PDF, JPEG y
-- PNG por Content-Type.
--
-- El rol postgres de Supabase puede escribir storage.buckets: los servicios
-- crean el esquema storage con privilegios por defecto para postgres, y la
-- guía oficial crea buckets así ("Creating buckets", pestaña SQL:
-- `insert into storage.buckets (id, name, public) values (…)`). Si el panel
-- lo rechazara, se crea igual desde Storage → New bucket (docs/despliegue-vercel.md).

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Este archivo lo corre el rol postgres de Supabase (SQL Editor), no %', current_user;
  END IF;
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'No está storage.buckets: ¿es un proyecto de Supabase con Storage? Crear el bucket desde el panel (docs/despliegue-vercel.md).';
  END IF;
END
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('adjuntos', 'adjuntos', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Las políticas no se tocan acá (no se borra nada que haya creado otro), pero
-- si hay alguna, que se vea: 99_verificar.sql la marca en falso.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename IN ('objects', 'buckets');
  IF n > 0 THEN
    RAISE WARNING 'Hay % política(s) en storage.objects o storage.buckets: el bucket adjuntos no tiene que tener ninguna. Revisalas en Storage → Policies.', n;
  END IF;
END
$$;
