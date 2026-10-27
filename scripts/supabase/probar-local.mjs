#!/usr/bin/env node
// Prueba de punta a punta de la preparación de Supabase, contra simuladores
// locales (scripts/supabase/simular-local.mjs). No toca el proyecto real, ni
// .env.supabase.local, ni la base de desarrollo.
//
//   npm run supabase:probar
//
// 1. Simulador A (TLS con CA de prueba, unaccent y pg_trgm ya habilitadas en el
//    esquema extensions como si alguien las hubiera prendido desde el panel):
//    preparar.mjs DOS veces seguidas; las dos tienen que terminar con la
//    verificación en verde (idempotencia).
// 2. TLS: la CLI de Prisma (motor de migraciones) y `pg` se niegan a conectarse
//    con otra CA o con un host que no está en el certificado.
// 3. supabase/sql/ al día con las fuentes (se regenera en memoria y se compara).
// 4. Simulador B: los archivos de supabase/sql/ EN ORDEN, cada uno en una sola
//    ejecución como el SQL Editor (rol postgres), con las claves y el admin
//    generados como los de .local/; después `prisma migrate deploy` no tiene
//    que aplicar nada, y la verificación completa en verde. Los idempotentes se
//    corren dos veces; una migración repetida se niega sin cambiar nada.
// 5. A y B son equivalentes: roles, dueños, ACL, triggers, políticas, RLS,
//    privilegios por defecto, extensiones, _prisma_migrations (definición y
//    checksums, que tienen que ser los que calcula Prisma), filas de la semilla
//    y secuencias.
// Login propio: en A y en B el admin inicial queda activo, con
// debe_cambiar_clave y con el hash de su contraseña temporal (la del archivo
// local en A, la de .local/35_admin_inicial.sql en B), nunca con la contraseña.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { archivoAdmin, generar, SALIDA } from "./generar-sql.mjs";
import {
  CLI_PRISMA,
  RAIZ,
  ROLES,
  armarUrl,
  claveAleatoria,
  claveTemporal,
  clientePg,
  entornoHijo,
  escribirBloqueEnv,
  hashClave,
  leerArchivoClave,
  listarMigraciones,
  redactar,
  sqlClave,
  verificarHashClave,
} from "./lib.mjs";
import { configuracion, preparar, verificar } from "./preparar.mjs";
import { ADMIN_CUIL_SIMULADOR, escribirEnvSimulador, generarCertificados, levantarSimulador } from "./simular-local.mjs";

const fallas = [];
const secretos = [];
function ok(cond, texto, detalle = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${texto}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) fallas.push(texto);
}
function titulo(t) {
  console.log(`\n=== ${t} ===`);
}

async function conSuper(sim, fn) {
  const c = new pg.Client({
    connectionString: sim.urlSuperusuario,
    ssl: sim.ca ? { ca: readFileSync(sim.ca, "utf8"), rejectUnauthorized: true } : undefined,
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------
// 1. preparar.mjs dos veces
// ---------------------------------------------------------------------------

async function probarPreparar(sim) {
  const env = path.join(sim.dir, "a.env");
  escribirEnvSimulador(env, sim);
  for (const vuelta of [1, 2]) {
    console.log(`\n--- preparar.mjs, corrida ${vuelta} ---`);
    const { controles } = await preparar({ archivoEnv: env, silencioso: true });
    const mal = controles.filter((c) => c.ok === false);
    for (const c of controles) if (c.ok === false) console.log(`    ✗ ${c.control}: ${c.detalle}`);
    ok(mal.length === 0, `corrida ${vuelta}: verificación final`, `${controles.filter((c) => c.ok).length} controles en verde, ${mal.length} mal`);
  }
  const cfg = configuracion({ archivoEnv: env });
  ok(!cfg.nuevas.app && !cfg.nuevas.deploy, "las claves de la primera corrida quedaron en el .env y la segunda las reusó");
  const clave = leerArchivoClave(cfg.archivoClaveAdmin);
  if (clave) secretos.push(clave);
  ok(clave !== null, "la semilla dejó la contraseña temporal del admin inicial en el archivo local (al lado del .env del simulador)");
  await comprobarAdmin(sim, clave, "A (preparar.mjs)");
  return { env, cfg };
}

/** El admin inicial: activo, con debe_cambiar_clave y el hash de `clave` (la temporal), no la contraseña. */
async function comprobarAdmin(sim, clave, donde) {
  const fila = await conSuper(sim, async (c) =>
    (await c.query("SELECT activo, debe_cambiar_clave, clave_hash FROM public.usuarios WHERE cuil = $1", [ADMIN_CUIL_SIMULADOR])).rows[0],
  );
  ok(Boolean(fila?.activo && fila.debe_cambiar_clave), `${donde}: el admin inicial está activo y con debe_cambiar_clave`);
  ok(
    Boolean(clave && fila?.clave_hash?.startsWith("scrypt$") && !fila.clave_hash.includes(clave) && verificarHashClave(clave, fila.clave_hash)),
    `${donde}: el admin inicial tiene el hash scrypt de su contraseña temporal (y no la contraseña)`,
  );
}

// ---------------------------------------------------------------------------
// 2. TLS
// ---------------------------------------------------------------------------

function prismaStatus(url, caArchivo) {
  const r = spawnSync(process.execPath, [CLI_PRISMA, "migrate", "status"], {
    cwd: RAIZ,
    env: entornoHijo({ MIGRATE_DATABASE_URL: url, DATABASE_CA_FILE: caArchivo }),
    encoding: "utf8",
    windowsHide: true,
  });
  return { codigo: r.status, salida: redactar(`${r.stdout}${r.stderr}`, secretos) };
}

async function probarTls(sim, cfg) {
  const otra = generarCertificados(path.join(sim.dir, "otra-ca"), { nombre: "Otra CA (no es la del servidor)" });
  const porIp = cfg.urls.deploy.replace("@localhost:", "@127.0.0.1:");

  const bien = prismaStatus(cfg.urls.deploy, sim.ca);
  ok(bien.codigo === 0 && /up to date/i.test(bien.salida), "Prisma CLI con la CA correcta: se conecta");
  const otraCa = prismaStatus(cfg.urls.deploy, otra.ca);
  ok(otraCa.codigo !== 0, "Prisma CLI con otra CA: NO se conecta", primeraLineaError(otraCa.salida));
  const ip = prismaStatus(porIp, sim.ca);
  ok(ip.codigo !== 0, "Prisma CLI con un host que no está en el certificado: NO se conecta", primeraLineaError(ip.salida));

  for (const [nombre, url, caPem] of [
    ["otra CA", cfg.urls.app, readFileSync(otra.ca, "utf8")],
    ["host que no está en el certificado", cfg.urls.app.replace("@localhost:", "@127.0.0.1:"), readFileSync(sim.ca, "utf8")],
  ]) {
    const c = clientePg(url, { ca: { pem: caPem } });
    let error = null;
    try {
      await c.connect();
    } catch (e) {
      error = e;
    } finally {
      await c.end().catch(() => undefined);
    }
    ok(error !== null, `pg (la app) con ${nombre}: NO se conecta`, error?.code ?? error?.message ?? "");
  }
}

function primeraLineaError(salida) {
  return (salida.split("\n").find((l) => /error|P1\d{3}|certificate|tls/i.test(l)) ?? "").trim().slice(0, 140);
}

// ---------------------------------------------------------------------------
// 3 y 4. supabase/sql/
// ---------------------------------------------------------------------------

async function probarArchivos(sim) {
  const { versionados, volcado } = await generar();
  const enDisco = readdirSync(SALIDA).filter((n) => n.endsWith(".sql")).sort();
  const distintos = [...versionados].filter(([n, t]) => !enDisco.includes(n) || readFileSync(path.join(SALIDA, n), "utf8") !== t).map(([n]) => n);
  ok(
    distintos.length === 0 && enDisco.length === versionados.size,
    "supabase/sql/ está al día con las fuentes",
    distintos.length ? `distintos: ${distintos.join(", ")} (npm run supabase:sql)` : `${enDisco.length} archivos`,
  );

  // Las claves y el admin, como .local/05_claves.sql y .local/35_admin_inicial.sql.
  const claves = { app: claveAleatoria(), deploy: claveAleatoria() };
  const temporal = claveTemporal();
  secretos.push(claves.app, claves.deploy, temporal);
  const locales = {
    "05_claves.sql": `${sqlClave(ROLES.app, claves.app)}\n${sqlClave(ROLES.deploy, claves.deploy)}\n`,
    "35_admin_inicial.sql": archivoAdmin(volcado.admin, ADMIN_CUIL_SIMULADOR, volcado.motivo, hashClave(temporal)),
  };
  ok(!locales["35_admin_inicial.sql"].includes(temporal), ".local/35_admin_inicial.sql lleva el hash y no la contraseña temporal");
  const orden = [...enDisco.map((n) => ({ n, sql: readFileSync(path.join(SALIDA, n), "utf8") })), ...Object.entries(locales).map(([n, sql]) => ({ n: `.local/${n}`, sql }))].sort(
    (a, b) => path.basename(a.n).localeCompare(path.basename(b.n)),
  );

  // Como el SQL Editor: el rol postgres, cada archivo en UNA ejecución.
  const admin = clientePg(sim.urlAdmin, { ca: { pem: readFileSync(sim.ca, "utf8") } });
  await admin.connect();
  let resultado99 = null;
  try {
    for (const a of orden) {
      try {
        const r = await admin.query(a.sql);
        if (a.n === "99_verificar.sql") resultado99 = Array.isArray(r) ? r.at(-1) : r;
        console.log(`  · ${a.n}: aplicado`);
      } catch (e) {
        ok(false, `${a.n} se aplica`, redactar(e.message, secretos));
        throw e;
      }
    }
    ok(true, `los ${orden.length} archivos en orden, como el SQL Editor`);
    const filas99 = resultado99?.rows ?? [];
    const mal99 = filas99.filter((f) => f.ok === false);
    ok(filas99.length > 0 && mal99.length === 0, "99_verificar.sql con el rol postgres: nada en falso", `${filas99.filter((f) => f.ok).length} en verde, ${filas99.filter((f) => f.ok === null).length} informativos o sin permiso${mal99.length ? `; mal: ${mal99.map((f) => f.control).join(", ")}` : ""}`);

    // Idempotentes: otra vez, sin error.
    for (const n of ["00_roles.sql", "01_extensiones.sql", "02_prisma_migrations.sql", "30_semilla_produccion.sql", "40_cierre_api.sql", "45_storage.sql", "99_verificar.sql"]) {
      try {
        await admin.query(readFileSync(path.join(SALIDA, n), "utf8"));
        ok(true, `${n} corrido dos veces: sin error`);
      } catch (e) {
        ok(false, `${n} corrido dos veces: sin error`, e.message);
      }
    }
    await admin.query(locales["35_admin_inicial.sql"]);
    // Con OTRA temporal (otra generación): el admin ya tiene contraseña y no se pisa.
    await admin.query(archivoAdmin(volcado.admin, ADMIN_CUIL_SIMULADOR, volcado.motivo, hashClave(claveTemporal())));
    ok(true, ".local/35_admin_inicial.sql corrido dos veces (y con otra temporal): sin error");
    // Una migración repetida se niega, y no queda nada (ni postgres como miembro del owner).
    const primera = enDisco.find((n) => n.startsWith("20_migracion_"));
    try {
      await admin.query(readFileSync(path.join(SALIDA, primera), "utf8"));
      ok(false, `${primera} repetida se niega`);
    } catch (e) {
      ok(/ya está aplicada/.test(e.message), `${primera} repetida se niega`, e.message.slice(0, 100));
    }
    const miembro = (await admin.query("SELECT pg_has_role('postgres', 'cementeria_owner', 'USAGE') AS m")).rows[0].m;
    ok(!miembro, "postgres no quedó como miembro de cementeria_owner");
  } finally {
    await admin.end();
  }

  // prisma migrate deploy después de los archivos: no aplica nada.
  const env = path.join(sim.dir, "b.env");
  escribirEnvSimulador(env, sim);
  escribirBloqueEnv(env, {
    DATABASE_URL: armarUrl({ rol: ROLES.app, ref: null, host: "localhost", puerto: sim.puerto, clave: claves.app }),
    MIGRATE_DATABASE_URL: armarUrl({ rol: ROLES.deploy, ref: null, host: "localhost", puerto: sim.puerto, clave: claves.deploy }),
  });
  const cfg = configuracion({ archivoEnv: env });
  const r = spawnSync(process.execPath, [CLI_PRISMA, "migrate", "deploy"], {
    cwd: RAIZ,
    env: entornoHijo({ MIGRATE_DATABASE_URL: cfg.urls.deploy, DATABASE_CA_FILE: sim.ca }),
    encoding: "utf8",
    windowsHide: true,
  });
  const salida = redactar(`${r.stdout}${r.stderr}`, secretos);
  ok(r.status === 0 && /No pending migrations to apply/.test(salida), "prisma migrate deploy después de los archivos: no aplica nada", primeraLineaError(salida));

  const controles = await verificar(cfg, { mostrar: false });
  const mal = controles.filter((c) => c.ok === false);
  for (const c of mal) console.log(`    ✗ ${c.control}: ${c.detalle}`);
  ok(mal.length === 0, "verificación completa (como cementeria_app) sobre lo aplicado a mano", `${controles.filter((c) => c.ok).length} en verde`);
  await comprobarAdmin(sim, temporal, "B (los archivos)");
}

// ---------------------------------------------------------------------------
// 5. Equivalencia
// ---------------------------------------------------------------------------

const CONSULTAS_ESTADO = {
  roles: `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls,
                 (SELECT array_agg(c ORDER BY c) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setrole = r.oid) AS ajustes,
                 (SELECT array_agg(g.rolname ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) AS miembro_de
            FROM pg_roles r WHERE rolname LIKE 'cementeria%' OR rolname IN ('postgres', 'anon', 'authenticated', 'service_role') ORDER BY 1`,
  objetos: `SELECT n.nspname, c.relname, c.relkind, c.relowner::regrole::text AS dueno, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('public', 'auditoria') AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'i') ORDER BY 1, 2`,
  funciones: `SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proowner::regrole::text AS dueno, p.proacl::text AS acl
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'auditoria') ORDER BY 1, 2, 3`,
  esquemas: `SELECT nspname, nspowner::regrole::text AS dueno, nspacl::text AS acl FROM pg_namespace WHERE nspname IN ('public', 'auditoria', 'extensions') ORDER BY 1`,
  base: `SELECT datname, datdba::regrole::text AS dueno, datacl::text AS acl FROM pg_database WHERE datname = 'postgres'`,
  triggers: `SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
              WHERE NOT t.tgisinternal AND c.relnamespace IN ('public'::regnamespace, 'auditoria'::regnamespace) ORDER BY 1, 2`,
  politicas: `SELECT schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check FROM pg_policies ORDER BY 1, 2, 3`,
  defaults: `SELECT defaclrole::regrole::text AS rol, defaclnamespace::regnamespace::text AS esquema, defaclobjtype, defaclacl::text AS acl FROM pg_default_acl ORDER BY 1, 2, 3`,
  extensiones: `SELECT extname, extversion, extnamespace::regnamespace::text AS esquema, extowner::regrole::text AS dueno FROM pg_extension ORDER BY 1`,
  columnas_prisma: `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS defecto
                      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                     WHERE a.attrelid = 'public._prisma_migrations'::regclass AND a.attnum > 0 ORDER BY a.attnum`,
  indices_prisma: `SELECT indexrelid::regclass::text AS indice, pg_get_indexdef(indexrelid) AS def FROM pg_index WHERE indrelid = 'public._prisma_migrations'::regclass`,
  migraciones: `SELECT migration_name, checksum, applied_steps_count, finished_at IS NOT NULL AS terminada, logs, rolled_back_at FROM public._prisma_migrations ORDER BY 1`,
  // Las secuencias de la semilla y de usuarios no se comparan por valor: la
  // semilla en TS, al correr de nuevo, gasta números aunque no inserte (ON
  // CONFLICT DO NOTHING igual pide nextval), y A corrió dos veces. Lo que
  // importa es que el próximo id no choque con uno existente.
  secuencias: `SELECT t.tabla, s.last_value >= (xpath('/row/m/text()', query_to_xml(format('SELECT coalesce(max(id), 0) AS m FROM public.%I', t.tabla), false, true, '')))[1]::text::bigint AS sin_choque
                FROM unnest(ARRAY['areas', 'tipos_monumento', 'tipos_tramite', 'cementerios', 'plantillas', 'usuarios']) AS t(tabla)
                JOIN pg_sequences s ON s.schemaname = 'public' AND s.sequencename = t.tabla || '_id_seq'
               ORDER BY 1`,
  auditoria: `SELECT tabla, operacion, motivo, count(*) AS n FROM auditoria.cambios GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  // El bucket de adjuntos (45_storage.sql) y que no haya políticas en storage.
  storage: `SELECT id, name, public, file_size_limit, allowed_mime_types,
                   (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage') AS politicas
              FROM storage.buckets ORDER BY id`,
};

async function estado(sim) {
  return conSuper(sim, async (c) => {
    const e = {};
    for (const [k, sql] of Object.entries(CONSULTAS_ESTADO)) e[k] = (await c.query(sql)).rows;
    // Filas de la semilla y de usuarios, sin las fechas (son las del momento).
    for (const tabla of ["areas", "tipos_monumento", "tipos_tramite", "cementerios", "feriados", "feriados_anios", "plantillas", "usuarios", "expedientes", "movimientos"]) {
      e[`filas_${tabla}`] = (
        // De usuarios, el hash no se compara (cada lado tiene su temporal): solo si hay.
        await c.query(
          `SELECT (to_jsonb(t) - ARRAY['creado_en', 'actualizado_en', 'publicado_en', 'ultimo_ingreso', 'cerrado_en', 'clave_cambiada_en', 'bloqueado_hasta', 'clave_hash'])
                  || CASE WHEN to_jsonb(t) ? 'clave_hash' THEN jsonb_build_object('con_clave', to_jsonb(t) ->> 'clave_hash' IS NOT NULL) ELSE '{}'::jsonb END AS f
             FROM public.${tabla} t ORDER BY 1`,
        )
      ).rows.map((r) => JSON.stringify(r.f));
    }
    return e;
  });
}

function comparar(a, b) {
  for (const k of Object.keys(a)) {
    const iguales = JSON.stringify(a[k]) === JSON.stringify(b[k]);
    let detalle = `${a[k].length} fila(s)`;
    if (!iguales) {
      const sa = new Set(a[k].map((x) => JSON.stringify(x)));
      const sb = new Set(b[k].map((x) => JSON.stringify(x)));
      const soloA = [...sa].filter((x) => !sb.has(x)).slice(0, 3);
      const soloB = [...sb].filter((x) => !sa.has(x)).slice(0, 3);
      detalle = `solo con preparar: ${soloA.join(" | ").slice(0, 400)} ; solo con los archivos: ${soloB.join(" | ").slice(0, 400)}`;
    }
    ok(iguales, `equivalentes: ${k}`, detalle);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const simA = await levantarSimulador({ tls: true, extensionesEnExtensions: true });
  secretos.push(...simA.secretos);
  let simB;
  try {
    simB = await levantarSimulador({ tls: true });
    secretos.push(...simB.secretos);

    titulo("1. preparar.mjs dos veces (simulador A, con las extensiones en el esquema extensions)");
    const { cfg } = await probarPreparar(simA);
    secretos.push(cfg.claves.app, cfg.claves.deploy);

    titulo("2. TLS: CA y nombre del host");
    await probarTls(simA, cfg);

    titulo("3 y 4. supabase/sql/ en orden, como el SQL Editor (simulador B)");
    await probarArchivos(simB);

    titulo("5. Lo que dejan preparar.mjs (A) y los archivos (B)");
    const checksums = (await listarMigraciones()).map((m) => [m.nombre, m.checksum]);
    const [ea, eb] = [await estado(simA), await estado(simB)];
    ok(
      JSON.stringify(ea.migraciones.map((m) => [m.migration_name, m.checksum])) === JSON.stringify(checksums),
      "los checksums que guardó Prisma son el SHA-256 de cada migration.sql (los de los archivos)",
    );
    ok(
      [ea, eb].every((e) => e.secuencias.length === 6 && e.secuencias.every((f) => f.sin_choque === true)),
      "las secuencias de la semilla y de usuarios no chocan con los ids existentes (en A y en B)",
    );
    comparar(ea, eb);
  } finally {
    await simA.limpiar().catch(() => undefined);
    await simB?.limpiar().catch(() => undefined);
  }
  console.log(`\n${fallas.length ? `✗ ${fallas.length} FALLA(S): ${fallas.join("; ")}` : "✓ Todo en verde."}`);
  return fallas.length ? 1 : 0;
}

try {
  process.exit(await main());
} catch (e) {
  console.error(`✗ ${redactar(e instanceof Error ? e.stack ?? e.message : String(e), secretos)}`);
  process.exit(1);
}
