// Privilegios, dueños, triggers e índices (propuesta 2 "Roles de base" y
// "Convenciones", 2.11 y 2.13(b) puntos 1 y 2; sección 6, fila "Tests").
//
// Las listas esperadas están escritas a mano a partir de la propuesta: si una
// migración generada borra o cambia un índice o un trigger, esto se rompe.

import { describe, expect, it } from "vitest";
import { crearEscenario, crearExpediente, fila } from "./escenario";
import { SISTEMA, conPg, enTransaccion, fijarActor, intentar } from "./helper";

const S = "SELECT";
const I = "INSERT";
const U = "UPDATE";
const D = "DELETE";

/** Privilegios de cementeria_app por tabla (2.11). Lo que no figura, no lo tiene. */
const PRIVILEGIOS_APP: Record<string, string[]> = {
  "auditoria.accesos": [S, I],
  "auditoria.cambios": [S, I],
  "public._prisma_migrations": [],
  "public.areas": [S, I, U],
  // 26/10/2026 (*_avisos): UPDATE solo de algunas columnas (leido_en; activo y
  // actualizado_en; corrido_en y avisos). avisos.test.ts prueba el resto.
  "public.avisos": [S, I, U],
  "public.avisos_corridas": [S, I, U],
  "public.avisos_preferencias": [S, I, U],
  "public.cementerios": [S, I, U],
  "public.expediente_personas": [S, I, U],
  "public.expedientes": [S, I, U],
  "public.feriados": [S, I, U, D],
  "public.feriados_anios": [S, I, U],
  "public.movimientos": [S, I],
  "public.plantillas": [S, I, U, D],
  "public.tipos_monumento": [S, I, U],
  "public.tipos_tramite": [S, I, U],
  "public.usuarios": [S, I, U],
};

describe("privilegios de cementeria_app", () => {
  it("tiene exactamente los privilegios de la sección 2.11, también a nivel de columna", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ tabla: string; privilegios: string[] }>(
        `SELECT t.tabla, array_remove(ARRAY[
                  CASE WHEN has_any_column_privilege('cementeria_app', t.tabla, 'SELECT') THEN 'SELECT' END,
                  CASE WHEN has_any_column_privilege('cementeria_app', t.tabla, 'INSERT') THEN 'INSERT' END,
                  CASE WHEN has_any_column_privilege('cementeria_app', t.tabla, 'UPDATE') THEN 'UPDATE' END,
                  CASE WHEN has_table_privilege('cementeria_app', t.tabla, 'DELETE') THEN 'DELETE' END,
                  CASE WHEN has_table_privilege('cementeria_app', t.tabla, 'TRUNCATE') THEN 'TRUNCATE' END,
                  CASE WHEN has_any_column_privilege('cementeria_app', t.tabla, 'REFERENCES') THEN 'REFERENCES' END,
                  CASE WHEN has_table_privilege('cementeria_app', t.tabla, 'TRIGGER') THEN 'TRIGGER' END
                ], NULL) AS privilegios
           FROM (SELECT schemaname || '.' || tablename AS tabla
                   FROM pg_tables WHERE schemaname IN ('public', 'auditoria')) AS t
          ORDER BY 1`,
      );
      expect(Object.fromEntries(r.rows.map((f) => [f.tabla, f.privilegios]))).toEqual(PRIVILEGIOS_APP);
    });
  });

  it("no tiene privilegios sobre las secuencias: las identity no los necesitan y nadie mueve un id a mano", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ secuencia: string }>(
        `SELECT n.nspname || '.' || s.relname AS secuencia
           FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
          WHERE s.relkind = 'S' AND n.nspname IN ('public', 'auditoria')
            AND (has_sequence_privilege('cementeria_app', s.oid, 'USAGE')
              OR has_sequence_privilege('cementeria_app', s.oid, 'UPDATE')
              OR has_sequence_privilege('cementeria_app', s.oid, 'SELECT'))`,
      );
      expect(r.rows).toEqual([]);
    });
  });

  const SIN_DELETE = [
    "public.expedientes",
    "public.movimientos",
    "public.expediente_personas",
    "public.usuarios",
    "public.areas",
    "public.cementerios",
    "public.tipos_monumento",
    "public.tipos_tramite",
    "public.feriados_anios",
    "auditoria.cambios",
    "auditoria.accesos",
    // Los avisos los purga el admin con la credencial de deploy (npm run avisos:purgar).
    "public.avisos",
    "public.avisos_corridas",
    "public.avisos_preferencias",
  ];

  it.each(SIN_DELETE)("no puede borrar en %s", async (tabla) => {
    await enTransaccion("app", async (c) => {
      const r = await intentar(c, `DELETE FROM ${tabla}`);
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
    });
  });

  it("no puede borrar un expediente existente", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "Prueba de privilegios");
      const exp = await crearExpediente(c, await crearEscenario(c));
      const r = await intentar(c, "DELETE FROM public.expedientes WHERE id = $1", [exp.id]);
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
    });
  });

  const DDL_Y_ESCAPES: Array<[string, string]> = [
    ["deshabilitar el trigger del historial", "ALTER TABLE public.movimientos DISABLE TRIGGER movimientos_inmutables"],
    ["deshabilitar todos los triggers", "ALTER TABLE public.movimientos DISABLE TRIGGER ALL"],
    ["pasar el trigger a ENABLE REPLICA", "ALTER TABLE public.movimientos ENABLE REPLICA TRIGGER movimientos_inmutables"],
    ["deshabilitar movimientos_sellar", "ALTER TABLE public.movimientos DISABLE TRIGGER movimientos_sellar"],
    ["deshabilitar la protección de personas", "ALTER TABLE public.expediente_personas DISABLE TRIGGER expediente_personas_proteger"],
    ["deshabilitar el congelado de plantillas", "ALTER TABLE public.plantillas DISABLE TRIGGER plantillas_congelar"],
    ["deshabilitar la auditoría de usuarios", "ALTER TABLE public.usuarios DISABLE TRIGGER auditar_cambio"],
    ["deshabilitar expedientes_preparar", "ALTER TABLE public.expedientes DISABLE TRIGGER expedientes_preparar"],
    ["borrar el trigger", "DROP TRIGGER movimientos_inmutables ON public.movimientos"],
    ["reemplazar la función del trigger", "CREATE OR REPLACE FUNCTION public.movimientos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"],
    ["borrar la función del trigger", "DROP FUNCTION public.movimientos_inmutables() CASCADE"],
    ["agregar un trigger", "CREATE TRIGGER intruso BEFORE INSERT ON public.movimientos FOR EACH ROW EXECUTE FUNCTION public.movimientos_sellar()"],
    ["agregar una regla", "CREATE RULE intrusa AS ON INSERT TO public.movimientos DO INSTEAD NOTHING"],
    ["quitar un CHECK", "ALTER TABLE public.movimientos DROP CONSTRAINT movimientos_motivo_check"],
    ["agregar una columna", "ALTER TABLE public.movimientos ADD COLUMN intrusa integer"],
    ["cambiar el dueño", "ALTER TABLE public.movimientos OWNER TO cementeria_app"],
    ["borrar la tabla", "DROP TABLE public.movimientos CASCADE"],
    ["crear una tabla en public", "CREATE TABLE public.intrusa (id integer)"],
    ["crear una tabla en auditoria", "CREATE TABLE auditoria.intrusa (id integer)"],
    ["vaciar expedientes", "TRUNCATE public.expedientes CASCADE"],
    ["mover una secuencia", "SELECT setval('public.movimientos_id_seq', 1)"],
    ["tomar el rol del owner", "SET ROLE cementeria_owner"],
    ["pasar la sesión a replica", "SET session_replication_role = replica"],
    ["cambiar la configuración de la base", "ALTER DATABASE cementeria SET session_replication_role = replica"],
  ];

  it.each(DDL_Y_ESCAPES)("no puede %s", async (_que, sentencia) => {
    await enTransaccion("app", async (c) => {
      const r = await intentar(c, sentencia);
      expect(r).toMatchObject({ ok: false, codigo: "42501" });
    });
  });
});

describe("roles de base (sección 2)", () => {
  it("cementeria_app: LOGIN, sin atributos especiales y sin pertenecer al owner", async () => {
    await conPg("superusuario", async (c) => {
      const r = await fila<Record<string, boolean>>(
        c,
        `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
                pg_has_role('cementeria_app', 'cementeria_owner', 'MEMBER') AS miembro_del_owner,
                pg_has_role('cementeria_app', 'cementeria_deploy', 'MEMBER') AS miembro_de_deploy
           FROM pg_roles WHERE rolname = 'cementeria_app'`,
      );
      expect(r).toEqual({
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        miembro_del_owner: false,
        miembro_de_deploy: false,
      });
    });
  });

  it("cementeria_owner es NOLOGIN y cementeria_deploy entra como owner sin heredar sus privilegios", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolinherit: boolean; rolconfig: string[] | null; miembro: boolean }>(
        `SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolconfig,
                pg_has_role(rolname, 'cementeria_owner', 'MEMBER') AS miembro
           FROM pg_roles WHERE rolname IN ('cementeria_owner', 'cementeria_deploy') ORDER BY 1`,
      );
      expect(r.rows).toEqual([
        { rolname: "cementeria_deploy", rolcanlogin: true, rolsuper: false, rolinherit: false, rolconfig: ["role=cementeria_owner"], miembro: true },
        { rolname: "cementeria_owner", rolcanlogin: false, rolsuper: false, rolinherit: true, rolconfig: null, miembro: true },
      ]);
    });
    await conPg("owner", async (c) => {
      const r = await fila<{ actual: string; sesion: string }>(c, "SELECT current_user AS actual, session_user AS sesion");
      expect(r).toEqual({ actual: "cementeria_owner", sesion: "cementeria_deploy" });
    });
  });
});

describe("dueños", () => {
  it("todas las tablas y secuencias de public y auditoria son de cementeria_owner", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ objeto: string; dueno: string }>(
        `SELECT n.nspname || '.' || k.relname AS objeto, pg_get_userbyid(k.relowner) AS dueno
           FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE n.nspname IN ('public', 'auditoria') AND k.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          ORDER BY 1`,
      );
      expect(r.rows.length).toBeGreaterThanOrEqual(14 + 11);
      expect(r.rows.filter((f) => f.dueno !== "cementeria_owner")).toEqual([]);
    });
  });

  it("las funciones propias, el esquema auditoria, la base y las extensiones también", async () => {
    await conPg("superusuario", async (c) => {
      // Las funciones de una extensión "trusted" quedan a nombre del
      // superusuario que la instala; la extensión, del owner.
      const funciones = await c.query<{ funcion: string; dueno: string }>(
        `SELECT p.proname AS funcion, pg_get_userbyid(p.proowner) AS dueno
           FROM pg_proc p
          WHERE p.pronamespace IN ('public'::regnamespace, 'auditoria'::regnamespace)
            AND NOT EXISTS (SELECT 1 FROM pg_depend d
                             WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
          ORDER BY 1`,
      );
      expect(funciones.rows).toEqual(
        [
          "areas_tipo_coherente",
          "auditar_cambio",
          "cementerios_area_externa",
          "expediente_personas_proteger",
          "expedientes_preparar",
          "f_actor",
          // Semana 4: el CHECK del CUIT de una persona jurídica.
          "f_cuit_valido",
          "f_dias_habiles_entre",
          // 26/10/2026 (*_cadena_hash): la cadena de hash del historial.
          "f_hash_inicial",
          "f_hash_movimiento",
          "f_normalizar",
          "f_sumar_dias_habiles",
          "f_unaccent",
          "f_verificar_cadena",
          "movimientos_inmutables",
          "movimientos_sellar",
          "plantillas_congelar",
          "usuarios_area_interna",
        ].map((funcion) => ({ funcion, dueno: "cementeria_owner" })),
      );

      const otros = await fila<{ esquema: string; base: string; unaccent: string; pg_trgm: string }>(
        c,
        `SELECT (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'auditoria') AS esquema,
                (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS base,
                (SELECT pg_get_userbyid(extowner) FROM pg_extension WHERE extname = 'unaccent') AS unaccent,
                (SELECT pg_get_userbyid(extowner) FROM pg_extension WHERE extname = 'pg_trgm') AS pg_trgm`,
      );
      expect(otros).toEqual({ esquema: "cementeria_owner", base: "cementeria_owner", unaccent: "cementeria_owner", pg_trgm: "cementeria_owner" });
    });
  });

  it("ninguna función propia es SECURITY DEFINER: corren con los privilegios de quien escribe", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ proname: string }>(
        "SELECT proname FROM pg_proc WHERE pronamespace IN ('public'::regnamespace, 'auditoria'::regnamespace) AND prosecdef",
      );
      expect(r.rows).toEqual([]);
    });
  });
});

describe("triggers (2.11)", () => {
  // tgenabled = 'A' es ENABLE ALWAYS: se disparan también con
  // session_replication_role = replica.
  const TRIGGERS: Array<[string, string, string]> = [
    ["areas", "areas_tipo_coherente", "BEFORE UPDATE OF tipo ON public.areas FOR EACH ROW EXECUTE FUNCTION areas_tipo_coherente()"],
    ["areas", "auditar_cambio", "AFTER INSERT OR DELETE OR UPDATE ON public.areas FOR EACH ROW EXECUTE FUNCTION auditar_cambio('id')"],
    ["cementerios", "auditar_cambio", "AFTER INSERT OR DELETE OR UPDATE ON public.cementerios FOR EACH ROW EXECUTE FUNCTION auditar_cambio('id')"],
    ["cementerios", "cementerios_area_externa", "BEFORE INSERT OR UPDATE OF area_id ON public.cementerios FOR EACH ROW EXECUTE FUNCTION cementerios_area_externa()"],
    ["expediente_personas", "expediente_personas_proteger", "BEFORE INSERT OR DELETE OR UPDATE ON public.expediente_personas FOR EACH ROW EXECUTE FUNCTION expediente_personas_proteger()"],
    ["expedientes", "expedientes_preparar", "BEFORE INSERT OR UPDATE ON public.expedientes FOR EACH ROW EXECUTE FUNCTION expedientes_preparar()"],
    ["feriados", "auditar_cambio", "AFTER INSERT OR DELETE OR UPDATE ON public.feriados FOR EACH ROW EXECUTE FUNCTION auditar_cambio('fecha')"],
    ["feriados_anios", "auditar_cambio", "AFTER INSERT OR DELETE OR UPDATE ON public.feriados_anios FOR EACH ROW EXECUTE FUNCTION auditar_cambio('anio')"],
    ["movimientos", "movimientos_inmutables", "BEFORE DELETE OR UPDATE ON public.movimientos FOR EACH ROW EXECUTE FUNCTION movimientos_inmutables()"],
    ["movimientos", "movimientos_inmutables_truncate", "BEFORE TRUNCATE ON public.movimientos FOR EACH STATEMENT EXECUTE FUNCTION movimientos_inmutables()"],
    ["movimientos", "movimientos_sellar", "BEFORE INSERT ON public.movimientos FOR EACH ROW EXECUTE FUNCTION movimientos_sellar()"],
    ["plantillas", "auditar_cambio", "AFTER INSERT OR DELETE OR UPDATE ON public.plantillas FOR EACH ROW EXECUTE FUNCTION auditar_cambio('id')"],
    ["plantillas", "plantillas_congelar", "BEFORE INSERT OR DELETE OR UPDATE ON public.plantillas FOR EACH ROW EXECUTE FUNCTION plantillas_congelar()"],
    ["tipos_monumento", "auditar_cambio", "AFTER INSERT OR DELETE OR UPDATE ON public.tipos_monumento FOR EACH ROW EXECUTE FUNCTION auditar_cambio('id')"],
    ["tipos_tramite", "auditar_cambio", "AFTER INSERT OR DELETE OR UPDATE ON public.tipos_tramite FOR EACH ROW EXECUTE FUNCTION auditar_cambio('id')"],
    // Login propio (27/10/2026): también debe_cambiar_clave; nunca el hash.
    ["usuarios", "auditar_cambio", "AFTER INSERT OR UPDATE OF cuil, area_id, rol, activo, debe_cambiar_clave ON public.usuarios FOR EACH ROW EXECUTE FUNCTION auditar_cambio('id', 'id,cuil,area_id,rol,activo,debe_cambiar_clave')"],
    ["usuarios", "usuarios_area_interna", "BEFORE INSERT OR UPDATE OF area_id ON public.usuarios FOR EACH ROW EXECUTE FUNCTION usuarios_area_interna()"],
  ];

  it("son exactamente los esperados, todos ENABLE ALWAYS", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ tabla: string; nombre: string; habilitado: string; definicion: string }>(
        `SELECT k.relname AS tabla, t.tgname AS nombre, t.tgenabled AS habilitado,
                regexp_replace(pg_get_triggerdef(t.oid), '^CREATE TRIGGER \\S+ ', '') AS definicion
           FROM pg_trigger t
           JOIN pg_class k ON k.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auditoria')
          ORDER BY 1, 2`,
      );
      expect(r.rows).toEqual(TRIGGERS.map(([tabla, nombre, definicion]) => ({ tabla, nombre, habilitado: "A", definicion })));
    });
  });
});

describe("columnas identity", () => {
  it("expedientes, personas, historial y auditoría son GENERATED ALWAYS; el resto, BY DEFAULT", async () => {
    // 'a' = ALWAYS, 'd' = BY DEFAULT. usuarios va BY DEFAULT por SISTEMA (id 1).
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ tabla: string; identity: string }>(
        `SELECT n.nspname || '.' || k.relname AS tabla, a.attidentity AS identity
           FROM pg_attribute a
           JOIN pg_class k ON k.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE n.nspname IN ('public', 'auditoria') AND k.relkind = 'r' AND a.attidentity <> ''
          ORDER BY 1`,
      );
      expect(r.rows).toEqual([
        { tabla: "auditoria.accesos", identity: "a" },
        { tabla: "auditoria.cambios", identity: "a" },
        { tabla: "public.areas", identity: "d" },
        { tabla: "public.avisos", identity: "a" },
        { tabla: "public.cementerios", identity: "d" },
        { tabla: "public.expediente_personas", identity: "a" },
        { tabla: "public.expedientes", identity: "a" },
        { tabla: "public.movimientos", identity: "a" },
        { tabla: "public.plantillas", identity: "d" },
        { tabla: "public.tipos_monumento", identity: "d" },
        { tabla: "public.tipos_tramite", identity: "d" },
        { tabla: "public.usuarios", identity: "d" },
      ]);
    });
  });
});

describe("índices (pg_indexes contra la lista esperada)", () => {
  // Definiciones normalizadas por PostgreSQL 15, sin "CREATE [UNIQUE] INDEX
  // nombre ON". Fuente: secciones 2.1 a 2.10.
  const UNICO = "UNIQUE ";
  const INDICES: Array<[string, string, string]> = [
    ["accesos_expediente_id_en_idx", "", "auditoria.accesos USING btree (expediente_id, en)"],
    ["accesos_pkey", UNICO, "auditoria.accesos USING btree (id)"],
    ["accesos_usuario_id_en_idx", "", "auditoria.accesos USING btree (usuario_id, en)"],
    ["cambios_pkey", UNICO, "auditoria.cambios USING btree (id)"],
    ["cambios_tabla_registro_id_idx", "", "auditoria.cambios USING btree (tabla, registro_id)"],
    ["areas_codigo_key", UNICO, "public.areas USING btree (codigo)"],
    ["areas_pkey", UNICO, "public.areas USING btree (id)"],
    // 26/10/2026 (*_avisos): "mis no leídos" (parcial), la lista y no duplicar.
    ["avisos_corridas_pkey", UNICO, "public.avisos_corridas USING btree (dia)"],
    ["avisos_no_leidos_idx", "", "public.avisos USING btree (usuario_id, creado_en DESC) WHERE (leido_en IS NULL)"],
    ["avisos_pkey", UNICO, "public.avisos USING btree (id)"],
    ["avisos_preferencias_pkey", UNICO, "public.avisos_preferencias USING btree (usuario_id, tipo, canal)"],
    ["avisos_usuario_id_clave_key", UNICO, "public.avisos USING btree (usuario_id, clave)"],
    ["avisos_usuario_id_creado_en_idx", "", "public.avisos USING btree (usuario_id, creado_en DESC)"],
    ["cementerios_area_id_key", UNICO, "public.cementerios USING btree (area_id)"],
    ["cementerios_codigo_key", UNICO, "public.cementerios USING btree (codigo)"],
    ["cementerios_pkey", UNICO, "public.cementerios USING btree (id)"],
    ["expediente_personas_contacto_key", UNICO, "public.expediente_personas USING btree (expediente_id) WHERE (es_contacto AND vigente)"],
    // Semana 4 (*_personas_juridicas): la caja única busca el CUIT por igualdad.
    ["expediente_personas_cuit_idx", "", "public.expediente_personas USING btree (cuit)"],
    ["expediente_personas_dni_idx", "", "public.expediente_personas USING btree (dni)"],
    ["expediente_personas_expediente_id_idx", "", "public.expediente_personas USING btree (expediente_id)"],
    ["expediente_personas_nombre_norm_idx", "", "public.expediente_personas USING gin (nombre_norm gin_trgm_ops)"],
    ["expediente_personas_pkey", UNICO, "public.expediente_personas USING btree (id)"],
    ["expediente_personas_vigente_key", UNICO, "public.expediente_personas USING btree (expediente_id, rol, orden) WHERE vigente"],
    ["expedientes_anio_secuencia_key", UNICO, "public.expedientes USING btree (anio, secuencia)"],
    ["expedientes_area_actual_id_idx", "", "public.expedientes USING btree (area_actual_id) WHERE (recibido_en IS NULL)"],
    ["expedientes_area_responsable_id_estado_idx", "", "public.expedientes USING btree (area_responsable_id, estado)"],
    ["expedientes_busqueda_idx", "", "public.expedientes USING gin (busqueda gin_trgm_ops)"],
    ["expedientes_cementerio_id_ubicacion_clave_idx", "", "public.expedientes USING btree (cementerio_id, ubicacion_clave) WHERE (ubicacion_clave IS NOT NULL)"],
    ["expedientes_estado_en_area_desde_idx", "", "public.expedientes USING btree (estado, en_area_desde)"],
    ["expedientes_numero_interno_key", UNICO, "public.expedientes USING btree (numero_interno)"],
    // No único a propósito (pregunta 5).
    ["expedientes_numero_municipal_norm_idx", "", "public.expedientes USING btree (numero_municipal_norm)"],
    ["expedientes_padron_norm_idx", "", "public.expedientes USING btree (padron_norm)"],
    ["expedientes_pkey", UNICO, "public.expedientes USING btree (id)"],
    ["expedientes_plazo_desde_idx", "", "public.expedientes USING btree (plazo_desde) WHERE (plazo_desde IS NOT NULL)"],
    ["expedientes_tipo_tramite_id_fecha_inicio_idx", "", "public.expedientes USING btree (tipo_tramite_id, fecha_inicio)"],
    ["expedientes_ubicacion_idx", "", "public.expedientes USING gin (ubicacion jsonb_path_ops)"],
    ["feriados_anios_pkey", UNICO, "public.feriados_anios USING btree (anio)"],
    ["feriados_pkey", UNICO, "public.feriados USING btree (fecha)"],
    ["movimientos_area_destino_id_fecha_efectiva_idx", "", "public.movimientos USING btree (area_destino_id, fecha_efectiva) WHERE (tipo = ANY (ARRAY['pase'::text, 'devolucion'::text]))"],
    ["movimientos_expediente_id_area_destino_id_idx", "", "public.movimientos USING btree (expediente_id, area_destino_id)"],
    ["movimientos_expediente_id_comando_id_tipo_key", UNICO, "public.movimientos USING btree (expediente_id, comando_id, tipo)"],
    ["movimientos_expediente_id_secuencia_key", UNICO, "public.movimientos USING btree (expediente_id, secuencia)"],
    ["movimientos_pkey", UNICO, "public.movimientos USING btree (id)"],
    ["movimientos_tipo_registrado_en_idx", "", "public.movimientos USING btree (tipo, registrado_en)"],
    ["movimientos_usuario_id_registrado_en_idx", "", "public.movimientos USING btree (usuario_id, registrado_en)"],
    ["plantillas_codigo_borrador_key", UNICO, "public.plantillas USING btree (codigo) WHERE (estado = 'borrador'::text)"],
    ["plantillas_codigo_publicada_key", UNICO, "public.plantillas USING btree (codigo) WHERE (estado = 'publicada'::text)"],
    ["plantillas_codigo_version_key", UNICO, "public.plantillas USING btree (codigo, version)"],
    ["plantillas_pkey", UNICO, "public.plantillas USING btree (id)"],
    ["tipos_monumento_codigo_key", UNICO, "public.tipos_monumento USING btree (codigo)"],
    ["tipos_monumento_pkey", UNICO, "public.tipos_monumento USING btree (id)"],
    ["tipos_tramite_codigo_key", UNICO, "public.tipos_tramite USING btree (codigo)"],
    ["tipos_tramite_pkey", UNICO, "public.tipos_tramite USING btree (id)"],
    ["usuarios_cidituc_id_key", UNICO, "public.usuarios USING btree (cidituc_id)"],
    ["usuarios_cuil_key", UNICO, "public.usuarios USING btree (cuil)"],
    ["usuarios_pkey", UNICO, "public.usuarios USING btree (id)"],
  ];

  it("existen exactamente los índices esperados, con su definición", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname IN ('public', 'auditoria') AND tablename <> '_prisma_migrations'
          ORDER BY indexname`,
      );
      const esperados = INDICES.map(([nombre, unico, definicion]) => ({
        indexname: nombre,
        indexdef: `CREATE ${unico}INDEX ${nombre} ON ${definicion}`,
      })).sort((a, b) => (a.indexname < b.indexname ? -1 : 1));
      expect(r.rows).toEqual(esperados);
    });
  });

  it("todos los índices son válidos", async () => {
    await conPg("superusuario", async (c) => {
      const r = await c.query<{ indice: string }>(
        `SELECT i.indexrelid::regclass::text AS indice
           FROM pg_index i JOIN pg_class k ON k.oid = i.indrelid JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE n.nspname IN ('public', 'auditoria') AND NOT (i.indisvalid AND i.indisready)`,
      );
      expect(r.rows).toEqual([]);
    });
  });
});
