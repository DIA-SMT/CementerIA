#!/usr/bin/env node
// Verificación de una restauración de prueba (docs/propuesta-mvp.md, sección
// 6, "Backups"; docs/pedidos-dia-1.md, A7; docs/despliegue.md, "Prueba
// mensual de restauración").
//
//   node scripts/verificar-restauracion.mjs [verificar] --dump <archivo> --adjuntos <carpeta> [opciones]
//   node scripts/verificar-restauracion.mjs registrar --resultado <json> --cuil <cuil> [--env-file <archivo>]
//
// (`npm run db:verificar-restauracion -- …` en el repositorio.)
//
// `verificar` se conecta a la base RESTAURADA (la instancia efímera
// cementeria-restore, nunca producción) con las variables de libpq (PGHOST,
// PGPORT, PGUSER, PGPASSWORD, PGDATABASE) o con --url, y controla:
//   roles        los tres roles de scripts/roles.sql, con sus atributos
//   base         dueño cementeria_owner, zona horaria y extensiones
//   duenos       todas las tablas, secuencias, vistas y funciones de public y
//                auditoria son de cementeria_owner
//   triggers     los triggers de las migraciones existen y están ENABLE ALWAYS
//                (y ningún otro trigger quedó deshabilitado)
//   migraciones  _prisma_migrations sin migraciones fallidas y con las mismas
//                que trae el paquete
//   conteos      filas por tabla en la base = filas en el dump (lee los COPY de
//                `pg_restore --data-only`); si no se pasa --dump, solo informa
//   historial    la secuencia de movimientos de cada expediente es 1..N, sin huecos
//   cadena       la cadena de hash de cada expediente está íntegra (f_verificar_cadena,
//                migración *_cadena_hash; aviso si el dump es de antes)
//   adjuntos     una muestra al azar de adjuntos (no purgados) existe en la
//                carpeta restaurada con el tamaño y el sha256 del historial
//
// Sale con 0 si todo dio bien y con 1 si algo falló. Con --salida deja un JSON
// sin datos personales (conteos, controles, cantidades), que `registrar`
// asienta después en auditoria.accesos de PRODUCCIÓN (accion 'exportar',
// detalle.tipo 'restauracion'), como pide la sección 6: la instancia
// restaurada se destruye y el registro tiene que quedar en la base real.
//
// Opciones de `verificar`:
//   --url <url>          conexión (si no, las variables PG* de libpq)
//   --dump <archivo>     el dump restaurado (pg_dump -Fc), para los conteos
//   --pg-restore <ruta>  el pg_restore a usar (por defecto, el del PATH)
//   --adjuntos <dir>     la carpeta de adjuntos restaurada
//   --muestra <N>        adjuntos a verificar (por defecto 50)
//   --migraciones <dir>  migraciones de referencia (por defecto ../prisma/migrations)
//   --snapshot <id>      el snapshot de restic, para el registro
//   --salida <archivo>   el resultado en JSON

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESQUEMAS = ["public", "auditoria"];
const RE_RUTA = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;
const RE_SHA = /^[0-9a-f]{64}$/;

function uso(mensaje) {
  if (mensaje) console.error(`verificar-restauracion: ${mensaje}\n`);
  console.error(
    "Uso:\n" +
      "  node scripts/verificar-restauracion.mjs [verificar] --dump <archivo> --adjuntos <dir> [--url <url>] [--muestra N]\n" +
      "      [--pg-restore <ruta>] [--migraciones <dir>] [--snapshot <id>] [--salida <json>]\n" +
      "  node scripts/verificar-restauracion.mjs registrar --resultado <json> --cuil <cuil> [--env-file <archivo>]",
  );
  process.exit(2);
}

function leerArgumentos(argv) {
  const comando = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "verificar";
  if (!["verificar", "registrar"].includes(comando)) uso(`comando desconocido: ${comando}`);
  const o = { comando, muestra: 50 };
  const conValor = {
    "--url": "url",
    "--dump": "dump",
    "--pg-restore": "pgRestore",
    "--adjuntos": "adjuntos",
    "--muestra": "muestra",
    "--migraciones": "migraciones",
    "--snapshot": "snapshot",
    "--salida": "salida",
    "--resultado": "resultado",
    "--cuil": "cuil",
    "--env-file": "envFile",
  };
  for (let i = 0; i < argv.length; i++) {
    const clave = conValor[argv[i]];
    if (!clave) uso(`opción desconocida: ${argv[i]}`);
    const v = argv[++i];
    if (v === undefined) uso(`${argv[i - 1]} necesita un valor`);
    o[clave] = v;
  }
  o.muestra = Number(o.muestra);
  if (!Number.isInteger(o.muestra) || o.muestra < 1) uso("--muestra tiene que ser un entero de 1 o más");
  return o;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** @typedef {{ control: string, estado: "ok" | "aviso" | "falla", detalle: string }} Item */

class Resultado {
  /** @type {Item[]} */
  items = [];
  /** @type {Record<string, number>} */
  conteos = {};
  adjuntos = { verificados: 0, total: 0 };

  agregar(control, estado, detalle) {
    this.items.push({ control, estado, detalle });
    const marca = { ok: "OK   ", aviso: "AVISO", falla: "FALLA" }[estado];
    console.log(`${marca} ${control}: ${detalle}`);
  }

  ok(control, detalle) {
    this.agregar(control, "ok", detalle);
  }
  aviso(control, detalle) {
    this.agregar(control, "aviso", detalle);
  }
  falla(control, detalle) {
    this.agregar(control, "falla", detalle);
  }

  get fallo() {
    return this.items.some((i) => i.estado === "falla");
  }
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

async function controlarRoles(db, r) {
  const { rows } = await db.query(
    `SELECT rolname, rolsuper, rolinherit, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname IN ('cementeria_owner', 'cementeria_deploy', 'cementeria_app')`,
  );
  const por = Object.fromEntries(rows.map((f) => [f.rolname, f]));
  const problemas = [];
  for (const nombre of ["cementeria_owner", "cementeria_deploy", "cementeria_app"]) {
    const f = por[nombre];
    if (!f) {
      problemas.push(`falta ${nombre} (¿se corrió scripts/roles.sql antes de restaurar?)`);
      continue;
    }
    if (f.rolsuper || f.rolcreaterole || f.rolcreatedb || f.rolreplication || f.rolbypassrls) {
      problemas.push(`${nombre} tiene atributos de más (SUPERUSER, CREATEROLE, CREATEDB, REPLICATION o BYPASSRLS)`);
    }
  }
  if (por.cementeria_owner?.rolcanlogin) problemas.push("cementeria_owner tiene LOGIN");
  if (por.cementeria_deploy && (por.cementeria_deploy.rolinherit || !por.cementeria_deploy.rolcanlogin)) {
    problemas.push("cementeria_deploy tiene que ser LOGIN NOINHERIT");
  }
  if (por.cementeria_deploy && por.cementeria_owner) {
    const m = await db.query(
      "SELECT pg_has_role('cementeria_deploy', 'cementeria_owner', 'MEMBER') AS miembro",
    );
    if (!m.rows[0].miembro) problemas.push("cementeria_deploy no es miembro de cementeria_owner");
  }
  if (problemas.length) r.falla("roles", problemas.join("; "));
  else r.ok("roles", "cementeria_owner, cementeria_deploy y cementeria_app con sus atributos");
}

async function controlarBase(db, r) {
  const { rows } = await db.query(
    `SELECT current_database() AS base,
            pg_get_userbyid(d.datdba) AS dueno,
            current_setting('server_version_num')::int AS version,
            (SELECT array_agg(extname ORDER BY extname) FROM pg_extension) AS extensiones,
            (SELECT string_agg(c, ',') FROM pg_db_role_setting s, unnest(s.setconfig) c
              WHERE s.setdatabase = d.oid AND s.setrole = 0 AND lower(c) LIKE 'timezone=%') AS zona
       FROM pg_database d WHERE d.datname = current_database()`,
  );
  const f = rows[0];
  const problemas = [];
  if (f.dueno !== "cementeria_owner") problemas.push(`la base es de ${f.dueno}, no de cementeria_owner`);
  for (const ext of ["unaccent", "pg_trgm"]) {
    if (!(f.extensiones ?? []).includes(ext)) problemas.push(`falta la extensión ${ext}`);
  }
  // PostgreSQL guarda el nombre como TimeZone.
  if (f.zona?.toLowerCase() !== "timezone=america/argentina/tucuman") {
    problemas.push("falta ALTER DATABASE … SET timezone = 'America/Argentina/Tucuman'");
  }
  if (f.version < 150000) problemas.push(`PostgreSQL ${f.version}: se espera 15 o más`);
  if (problemas.length) r.falla("base", problemas.join("; "));
  else r.ok("base", `${f.base}: dueño cementeria_owner, zona de Tucumán, unaccent y pg_trgm, PostgreSQL ${f.version}`);
}

async function controlarDuenos(db, r) {
  // Los objetos que pertenecen a una extensión (funciones de unaccent y
  // pg_trgm) no cuentan: su dueño es el de la extensión.
  const { rows } = await db.query(
    `WITH objetos AS (
       SELECT 'relación' AS tipo, n.nspname || '.' || c.relname AS nombre, pg_get_userbyid(c.relowner) AS dueno, c.oid,
              'pg_class'::regclass AS catalogo
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
       UNION ALL
       SELECT 'función', n.nspname || '.' || p.proname, pg_get_userbyid(p.proowner), p.oid, 'pg_proc'::regclass
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($1)
       UNION ALL
       SELECT 'esquema', n.nspname, pg_get_userbyid(n.nspowner), n.oid, 'pg_namespace'::regclass
         FROM pg_namespace n WHERE n.nspname = 'auditoria'
     )
     SELECT tipo, nombre, dueno FROM objetos o
      WHERE dueno <> 'cementeria_owner'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = o.catalogo AND d.objid = o.oid AND d.deptype = 'e')
      ORDER BY tipo, nombre`,
    [ESQUEMAS],
  );
  const tablas = await db.query(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = ANY($1)`,
    [ESQUEMAS],
  );
  if (tablas.rows[0].n === 0) {
    r.falla("duenos", "no hay tablas en public ni en auditoria: ¿se restauró el dump?");
  } else if (rows.length > 0) {
    const lista = rows.slice(0, 10).map((f) => `${f.tipo} ${f.nombre} (${f.dueno})`).join(", ");
    r.falla("duenos", `${rows.length} objeto(s) que no son de cementeria_owner: ${lista}${rows.length > 10 ? ", …" : ""}`);
  } else {
    r.ok("duenos", `las ${tablas.rows[0].n} tablas y el resto de los objetos de public y auditoria son de cementeria_owner`);
  }
}

/**
 * Los triggers que las migraciones declaran ENABLE ALWAYS, leídos de los
 * migration.sql: así la lista no se desactualiza cuando una migración nueva
 * agrega uno. Un DROP TRIGGER posterior lo saca.
 * @returns {Map<string, string>} "tabla.trigger" → tabla
 */
export function triggersDeLasMigraciones(dirMigraciones) {
  const esperados = new Map();
  const quitarComillas = (s) => s.replaceAll('"', "");
  const normalizarTabla = (t) => {
    const limpia = quitarComillas(t);
    return limpia.includes(".") ? limpia : `public.${limpia}`;
  };
  const dirs = readdirSync(dirMigraciones, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    const archivo = path.join(dirMigraciones, dir, "migration.sql");
    if (!existsSync(archivo)) continue;
    // Sin comentarios de línea, para no leer un ejemplo comentado.
    const sql = readFileSync(archivo, "utf8").replace(/--[^\n]*/g, "");
    const re =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?([\w."]+)\s+ENABLE\s+ALWAYS\s+TRIGGER\s+([\w"]+)|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([\w"]+)\s+ON\s+([\w."]+)/gi;
    for (const m of sql.matchAll(re)) {
      if (m[1]) {
        const tabla = normalizarTabla(m[1]);
        esperados.set(`${tabla}.${quitarComillas(m[2])}`, tabla);
      } else {
        esperados.delete(`${normalizarTabla(m[4])}.${quitarComillas(m[3])}`);
      }
    }
  }
  return esperados;
}

async function controlarTriggers(db, r, dirMigraciones) {
  const { rows } = await db.query(
    `SELECT n.nspname || '.' || c.relname AS tabla, t.tgname AS nombre, t.tgenabled AS estado
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = ANY($1)`,
    [ESQUEMAS],
  );
  const enBase = new Map(rows.map((f) => [`${f.tabla}.${f.nombre}`, f.estado]));
  const problemas = [];
  let esperados = new Map();
  if (!existsSync(dirMigraciones)) {
    problemas.push(`no está la carpeta de migraciones ${dirMigraciones} para saber qué triggers esperar`);
  } else {
    esperados = triggersDeLasMigraciones(dirMigraciones);
    if (esperados.size === 0) problemas.push("las migraciones no declaran ningún trigger ENABLE ALWAYS: ¿carpeta equivocada?");
    for (const clave of esperados.keys()) {
      const estado = enBase.get(clave);
      if (estado === undefined) problemas.push(`falta ${clave}`);
      else if (estado === "D") problemas.push(`${clave} está DESHABILITADO`);
      else if (estado !== "A") problemas.push(`${clave} está '${estado}' y no ENABLE ALWAYS ('A')`);
    }
  }
  // 'D' es deshabilitado; cualquier otro trigger que exista tiene que dispararse.
  for (const [clave, estado] of enBase) {
    if (estado === "D" && !esperados.has(clave)) problemas.push(`${clave} está DESHABILITADO`);
  }
  if (problemas.length) r.falla("triggers", problemas.join("; "));
  else r.ok("triggers", `${esperados.size} triggers de las migraciones, todos ENABLE ALWAYS`);
}

async function controlarMigraciones(db, r, dirMigraciones) {
  const existe = await db.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS hay");
  if (!existe.rows[0].hay) {
    r.falla("migraciones", "no está public._prisma_migrations");
    return;
  }
  const { rows } = await db.query(
    "SELECT migration_name, finished_at IS NOT NULL AS terminada, rolled_back_at IS NOT NULL AS revertida FROM public._prisma_migrations",
  );
  const malas = rows.filter((f) => !f.terminada || f.revertida).map((f) => f.migration_name);
  if (malas.length) {
    r.falla("migraciones", `migraciones fallidas o revertidas: ${malas.join(", ")}`);
    return;
  }
  const enBase = new Set(rows.map((f) => f.migration_name));
  if (!existsSync(dirMigraciones)) {
    r.aviso("migraciones", `${enBase.size} aplicadas; sin carpeta de referencia para comparar`);
    return;
  }
  const delPaquete = readdirSync(dirMigraciones, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const faltan = delPaquete.filter((m) => !enBase.has(m));
  const sobran = [...enBase].filter((m) => !delPaquete.includes(m));
  if (faltan.length || sobran.length) {
    // El backup puede ser de antes de un despliegue con migraciones nuevas: no
    // es una falla de la restauración, pero hay que saberlo.
    r.aviso(
      "migraciones",
      `la base y el paquete no coinciden${faltan.length ? `; faltan en la base: ${faltan.join(", ")}` : ""}${sobran.length ? `; no están en el paquete: ${sobran.join(", ")}` : ""}`,
    );
  } else {
    r.ok("migraciones", `las ${enBase.size} migraciones del paquete, todas terminadas`);
  }
}

/**
 * Filas por tabla en un SQL plano con bloques COPY … FROM stdin (lo que
 * escriben `pg_restore --data-only -f -` y `pg_dump -Fp`). En el formato de
 * texto de COPY cada fila es una línea: los saltos de línea de los datos van
 * escapados como \n.
 * @param {AsyncIterable<string>} lineas
 * @returns {Promise<Record<string, number>>}
 */
export async function contarFilasDeCopy(lineas) {
  const conteos = {};
  let tabla = null;
  for await (const linea of lineas) {
    if (tabla === null) {
      const m = /^COPY\s+(\S+)\s.*FROM stdin;$/.exec(linea);
      if (m) {
        tabla = m[1].replaceAll('"', "");
        conteos[tabla] = 0;
      }
    } else if (linea === "\\.") {
      tabla = null;
    } else {
      conteos[tabla] += 1;
    }
  }
  if (tabla !== null) throw new Error(`El COPY de ${tabla} no termina: el dump está truncado`);
  return conteos;
}

/**
 * Las diferencias entre las filas de la base restaurada y las del dump, por
 * tabla de public y auditoria. Vacío = coinciden.
 * @param {Record<string, number>} enBase
 * @param {Record<string, number>} delDump
 * @returns {string[]}
 */
export function compararConteos(enBase, delDump) {
  const diferencias = [];
  for (const [tabla, n] of Object.entries(delDump)) {
    if (!ESQUEMAS.includes(tabla.split(".")[0])) continue;
    if (!(tabla in enBase)) diferencias.push(`${tabla}: está en el dump y no en la base`);
    else if (enBase[tabla] !== n) diferencias.push(`${tabla}: ${enBase[tabla]} en la base y ${n} en el dump`);
  }
  for (const tabla of Object.keys(enBase)) {
    // Una tabla vacía igual tiene su COPY en el dump.
    if (!(tabla in delDump)) diferencias.push(`${tabla}: no tiene datos en el dump`);
  }
  return diferencias;
}

function filasDelDump(dump, pgRestore) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(pgRestore, ["--data-only", "--file=-", dump], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let errores = "";
    hijo.stderr.on("data", (d) => (errores += d.toString()));
    hijo.on("error", (e) => reject(new Error(`No se pudo correr ${pgRestore}: ${e.message}`)));
    const conteo = contarFilasDeCopy(createInterface({ input: hijo.stdout, crlfDelay: Infinity }));
    hijo.on("close", async (codigo) => {
      try {
        const c = await conteo;
        if (codigo !== 0) reject(new Error(`${pgRestore} terminó con código ${codigo}: ${errores.trim().split("\n")[0]}`));
        else resolve(c);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function controlarConteos(db, r, opciones) {
  const { rows: tablas } = await db.query(
    `SELECT schemaname || '.' || tablename AS tabla FROM pg_tables WHERE schemaname = ANY($1) ORDER BY 1`,
    [ESQUEMAS],
  );
  for (const { tabla } of tablas) {
    const [esquema, nombre] = tabla.split(".");
    const { rows } = await db.query(`SELECT count(*)::bigint AS n FROM ${pg.escapeIdentifier(esquema)}.${pg.escapeIdentifier(nombre)}`);
    r.conteos[tabla] = Number(rows[0].n);
  }
  const total = Object.values(r.conteos).reduce((a, b) => a + b, 0);
  if (!opciones.dump) {
    r.aviso("conteos", `${total} filas en ${tablas.length} tablas; sin --dump no se compara contra el dump`);
    return;
  }
  let delDump;
  try {
    delDump = await filasDelDump(opciones.dump, opciones.pgRestore ?? "pg_restore");
  } catch (e) {
    r.falla("conteos", e instanceof Error ? e.message : String(e));
    return;
  }
  const diferencias = compararConteos(r.conteos, delDump);
  if (diferencias.length) r.falla("conteos", diferencias.join("; "));
  else r.ok("conteos", `${total} filas en ${tablas.length} tablas, iguales a las del dump`);
}

async function controlarHistorial(db, r) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS expedientes,
            count(*) FILTER (WHERE n <> maximo OR minimo <> 1)::int AS con_huecos
       FROM (SELECT expediente_id, count(*) AS n, max(secuencia) AS maximo, min(secuencia) AS minimo
               FROM public.movimientos GROUP BY expediente_id) s`,
  );
  const f = rows[0];
  if (f.con_huecos > 0) {
    r.falla("historial", `${f.con_huecos} de ${f.expedientes} expedientes tienen huecos o repeticiones en la secuencia de movimientos`);
  } else {
    r.ok("historial", `la secuencia de movimientos de los ${f.expedientes} expedientes es 1..N, sin huecos`);
  }
}

/**
 * La cadena de hash de cada expediente (26/10/2026): un dump que se restauró
 * bien la trae íntegra. Si el dump es de antes de la migración *_cadena_hash
 * (no está f_verificar_cadena), es un aviso, como migraciones.
 */
async function controlarCadena(db, r) {
  const existe = await db.query("SELECT to_regprocedure('public.f_verificar_cadena(bigint)') IS NOT NULL AS hay");
  if (!existe.rows[0].hay) {
    r.aviso("cadena", "la base no tiene f_verificar_cadena: el dump es de antes de la cadena de hash");
    return;
  }
  const { rows } = await db.query(
    `SELECT e.numero_interno AS numero, v.integra, v.secuencia_rota, v.motivo
       FROM public.expedientes e CROSS JOIN LATERAL public.f_verificar_cadena(e.id) v
      ORDER BY e.id`,
  );
  const rotos = rows.filter((f) => !f.integra);
  if (rotos.length > 0) {
    const lista = rotos.slice(0, 10).map((f) => `${f.numero} (movimiento ${f.secuencia_rota}: ${f.motivo})`).join(", ");
    r.falla("cadena", `${rotos.length} de ${rows.length} expedientes con la cadena de hash rota: ${lista}${rotos.length > 10 ? ", …" : ""}`);
  } else {
    r.ok("cadena", `la cadena de hash de los ${rows.length} expedientes está íntegra`);
  }
}

function sha256DeArchivo(ruta) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(ruta)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function controlarAdjuntos(db, r, opciones) {
  // Los purgados (Ley 25.326) ya no tienen archivo: su movimiento `adjunto`
  // sigue, con una corrección que lo retira con purgar = true.
  const filtro = `m.tipo = 'adjunto' AND NOT EXISTS (
      SELECT 1 FROM public.movimientos c
       WHERE c.expediente_id = m.expediente_id AND c.tipo = 'correccion'
         AND c.datos->>'retirar_adjunto' = m.id::text AND c.datos->>'purgar' = 'true')`;
  const total = await db.query(`SELECT count(*)::int AS n FROM public.movimientos m WHERE ${filtro}`);
  r.adjuntos.total = total.rows[0].n;
  if (!opciones.adjuntos) {
    r.falla("adjuntos", "falta --adjuntos con la carpeta de adjuntos restaurada");
    return;
  }
  if (!existsSync(opciones.adjuntos) || !statSync(opciones.adjuntos).isDirectory()) {
    r.falla("adjuntos", `no existe la carpeta ${opciones.adjuntos}`);
    return;
  }
  if (r.adjuntos.total === 0) {
    r.aviso("adjuntos", "la base no tiene adjuntos: no hay muestra que verificar");
    return;
  }
  const { rows } = await db.query(
    `SELECT m.id::text AS id, m.datos->>'ruta' AS ruta, m.datos->>'sha256' AS sha256, (m.datos->>'bytes')::bigint AS bytes
       FROM public.movimientos m WHERE ${filtro} ORDER BY random() LIMIT $1`,
    [opciones.muestra],
  );
  const problemas = [];
  for (const f of rows) {
    // La ruta sale de la base, pero se controla como en src/lib/adjuntos/almacen.ts.
    if (!f.ruta || !RE_RUTA.test(f.ruta) || !f.sha256 || !RE_SHA.test(f.sha256)) {
      problemas.push(`movimiento ${f.id}: ruta o sha256 inválidos en el historial`);
      continue;
    }
    const archivo = path.join(opciones.adjuntos, ...f.ruta.split("/"));
    if (!existsSync(archivo)) {
      problemas.push(`movimiento ${f.id}: falta el archivo ${f.ruta}`);
      continue;
    }
    const bytes = statSync(archivo).size;
    if (f.bytes !== null && Number(f.bytes) !== bytes) {
      problemas.push(`movimiento ${f.id}: ${f.ruta} tiene ${bytes} bytes y el historial dice ${f.bytes}`);
      continue;
    }
    if ((await sha256DeArchivo(archivo)) !== f.sha256) {
      problemas.push(`movimiento ${f.id}: el sha256 de ${f.ruta} no coincide`);
      continue;
    }
    r.adjuntos.verificados += 1;
  }
  if (problemas.length) {
    r.falla("adjuntos", `${problemas.length} de ${rows.length} con problemas: ${problemas.slice(0, 10).join("; ")}`);
  } else {
    r.ok("adjuntos", `${rows.length} de ${r.adjuntos.total} adjuntos (al azar) existen y coinciden en tamaño y sha256`);
  }
}

async function verificar(opciones) {
  const dirMigraciones = path.resolve(opciones.migraciones ?? path.join(AQUI, "..", "prisma", "migrations"));
  // Sin URL, pg toma PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE, como psql.
  const db = new pg.Client(opciones.url ? { connectionString: opciones.url } : {});
  const r = new Resultado();
  await db.connect();
  try {
    // Solo lectura: esta verificación no escribe nada en la base restaurada.
    await db.query("SET default_transaction_read_only = on");
    /** @type {Array<[string, () => Promise<void>]>} */
    const controles = [
      ["roles", () => controlarRoles(db, r)],
      ["base", () => controlarBase(db, r)],
      ["duenos", () => controlarDuenos(db, r)],
      ["triggers", () => controlarTriggers(db, r, dirMigraciones)],
      ["migraciones", () => controlarMigraciones(db, r, dirMigraciones)],
      ["conteos", () => controlarConteos(db, r, opciones)],
      ["historial", () => controlarHistorial(db, r)],
      ["cadena", () => controlarCadena(db, r)],
      ["adjuntos", () => controlarAdjuntos(db, r, opciones)],
    ];
    for (const [nombre, control] of controles) {
      try {
        await control();
      } catch (e) {
        // Un control que no pudo correr (una tabla que falta) es una falla,
        // pero no corta los demás.
        r.falla(nombre, e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    }
  } finally {
    await db.end();
  }

  const resumen = {
    tipo: "restauracion",
    resultado: r.fallo ? "falla" : "ok",
    verificado_en: new Date().toISOString(),
    snapshot: opciones.snapshot ?? null,
    controles: Object.fromEntries(r.items.map((i) => [i.control, i.estado])),
    detalle: r.items,
    conteos: r.conteos,
    filas: Object.values(r.conteos).reduce((a, b) => a + b, 0),
    adjuntos: r.adjuntos,
  };
  if (opciones.salida) writeFileSync(opciones.salida, `${JSON.stringify(resumen, null, 2)}\n`);
  console.log(`\nResultado: ${r.fallo ? "FALLA" : "OK"}${opciones.salida ? ` (detalle en ${opciones.salida})` : ""}`);
  return r.fallo ? 1 : 0;
}

/**
 * Asienta la prueba en auditoria.accesos de PRODUCCIÓN: accion 'exportar',
 * detalle.tipo 'restauracion' (sección 6). Corre en la VM de producción con
 * DATABASE_URL (rol cementeria_app, que puede insertar en accesos); el usuario
 * es el responsable que hizo la prueba, por su CUIL.
 */
async function registrar(opciones) {
  if (!opciones.resultado) uso("registrar necesita --resultado <json>");
  if (!opciones.cuil || !/^\d{11}$/.test(opciones.cuil)) uso("registrar necesita --cuil con 11 dígitos");
  if (opciones.envFile) process.loadEnvFile(opciones.envFile);
  const url = opciones.url ?? process.env.DATABASE_URL;
  if (!url) uso("falta DATABASE_URL (o --env-file /etc/cementeria/cementeria.env)");
  const resultado = JSON.parse(readFileSync(opciones.resultado, "utf8"));
  if (resultado.tipo !== "restauracion") throw new Error(`${opciones.resultado} no es un resultado de verificar-restauracion`);

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const usuario = await db.query("SELECT id FROM public.usuarios WHERE cuil = $1 AND activo", [opciones.cuil]);
    if (usuario.rows.length === 0) throw new Error("No hay un usuario activo con ese CUIL");
    // Sin `detalle` (los textos de cada control): alcanza con el estado de
    // cada uno, los conteos y la muestra.
    const detalle = {
      tipo: "restauracion",
      resultado: resultado.resultado,
      verificado_en: resultado.verificado_en,
      snapshot: resultado.snapshot,
      controles: resultado.controles,
      filas: resultado.filas,
      adjuntos: resultado.adjuntos,
    };
    const { rows } = await db.query(
      "INSERT INTO auditoria.accesos (usuario_id, accion, detalle) VALUES ($1, 'exportar', $2) RETURNING id::text AS id",
      [usuario.rows[0].id, JSON.stringify(detalle)],
    );
    console.log(`Prueba de restauración registrada en auditoria.accesos (id ${rows[0].id}, resultado ${resultado.resultado}).`);
  } finally {
    await db.end();
  }
  return 0;
}

// Se puede importar (para probar contarFilasDeCopy y triggersDeLasMigraciones) sin correr nada.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opciones = leerArgumentos(process.argv.slice(2));
  const accion = opciones.comando === "registrar" ? registrar : verificar;
  accion(opciones)
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
      console.error(`verificar-restauracion: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
