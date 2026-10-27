#!/usr/bin/env node
// Genera supabase/sql/: la preparación de la base de Supabase como archivos SQL
// numerados, para aplicarlos a mano desde el SQL Editor del panel (rol
// postgres, sin psql). Ver supabase/sql/README.md.
//
//   npm run supabase:sql                 escribe supabase/sql/ (y .local/ si hay datos)
//   npm run supabase:sql -- --verificar  no escribe: falla si supabase/sql/ no está al día
//
// Sale de las MISMAS fuentes que preparar.mjs: scripts/supabase/sql/*.sql,
// prisma/migrations (cada una tal cual, en orden) y la semilla real de
// prisma/semilla, que se corre (--sin-ficticios) en un simulador efímero de
// Supabase y se vuelca de forma determinista. Una migración nueva entra sola:
// basta con volver a correr esto.
//
// Versionados (sin secretos ni datos personales):
//   00_roles.sql, 01_extensiones.sql, 02_prisma_migrations.sql,
//   20_migracion_<nombre>.sql (una por migración), 30_semilla_produccion.sql,
//   31_inhumacion.sql (lo que la semilla agregó después, para una base que ya
//   tiene la anterior: ver INCREMENTALES), 40_cierre_api.sql, 45_storage.sql
//   (el bucket privado de adjuntos), 99_verificar.sql
// En supabase/sql/.local/ (ignorado por git), solo si .env.supabase.local
// tiene SUPABASE_ADMIN_URL (y ADMIN_INICIAL_CUIL para el admin):
//   05_claves.sql (ALTER ROLE … PASSWORD con verificadores SCRAM: las claves
//   en texto plano no salen de .env.supabase.local, donde se escriben las URLs;
//   si ya están ahí, se reusan: no se regeneran)
//   35_admin_inicial.sql (el admin inicial con el CUIL real y el HASH scrypt de
//   su contraseña temporal, con debe_cambiar_clave)
//   clave-admin-inicial.txt (esa contraseña temporal, en texto: el único lugar
//   donde está; si el archivo ya existe se reusa la misma, así volver a generar
//   no invalida la que ya se entregó)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  ENV_SUPABASE,
  ErrorPreparacion,
  RAIZ,
  ROLES,
  analizarUrlAdmin,
  ARCHIVO_CLAVE_ADMIN,
  armarUrl,
  claveAleatoria,
  claveDeUrl,
  claveTemporal,
  cuilValido,
  escribirArchivoClave,
  escribirBloqueEnv,
  hashClave,
  leerArchivoClave,
  leerEnv,
  leerFuente,
  listarMigraciones,
  redactar,
  sqlClave,
} from "./lib.mjs";
import { preparar } from "./preparar.mjs";
import { ADMIN_CUIL_SIMULADOR, escribirEnvSimulador, levantarSimulador } from "./simular-local.mjs";

export const SALIDA = path.join(RAIZ, "supabase", "sql");
export const SALIDA_LOCAL = path.join(SALIDA, ".local");

/** Las tablas que llena la semilla de producción, en el orden de prisma/semilla/sembrar.ts. */
const TABLAS_SEMILLA = ["areas", "tipos_monumento", "tipos_tramite", "cementerios", "feriados", "feriados_anios", "plantillas"];

const AVISO = "-- GENERADO por `npm run supabase:sql` (scripts/supabase/generar-sql.mjs). No editar a mano:\n-- se cambia la fuente y se vuelve a generar.";

/** Cómo tiene que correrse cada archivo: lo repite cada encabezado. */
const COMO_CORRER = [
  "-- Se corre ENTERO y de una sola vez en el SQL Editor de Supabase (rol postgres):",
  "-- todo el archivo es una única transacción implícita, así que si algo falla no",
  "-- queda nada a medias. Con psql: psql -1 -v ON_ERROR_STOP=1 -f <archivo>.",
].join("\n");

// ---------------------------------------------------------------------------
// Envoltorios
// ---------------------------------------------------------------------------

/** Lo que corre como cementeria_owner desde el SQL Editor (rol postgres). */
function comoOwner(cuerpo, { antes = "", despues = "" } = {}) {
  const bloques = [
    [
      "DO $$",
      "BEGIN",
      "  IF current_user <> 'postgres' THEN",
      "    RAISE EXCEPTION 'Este archivo lo corre el rol postgres de Supabase (SQL Editor), no %', current_user;",
      "  END IF;",
      "END",
      "$$;",
    ].join("\n"),
    antes.trim(),
    [
      "-- postgres toma el rol del dueño SOLO durante este archivo: el GRANT y el",
      "-- REVOKE del final van en la misma transacción.",
      "GRANT cementeria_owner TO postgres;",
      "SET LOCAL ROLE cementeria_owner;",
      'SET LOCAL search_path = "$user", public;',
      "DO $$",
      "BEGIN",
      "  IF current_user <> 'cementeria_owner' THEN",
      "    RAISE EXCEPTION 'No se pudo tomar el rol cementeria_owner: ¿se corrió el archivo entero de una sola vez?';",
      "  END IF;",
      "END",
      "$$;",
    ].join("\n"),
    cuerpo.trim(),
    despues.trim(),
    ["RESET ROLE;", "REVOKE cementeria_owner FROM postgres;"].join("\n"),
  ];
  return bloques.filter(Boolean).join("\n\n");
}

function encabezado(titulo, detalle) {
  return `-- ${titulo}\n--\n${AVISO}\n--\n${COMO_CORRER}\n${detalle ? `--\n${detalle}\n` : ""}`;
}

// ---------------------------------------------------------------------------
// Archivos versionados
// ---------------------------------------------------------------------------

function archivoMigracion(m) {
  const cuerpo = [
    `-- ===== prisma/migrations/${m.nombre}/migration.sql (sin cambios) =====`,
    m.sql.trimEnd(),
    `-- ===== fin de ${m.nombre} =====`,
    "",
    "-- La fila de Prisma, con su checksum (SHA-256 de migration.sql): después",
    "-- `prisma migrate deploy` la da por aplicada.",
    "INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)",
    `VALUES (gen_random_uuid()::text, '${m.checksum}', now(), '${m.nombre}', NULL, NULL, now(), 1);`,
  ].join("\n");
  const antes = [
    "-- Si ya está aplicada, se corta acá y no cambia nada.",
    "DO $$",
    "BEGIN",
    "  IF to_regclass('public._prisma_migrations') IS NULL THEN",
    "    RAISE EXCEPTION 'Falta public._prisma_migrations: corré antes 02_prisma_migrations.sql';",
    "  END IF;",
    "END",
    "$$;",
  ].join("\n");
  const guarda = [
    "DO $$",
    "BEGIN",
    `  IF EXISTS (SELECT FROM public._prisma_migrations WHERE migration_name = '${m.nombre}' AND rolled_back_at IS NULL) THEN`,
    `    RAISE EXCEPTION 'La migración ${m.nombre} ya está aplicada: no hay nada que hacer (no se cambió nada).';`,
    "  END IF;",
    "END",
    "$$;",
    "-- Como `prisma migrate deploy` con cementeria_deploy: su zona horaria.",
    "SET LOCAL timezone = 'America/Argentina/Tucuman';",
    "",
  ].join("\n");
  return (
    encabezado(
      `Migración ${m.nombre}, como cementeria_owner.`,
      `-- Fuente: prisma/migrations/${m.nombre}/migration.sql (checksum ${m.checksum}).\n` +
        "-- NO es idempotente a propósito: si ya está aplicada, el archivo se niega y no cambia nada.",
    ) +
    "\n" +
    comoOwner(guarda + cuerpo, { antes }) +
    "\n"
  );
}

function literalJson(valor) {
  const texto = valor.map((f) => `  ${JSON.stringify(f)}`).join(",\n");
  if (texto.includes("$semilla$")) throw new Error("La semilla contiene $semilla$: cambiar el delimitador.");
  return `$semilla$[\n${texto}\n]$semilla$::jsonb`;
}

/**
 * La semilla de producción volcada del simulador.
 * @param {{ tablas: { tabla: string, columnas: { nombre: string, identidad: string }[], filas: object[], clave: string[] }[], motivo: string }} volcado
 */
export function archivoSemilla(volcado, huella) {
  const partes = [
    "-- Que estén las migraciones (SISTEMA, id 1, lo inserta reglas_base).",
    "DO $$",
    "BEGIN",
    "  IF NOT EXISTS (SELECT FROM public.usuarios WHERE id = 1 AND apellido = 'SISTEMA') THEN",
    "    RAISE EXCEPTION 'No está el usuario SISTEMA: aplicá antes las migraciones (20_migracion_*.sql)';",
    "  END IF;",
    "END",
    "$$;",
    "",
    "-- El actor, como conActor(): SISTEMA y el motivo de la semilla, solo para esta",
    "-- transacción (los triggers de auditoría lo exigen).",
    `SELECT set_config('app.usuario_id', '1', true), set_config('app.motivo', '${volcado.motivo.replaceAll("'", "''")}', true);`,
  ];
  for (const t of volcado.tablas) {
    const columnas = t.columnas.map((c) => `"${c.nombre}"`).join(", ");
    const esPlantilla = t.tabla === "plantillas";
    const seleccion = t.columnas
      .map((c) =>
        esPlantilla && c.nombre === "estado" ? "'borrador'" : esPlantilla && c.nombre === "publicado_por" ? "NULL" : `d."${c.nombre}"`,
      )
      .join(", ");
    const sobreescribir = t.columnas.some((c) => c.identidad === "a") ? " OVERRIDING SYSTEM VALUE" : "";
    partes.push(
      "",
      `-- ${t.tabla}: ${t.filas.length} fila(s).${esPlantilla ? " Nacen borrador y se publican con un UPDATE, como exige plantillas_congelar." : ""}`,
      `INSERT INTO public.${t.tabla} (${columnas})${sobreescribir}`,
      `SELECT ${seleccion}`,
      `  FROM jsonb_populate_recordset(NULL::public.${t.tabla}, ${literalJson(t.filas)}) AS d`,
      `ON CONFLICT DO NOTHING;`,
    );
    if (esPlantilla) {
      partes.push(
        "",
        "UPDATE public.plantillas p",
        "   SET estado = d.estado, publicado_por = d.publicado_por, publicado_en = now()",
        `  FROM jsonb_populate_recordset(NULL::public.plantillas, ${literalJson(
          t.filas.map((f) => ({ id: f.id, estado: f.estado, publicado_por: f.publicado_por })),
        )}) AS d`,
        " WHERE p.id = d.id AND p.estado = 'borrador' AND d.estado <> 'borrador';",
      );
    }
    for (const c of t.columnas.filter((x) => x.identidad)) {
      partes.push(
        `SELECT setval(pg_get_serial_sequence('public.${t.tabla}', '${c.nombre}'), coalesce(max("${c.nombre}"), 1), max("${c.nombre}") IS NOT NULL) FROM public.${t.tabla};`,
      );
    }
  }
  return (
    encabezado(
      "Semilla de PRODUCCIÓN: áreas, catálogos, cementerios, feriados y plantillas publicadas.",
      [
        "-- Es la semilla real (prisma/seed.ts --sin-ficticios), corrida en un simulador",
        "-- efímero y volcada tal cual: mismos ids y valores (las fechas de alta y de",
        "-- publicación son las del momento en que se aplica). Sin usuarios ficticios",
        "-- ni expedientes. El administrador inicial va aparte, en",
        "-- .local/35_admin_inicial.sql (lleva un CUIL real y no se versiona).",
        "-- Idempotente: lo que ya existe (por clave) no se toca.",
        `-- Huella de prisma/semilla/ y prisma/seed.ts: ${huella}`,
      ].join("\n"),
    ) +
    "\n" +
    comoOwner(partes.join("\n")) +
    "\n"
  );
}

/**
 * Lo que la semilla agregó después de que el paquete se aplicó en Supabase, en
 * un archivo aparte para una base que YA tiene una semilla anterior. Volver a
 * correr 30_semilla_produccion.sql ahí no es seguro: inserta con los ids de
 * una base vacía y `ON CONFLICT DO NOTHING` (sin clave), así que si el admin ya
 * creó un tipo de trámite o una plantilla con ese id, la fila nueva se saltea
 * en silencio, la plantilla queda apuntando a otro tipo de trámite y el UPDATE
 * de la publicación puede publicar un borrador del admin. Estos archivos
 * buscan por CÓDIGO y dejan que la base ponga los ids.
 *
 * Cada uno nombra los tipos de trámite y las plantillas que agrega; el
 * contenido sale del mismo volcado que el 30, así que dicen lo mismo.
 */
export const INCREMENTALES = [
  {
    archivo: "31_inhumacion.sql",
    titulo: "Inhumación (27/10/2026): el tipo de trámite INHUMACION y sus dos plantillas publicadas.",
    tiposTramite: ["INHUMACION"],
    plantillas: ["INHUMACION_DIRECCION", "INHUMACION_EMPRESA"],
  },
];

/**
 * Un archivo incremental de la semilla (ver INCREMENTALES). Idempotente: un
 * tipo de trámite que ya existe (por código) se reusa, y una plantilla cuyo
 * código ya existe (en cualquier versión o estado) no se toca. Al final
 * controla que cada plantilla tenga una versión publicada: si no, falla y no
 * deja nada.
 */
function archivoIncremental(volcado, inc) {
  const tabla = (nombre) => {
    const t = volcado.tablas.find((x) => x.tabla === nombre);
    if (!t) throw new Error(`El volcado no tiene la tabla ${nombre}`);
    return t;
  };
  const tipos = tabla("tipos_tramite");
  const plantillas = tabla("plantillas");
  // Sin los ids: los pone la base (y no confunden a quien lea el archivo).
  const sinIds = (f, ...otras) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "id" && !otras.includes(k)));
  const filasTipo = inc.tiposTramite.map((codigo) => {
    const f = tipos.filas.find((x) => x.codigo === codigo);
    if (!f) throw new Error(`${inc.archivo}: la semilla no tiene el tipo de trámite ${codigo}`);
    return sinIds(f);
  });
  const codigoTipo = new Map(tipos.filas.map((f) => [f.id, f.codigo]));
  const filasPlantilla = inc.plantillas.map((codigo) => {
    const f = plantillas.filas.find((x) => x.codigo === codigo);
    if (!f) throw new Error(`${inc.archivo}: la semilla no tiene la plantilla ${codigo}`);
    // El tipo de trámite va por código: en la base de destino su id puede ser otro.
    return { ...sinIds(f, "tipo_tramite_id"), tipo_tramite: codigoTipo.get(f.tipo_tramite_id) };
  });
  const lista = (codigos) => codigos.map((c) => `'${c}'`).join(", ");

  const colsTipo = tipos.columnas.filter((c) => !c.identidad).map((c) => c.nombre);
  const colsPlantilla = plantillas.columnas.filter((c) => !c.identidad).map((c) => c.nombre);
  const valorPlantilla = (c) =>
    c === "tipo_tramite_id" ? "v_tipo" : c === "estado" ? "'borrador'" : c === "publicado_por" ? "NULL" : `d."${c}"`;

  const cuerpo = [
    "-- Que estén las migraciones y la semilla anterior (30_semilla_produccion.sql).",
    "DO $$",
    "BEGIN",
    "  IF NOT EXISTS (SELECT FROM public.usuarios WHERE id = 1 AND apellido = 'SISTEMA') THEN",
    "    RAISE EXCEPTION 'No está el usuario SISTEMA: aplicá antes las migraciones (20_migracion_*.sql)';",
    "  END IF;",
    "  IF NOT EXISTS (SELECT FROM public.areas) OR NOT EXISTS (SELECT FROM public.cementerios) THEN",
    "    RAISE EXCEPTION 'No están las áreas ni los cementerios: aplicá antes 30_semilla_produccion.sql';",
    "  END IF;",
    "END",
    "$$;",
    "",
    "-- El actor, como conActor(): SISTEMA y el motivo de la semilla.",
    `SELECT set_config('app.usuario_id', '1', true), set_config('app.motivo', '${volcado.motivo.replaceAll("'", "''")}', true);`,
    "",
    `-- tipos_tramite: ${filasTipo.length} fila(s), por código (si ya existe, se reusa).`,
    `INSERT INTO public.tipos_tramite (${colsTipo.map((c) => `"${c}"`).join(", ")})`,
    `SELECT ${colsTipo.map((c) => `d."${c}"`).join(", ")}`,
    `  FROM jsonb_populate_recordset(NULL::public.tipos_tramite, ${literalJson(filasTipo)}) AS d`,
    "ON CONFLICT (codigo) DO NOTHING;",
    "",
    `-- plantillas: ${filasPlantilla.length}. Cada una nace borrador y se publica con un UPDATE de esa`,
    "-- misma fila (plantillas_congelar); si el código ya existe, no se toca.",
    "DO $incremental$",
    "DECLARE",
    "  f jsonb;",
    "  v_tipo smallint;",
    "  v_id integer;",
    "BEGIN",
    `  FOR f IN SELECT x FROM jsonb_array_elements(${literalJson(filasPlantilla)}) AS x LOOP`,
    "    IF EXISTS (SELECT FROM public.plantillas WHERE codigo = f ->> 'codigo') THEN",
    "      RAISE NOTICE 'La plantilla % ya existe: no se toca.', f ->> 'codigo';",
    "      CONTINUE;",
    "    END IF;",
    "    SELECT id INTO v_tipo FROM public.tipos_tramite WHERE codigo = f ->> 'tipo_tramite';",
    "    IF v_tipo IS NULL THEN",
    "      RAISE EXCEPTION 'No existe el tipo de trámite %', f ->> 'tipo_tramite';",
    "    END IF;",
    `    INSERT INTO public.plantillas (${colsPlantilla.map((c) => `"${c}"`).join(", ")})`,
    `    SELECT ${colsPlantilla.map(valorPlantilla).join(", ")}`,
    "      FROM jsonb_populate_record(NULL::public.plantillas, f) AS d",
    "    RETURNING id INTO v_id;",
    "    UPDATE public.plantillas",
    "       SET estado = f ->> 'estado', publicado_por = (f ->> 'publicado_por')::integer, publicado_en = now()",
    "     WHERE id = v_id AND f ->> 'estado' <> 'borrador';",
    "  END LOOP;",
    "END",
    "$incremental$;",
    "",
    "-- Control: cada plantilla tiene una versión publicada (si no, nada de este archivo queda).",
    "DO $$",
    "DECLARE",
    "  faltan text;",
    "BEGIN",
    "  SELECT string_agg(c, ', ') INTO faltan",
    `    FROM unnest(ARRAY[${lista(inc.plantillas)}]) AS c`,
    "   WHERE NOT EXISTS (SELECT FROM public.plantillas p WHERE p.codigo = c AND p.estado = 'publicada');",
    "  IF faltan IS NOT NULL THEN",
    "    RAISE EXCEPTION 'Quedaron sin versión publicada: % (¿ya existían como borrador o retiradas? Revisalas en /admin/plantillas)', faltan;",
    "  END IF;",
    "END",
    "$$;",
  ].join("\n");

  return (
    encabezado(
      inc.titulo,
      [
        "-- Para una base de Supabase que YA tiene aplicada una semilla anterior: agrega",
        `-- solo esto (tipos de trámite: ${inc.tiposTramite.join(", ")}; plantillas: ${inc.plantillas.join(", ")}),`,
        "-- buscando por código y dejando que la base ponga los ids. No hace falta volver a",
        "-- correr 30_semilla_produccion.sql (y no conviene: inserta con ids fijos). En una",
        "-- base nueva, después del 30 no hace nada (el 30 ya trae todo).",
        "-- Idempotente: lo que ya existe (por código) no se toca. Mismo contenido que el 30",
        "-- (el mismo volcado de prisma/semilla).",
      ].join("\n"),
    ) +
    "\n" +
    comoOwner(cuerpo) +
    "\n"
  );
}

/**
 * El admin inicial con el CUIL real y el hash de su contraseña temporal
 * (`claveHash`, nunca la contraseña), con `debe_cambiar_clave`. Si el CUIL ya
 * existe SIN contraseña (una base anterior al login propio), se la pone; si ya
 * tiene una, no lo toca.
 */
export function archivoAdmin(admin, cuil, motivo, claveHash) {
  if (!/^scrypt\$/.test(claveHash ?? "")) throw new Error("archivoAdmin: falta el hash de la contraseña temporal");
  const fila = { ...admin.fila, cuil, clave_hash: claveHash, debe_cambiar_clave: true, intentos_fallidos: 0 };
  const columnas = admin.columnas.map((c) => `"${c}"`).join(", ");
  const cuerpo = [
    `SELECT set_config('app.usuario_id', '1', true), set_config('app.motivo', '${motivo.replaceAll("'", "''")}', true);`,
    `INSERT INTO public.usuarios (${columnas}, "clave_cambiada_en")`,
    `SELECT ${admin.columnas.map((c) => `d."${c}"`).join(", ")}, now()`,
    `  FROM jsonb_populate_record(NULL::public.usuarios, '${JSON.stringify(fila).replaceAll("'", "''")}'::jsonb) AS d`,
    "ON CONFLICT (cuil) DO UPDATE",
    "   SET clave_hash = EXCLUDED.clave_hash, debe_cambiar_clave = true, clave_cambiada_en = now()",
    " WHERE public.usuarios.clave_hash IS NULL AND public.usuarios.rol = 'admin' AND public.usuarios.activo;",
  ].join("\n");
  return (
    encabezado(
      "Administrador inicial (ADMIN_INICIAL_CUIL). NO SE VERSIONA: lleva un CUIL real.",
      [
        "-- Generado desde .env.supabase.local. Lleva el HASH (scrypt) de la contraseña temporal,",
        "-- nunca la contraseña: esa está solo en .local/clave-admin-inicial.txt. Con",
        "-- debe_cambiar_clave: en el primer ingreso CementerIA pide cambiarla.",
        "-- Idempotente: si el CUIL ya existe con contraseña, no lo toca; si existe sin",
        "-- contraseña (admin de antes del login propio), le pone esta temporal.",
      ].join("\n"),
    ) +
    "\n" +
    comoOwner(cuerpo) +
    "\n"
  );
}

function archivoSimple(titulo, fuente, detalle) {
  return `${encabezado(titulo, `-- Fuente: scripts/supabase/sql/${fuente}${detalle ? `\n${detalle}` : ""}`)}\n${leerFuente(fuente).trimEnd()}\n`;
}

function archivoCierre() {
  const dueno = leerFuente("cierre-api-dueno.sql").trimEnd();
  const postgres = leerFuente("cierre-api-postgres.sql").trimEnd();
  return (
    encabezado(
      "Cierre de la API pública de Supabase (anon, authenticated, service_role).",
      "-- Fuentes: scripts/supabase/sql/cierre-api-dueno.sql (como cementeria_owner) y\n-- scripts/supabase/sql/cierre-api-postgres.sql (como postgres). Idempotente.",
    ) +
    "\n" +
    comoOwner(dueno) +
    "\n\n" +
    postgres +
    "\n"
  );
}

function archivoVerificar() {
  return archivoSimple(
    "Verificación final: SOLO LECTURA, se puede correr las veces que haga falta.",
    "verificar.sql",
    "-- Una fila por control (ok: true bien, false mal, null informativo). Los que leen\n" +
      "-- datos salen en null con el rol postgres: los hace `npm run supabase:verificar`.",
  ).replace(COMO_CORRER, "-- Se corre entero en el SQL Editor (rol postgres) o con psql.");
}

// ---------------------------------------------------------------------------
// Volcado de la semilla
// ---------------------------------------------------------------------------

/** Huella de las fuentes de la semilla, para saber si el volcado está al día. */
export function huellaSemilla() {
  const h = createHash("sha256");
  const archivos = [path.join(RAIZ, "prisma", "seed.ts")];
  const recorrer = (dir) => {
    for (const n of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, n.name);
      if (n.isDirectory()) recorrer(p);
      else if (!n.name.endsWith(".test.ts")) archivos.push(p);
    }
  };
  recorrer(path.join(RAIZ, "prisma", "semilla"));
  for (const a of archivos) {
    h.update(path.relative(RAIZ, a).replaceAll("\\", "/"));
    h.update("\0");
    h.update(readFileSync(a));
    h.update("\0");
  }
  return h.digest("hex");
}

async function volcar(urlSuperusuario) {
  const c = new pg.Client({ connectionString: urlSuperusuario });
  await c.connect();
  try {
    const tablas = [];
    for (const tabla of TABLAS_SEMILLA) {
      const cols = (
        await c.query(
          `SELECT a.attname AS nombre, format_type(a.atttypid, a.atttypmod) AS tipo, a.attidentity AS identidad,
                  a.attgenerated AS generada, a.attnotnull AS no_nula, a.atthasdef AS con_default
             FROM pg_attribute a
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum`,
          [`public.${tabla}`],
        )
      ).rows;
      const columnas = [];
      for (const col of cols) {
        if (col.generada) continue;
        // Las fechas de alta y publicación son las de cuando se aplica: no se
        // vuelcan (así el archivo es el mismo cada vez que se genera).
        if (/^timestamp/.test(col.tipo)) {
          if (col.no_nula && !col.con_default) throw new Error(`public.${tabla}.${col.nombre} es timestamp NOT NULL sin default: el generador no sabe qué poner.`);
          continue;
        }
        columnas.push({ nombre: col.nombre, identidad: col.identidad || "" });
      }
      const clave = (
        await c.query(
          `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`,
          [`public.${tabla}`],
        )
      ).rows.map((f) => f.attname);
      const filas = (await c.query(`SELECT to_jsonb(t) AS f FROM public.${tabla} t ORDER BY ${clave.map((k) => `t."${k}"`).join(", ")}`)).rows.map(
        (r) => Object.fromEntries(columnas.map((col) => [col.nombre, r.f[col.nombre] ?? null])),
      );
      tablas.push({ tabla, columnas, filas, clave });
    }
    const motivo = (await c.query("SELECT DISTINCT motivo FROM auditoria.cambios WHERE tabla = 'areas'")).rows.map((f) => f.motivo);
    if (motivo.length !== 1) throw new Error(`Se esperaba un solo motivo de la semilla en auditoria.cambios y hay ${motivo.length}.`);
    const admin = (await c.query("SELECT to_jsonb(u) AS f FROM public.usuarios u WHERE cuil = $1", [ADMIN_CUIL_SIMULADOR])).rows[0]?.f;
    if (!admin) throw new Error("La semilla no creó el admin inicial en el simulador.");
    const colsAdmin = (
      await c.query(
        `SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid = 'public.usuarios'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
            AND a.attidentity = '' AND a.attname <> 'id' AND format_type(a.atttypid, a.atttypmod) NOT LIKE 'timestamp%'
          ORDER BY a.attnum`,
      )
    ).rows.map((f) => f.attname);
    return { tablas, motivo: motivo[0], admin: { columnas: colsAdmin, fila: Object.fromEntries(colsAdmin.map((k) => [k, admin[k] ?? null])) } };
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

/**
 * Corre la semilla en un simulador efímero y arma todos los archivos.
 * @returns {Promise<{ versionados: Map<string, string>, volcado: Awaited<ReturnType<typeof volcar>> }>}
 */
export async function generar() {
  const migraciones = await listarMigraciones();
  const sim = await levantarSimulador({ tls: false });
  let volcado;
  try {
    const envTemporal = path.join(sim.dir, "simulador.env");
    escribirEnvSimulador(envTemporal, sim);
    await preparar({ archivoEnv: envTemporal, hasta: "semilla", silencioso: true });
    volcado = await volcar(sim.urlSuperusuario);
  } catch (e) {
    throw new Error(redactar(e instanceof Error ? e.message : String(e), sim.secretos));
  } finally {
    await sim.limpiar();
  }

  const versionados = new Map();
  versionados.set(
    "00_roles.sql",
    archivoSimple(
      "Roles de CementerIA (sin contraseñas). Idempotente.",
      "roles.sql",
      "-- Después: .local/05_claves.sql (las contraseñas, como verificadores SCRAM).",
    ),
  );
  versionados.set("01_extensiones.sql", archivoSimple("unaccent y pg_trgm en el esquema public. Idempotente.", "extensiones.sql"));
  versionados.set(
    "02_prisma_migrations.sql",
    encabezado("La tabla de control de Prisma, a nombre de cementeria_owner. Idempotente.", "-- Fuente: scripts/supabase/sql/prisma-migrations.sql") +
      "\n" +
      comoOwner(leerFuente("prisma-migrations.sql")) +
      "\n",
  );
  for (const m of migraciones) versionados.set(`20_migracion_${m.nombre}.sql`, archivoMigracion(m));
  versionados.set("30_semilla_produccion.sql", archivoSemilla(volcado, huellaSemilla()));
  for (const inc of INCREMENTALES) versionados.set(inc.archivo, archivoIncremental(volcado, inc));
  versionados.set("40_cierre_api.sql", archivoCierre());
  versionados.set(
    "45_storage.sql",
    archivoSimple(
      "Bucket PRIVADO de adjuntos en Supabase Storage (solo para el despliegue en Vercel). Idempotente.",
      "storage.sql",
      "-- Lo usa la app con ADJUNTOS_ALMACEN=supabase (docs/despliegue-vercel.md). En el\n" +
        "-- servidor municipal los adjuntos van al disco y este bucket queda vacío.",
    ),
  );
  versionados.set("99_verificar.sql", archivoVerificar());
  return { versionados, volcado };
}

/** Escribe los .local/ y las URLs: solo si hay SUPABASE_ADMIN_URL. */
function generarLocales(volcado) {
  const env = leerEnv(ENV_SUPABASE);
  const adminUrl = env.SUPABASE_ADMIN_URL?.trim();
  if (!adminUrl) {
    console.log(`  · Sin SUPABASE_ADMIN_URL en .env.supabase.local: no se generan .local/05_claves.sql ni las URLs.`);
    return;
  }
  const info = analizarUrlAdmin(adminUrl);
  const claves = {
    app: claveDeUrl(env.DATABASE_URL, { rol: ROLES.app, ref: info.ref, host: info.host }) ?? claveAleatoria(),
    deploy: claveDeUrl(env.MIGRATE_DATABASE_URL, { rol: ROLES.deploy, ref: info.ref, host: info.host }) ?? claveAleatoria(),
  };
  mkdirSync(SALIDA_LOCAL, { recursive: true });
  writeFileSync(
    path.join(SALIDA_LOCAL, "05_claves.sql"),
    `${encabezado(
      "Contraseñas de cementeria_app y cementeria_deploy. NO SE VERSIONA.",
      "-- Verificadores SCRAM-SHA-256 de las claves de .env.supabase.local: la clave en texto\n" +
        "-- plano no está acá ni llega a la base. Correr después de 00_roles.sql. Se puede\n" +
        "-- volver a correr (pone la misma clave).",
    )}\n${sqlClave(ROLES.app, claves.app)}\n${sqlClave(ROLES.deploy, claves.deploy)}\n`,
    { mode: 0o600 },
  );
  const valores = {
    DATABASE_URL: armarUrl({ rol: ROLES.app, ref: info.ref, host: info.host, puerto: info.puerto, clave: claves.app }),
    MIGRATE_DATABASE_URL: armarUrl({ rol: ROLES.deploy, ref: info.ref, host: info.host, puerto: info.puerto, clave: claves.deploy }),
  };
  if (!env.DATABASE_CA_FILE) valores.DATABASE_CA_FILE = "certs/supabase-prod-ca-2021.crt";
  escribirBloqueEnv(ENV_SUPABASE, valores);
  console.log("  ✓ .local/05_claves.sql y las URLs (DATABASE_URL, MIGRATE_DATABASE_URL) en .env.supabase.local");

  const cuil = env.ADMIN_INICIAL_CUIL?.trim() ?? "";
  if (!cuil) {
    console.log("  · Sin ADMIN_INICIAL_CUIL en .env.supabase.local: no se genera .local/35_admin_inicial.sql.");
  } else if (!cuilValido(cuil)) {
    throw new ErrorPreparacion("ADMIN_INICIAL_CUIL de .env.supabase.local no es un CUIL válido: no se genera .local/35_admin_inicial.sql.");
  } else {
    // La contraseña temporal: la del archivo si ya existe (ya se pudo haber
    // entregado o aplicado), o una nueva. En texto, SOLO en ese archivo.
    const existente = leerArchivoClave(ARCHIVO_CLAVE_ADMIN);
    const clave = existente ?? claveTemporal();
    if (!existente) escribirArchivoClave(ARCHIVO_CLAVE_ADMIN, clave, "npm run supabase:sql");
    writeFileSync(path.join(SALIDA_LOCAL, "35_admin_inicial.sql"), archivoAdmin(volcado.admin, cuil, volcado.motivo, hashClave(clave)), { mode: 0o600 });
    console.log("  ✓ .local/35_admin_inicial.sql (con el CUIL de ADMIN_INICIAL_CUIL y el hash de su contraseña temporal)");
    console.log(
      existente
        ? "  ✓ .local/clave-admin-inicial.txt ya existía: se reusó su contraseña temporal (no se imprime)"
        : "  ✓ .local/clave-admin-inicial.txt: la contraseña temporal del admin inicial (no se imprime; entregala en mano)",
    );
  }
}

async function main() {
  const verificarSolo = process.argv.includes("--verificar");
  console.log("» Generando supabase/sql/ (la semilla corre en un simulador efímero)…");
  const { versionados, volcado } = await generar();
  const existentes = existsSync(SALIDA) ? readdirSync(SALIDA).filter((n) => n.endsWith(".sql")) : [];
  const sobrantes = existentes.filter((n) => !versionados.has(n));
  const distintos = [...versionados].filter(([n, t]) => !existsSync(path.join(SALIDA, n)) || readFileSync(path.join(SALIDA, n), "utf8") !== t).map(([n]) => n);
  if (verificarSolo) {
    if (distintos.length || sobrantes.length) {
      console.error(`✗ supabase/sql/ no está al día: ${[...distintos, ...sobrantes.map((s) => `${s} (sobra)`)].join(", ")}. Corré npm run supabase:sql.`);
      return 1;
    }
    console.log(`✓ supabase/sql/ al día (${versionados.size} archivos).`);
    return 0;
  }
  mkdirSync(SALIDA, { recursive: true });
  for (const s of sobrantes) rmSync(path.join(SALIDA, s));
  for (const [n, t] of versionados) writeFileSync(path.join(SALIDA, n), t);
  console.log(`  ✓ ${versionados.size} archivos en supabase/sql/ (${distintos.length} cambiados${sobrantes.length ? `, ${sobrantes.length} borrados` : ""})`);
  generarLocales(volcado);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
