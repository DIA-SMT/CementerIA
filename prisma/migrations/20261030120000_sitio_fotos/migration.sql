-- Fotos propias del sitio público (30/10/2026; docs/api-dominio.md, sección
-- 25.7). Hasta ahora la foto de un cementerio o de un recorrido salía de una
-- lista cerrada de imágenes ilustrativas del kit (`foto`, CHECK de
-- *_sitio_publico); desde esta migración la Dirección también puede subir las
-- suyas desde /admin/sitio-publico (pestaña Fotos). Escrita a mano a partir de
-- `prisma migrate diff`:
--
--   1. La guarda de dueño, como las anteriores.
--   2. public.sitio_fotos: id uuid (lo pone la app: es también la carpeta del
--      almacén), ruta (`fotos/<id>`), alt, crédito, ancho, alto, bytes y
--      sha256 del original, activa, subida_por y las fechas de siempre. Del
--      original no se guarda nada más: el archivo que se sirve son dos WebP
--      re-codificados en el servidor, sin metadatos (EXIF, GPS, cámara ni
--      perfil). Un índice único parcial: la misma foto (sha256) no se sube
--      dos veces mientras esté activa.
--   3. foto_id (uuid, nullable, FK) en sitio_cementerios y sitio_recorridos,
--      con su índice (para "¿dónde se usa?" al dar de baja) y un CHECK: o una
--      ilustrativa del kit (`foto`) o una subida (`foto_id`), nunca las dos.
--   4. CHECKs de sitio_fotos: los mismos límites que
--      src/lib/imagenes/tipos.ts y src/lib/dominio/sitio/validacion.ts.
--   5. Triggers (ENABLE ALWAYS, sin SECURITY DEFINER):
--      - sitio_fotos_proteger: de una foto solo cambian el texto alternativo,
--        el crédito y `activa` (de true a false: la baja no se deshace), y no
--        se da de baja mientras un cementerio o un recorrido la use (la app
--        primero los deja sin foto, en la misma transacción);
--      - sitio_foto_activa: un cementerio o un recorrido no puede pasar a usar
--        una foto dada de baja.
--   6. auditar_cambio (ALWAYS) en sitio_fotos, como el resto de la
--      configuración del sitio.
--   7. GRANTs mínimos para cementeria_app: lee, inserta y actualiza; sin
--      DELETE (una foto se da de baja, no se borra).
--   8. RLS con la política de cementeria_app (como *_rls_defensa).
--
-- Las fotos del sitio son públicas: no deben mostrar personas reconocibles ni
-- nombres en lápidas sin autorización (docs/borrador-tecnico-art22.md). El
-- bucket de Supabase Storage donde viven en Vercel (`sitio-publico`, privado)
-- lo crea 45_storage.sql, no esta migración.
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
-- 2 y 3. Tablas, columnas, índices y claves (lo que genera Prisma)
-- ===========================================================================

-- CreateTable
CREATE TABLE "sitio_fotos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruta" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "credito" TEXT,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "subida_por" INTEGER NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sitio_fotos_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "sitio_cementerios" ADD COLUMN     "foto_id" UUID;

-- AlterTable
ALTER TABLE "sitio_recorridos" ADD COLUMN     "foto_id" UUID;

-- La misma foto (por su contenido) una sola vez entre las activas.
-- CreateIndex
CREATE UNIQUE INDEX "sitio_fotos_sha256_activa_key" ON "sitio_fotos"("sha256") WHERE (activa);

-- CreateIndex
CREATE INDEX "sitio_cementerios_foto_id_idx" ON "sitio_cementerios"("foto_id");

-- CreateIndex
CREATE INDEX "sitio_recorridos_foto_id_idx" ON "sitio_recorridos"("foto_id");

-- AddForeignKey
ALTER TABLE "sitio_cementerios" ADD CONSTRAINT "sitio_cementerios_foto_id_fkey" FOREIGN KEY ("foto_id") REFERENCES "sitio_fotos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sitio_recorridos" ADD CONSTRAINT "sitio_recorridos_foto_id_fkey" FOREIGN KEY ("foto_id") REFERENCES "sitio_fotos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sitio_fotos" ADD CONSTRAINT "sitio_fotos_subida_por_fkey" FOREIGN KEY ("subida_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ===========================================================================
-- 3 y 4. CHECKs
-- ===========================================================================

-- O la ilustrativa del kit o la subida: nunca las dos.
ALTER TABLE public.sitio_cementerios
  ADD CONSTRAINT sitio_cementerios_una_foto_check CHECK (foto IS NULL OR foto_id IS NULL);
ALTER TABLE public.sitio_recorridos
  ADD CONSTRAINT sitio_recorridos_una_foto_check CHECK (foto IS NULL OR foto_id IS NULL);

-- Los límites de src/lib/imagenes/tipos.ts (15 MB, 600 px de ancho como
-- mínimo, proporción entre 1:2 y 4:1, 100 megapíxeles) y el texto alternativo
-- de 5 a 200 caracteres (el crédito, de 1 a 200), en una línea, sin
-- caracteres de control ni espacios en los bordes.
ALTER TABLE public.sitio_fotos
  ADD CONSTRAINT sitio_fotos_ruta_check CHECK (ruta = 'fotos/' || id::text),
  ADD CONSTRAINT sitio_fotos_alt_check
    CHECK (char_length(alt) BETWEEN 5 AND 200 AND alt !~ '[[:cntrl:]]' AND alt = btrim(alt)),
  ADD CONSTRAINT sitio_fotos_credito_check
    CHECK (char_length(credito) BETWEEN 1 AND 200 AND credito !~ '[[:cntrl:]]' AND credito = btrim(credito)),
  ADD CONSTRAINT sitio_fotos_medidas_check
    CHECK (ancho >= 600 AND alto >= 1 AND ancho::bigint * alto <= 100000000
           AND ancho::numeric / alto BETWEEN 0.5 AND 4),
  ADD CONSTRAINT sitio_fotos_bytes_check CHECK (bytes BETWEEN 1 AND 15728640),
  ADD CONSTRAINT sitio_fotos_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- ===========================================================================
-- 5. Triggers
-- ===========================================================================

-- De una foto cambian solo alt, crédito y la baja. La baja no se deshace (se
-- vuelve a subir) y no se da mientras alguien la use: la app deja antes sin
-- foto a los cementerios y recorridos que la tenían, en la misma transacción.
CREATE FUNCTION public.sitio_fotos_proteger() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.ruta IS DISTINCT FROM OLD.ruta OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.ancho IS DISTINCT FROM OLD.ancho OR NEW.alto IS DISTINCT FROM OLD.alto
     OR NEW.subida_por IS DISTINCT FROM OLD.subida_por OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'sitio_fotos: de una foto solo cambian el texto alternativo, el crédito y la baja';
  END IF;
  IF NEW.activa AND NOT OLD.activa THEN
    RAISE EXCEPTION 'sitio_fotos: una foto dada de baja no se reactiva (se vuelve a subir)';
  END IF;
  IF OLD.activa AND NOT NEW.activa
     AND (EXISTS (SELECT 1 FROM public.sitio_cementerios c WHERE c.foto_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.sitio_recorridos r WHERE r.foto_id = OLD.id)) THEN
    RAISE EXCEPTION 'sitio_fotos: la foto % está en uso; primero hay que dejar sin foto a quien la usa', OLD.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sitio_fotos_proteger BEFORE UPDATE ON public.sitio_fotos
  FOR EACH ROW EXECUTE FUNCTION public.sitio_fotos_proteger();
ALTER TABLE public.sitio_fotos ENABLE ALWAYS TRIGGER sitio_fotos_proteger;

-- Solo una foto activa. Al guardar sin cambiar la foto (foto_id igual) no se
-- controla: un cementerio no queda trabado por una foto que ya tenía.
CREATE FUNCTION public.sitio_foto_activa() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.foto_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.foto_id IS DISTINCT FROM OLD.foto_id)
     AND NOT EXISTS (SELECT 1 FROM public.sitio_fotos f WHERE f.id = NEW.foto_id AND f.activa) THEN
    RAISE EXCEPTION '%: la foto % no existe o está dada de baja', TG_TABLE_NAME, NEW.foto_id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sitio_foto_activa BEFORE INSERT OR UPDATE OF foto_id ON public.sitio_cementerios
  FOR EACH ROW EXECUTE FUNCTION public.sitio_foto_activa();
CREATE TRIGGER sitio_foto_activa BEFORE INSERT OR UPDATE OF foto_id ON public.sitio_recorridos
  FOR EACH ROW EXECUTE FUNCTION public.sitio_foto_activa();
ALTER TABLE public.sitio_cementerios ENABLE ALWAYS TRIGGER sitio_foto_activa;
ALTER TABLE public.sitio_recorridos ENABLE ALWAYS TRIGGER sitio_foto_activa;

-- ===========================================================================
-- 6. Auditoría: como el resto del sitio (auditar_cambio, reglas_base)
-- ===========================================================================

CREATE TRIGGER auditar_cambio AFTER INSERT OR UPDATE OR DELETE ON public.sitio_fotos
  FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio('id');
ALTER TABLE public.sitio_fotos ENABLE ALWAYS TRIGGER auditar_cambio;

-- ===========================================================================
-- 7. Privilegios de cementeria_app: leer, subir y modificar; nunca borrar
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON public.sitio_fotos TO cementeria_app;

-- ===========================================================================
-- 8. RLS como en *_rls_defensa: una sola política, para cementeria_app
-- ===========================================================================

ALTER TABLE public.sitio_fotos ENABLE ROW LEVEL SECURITY;
CREATE POLICY cementeria_app ON public.sitio_fotos AS PERMISSIVE FOR ALL TO cementeria_app USING (true) WITH CHECK (true);
