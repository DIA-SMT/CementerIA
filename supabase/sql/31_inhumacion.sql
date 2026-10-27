-- Inhumación (27/10/2026): el tipo de trámite INHUMACION y sus dos plantillas publicadas.
--
-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:
-- se cambia la fuente y se vuelve a generar.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Para una base de Supabase que YA tiene aplicada una semilla anterior: agrega
-- solo esto (tipos de trámite: INHUMACION; plantillas: INHUMACION_DIRECCION, INHUMACION_EMPRESA),
-- buscando por código y dejando que la base ponga los ids. No hace falta volver a
-- correr 30_semilla_produccion.sql (y no conviene: inserta con ids fijos). En una
-- base nueva, después del 30 no hace nada (el 30 ya trae todo).
-- Idempotente: lo que ya existe (por código) no se toca. Mismo contenido que el 30
-- (el mismo volcado de prisma/semilla).

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

-- Que estén las migraciones y la semilla anterior (30_semilla_produccion.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.usuarios WHERE id = 1 AND apellido = 'SISTEMA') THEN
    RAISE EXCEPTION 'No está el usuario SISTEMA: aplicá antes las migraciones (20_migracion_*.sql)';
  END IF;
  IF NOT EXISTS (SELECT FROM public.areas) OR NOT EXISTS (SELECT FROM public.cementerios) THEN
    RAISE EXCEPTION 'No están las áreas ni los cementerios: aplicá antes 30_semilla_produccion.sql';
  END IF;
END
$$;

-- El actor, como conActor(): SISTEMA y el motivo de la semilla.
SELECT set_config('app.usuario_id', '1', true), set_config('app.motivo', 'Semilla (prisma/semilla)', true);

-- tipos_tramite: 1 fila(s), por código (si ya existe, se reusa).
INSERT INTO public.tipos_tramite ("codigo", "nombre", "activo")
SELECT d."codigo", d."nombre", d."activo"
  FROM jsonb_populate_recordset(NULL::public.tipos_tramite, $semilla$[
  {"codigo":"INHUMACION","nombre":"Inhumación","activo":true}
]$semilla$::jsonb) AS d
ON CONFLICT (codigo) DO NOTHING;

-- plantillas: 2. Cada una nace borrador y se publica con un UPDATE de esa
-- misma fila (plantillas_congelar); si el código ya existe, no se toca.
DO $incremental$
DECLARE
  f jsonb;
  v_tipo smallint;
  v_id integer;
BEGIN
  FOR f IN SELECT x FROM jsonb_array_elements($semilla$[
  {"codigo":"INHUMACION_DIRECCION","version":1,"nombre":"Inhumación, pago en la Dirección","estado":"publicada","definicion":{"pasos":[{"area":"MESA_ENTRADAS","clave":"MESA","plazo":null,"estado":"en_tramite","nombre":"Mesa de Entradas","custodia":null,"omitible":false,"subtareas":[{"dato":null,"clave":"MESA_CARATULA","nombre":"Carátula impresa y agregada al expediente","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null},{"dato":null,"clave":"MESA_CONCESION_VIGENTE","nombre":"Concesión vigente verificada en Cómputos","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null},{"dato":null,"clave":"MESA_CONSERVACION","nombre":"Conservación de los últimos 5 años verificada en el estado de cuenta","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null}],"dias_alerta":1,"instrucciones":null},{"area":"LIQUIDACION","clave":"LIQUIDACION","plazo":null,"estado":"en_tramite","nombre":"Liquidación y boleta","custodia":null,"omitible":false,"subtareas":[{"dato":null,"clave":"LIQ_DEBITOS","nombre":"Liquidación practicada y débitos generados","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null},{"dato":"texto","clave":"LIQ_BOLETA","nombre":"Boleta emitida: oficina, inhumación y conducción","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":["JARDIN_NORTE"]},{"dato":"texto","clave":"LIQ_BOLETA_JARDIN","nombre":"Boleta emitida: oficina, apertura, inhumación y conducción","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":["JARDIN_NORTE"],"excepto_cementerios":null},{"dato":"fecha","clave":"LIQ_PAGO","nombre":"Pago verificado: Rapipago, Pago Fácil o Banco Macro","obligatoria":true,"dato_obligatorio":true,"solo_cementerios":null,"excepto_cementerios":null}],"dias_alerta":1,"instrucciones":"Al tildar la boleta se puede anotar su número. La apertura se cobra solo cuando se inhuma en el Cementerio Jardín."},{"area":"$CEMENTERIO","clave":"CEMENTERIO","plazo":null,"estado":"en_tramite","nombre":"Cementerio (afuera)","custodia":"MESA_ENTRADAS","omitible":false,"subtareas":[{"dato":"fecha","clave":"CEM_REALIZADA","nombre":"Inhumación realizada","obligatoria":true,"dato_obligatorio":true,"solo_cementerios":null,"excepto_cementerios":null},{"dato":null,"clave":"CEM_DEVUELTO","nombre":"Expediente devuelto a la Dirección","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null}],"dias_alerta":2,"instrucciones":"El cementerio realiza la inhumación, la informa y devuelve el expediente a la Dirección. Al tildar la inhumación se anota la fecha en que se hizo."},{"area":"MESA_ENTRADAS","clave":"CONOCIMIENTO","plazo":null,"estado":"en_tramite","nombre":"Conocimiento y archivo","custodia":null,"omitible":false,"subtareas":[{"dato":null,"clave":"DIR_CONOCIMIENTO","nombre":"La Dirección tomó conocimiento de la inhumación","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null}],"dias_alerta":5,"instrucciones":"Después de tildar el conocimiento, concluir el expediente y archivarlo con su caja."}],"personas":[{"max":1,"min":1,"rol":"titular","etiqueta":"Titular de la concesión (concesionario)","fallecido":"no","pide_vinculo":false,"admite_juridica":false},{"max":1,"min":1,"rol":"difunto","etiqueta":"Difunto a inhumar","fallecido":"si","pide_vinculo":false,"admite_juridica":false},{"max":1,"min":0,"rol":"solicitante","etiqueta":"Solicitante","fallecido":"no","pide_vinculo":true,"admite_juridica":false}],"conceptos":[{"via":"boleta","paso":"LIQUIDACION","clave":"DERECHO_OFICINA","nombre":"Derecho de oficina","solo_cementerios":null,"excepto_cementerios":null},{"via":"boleta","paso":"LIQUIDACION","clave":"APERTURA","nombre":"Apertura","solo_cementerios":["JARDIN_NORTE"],"excepto_cementerios":null},{"via":"boleta","paso":"LIQUIDACION","clave":"INHUMACION","nombre":"Inhumación","solo_cementerios":null,"excepto_cementerios":null},{"via":"boleta","paso":"LIQUIDACION","clave":"CONDUCCION","nombre":"Conducción","solo_cementerios":null,"excepto_cementerios":null}],"documentos":[{"clave":"CONST_COMPUTOS","nombre":"Constancia de Cómputos (datos personales y catastrales, concesión vigente)","origen":"direccion","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"ESTADO_CUENTA","nombre":"Estado de cuenta (Conservación de los últimos 5 años)","origen":"direccion","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"DNI","nombre":"Fotocopia del DNI","origen":"concesionario","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"CONST_INHUMAR","nombre":"Constancia para inhumar","origen":"concesionario","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"COMPROBANTE_PAGO","nombre":"Copia del comprobante de pago de la boleta","origen":"concesionario","adjunto":"sugerido","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"LIQUIDACION","excepto_cementerios":null}],"forma_pago":"no_aplica","campos_extra":[],"tipos_monumento":["SOTANITO","CAPILLA","MAUSOLEO","SEPULTURA"],"requiere_contacto":true,"ubicacion_obligatoria":true},"notas_cambio":"Carga inicial, a validar. Según el procedimiento de inhumación de la Dirección (docs/fuentes/procedimiento-inhumacion.docx, 27/10/2026).","creado_por":1,"publicado_por":1,"tipo_tramite":"INHUMACION"},
  {"codigo":"INHUMACION_EMPRESA","version":1,"nombre":"Inhumación, pago en la empresa fúnebre","estado":"publicada","definicion":{"pasos":[{"area":"MESA_ENTRADAS","clave":"MESA","plazo":null,"estado":"en_tramite","nombre":"Mesa de Entradas","custodia":null,"omitible":false,"subtareas":[{"dato":null,"clave":"MESA_CARATULA","nombre":"Carátula impresa y agregada al expediente","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null},{"dato":null,"clave":"MESA_CONCESION_VIGENTE","nombre":"Concesión vigente verificada en Cómputos","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null},{"dato":null,"clave":"MESA_CONSERVACION","nombre":"Conservación de los últimos 5 años verificada en el estado de cuenta","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null},{"dato":"texto","clave":"MESA_HORARIO","nombre":"Horario de la inhumación informado al cementerio","obligatoria":true,"dato_obligatorio":true,"solo_cementerios":null,"excepto_cementerios":null}],"dias_alerta":1,"instrucciones":"Al tildar el horario se anota el día y la hora informados al cementerio. La empresa fúnebre abona, según el plan de sepelio, el derecho de oficina, la apertura (solo en el Cementerio Jardín), la inhumación y la conducción: la Dirección no emite boleta."},{"area":"$CEMENTERIO","clave":"CEMENTERIO","plazo":null,"estado":"en_tramite","nombre":"Cementerio (afuera)","custodia":"MESA_ENTRADAS","omitible":false,"subtareas":[{"dato":null,"clave":"CEM_COMPROBANTES","nombre":"Comprobantes de la empresa fúnebre presentados en el cementerio","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null},{"dato":"fecha","clave":"CEM_REALIZADA","nombre":"Inhumación realizada","obligatoria":true,"dato_obligatorio":true,"solo_cementerios":null,"excepto_cementerios":null},{"dato":null,"clave":"CEM_INFORMADO","nombre":"Informado a la Dirección","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null}],"dias_alerta":2,"instrucciones":"El concesionario se presenta en el cementerio con los comprobantes. La empresa fúnebre abona, según el plan de sepelio, el derecho de oficina, la apertura (solo en el Cementerio Jardín), la inhumación y la conducción: la Dirección no emite boleta. Al tildar la inhumación se anota la fecha en que se hizo."},{"area":"MESA_ENTRADAS","clave":"CONOCIMIENTO","plazo":null,"estado":"en_tramite","nombre":"Conocimiento y archivo","custodia":null,"omitible":false,"subtareas":[{"dato":null,"clave":"DIR_CONOCIMIENTO","nombre":"La Dirección tomó conocimiento de la inhumación","obligatoria":true,"dato_obligatorio":false,"solo_cementerios":null,"excepto_cementerios":null}],"dias_alerta":5,"instrucciones":"Después de tildar el conocimiento, concluir el expediente y archivarlo con su caja."}],"personas":[{"max":1,"min":1,"rol":"titular","etiqueta":"Titular de la concesión (concesionario)","fallecido":"no","pide_vinculo":false,"admite_juridica":false},{"max":1,"min":1,"rol":"difunto","etiqueta":"Difunto a inhumar","fallecido":"si","pide_vinculo":false,"admite_juridica":false},{"max":1,"min":0,"rol":"solicitante","etiqueta":"Solicitante","fallecido":"no","pide_vinculo":true,"admite_juridica":false}],"conceptos":[],"documentos":[{"clave":"CONST_COMPUTOS","nombre":"Constancia de Cómputos (datos personales y catastrales, concesión vigente)","origen":"direccion","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"ESTADO_CUENTA","nombre":"Estado de cuenta (Conservación de los últimos 5 años)","origen":"direccion","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"DNI","nombre":"Fotocopia del DNI","origen":"concesionario","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"CONST_INHUMAR","nombre":"Constancia para inhumar","origen":"concesionario","adjunto":"no","obligatorio":true,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"MESA","excepto_cementerios":null},{"clave":"COMPROBANTES_EMPRESA","nombre":"Comprobantes de pago de la empresa fúnebre","origen":"concesionario","adjunto":"sugerido","obligatorio":false,"solo_cementerios":null,"solo_si_juridica":null,"exigir_al_salir_de":"CEMENTERIO","excepto_cementerios":null}],"forma_pago":"no_aplica","campos_extra":[],"tipos_monumento":["SOTANITO","CAPILLA","MAUSOLEO","SEPULTURA"],"requiere_contacto":true,"ubicacion_obligatoria":true},"notas_cambio":"Carga inicial, a validar. Según el procedimiento de inhumación de la Dirección (docs/fuentes/procedimiento-inhumacion.docx, 27/10/2026).","creado_por":1,"publicado_por":1,"tipo_tramite":"INHUMACION"}
]$semilla$::jsonb) AS x LOOP
    IF EXISTS (SELECT FROM public.plantillas WHERE codigo = f ->> 'codigo') THEN
      RAISE NOTICE 'La plantilla % ya existe: no se toca.', f ->> 'codigo';
      CONTINUE;
    END IF;
    SELECT id INTO v_tipo FROM public.tipos_tramite WHERE codigo = f ->> 'tipo_tramite';
    IF v_tipo IS NULL THEN
      RAISE EXCEPTION 'No existe el tipo de trámite %', f ->> 'tipo_tramite';
    END IF;
    INSERT INTO public.plantillas ("codigo", "version", "tipo_tramite_id", "nombre", "estado", "definicion", "notas_cambio", "creado_por", "publicado_por")
    SELECT d."codigo", d."version", v_tipo, d."nombre", 'borrador', d."definicion", d."notas_cambio", d."creado_por", NULL
      FROM jsonb_populate_record(NULL::public.plantillas, f) AS d
    RETURNING id INTO v_id;
    UPDATE public.plantillas
       SET estado = f ->> 'estado', publicado_por = (f ->> 'publicado_por')::integer, publicado_en = now()
     WHERE id = v_id AND f ->> 'estado' <> 'borrador';
  END LOOP;
END
$incremental$;

-- Control: cada plantilla tiene una versión publicada (si no, nada de este archivo queda).
DO $$
DECLARE
  faltan text;
BEGIN
  SELECT string_agg(c, ', ') INTO faltan
    FROM unnest(ARRAY['INHUMACION_DIRECCION', 'INHUMACION_EMPRESA']) AS c
   WHERE NOT EXISTS (SELECT FROM public.plantillas p WHERE p.codigo = c AND p.estado = 'publicada');
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Quedaron sin versión publicada: % (¿ya existían como borrador o retiradas? Revisalas en /admin/plantillas)', faltan;
  END IF;
END
$$;

RESET ROLE;
REVOKE cementeria_owner FROM postgres;
