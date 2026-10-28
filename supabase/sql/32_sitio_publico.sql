-- Sitio público (28/10/2026): las preguntas frecuentes iniciales de la página pública.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Para una base de Supabase que YA tiene aplicada una semilla anterior (sin el sitio
-- público): agrega solo las preguntas frecuentes que son verdad por el diseño del
-- sistema y los procedimientos (lo demás del sitio arranca vacío y lo carga la
-- Dirección desde /admin/sitio-publico). Va DESPUÉS de la migración *_sitio_publico.
-- En una base nueva, después del 30 no hace nada (el 30 ya las trae).
-- Idempotente: una pregunta que ya existe (el mismo texto) no se toca. Mismo
-- contenido que el 30 (el mismo volcado de prisma/semilla).

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Este archivo lo corre el rol postgres de Supabase (SQL Editor), no %', current_user;
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

-- Que estén las migraciones, la de sitio público incluida.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.usuarios WHERE id = 1 AND apellido = 'SISTEMA') THEN
    RAISE EXCEPTION 'No está el usuario SISTEMA: aplicá antes las migraciones (20_migracion_*.sql)';
  END IF;
  IF to_regclass('public.sitio_preguntas') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla sitio_preguntas: aplicá antes 20_migracion_20261028180000_sitio_publico.sql';
  END IF;
END
$$;

-- El actor, como conActor(): SISTEMA y el motivo de la semilla.
SELECT set_config('app.usuario_id', '1', true), set_config('app.motivo', 'Semilla (prisma/semilla)', true);

-- sitio_preguntas: 3 pregunta(s), por el texto de la pregunta (si ya existe, no se toca).
INSERT INTO public.sitio_preguntas ("pregunta", "respuesta", "orden", "activa")
SELECT d."pregunta", d."respuesta", d."orden", d."activa"
  FROM jsonb_populate_recordset(NULL::public.sitio_preguntas, $semilla$[
  {"pregunta":"Perdí el código de consulta, ¿qué hago?","respuesta":"Pedí uno nuevo en Mesa de Entradas de la Dirección de Cementerios. Desde ese momento, el código anterior deja de funcionar.","orden":10,"activa":true},
  {"pregunta":"¿La consulta en línea reemplaza al expediente?","respuesta":"No. La consulta en línea es información orientativa sobre en qué anda tu trámite: el expediente oficial es el de papel.","orden":20,"activa":true},
  {"pregunta":"¿Dónde pago las tasas?","respuesta":"Con la boleta que te entrega Liquidación, en Rapipago, Pago Fácil o Banco Macro. Después traés una copia del pago a Mesa de Entradas para sumarla al expediente.","orden":30,"activa":true}
]$semilla$::jsonb) AS d
 WHERE NOT EXISTS (SELECT FROM public.sitio_preguntas p WHERE lower(p.pregunta) = lower(d.pregunta));

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
