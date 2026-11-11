-- Requisitos del sitio público (/tramites): textos pedidos por la Dirección de
-- Cementerios el 10/11/2026. Publica una versión nueva de las 6 plantillas.
--
-- ESCRITO A MANO (no lo genera `npm run supabase:sql`, y por eso no está en
-- supabase/sql/). La semilla (prisma/semilla/plantillas) ya tiene los mismos
-- textos para las bases nuevas.
--
-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):
-- todo el archivo es una única transacción implícita, así que si algo falla no
-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.
--
-- Qué hace, en cada plantilla: toma la versión PUBLICADA que hay hoy en la base
-- (con lo que el admin haya cambiado), le cambia SOLO el nombre de estos
-- documentos y publica eso como versión nueva, como "Publicar" en
-- /admin/plantillas: la anterior queda retirada y los expedientes en curso
-- siguen con la suya.
--   - Todas menos inhumación: "Copia del comprobante de pago" lleva "(que emite
--     la Dirección de Cementerios, una vez iniciado el expediente)". En
--     RENOV_PLAN además deja de decir "de la boleta inicial".
--   - RENOV_SPT_CONTADO: el comprobante de pago pasa al final de la lista.
--   - Inhumación (las dos): el DNI y la constancia para inhumar "se presentan en
--     la Dirección, al iniciar el trámite"; el comprobante de la boleta "se
--     adjunta al expediente en la Dirección"; los de la empresa fúnebre "se
--     presentan en el cementerio, al momento de inhumar".
--
-- Si una plantilla tiene un BORRADOR abierto (alguien la está editando en
-- /admin/plantillas), no se publica: los textos nuevos se aplican EN EL
-- BORRADOR, sin tocar lo demás que tenga, y llegan al sitio cuando quien lo
-- edita lo publique. Un documento que esa persona ya renombró o sacó se deja
-- como está (lo avisa con un NOTICE). Si tiene el borrador abierto en pantalla,
-- al guardar le va a decir que alguien más lo cambió: que recargue.
--
-- Controles: si en una versión publicada un documento tiene un nombre distinto
-- del esperado (alguien lo cambió desde la carga inicial), falla y no cambia
-- nada: en ese caso, revisarla en /admin/plantillas.
-- Idempotente: una plantilla que ya tiene los textos nuevos no se toca.

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

-- El actor, como conActor(): SISTEMA y el motivo (queda en la auditoría).
SELECT set_config('app.usuario_id', '1', true),
       set_config('app.motivo', 'Requisitos del sitio público pedidos por la Dirección (10/11/2026)', true);

DO $cambios$
DECLARE
  comprobante CONSTANT text := 'Copia del comprobante de pago (que emite la Dirección de Cementerios, una vez iniciado el expediente)';
  dni CONSTANT text := 'Fotocopia del DNI (se presenta en la Dirección, al iniciar el trámite)';
  constancia CONSTANT text := 'Constancia para inhumar (se presenta en la Dirección, al iniciar el trámite)';
  notas CONSTANT text := 'Requisitos del sitio público, pedido de la Dirección (10/11/2026): aclaraciones sobre dónde se presenta cada documento y el comprobante de pago.';
  -- Por plantilla: los documentos a renombrar (clave, nombres anteriores
  -- aceptados, nombre nuevo) y los que van al final de la lista.
  cambios jsonb;
  c jsonb;
  r jsonb;
  pub public.plantillas%ROWTYPE;
  es_borrador boolean;
  docs jsonb;
  doc jsonb;
  i integer;
  encontrado boolean;
  clave_final text;
  v_nueva smallint;
  v_id integer;
BEGIN
  cambios := jsonb_build_array(
    jsonb_build_object('codigo', 'RENOV_CONTADO', 'al_final', '[]'::jsonb, 'renombrar', jsonb_build_array(
      jsonb_build_object('clave', 'COMPROBANTE_PAGO', 'antes', jsonb_build_array('Copia del comprobante de pago'), 'nombre', comprobante))),
    jsonb_build_object('codigo', 'RENOV_PLAN', 'al_final', '[]'::jsonb, 'renombrar', jsonb_build_array(
      jsonb_build_object('clave', 'COMPROBANTE_PAGO', 'antes', jsonb_build_array('Copia del comprobante de pago de la boleta inicial'), 'nombre', comprobante))),
    jsonb_build_object('codigo', 'RENOV_SPT_CONTADO', 'al_final', jsonb_build_array('COMPROBANTE_PAGO'), 'renombrar', jsonb_build_array(
      jsonb_build_object('clave', 'COMPROBANTE_PAGO', 'antes', jsonb_build_array('Copia del comprobante de pago'), 'nombre', comprobante))),
    jsonb_build_object('codigo', 'NUEVA_CONC_CONTADO', 'al_final', '[]'::jsonb, 'renombrar', jsonb_build_array(
      jsonb_build_object('clave', 'COMPROBANTE_PAGO', 'antes', jsonb_build_array('Copia del comprobante de pago'), 'nombre', comprobante))),
    jsonb_build_object('codigo', 'INHUMACION_DIRECCION', 'al_final', '[]'::jsonb, 'renombrar', jsonb_build_array(
      jsonb_build_object('clave', 'DNI', 'antes', jsonb_build_array('Fotocopia del DNI'), 'nombre', dni),
      jsonb_build_object('clave', 'CONST_INHUMAR', 'antes', jsonb_build_array('Constancia para inhumar'), 'nombre', constancia),
      jsonb_build_object('clave', 'COMPROBANTE_PAGO', 'antes', jsonb_build_array('Copia del comprobante de pago de la boleta'),
        'nombre', 'Copia del comprobante de pago de la boleta (se adjunta al expediente en la Dirección)'))),
    jsonb_build_object('codigo', 'INHUMACION_EMPRESA', 'al_final', '[]'::jsonb, 'renombrar', jsonb_build_array(
      jsonb_build_object('clave', 'DNI', 'antes', jsonb_build_array('Fotocopia del DNI'), 'nombre', dni),
      jsonb_build_object('clave', 'CONST_INHUMAR', 'antes', jsonb_build_array('Constancia para inhumar'), 'nombre', constancia),
      jsonb_build_object('clave', 'COMPROBANTES_EMPRESA', 'antes', jsonb_build_array('Comprobantes de pago de la empresa fúnebre'),
        'nombre', 'Comprobantes de pago de la empresa fúnebre (se presentan en el cementerio, al momento de inhumar)')))
  );

  FOR c IN SELECT x FROM jsonb_array_elements(cambios) AS x LOOP
    -- Con un borrador abierto, los textos van al borrador (ver el encabezado).
    SELECT * INTO pub FROM public.plantillas WHERE codigo = c ->> 'codigo' AND estado = 'borrador' FOR UPDATE;
    es_borrador := FOUND;
    IF NOT es_borrador THEN
      SELECT * INTO pub FROM public.plantillas WHERE codigo = c ->> 'codigo' AND estado = 'publicada' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La plantilla % no tiene una versión publicada: revisala en /admin/plantillas', c ->> 'codigo';
      END IF;
    END IF;

    docs := pub.definicion -> 'documentos';
    FOR r IN SELECT x FROM jsonb_array_elements(c -> 'renombrar') AS x LOOP
      encontrado := false;
      FOR i IN 0 .. jsonb_array_length(docs) - 1 LOOP
        doc := docs -> i;
        CONTINUE WHEN doc ->> 'clave' <> r ->> 'clave';
        encontrado := true;
        IF doc ->> 'nombre' = r ->> 'nombre' THEN
          NULL; -- ya tiene el texto nuevo
        ELSIF (r -> 'antes') ? (doc ->> 'nombre') THEN
          docs := jsonb_set(docs, ARRAY[i::text, 'nombre'], to_jsonb(r ->> 'nombre'));
        ELSIF es_borrador THEN
          -- Lo cambió quien edita el borrador: se respeta.
          RAISE NOTICE 'Borrador % v%: el documento % se llama "%" (lo cambió quien lo edita): se deja así.',
            pub.codigo, pub.version, r ->> 'clave', doc ->> 'nombre';
        ELSE
          RAISE EXCEPTION 'Plantilla % v%: el documento % se llama "%", no lo que se esperaba: revisalo en /admin/plantillas',
            pub.codigo, pub.version, r ->> 'clave', doc ->> 'nombre';
        END IF;
      END LOOP;
      IF NOT encontrado AND es_borrador THEN
        RAISE NOTICE 'Borrador % v%: no tiene el documento % (lo sacó quien lo edita): se deja así.', pub.codigo, pub.version, r ->> 'clave';
      ELSIF NOT encontrado THEN
        RAISE EXCEPTION 'Plantilla % v%: no tiene el documento %', pub.codigo, pub.version, r ->> 'clave';
      END IF;
    END LOOP;

    -- Al final de la lista, sin cambiar el orden de los demás.
    FOR clave_final IN SELECT jsonb_array_elements_text(c -> 'al_final') LOOP
      SELECT jsonb_agg(d ORDER BY (d ->> 'clave' = clave_final), n) INTO docs
        FROM jsonb_array_elements(docs) WITH ORDINALITY AS t(d, n);
    END LOOP;

    IF docs = pub.definicion -> 'documentos' THEN
      RAISE NOTICE 'La plantilla % v% (%): no hay nada que cambiar, no se toca.', pub.codigo, pub.version, pub.estado;
      CONTINUE;
    END IF;

    IF es_borrador THEN
      -- Un borrador se puede modificar: solo cambian estos documentos, lo
      -- demás queda como lo dejó quien lo edita. No se publica.
      UPDATE public.plantillas SET definicion = jsonb_set(definicion, '{documentos}', docs) WHERE id = pub.id;
      RAISE NOTICE 'Plantilla %: tiene un borrador abierto (v%). Los textos nuevos quedaron EN EL BORRADOR; la versión publicada no cambia hasta que se publique desde /admin/plantillas.',
        pub.codigo, pub.version;
      CONTINUE;
    END IF;

    SELECT max(version) + 1 INTO v_nueva FROM public.plantillas WHERE codigo = pub.codigo;

    -- Como "Publicar": nace borrador, se retira la anterior (el índice único no
    -- admite dos publicadas) y se publica la nueva.
    INSERT INTO public.plantillas (codigo, version, tipo_tramite_id, nombre, estado, definicion, notas_cambio, creado_por)
    VALUES (pub.codigo, v_nueva, pub.tipo_tramite_id, pub.nombre, 'borrador',
            jsonb_set(pub.definicion, '{documentos}', docs), notas, 1)
    RETURNING id INTO v_id;
    UPDATE public.plantillas SET estado = 'retirada' WHERE id = pub.id;
    UPDATE public.plantillas SET estado = 'publicada', publicado_por = 1, publicado_en = now() WHERE id = v_id;
    RAISE NOTICE 'Plantilla %: publicada la v% (la v% queda retirada).', pub.codigo, v_nueva, pub.version;
  END LOOP;

  -- Control: la versión publicada de cada una quedó con los textos nuevos (si
  -- no, falla y nada de este archivo queda). Menos las que tienen borrador.
  FOR c IN SELECT x FROM jsonb_array_elements(cambios) AS x LOOP
    CONTINUE WHEN EXISTS (SELECT FROM public.plantillas WHERE codigo = c ->> 'codigo' AND estado = 'borrador');
    SELECT definicion -> 'documentos' INTO docs FROM public.plantillas WHERE codigo = c ->> 'codigo' AND estado = 'publicada';
    FOR r IN SELECT x FROM jsonb_array_elements(c -> 'renombrar') AS x LOOP
      IF NOT EXISTS (SELECT FROM jsonb_array_elements(docs) AS d WHERE d ->> 'clave' = r ->> 'clave' AND d ->> 'nombre' = r ->> 'nombre') THEN
        RAISE EXCEPTION 'Control: % quedó sin el texto nuevo de %', c ->> 'codigo', r ->> 'clave';
      END IF;
    END LOOP;
    FOR clave_final IN SELECT jsonb_array_elements_text(c -> 'al_final') LOOP
      IF docs -> -1 ->> 'clave' <> clave_final THEN
        RAISE EXCEPTION 'Control: en % el documento % no quedó al final', c ->> 'codigo', clave_final;
      END IF;
    END LOOP;
  END LOOP;
END
$cambios$;

RESET ROLE;
REVOKE cementeria_owner FROM postgres;

-- Para ver el resultado (opcional, después de correr todo lo anterior):
-- SELECT codigo, version, estado, publicado_en FROM public.plantillas ORDER BY codigo, version;
