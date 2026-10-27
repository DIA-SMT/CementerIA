#!/usr/bin/env node
// Prepara la base de CementerIA en Supabase con un solo comando, sin pasos
// manuales en SQL (docs/despliegue.md, "Base en Supabase").
//
//   npm run supabase:preparar                       usa .env.supabase.local
//   npm run supabase:preparar -- --env <archivo>    otro archivo (el simulador)
//   npm run supabase:preparar -- --rotar-claves     claves nuevas para app y deploy
//   npm run supabase:preparar -- --app-pooler transaccion
//                                                   DATABASE_URL por el Transaction
//                                                   pooler (6543) en vez del Session (5432)
//   npm run supabase:verificar                      solo la verificación final
//
// Lee del archivo de entorno SUPABASE_ADMIN_URL (rol postgres, Session pooler,
// puerto 5432, usuario postgres.<ref>), ADMIN_INICIAL_CUIL y, opcional,
// DATABASE_CA_FILE (por defecto certs/supabase-prod-ca-2021.crt). Hace:
//   a. conexión con TLS verificado, versión y que el usuario sea el postgres de
//      Supabase (no superusuario, con los roles de la API);
//   b. roles cementeria_owner, cementeria_deploy y cementeria_app
//      (scripts/supabase/sql/roles.sql) con claves aleatorias que se guardan en
//      el archivo de entorno como DATABASE_URL y MIGRATE_DATABASE_URL;
//   c. unaccent y pg_trgm en public (sql/extensiones.sql);
//   d. `prisma migrate deploy` con el rol de deploy;
//   e. cierre de la API de Supabase (sql/cierre-api-*.sql) y el bucket privado
//      de adjuntos de Storage (sql/storage.sql: para el despliegue en Vercel);
//   f. semilla de producción: --sin-ficticios y el admin de ADMIN_INICIAL_CUIL,
//      con una contraseña TEMPORAL (login propio) que la semilla imprime una vez
//      y escribe en supabase/sql/.local/clave-admin-inicial.txt (o en
//      ADMIN_INICIAL_CLAVE_ARCHIVO del archivo de entorno); con el simulador, al
//      lado de su .env. Si el admin ya existía con contraseña, no se toca;
//   g. verificación como cementeria_app (sql/verificar.sql, intentos reales,
//      alta de prueba que se deshace, historial:verificar).
//
// Idempotente: se puede correr las veces que haga falta. Las claves se generan
// la primera vez y después se reusan las del archivo (salvo --rotar-claves).
// Nunca imprime una clave ni una URL con clave: la salida de los procesos hijos
// pasa por un filtro que las tapa.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARCHIVO_CLAVE_ADMIN,
  CLI_PRISMA,
  CLI_TSX,
  ENV_SUPABASE,
  ErrorPreparacion,
  RAIZ,
  ROLES,
  ROLES_API,
  analizarUrlAdmin,
  armarUrl,
  cargarCa,
  claveAleatoria,
  claveDeUrl,
  conectarConReintentos,
  correrNode,
  cuilValido,
  entornoHijo,
  escribirBloqueEnv,
  leerEnv,
  leerFuente,
  redactar,
  sqlClave,
} from "./lib.mjs";

const PUERTO_TRANSACCION = 6543;

/** Los secretos que se conocen hasta ahora, para tapar cualquier mensaje de error. */
const secretosConocidos = [];

/** false: los procesos hijos no muestran su salida (el generador de supabase/sql/). */
let mostrarHijos = true;

/** El final de la salida de un hijo, para el error cuando no se mostró. */
function cola(r) {
  return mostrarHijos ? "" : `\n${r.salida.trim().split("\n").slice(-25).join("\n")}`;
}

/** Mensajes de avance. */
function paso(texto) {
  console.log(`\n» ${texto}`);
}
function bien(texto) {
  console.log(`  ✓ ${texto}`);
}
function aviso(texto) {
  console.log(`  ! ${texto}`);
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/**
 * Lee y valida el archivo de entorno ANTES de tocar nada.
 * @param {{ archivoEnv: string, rotarClaves?: boolean, appPooler?: "sesion" | "transaccion" }} o
 */
export function configuracion({ archivoEnv, rotarClaves = false, appPooler = "sesion" }) {
  const env = leerEnv(archivoEnv);
  const nombre = path.relative(RAIZ, archivoEnv) || archivoEnv;
  const adminUrl = env.SUPABASE_ADMIN_URL?.trim();
  if (!adminUrl) {
    throw new ErrorPreparacion(
      `Falta SUPABASE_ADMIN_URL en ${nombre}.\n` +
        "Es la cadena del Session pooler del rol postgres (Supabase → Connect → Session pooler):\n" +
        "  postgresql://postgres.<ref>:<clave>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres\n" +
        "Ver .env.supabase.ejemplo.",
    );
  }
  const cuil = env.ADMIN_INICIAL_CUIL?.trim() ?? "";
  if (!cuil) {
    throw new ErrorPreparacion(
      `Falta ADMIN_INICIAL_CUIL en ${nombre}: el CUIL (11 dígitos, sin guiones) de la persona que va a ser el primer administrador.`,
    );
  }
  if (!cuilValido(cuil)) {
    throw new ErrorPreparacion(
      `ADMIN_INICIAL_CUIL no es un CUIL válido (11 dígitos sin guiones, prefijo 20/23/24/27/30/33/34 y dígito verificador correcto). Revisalo en ${nombre}.`,
    );
  }
  const info = analizarUrlAdmin(adminUrl);
  if (info.pooler && info.puerto === PUERTO_TRANSACCION) {
    throw new ErrorPreparacion(
      "SUPABASE_ADMIN_URL es la del Transaction pooler (6543). Tiene que ser la del Session pooler (puerto 5432 del mismo host): " +
        "crear roles y migrar necesita una sesión entera.",
    );
  }
  if (info.pooler && !info.ref) {
    throw new ErrorPreparacion("Por el pooler de Supabase el usuario es postgres.<ref del proyecto>: falta el .<ref> en SUPABASE_ADMIN_URL.");
  }
  // Sin CA solo el simulador local sin TLS; cualquier otra base, con CA o nada.
  const ca = info.local && !env.DATABASE_CA_FILE ? null : cargarCa(env);
  if (!["sesion", "transaccion"].includes(appPooler)) throw new ErrorPreparacion("--app-pooler es sesion o transaccion.");
  const puertoApp = info.pooler && appPooler === "transaccion" ? PUERTO_TRANSACCION : info.puerto;

  const claves = {
    app: rotarClaves ? null : claveDeUrl(env.DATABASE_URL, { rol: ROLES.app, ref: info.ref, host: info.host }),
    deploy: rotarClaves ? null : claveDeUrl(env.MIGRATE_DATABASE_URL, { rol: ROLES.deploy, ref: info.ref, host: info.host }),
  };
  const nuevas = { app: !claves.app, deploy: !claves.deploy };
  claves.app ??= claveAleatoria();
  claves.deploy ??= claveAleatoria();

  const urls = {
    admin: adminUrl,
    app: armarUrl({ rol: ROLES.app, ref: info.ref, host: info.host, puerto: puertoApp, clave: claves.app }),
    deploy: armarUrl({ rol: ROLES.deploy, ref: info.ref, host: info.host, puerto: info.puerto, clave: claves.deploy }),
  };
  const secretos = [claves.app, claves.deploy, decodeURIComponent(new URL(adminUrl).password)];
  secretosConocidos.push(...secretos);
  // Dónde deja la semilla la contraseña temporal del admin inicial: la misma
  // que usa el paquete SQL para el proyecto real; al lado del .env para otro
  // archivo de entorno (el simulador, que se borra entero).
  const archivoClaveAdmin = env.ADMIN_INICIAL_CLAVE_ARCHIVO?.trim()
    ? path.resolve(RAIZ, env.ADMIN_INICIAL_CLAVE_ARCHIVO.trim())
    : path.resolve(archivoEnv) === path.resolve(ENV_SUPABASE)
      ? ARCHIVO_CLAVE_ADMIN
      : path.join(path.dirname(path.resolve(archivoEnv)), "clave-admin-inicial.txt");
  return { env, nombre, archivoEnv, info, ca, cuil, claves, nuevas, urls, secretos, appPooler, puertoApp, archivoClaveAdmin };
}

/** El entorno de la app para los procesos hijos (semilla, verificaciones). */
function entornoApp(cfg, extra = {}) {
  return entornoHijo({ DATABASE_URL: cfg.urls.app, DATABASE_CA_FILE: cfg.ca?.archivo ?? "", ...extra });
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

async function conectarAdmin(cfg) {
  paso("a. Conexión de administración");
  if (cfg.ca) bien(`Certificado raíz: ${cfg.ca.relativa} — ${cfg.ca.resumen}`);
  else aviso("Sin TLS: solo se acepta porque es una base local (el simulador).");
  const admin = await conectarConReintentos(cfg.urls.admin, { ca: cfg.ca, aplicacion: "cementeria-preparar" }, { intentos: 2 });
  const { rows } = await admin.query(`
    SELECT current_user AS usuario, current_database() AS base,
           current_setting('server_version') AS version, current_setting('server_version_num')::int AS version_num,
           r.rolsuper, r.rolcreaterole,
           (SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles WHERE rolname = ANY ($1)) AS roles_api,
           (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl
      FROM pg_roles r WHERE r.rolname = current_user`, [ROLES_API]);
  const i = rows[0];
  if (i.usuario !== "postgres") throw new ErrorPreparacion(`Se conectó como ${i.usuario}: tiene que ser el rol postgres de Supabase.`);
  if (i.rolsuper) {
    throw new ErrorPreparacion("El rol postgres es superusuario: esto no es Supabase (allí no lo es). No se sigue, para no preparar otra base por error.");
  }
  if (!i.rolcreaterole) throw new ErrorPreparacion("El rol postgres no tiene CREATEROLE: no puede crear los roles de CementerIA.");
  if ((i.roles_api ?? []).length !== ROLES_API.length) {
    throw new ErrorPreparacion(`Faltan roles de Supabase (${ROLES_API.join(", ")}): ¿es un proyecto de Supabase?`);
  }
  if (i.version_num < 150000) throw new ErrorPreparacion(`PostgreSQL ${i.version}: CementerIA necesita 15 o más.`);
  if (!cfg.info.local && !i.ssl) throw new ErrorPreparacion("La conexión no está cifrada: no se sigue.");
  bien(`postgres en ${cfg.info.host}:${cfg.info.puerto}${cfg.info.ref ? ` (proyecto ${cfg.info.ref})` : ""}, PostgreSQL ${i.version}, TLS ${i.ssl ? "sí" : "no"}`);
  return admin;
}

async function crearRoles(cfg, admin) {
  paso("b. Roles");
  const existentes = new Set(
    (await admin.query("SELECT rolname FROM pg_roles WHERE rolname = ANY ($1)", [Object.values(ROLES)])).rows.map((f) => f.rolname),
  );
  await admin.query(leerFuente("roles.sql"));
  const cambiadas = [];
  for (const clave of ["app", "deploy"]) {
    const rol = ROLES[clave];
    if (!existentes.has(rol) || cfg.nuevas[clave]) {
      // El verificador SCRAM, nunca la clave: no llega en texto plano ni al log de la base.
      await admin.query(sqlClave(rol, cfg.claves[clave]));
      cambiadas.push(rol);
    }
  }
  const valores = { DATABASE_URL: cfg.urls.app, MIGRATE_DATABASE_URL: cfg.urls.deploy };
  if (cfg.ca && !cfg.env.DATABASE_CA_FILE) valores.DATABASE_CA_FILE = cfg.ca.relativa;
  escribirBloqueEnv(cfg.archivoEnv, valores);
  bien(`${[...Object.values(ROLES)].filter((r) => !existentes.has(r)).join(", ") || "ninguno"} creado(s); atributos reafirmados`);
  bien(cambiadas.length ? `clave nueva para ${cambiadas.join(" y ")} (verificador SCRAM)` : "claves sin cambios (las de " + cfg.nombre + ")");
  bien(
    `URLs guardadas en ${cfg.nombre}: DATABASE_URL (${!cfg.info.pooler ? "conexión directa" : cfg.puertoApp === PUERTO_TRANSACCION ? "Transaction pooler" : "Session pooler"}, puerto ${cfg.puertoApp}) y MIGRATE_DATABASE_URL (puerto ${cfg.info.puerto})`,
  );
  return cambiadas.length > 0;
}

async function prepararExtensiones(admin) {
  paso("c. Base y extensiones");
  const avisos = [];
  admin.on("notice", (n) => avisos.push(n.message));
  await admin.query(leerFuente("extensiones.sql"));
  admin.removeAllListeners("notice");
  for (const a of avisos.filter((m) => /se mueve a public/.test(m))) aviso(a);
  const { rows } = await admin.query(
    "SELECT string_agg(x.extname || ' ' || x.extversion || ' en ' || n.nspname, ', ' ORDER BY x.extname) AS e FROM pg_extension x JOIN pg_namespace n ON n.oid = x.extnamespace WHERE x.extname IN ('unaccent', 'pg_trgm')",
  );
  bien(`base postgres (en Supabase no se crean bases); ${rows[0].e}`);
  bien("zona horaria por rol: cementeria_app en UTC, cementeria_deploy en America/Argentina/Tucuman");
}

async function migrar(cfg, clavesCambiadas) {
  paso("d. Migraciones (prisma migrate deploy con cementeria_deploy)");
  // Antes de Prisma, una conexión propia: que el pooler ya conozca al rol y que
  // entre como owner. Con reintentos si las claves acaban de cambiar.
  const deploy = await conectarConReintentos(cfg.urls.deploy, { ca: cfg.ca, aplicacion: "cementeria-preparar" }, { intentos: clavesCambiadas ? 10 : 2 });
  try {
    const { rows } = await deploy.query("SELECT current_user AS u, session_user AS s, current_setting('TimeZone') AS tz");
    if (rows[0].u !== ROLES.owner) throw new ErrorPreparacion(`cementeria_deploy entró como ${rows[0].u} y no como cementeria_owner.`);
    bien(`cementeria_deploy entra como ${rows[0].u} (zona ${rows[0].tz})`);
  } finally {
    await deploy.end();
  }
  const r = await correrNode([CLI_PRISMA, "migrate", "deploy"], {
    env: entornoHijo({ MIGRATE_DATABASE_URL: cfg.urls.deploy, DATABASE_CA_FILE: cfg.ca?.archivo ?? "" }),
    secretos: cfg.secretos,
    mostrar: mostrarHijos,
  });
  if (r.codigo !== 0) throw new ErrorPreparacion(`prisma migrate deploy falló (ver arriba).${cola(r)}`);
  bien("migraciones al día");
}

async function cerrarApi(cfg, admin) {
  paso("e. Cierre de la API pública de Supabase");
  const deploy = await conectarConReintentos(cfg.urls.deploy, { ca: cfg.ca, aplicacion: "cementeria-preparar" }, { intentos: 2 });
  try {
    await deploy.query(leerFuente("cierre-api-dueno.sql"));
  } finally {
    await deploy.end();
  }
  await admin.query(leerFuente("cierre-api-postgres.sql"));
  bien("anon, authenticated y service_role: sin privilegios sobre tablas, secuencias y funciones de public y auditoria, ni por defecto");
  aviso("Falta lo del panel: apagar la Data API (Settings → API → Data API). Ver docs/despliegue.md.");
  await admin.query(leerFuente("storage.sql"));
  bien("bucket de Storage adjuntos: privado, 10 MB, PDF/JPEG/PNG, sin políticas (lo usa el despliegue en Vercel)");
}

async function sembrar(cfg, clavesCambiadas) {
  paso("f. Semilla de producción (--sin-ficticios) y administrador inicial");
  if (clavesCambiadas) {
    // Que el pooler ya acepte la clave nueva de la app antes de Prisma.
    const app = await conectarConReintentos(cfg.urls.app, { ca: cfg.ca, aplicacion: "cementeria-preparar" }, { intentos: 10 });
    await app.end();
  }
  const r = await correrNode([CLI_TSX, "prisma/seed.ts", "--sin-ficticios"], {
    env: entornoApp(cfg, { ADMIN_INICIAL_CUIL: cfg.cuil, NODE_ENV: "production", ADMIN_INICIAL_CLAVE_ARCHIVO: cfg.archivoClaveAdmin }),
    secretos: [...cfg.secretos, cfg.cuil],
    mostrar: mostrarHijos,
  });
  if (r.codigo !== 0) throw new ErrorPreparacion(`La semilla falló (ver arriba).${cola(r)}`);
  bien("catálogos, cementerios, plantillas, feriados y el admin inicial (CUIL de ADMIN_INICIAL_CUIL)");
  if (/Contraseña TEMPORAL del administrador inicial/.test(r.salida)) {
    aviso(`La contraseña temporal del admin inicial quedó en ${path.relative(RAIZ, cfg.archivoClaveAdmin) || cfg.archivoClaveAdmin} (no se versiona): entregala en mano y borrá el archivo después del primer ingreso.`);
  } else {
    bien("el admin inicial ya tenía contraseña: no se cambió");
  }
}

/**
 * La verificación final, como cementeria_app. Devuelve las filas de
 * verificar.sql y los resultados de las pruebas.
 */
export async function verificar(cfg, { mostrar = true } = {}) {
  if (mostrar) paso("g. Verificación (como cementeria_app)");
  const fallas = [];
  const app = await conectarConReintentos(cfg.urls.app, { ca: cfg.ca, aplicacion: "cementeria-verificar" }, { intentos: 3 });
  let controles;
  try {
    controles = (await app.query(leerFuente("verificar.sql"))).rows;
    // Intentos reales, en una transacción que se deshace: la app no puede
    // cambiar ni borrar el historial.
    for (const [nombre, sql] of [
      ["UPDATE de movimientos", "UPDATE public.movimientos SET motivo = motivo WHERE false"],
      ["DELETE de movimientos", "DELETE FROM public.movimientos WHERE false"],
      ["TRUNCATE de movimientos", "TRUNCATE public.movimientos"],
    ]) {
      await app.query("BEGIN");
      try {
        await app.query(sql);
        fallas.push(`la app pudo hacer ${nombre}`);
      } catch (e) {
        if (e.code !== "42501") fallas.push(`${nombre}: error inesperado ${e.code}`);
      } finally {
        await app.query("ROLLBACK");
      }
    }
    controles.push({ control: "la app no puede UPDATE/DELETE/TRUNCATE movimientos (intento real)", ok: !fallas.length, detalle: "permission denied (42501), y se deshizo" });
  } finally {
    await app.end();
  }

  // anon y authenticated: intento real de leer cada tabla, si postgres puede
  // tomar esos roles (en Supabase es miembro de ellos).
  const admin = await conectarConReintentos(cfg.urls.admin, { ca: cfg.ca, aplicacion: "cementeria-verificar" }, { intentos: 2 });
  try {
    const tablas = (
      await admin.query(`SELECT format('%I.%I', n.nspname, c.relname) AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('public', 'auditoria') ORDER BY 1`)
    ).rows.map((f) => f.t);
    for (const rol of ["anon", "authenticated"]) {
      const miembro = (await admin.query("SELECT pg_has_role('postgres', $1, 'MEMBER') AS m", [rol])).rows[0].m;
      if (!miembro) {
        controles.push({ control: `${rol} no lee ninguna tabla (intento real)`, ok: null, detalle: "postgres no puede tomar ese rol: vale el control de privilegios" });
        continue;
      }
      const leidas = [];
      await admin.query("BEGIN");
      try {
        await admin.query(`SET LOCAL ROLE ${rol}`);
        for (const t of tablas) {
          await admin.query("SAVEPOINT intento");
          try {
            await admin.query(`SELECT 1 FROM ${t} LIMIT 1`);
            leidas.push(t);
          } catch (e) {
            if (e.code !== "42501") leidas.push(`${t} (${e.code})`);
          }
          await admin.query("ROLLBACK TO SAVEPOINT intento");
        }
      } finally {
        await admin.query("ROLLBACK");
      }
      controles.push({
        control: `${rol} no lee ninguna tabla (intento real)`,
        ok: leidas.length === 0,
        detalle: leidas.length ? `pudo leer: ${leidas.join(", ")}` : `permission denied en las ${tablas.length} tablas`,
      });
    }
  } finally {
    await admin.end();
  }

  // El bucket de adjuntos (Storage), como postgres: cementeria_app no ve el esquema storage.
  {
    const admin3 = await conectarConReintentos(cfg.urls.admin, { ca: cfg.ca, aplicacion: "cementeria-verificar" }, { intentos: 2 });
    try {
      const hay = (await admin3.query("SELECT to_regclass('storage.buckets') IS NOT NULL AS hay")).rows[0].hay;
      if (!hay) {
        controles.push({ control: "Storage: bucket adjuntos (como postgres)", ok: false, detalle: "no está storage.buckets" });
      } else {
        const b = (
          await admin3.query(
            `SELECT public, file_size_limit::text AS limite, (SELECT array_agg(x ORDER BY x) FROM unnest(allowed_mime_types) x) AS tipos
               FROM storage.buckets WHERE id = 'adjuntos'`,
          )
        ).rows[0];
        const tipos = (b?.tipos ?? []).join(" ");
        controles.push({
          control: "Storage: bucket adjuntos (como postgres)",
          ok: Boolean(b) && b.public === false && b.limite === "10485760" && tipos === "application/pdf image/jpeg image/png",
          detalle: b ? `privado: ${!b.public}, límite ${b.limite} bytes, tipos: ${tipos}` : "no existe el bucket adjuntos",
        });
      }
    } finally {
      await admin3.end();
    }
  }

  // Alta de prueba que se deshace (cadena de hash) y la verificación nocturna.
  const alta = await correrNode([CLI_TSX, "scripts/supabase/probar-alta.ts"], { env: entornoApp(cfg), secretos: cfg.secretos, mostrar: false });
  let detalleAlta;
  try {
    detalleAlta = JSON.parse(alta.salida.trim().split("\n").at(-1) ?? "{}");
  } catch {
    detalleAlta = { ok: false, error: alta.salida.trim().slice(-300) };
  }
  controles.push({
    control: "alta de prueba con cadena de hash (se deshace)",
    ok: alta.codigo === 0 && detalleAlta.ok === true,
    detalle: detalleAlta.alta
      ? `${detalleAlta.alta.numero}: ${detalleAlta.alta.movimientos} movimiento(s), cadena ${detalleAlta.alta.integra ? "íntegra" : "ROTA"}; sesión en ${detalleAlta.zona_de_la_sesion}; ${detalleAlta.sin_rastros ? "no quedó nada" : "QUEDARON DATOS"}`
      : (detalleAlta.error ?? "sin resultado"),
  });
  const historial = await correrNode([CLI_TSX, "scripts/verificar-historial.ts"], { env: entornoApp(cfg), secretos: cfg.secretos, mostrar: false });
  controles.push({
    control: "npm run historial:verificar",
    ok: historial.codigo === 0,
    detalle: historial.salida.trim().split("\n").at(-1)?.slice(0, 200) ?? "",
  });

  if (mostrar) {
    for (const c of controles) {
      const marca = c.ok === true ? "✓" : c.ok === false ? "✗" : "·";
      console.log(`  ${marca} ${c.control}: ${c.detalle}`);
    }
  }
  return controles;
}

/**
 * Todo el proceso. `hasta` corta después de un paso (lo usa el generador de
 * supabase/sql/, que no necesita la verificación).
 * @param {{ archivoEnv?: string, rotarClaves?: boolean, appPooler?: "sesion" | "transaccion", hasta?: "semilla", silencioso?: boolean }} o
 */
export async function preparar(o = {}) {
  if (!o.silencioso) return prepararTodo(o);
  const log = console.log;
  mostrarHijos = false;
  console.log = () => undefined;
  try {
    return await prepararTodo(o);
  } finally {
    console.log = log;
    mostrarHijos = true;
  }
}

async function prepararTodo(o) {
  const cfg = configuracion({ archivoEnv: o.archivoEnv ?? ENV_SUPABASE, rotarClaves: o.rotarClaves, appPooler: o.appPooler });
  const admin = await conectarAdmin(cfg);
  let clavesCambiadas;
  try {
    clavesCambiadas = await crearRoles(cfg, admin);
    await prepararExtensiones(admin);
  } finally {
    await admin.end();
  }
  await migrar(cfg, clavesCambiadas);
  const admin2 = await conectarConReintentos(cfg.urls.admin, { ca: cfg.ca, aplicacion: "cementeria-preparar" }, { intentos: 2 });
  try {
    await cerrarApi(cfg, admin2);
  } finally {
    await admin2.end();
  }
  await sembrar(cfg, clavesCambiadas);
  if (o.hasta === "semilla") return { cfg, controles: [] };
  const controles = await verificar(cfg);
  return { cfg, controles };
}

function resumen(cfg, controles) {
  const mal = controles.filter((c) => c.ok === false);
  console.log("\n─────────────────────────────────────────────────────────────");
  if (mal.length) {
    console.log(`VERIFICACIÓN CON ${mal.length} PROBLEMA(S): ${mal.map((c) => c.control).join("; ")}`);
  } else {
    console.log("Base de Supabase lista y verificada.");
  }
  console.log(`  Proyecto: ${cfg.info.ref ?? "(local)"} en ${cfg.info.host}`);
  console.log(`  Conexiones en ${cfg.nombre}: DATABASE_URL (app, puerto ${cfg.puertoApp}) y MIGRATE_DATABASE_URL (deploy, puerto ${cfg.info.puerto})`);
  if (cfg.ca) console.log(`  TLS verificado con ${cfg.ca.relativa} (DATABASE_CA_FILE)`);
  console.log("  Pendiente en el panel: apagar la Data API (Settings → API). Ver docs/despliegue.md, \"Base en Supabase\".");
  return mal.length === 0;
}

// ---------------------------------------------------------------------------
// Línea de comandos
// ---------------------------------------------------------------------------

function argumentos(argv) {
  const o = { archivoEnv: ENV_SUPABASE, rotarClaves: false, appPooler: "sesion", soloVerificar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env") o.archivoEnv = path.resolve(argv[++i] ?? "");
    else if (a === "--rotar-claves") o.rotarClaves = true;
    else if (a === "--app-pooler") o.appPooler = argv[++i];
    else if (a === "--solo-verificar") o.soloVerificar = true;
    else throw new ErrorPreparacion(`Opción desconocida: ${a}`);
  }
  return o;
}

async function main() {
  const o = argumentos(process.argv.slice(2));
  if (o.soloVerificar) {
    const cfg = configuracion({ archivoEnv: o.archivoEnv, appPooler: o.appPooler });
    if (cfg.nuevas.app || cfg.nuevas.deploy) {
      throw new ErrorPreparacion(`No hay DATABASE_URL y MIGRATE_DATABASE_URL en ${cfg.nombre}: corré primero npm run supabase:preparar (o supabase:sql).`);
    }
    const controles = await verificar(cfg);
    return resumen(cfg, controles) ? 0 : 1;
  }
  const { cfg, controles } = await preparar(o);
  return resumen(cfg, controles) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      const mensaje = redactar(e instanceof Error ? e.message : String(e), secretosConocidos);
      console.error(e instanceof ErrorPreparacion ? `\n✗ ${mensaje}` : `\n✗ Error inesperado: ${mensaje}`);
      process.exit(1);
    });
}
