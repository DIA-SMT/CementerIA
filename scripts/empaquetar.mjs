#!/usr/bin/env node
// Arma el paquete de despliegue de CementerIA (docs/despliegue.md).
//
//   npm run empaquetar                         paquete para el servidor (Linux x64), desde HEAD
//   npm run empaquetar -- --ref <commit>       desde otro commit (o un árbol de git)
//   npm run empaquetar -- --destino local      para probar el paquete en esta máquina
//   npm run empaquetar -- --sin-tar            solo la carpeta, sin el .tar.gz
//
// Sección 6 de la propuesta, "Despliegue sin npm en el servidor": se compila
// en la máquina de build y se lleva `.next/standalone` con `.next/static`,
// `public`, las migraciones y la CLI de Prisma (para `migrate deploy`). En el
// servidor solo hace falta Node 24.
//
// El paquete sale de un COMMIT, no de la carpeta de trabajo: se exporta el
// árbol a una carpeta temporal y se compila ahí. Así lo desplegado es
// exactamente lo que está en git (ni cambios a medio hacer ni archivos sin
// versionar) y ningún .env.local llega al build. node_modules no se reinstala:
// se enlaza (hard links) desde el del repositorio, que tiene que estar al día
// con el package-lock del commit.
//
// Queda en build/paquetes/ (ignorado por git):
//   cementeria-<versión>/            la carpeta lista para copiar
//   cementeria-<versión>.tar.gz      lo mismo, comprimido
//   cementeria-<versión>.tar.gz.sha256

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = path.join(RAIZ, "build", "paquetes");

// El motor de migraciones de Prisma (schema-engine) es un binario nativo. Ubuntu
// 24.04 trae OpenSSL 3, y para Prisma esa plataforma es debian-openssl-3.0.x.
const MOTOR_LINUX = "schema-engine-debian-openssl-3.0.x";

// Paquetes que van COMPLETOS al node_modules del paquete, con sus dependencias.
// El trazado de Next copia solo los archivos que la app importa; estos se usan
// fuera de la app:
// - prisma: la CLI de `migrate deploy`;
// - pg: lo usa scripts/verificar-restauracion.mjs.
const COMPLETOS = ["prisma", "pg"];

// La CLI de Prisma 7 hace require() de @prisma/studio-core y de @prisma/dev al
// cargar, aunque `migrate deploy` no los use. De studio-core va el paquete
// solo: sus dependencias son la interfaz de Prisma Studio (React, gráficos) y
// no se cargan. mysql2 y postgres son drivers que la CLI importa solo para
// Studio. Si una versión nueva de Prisma necesitara algo de esto, la prueba
// del paquete fuera del repositorio lo muestra (docs/despliegue.md, sección 17).
const SIN_DEPENDENCIAS = new Set(["@prisma/studio-core"]);
const EXCLUIDOS = new Set(["mysql2", "postgres"]);

// Variables que no tienen por qué estar en el entorno del build. `next build`
// no las necesita, y si alguna llegara a un módulo evaluado en el build podría
// quedar escrita en la salida.
const SECRETAS = [
  "DATABASE_URL",
  "MIGRATE_DATABASE_URL",
  "SHADOW_DATABASE_URL",
  "SESSION_SECRET",
  "DB_LOCAL_CLAVE_SUPERUSUARIO",
  "AUTH_DEV_LOGIN",
  "AUTH_DEV_LOGIN_STAGING",
  "CIDITUC_CA_PEM",
];

function uso(mensaje) {
  if (mensaje) console.error(`empaquetar: ${mensaje}\n`);
  console.error(
    "Uso: npm run empaquetar -- [--ref <commit|árbol>] [--destino linux|local] [--sin-tar]\n" +
      "  --ref       de dónde sale el código (por defecto HEAD)\n" +
      "  --destino   linux: el servidor Ubuntu 24.04 (por defecto); local: esta máquina, para probar\n" +
      "  --sin-tar   deja solo la carpeta",
  );
  process.exit(2);
}

function leerArgumentos(argv) {
  const o = { ref: "HEAD", destino: "linux", tar: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valor = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) uso(`${a} necesita un valor`);
      return v;
    };
    if (a === "--ref") o.ref = valor();
    else if (a === "--destino") o.destino = valor();
    else if (a === "--sin-tar") o.tar = false;
    else if (a === "--ayuda" || a === "-h") uso();
    else uso(`opción desconocida: ${a}`);
  }
  if (!["linux", "local"].includes(o.destino)) uso("--destino tiene que ser linux o local");
  return o;
}

function paso(texto) {
  console.log(`\n» ${texto}`);
}

/** Corre un comando y corta todo si falla. Devuelve la salida estándar. */
function correr(comando, args, { cwd = RAIZ, env = process.env, mostrar = false } = {}) {
  const r = spawnSync(comando, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: mostrar ? "inherit" : "pipe",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`${comando}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`${comando} ${args.join(" ")} terminó con código ${r.status}\n${r.stderr ?? ""}`.trim());
  }
  return (r.stdout ?? "").trim();
}

const git = (...args) => correr("git", args);

/**
 * Qué se empaqueta: el árbol de `ref`, su commit (si lo es) y la versión, que
 * es la del package.json de ese árbol más el commit. La versión llega a
 * /api/salud y a la carpeta del paquete.
 */
function origen(ref) {
  let arbol;
  try {
    arbol = git("rev-parse", "--verify", "--quiet", `${ref}^{tree}`);
  } catch {
    throw new Error(`No existe en git: ${ref}`);
  }
  let commit = null;
  try {
    commit = git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  } catch {
    // Un árbol suelto (por ejemplo, armado con git write-tree para probar).
  }
  const pkg = JSON.parse(git("show", `${arbol}:package.json`));
  const sufijo = commit ? commit.slice(0, 7) : `arbol-${arbol.slice(0, 7)}`;
  return { arbol, commit, version: `${pkg.version}-${sufijo}` };
}

/**
 * Exporta el árbol a `destino` con un índice propio: no toca el índice ni la
 * carpeta de trabajo del repositorio. checkout-index respeta .gitattributes
 * (eol=lf), así que los .sh salen con LF también desde Windows.
 */
function exportarArbol(arbol, destino, temporal) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temporal, "indice-git") };
  correr("git", ["read-tree", arbol], { env });
  const prefijo = destino.split(path.sep).join("/") + "/";
  correr("git", ["checkout-index", "--all", "--force", `--prefix=${prefijo}`], { env });
}

/**
 * Copia node_modules con hard links (segundos y sin espacio extra) y cae a
 * copia común si el sistema no los admite. Los directorios son nuevos: lo que
 * el build cree adentro no aparece en el repositorio.
 */
function enlazarArbol(desde, hasta) {
  mkdirSync(hasta, { recursive: true });
  for (const e of readdirSync(desde, { withFileTypes: true })) {
    const a = path.join(desde, e.name);
    const b = path.join(hasta, e.name);
    if (e.isDirectory()) enlazarArbol(a, b);
    else if (e.isSymbolicLink()) symlinkSync(readlinkSync(a), b);
    else {
      try {
        linkSync(a, b);
      } catch {
        copyFileSync(a, b);
      }
    }
  }
}

/** Busca el directorio de un paquete como lo haría require(), desde `dir`. */
function resolverPaquete(nombre, dir, raizModulos) {
  let actual = dir;
  for (;;) {
    const candidato = path.join(actual, "node_modules", nombre);
    if (existsSync(path.join(candidato, "package.json"))) return candidato;
    if (path.resolve(actual) === path.resolve(raizModulos)) return null;
    const padre = path.dirname(actual);
    if (padre === actual) return null;
    actual = padre;
  }
}

/**
 * Los paquetes de primer nivel de node_modules que necesita `nombres`, con
 * sus dependencias (no las peer, que son opcionales en la CLI de Prisma). Los
 * anidados viajan dentro de su paquete padre.
 */
function cierreDeDependencias(nombres, raizProyecto) {
  const modulos = path.join(raizProyecto, "node_modules");
  const resultado = new Set();
  const visitados = new Set();
  const pendientes = nombres.map((n) => ({ nombre: n, desde: raizProyecto }));
  while (pendientes.length > 0) {
    const { nombre, desde } = pendientes.pop();
    if (EXCLUIDOS.has(nombre)) continue;
    const dir = resolverPaquete(nombre, desde, raizProyecto);
    if (!dir) {
      // Una dependencia opcional que no se instaló en esta plataforma.
      continue;
    }
    if (visitados.has(dir)) continue;
    visitados.add(dir);
    const relativo = path.relative(modulos, dir);
    const partes = relativo.split(path.sep);
    const primerNivel = partes[0].startsWith("@") ? partes.slice(0, 2).join("/") : partes[0];
    if (!relativo.startsWith("..")) resultado.add(primerNivel);
    if (SIN_DEPENDENCIAS.has(nombre)) continue;
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      pendientes.push({ nombre: dep, desde: dir });
    }
  }
  return [...resultado].sort();
}

/** Todos los archivos bajo `dir` (rutas relativas, con /). */
function listar(dir, base = dir, salida = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) listar(ruta, base, salida);
    else salida.push(path.relative(base, ruta).split(path.sep).join("/"));
  }
  return salida;
}

function tamanio(dir) {
  return listar(dir).reduce((total, r) => total + statSync(path.join(dir, r)).size, 0);
}

function sha256(archivo) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(archivo)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** El motor de migraciones que corresponde al destino, dentro de @prisma/engines. */
function motorDeMigraciones(destino, dirEngines) {
  if (destino === "linux") return MOTOR_LINUX;
  const local = readdirSync(dirEngines).filter((n) => n.startsWith("schema-engine-"));
  if (local.length !== 1) {
    throw new Error(`Se esperaba un solo schema-engine en ${dirEngines} y hay: ${local.join(", ") || "ninguno"}`);
  }
  return local[0];
}

/**
 * Compila un script de TypeScript a un solo .mjs, con sus dependencias
 * adentro: en el servidor no hay tsx ni el node_modules completo. Lo que va en
 * `externos` queda como import a resolver en tiempo de ejecución.
 */
async function compilarScript(fuente, entrada, destino, externos = []) {
  let esbuild;
  try {
    // esbuild no es dependencia directa: llega con tsx, que sí lo es.
    esbuild = createRequire(path.join(fuente, "package.json"))("esbuild");
  } catch {
    throw new Error("No se encontró esbuild (llega con tsx, dependencia de desarrollo). Corré npm install.");
  }
  await esbuild.build({
    entryPoints: [path.join(fuente, entrada)],
    outfile: destino,
    bundle: true,
    platform: "node",
    target: "node24",
    // ESM: el cliente generado de Prisma usa import.meta.url. Las dependencias
    // CommonJS que quedan adentro (dotenv) hacen require() de módulos de Node,
    // que en un bundle ESM no existe: el banner lo define.
    format: "esm",
    external: externos,
    tsconfig: path.join(fuente, "tsconfig.json"),
    logLevel: "warning",
    banner: {
      js: [
        `// Generado por scripts/empaquetar.mjs desde ${entrada}. No editar.`,
        'import { createRequire as __crearRequire } from "node:module";',
        "const require = __crearRequire(import.meta.url);",
      ].join("\n"),
    },
  });
}

async function main() {
  const opciones = leerArgumentos(process.argv.slice(2));
  const { arbol, commit, version } = origen(opciones.ref);
  const nombre = `cementeria-${version}`;
  const paquete = path.join(SALIDA, nombre);

  console.log(`Paquete ${nombre} (destino: ${opciones.destino})`);
  console.log(`Origen: ${commit ? `commit ${commit}` : `árbol ${arbol}`}`);
  if (git("status", "--porcelain")) {
    console.log("Aviso: hay cambios sin commitear en la carpeta de trabajo. NO entran al paquete.");
  }
  if (opciones.destino === "local" && process.platform === "linux" && process.arch === "x64") {
    console.log("Aviso: esta máquina ya es Linux x64; --destino linux sirve igual para el servidor.");
  }

  // Antes del build, que lleva un par de minutos: sin el motor de Linux el
  // paquete no serviría y se cortaría al final.
  const enginesRepo = path.join(RAIZ, "node_modules", "@prisma", "engines");
  if (opciones.destino === "linux" && !existsSync(path.join(enginesRepo, MOTOR_LINUX))) {
    throw new Error(
      `Falta ${MOTOR_LINUX} en node_modules/@prisma/engines: sin él, migrate deploy no corre en el servidor.\n` +
        "Bajalo una vez en esta máquina (lo baja Prisma de su servidor, igual que en npm install):\n" +
        "  PRISMA_CLI_BINARY_TARGETS=native,debian-openssl-3.0.x node node_modules/@prisma/engines/scripts/postinstall.js\n" +
        "(en PowerShell: $env:PRISMA_CLI_BINARY_TARGETS='native,debian-openssl-3.0.x'; node node_modules/@prisma/engines/scripts/postinstall.js)\n" +
        "Ver docs/despliegue.md, \"El paquete\".",
    );
  }

  const temporal = mkdtempSync(path.join(os.tmpdir(), "cementeria-paquete-"));
  const fuente = path.join(temporal, "fuente");
  let completo = false;
  try {
    paso("Exportando el árbol de git");
    exportarArbol(arbol, fuente, temporal);
    if (!existsSync(path.join(RAIZ, "node_modules", "next"))) {
      throw new Error("Falta node_modules en el repositorio: corré npm install.");
    }

    paso("Enlazando node_modules");
    enlazarArbol(path.join(RAIZ, "node_modules"), path.join(fuente, "node_modules"));

    // Sin las variables secretas, por las dudas (ver SECRETAS).
    // Next solo admite letras, dígitos, - y _ en el deploymentId: 0.1.0 va como
    // 0_1_0 (src/app/api/salud/salud.ts lo muestra otra vez con puntos).
    const envBuild = {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_DEPLOYMENT_ID: version.replaceAll(".", "_"),
    };
    for (const v of SECRETAS) delete envBuild[v];

    paso("Generando el cliente de Prisma");
    correr(process.execPath, [path.join(fuente, "node_modules", "prisma", "build", "index.js"), "generate"], {
      cwd: fuente,
      env: envBuild,
      mostrar: true,
    });

    paso("Compilando (next build)");
    // NEXT_DEPLOYMENT_ID: la versión que informa /api/salud y con la que Next
    // detecta que una pestaña quedó abierta con el build anterior (recarga en
    // vez de fallar al llamar a una Server Action que ya no existe).
    correr(process.execPath, [path.join(fuente, "node_modules", "next", "dist", "bin", "next"), "build"], {
      cwd: fuente,
      env: envBuild,
      mostrar: true,
    });
    const standalone = path.join(fuente, ".next", "standalone");
    if (!existsSync(path.join(standalone, "server.js"))) {
      throw new Error("next build no dejó .next/standalone/server.js: ¿falta output: 'standalone' en next.config.ts?");
    }

    paso(`Armando ${path.relative(RAIZ, paquete)}`);
    rmSync(paquete, { recursive: true, force: true });
    mkdirSync(SALIDA, { recursive: true });
    cpSync(standalone, paquete, { recursive: true, verbatimSymlinks: true });
    // Lo que server.js sirve pero Next no copia (docs de `output`).
    cpSync(path.join(fuente, ".next", "static"), path.join(paquete, ".next", "static"), { recursive: true });
    if (existsSync(path.join(fuente, "public"))) {
      cpSync(path.join(fuente, "public"), path.join(paquete, "public"), { recursive: true });
    }

    // Migraciones, esquema y la configuración de la CLI para el servidor (sin
    // dotenv: la URL de cementeria_deploy llega por el entorno y no se guarda).
    mkdirSync(path.join(paquete, "prisma"), { recursive: true });
    copyFileSync(path.join(fuente, "prisma", "schema.prisma"), path.join(paquete, "prisma", "schema.prisma"));
    cpSync(path.join(fuente, "prisma", "migrations"), path.join(paquete, "prisma", "migrations"), { recursive: true });
    copyFileSync(path.join(fuente, "deploy", "prisma.config.mjs"), path.join(paquete, "prisma.config.mjs"));

    // CLI de Prisma y pg, completos (pisan las copias parciales del trazado).
    const completos = cierreDeDependencias(COMPLETOS, fuente);
    for (const p of completos) {
      const destinoPkg = path.join(paquete, "node_modules", ...p.split("/"));
      rmSync(destinoPkg, { recursive: true, force: true });
      cpSync(path.join(fuente, "node_modules", ...p.split("/")), destinoPkg, { recursive: true, verbatimSymlinks: true });
    }
    console.log(`  node_modules completos: ${completos.join(", ")}`);

    // Solo el motor de migraciones del destino.
    const dirEngines = path.join(paquete, "node_modules", "@prisma", "engines");
    const motor = motorDeMigraciones(opciones.destino, dirEngines);
    if (!existsSync(path.join(dirEngines, motor))) throw new Error(`Falta ${motor} en el paquete`);
    for (const n of readdirSync(dirEngines)) {
      if (n.startsWith("schema-engine-") && n !== motor) rmSync(path.join(dirEngines, n), { force: true });
    }

    // sharp es del optimizador de imágenes de Next, que la app no usa (los
    // adjuntos los sirve un Route Handler y nginx corta /_next/image). Si el
    // trazado lo trajo, sería el binario de la máquina de build.
    for (const p of [["sharp"], ["@img"]]) rmSync(path.join(paquete, "node_modules", ...p), { recursive: true, force: true });

    // Scripts de operación.
    const scripts = path.join(paquete, "scripts");
    mkdirSync(scripts, { recursive: true });
    await compilarScript(fuente, "scripts/barrer-adjuntos-tmp.ts", path.join(scripts, "barrer-adjuntos-tmp.mjs"));
    // La semilla, para el primer despliegue (catálogos, plantillas y el admin
    // inicial; en producción con --sin-ficticios).
    // Todo adentro (unos 7 MB): el node_modules del paquete tiene solo lo que
    // trazó Next, y el cliente de Prisma 7 trae su motor como wasm en base64,
    // así que se empaqueta sin archivos aparte. pg-native es opcional y no está.
    await compilarScript(fuente, "prisma/seed.ts", path.join(scripts, "semilla.mjs"), ["pg-native"]);
    for (const s of ["verificar-restauracion.mjs", "backup.sh", "restaurar-prueba.sh", "roles.sql"]) {
      copyFileSync(path.join(fuente, "scripts", s), path.join(scripts, s));
    }
    cpSync(path.join(fuente, "deploy"), path.join(paquete, "deploy"), { recursive: true });
    // El runbook viaja con el paquete: en el servidor no está el repositorio.
    copyFileSync(path.join(fuente, "docs", "despliegue.md"), path.join(paquete, "DESPLIEGUE.md"));
    // Y una copia de desplegar.sh al lado del .tar.gz: es lo primero que se
    // corre en el servidor, antes de que el paquete esté descomprimido.
    copyFileSync(path.join(fuente, "deploy", "desplegar.sh"), path.join(SALIDA, "desplegar.sh"));

    // Controles: nada de .env ni de binarios nativos de otra plataforma.
    const archivos = listar(paquete);
    const envs = archivos.filter((a) => /(^|\/)\.env(\.|$)/.test(a) && !a.startsWith("deploy/"));
    if (envs.length > 0) throw new Error(`El paquete tiene archivos .env: ${envs.join(", ")}`);
    const nativos = archivos.filter((a) => /\.(node|dll|exe|so|dylib)$/.test(a) && !a.endsWith(`/${motor}`));
    if (opciones.destino === "linux" && nativos.some((a) => !a.endsWith(".so"))) {
      throw new Error(`El paquete tiene binarios de otra plataforma:\n  ${nativos.join("\n  ")}`);
    }
    if (nativos.length > 0) console.log(`  Binarios nativos (revisar): ${nativos.join(", ")}`);

    const manifiesto = {
      nombre,
      version,
      commit,
      arbol,
      destino: opciones.destino === "linux" ? "linux-x64" : `${process.platform}-${process.arch}`,
      motorMigraciones: motor,
      construido: new Date().toISOString(),
      node: process.version,
    };
    writeFileSync(path.join(paquete, "VERSION"), `${version}\n`);
    writeFileSync(path.join(paquete, "paquete.json"), `${JSON.stringify(manifiesto, null, 2)}\n`);
    console.log(`  ${archivos.length + 2} archivos, ${(tamanio(paquete) / 1024 / 1024).toFixed(1)} MB`);

    if (opciones.tar) {
      paso("Comprimiendo");
      const tar = `${nombre}.tar.gz`;
      rmSync(path.join(SALIDA, tar), { force: true });
      // Rutas relativas y cwd en la salida: GNU tar (Git Bash) toma "C:" de
      // una ruta absoluta de Windows como un host remoto.
      correr("tar", ["-czf", tar, nombre], { cwd: SALIDA });
      const suma = await sha256(path.join(SALIDA, tar));
      writeFileSync(path.join(SALIDA, `${tar}.sha256`), `${suma}  ${tar}\n`);
      console.log(`  ${path.relative(RAIZ, path.join(SALIDA, tar))} (${(statSync(path.join(SALIDA, tar)).size / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`  sha256 ${suma}`);
    }

    completo = true;
    console.log(`\nListo: ${path.relative(RAIZ, paquete)}`);
    if (opciones.destino === "linux") {
      console.log("Siguiente paso: copiarlo al servidor y seguir docs/despliegue.md, \"Actualizaciones\".");
    } else {
      console.log("Paquete LOCAL (motor de migraciones de esta máquina): no sirve para el servidor.");
    }
  } finally {
    // Windows suelta los archivos con un poco de demora.
    rmSync(temporal, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    // Un paquete a medio armar no tiene que poder confundirse con uno bueno.
    if (!completo) {
      rmSync(paquete, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      rmSync(`${paquete}.tar.gz`, { force: true });
      rmSync(`${paquete}.tar.gz.sha256`, { force: true });
    }
  }
}

main().catch((e) => {
  console.error(`\nempaquetar: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
