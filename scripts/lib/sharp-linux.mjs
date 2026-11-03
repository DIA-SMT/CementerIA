// Los binarios de sharp para el servidor municipal (Linux x64, glibc), para
// scripts/empaquetar.mjs (30/10/2026: las fotos del sitio público se procesan
// con sharp, src/lib/imagenes/procesar.ts).
//
// El paquete se arma en la máquina de build (Windows, en general), cuyo
// node_modules trae solo el binario de ESA plataforma (@img/sharp-win32-x64).
// El servidor necesita @img/sharp-linux-x64 y @img/sharp-libvips-linux-x64: se
// bajan del registro de npm con `npm pack`, con la versión EXACTA del
// package-lock y se comprueba su `integrity` (sha512) antes de usarlos. Sin
// red, el paquete no se arma (mejor que llevar un sharp que no arranca).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PAQUETES_SHARP_LINUX = ["@img/sharp-linux-x64", "@img/sharp-libvips-linux-x64"];

function correr(comando, args, cwd) {
  // npm, en Windows, es npm.cmd: necesita la shell. Los argumentos salen del package-lock (nombre y versión) y de
  // una carpeta temporal propia; igual van entre comillas, en una sola línea (sin la shell no se puede llamar a un .cmd).
  const enShell = comando === "npm" && process.platform === "win32";
  const r = enShell
    ? spawnSync([comando, ...args.map((a) => `"${a}"`)].join(" "), { cwd, encoding: "utf8", shell: true })
    : spawnSync(comando, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${comando} ${args.join(" ")} falló: ${(r.stderr || r.stdout || "").trim().slice(-400)}`);
  return r.stdout;
}

/**
 * Deja en `<destinoNodeModules>/@img/` los binarios de sharp para Linux x64 y
 * borra los de otras plataformas. `lock` es el package-lock.json leído.
 * Devuelve los paquetes que puso, con su versión.
 */
export function ponerSharpLinux(lock, destinoNodeModules) {
  const dirImg = path.join(destinoNodeModules, "@img");
  mkdirSync(dirImg, { recursive: true });
  // Los binarios de la máquina de build (y de cualquier otra plataforma) no sirven allá.
  for (const n of readdirSync(dirImg)) {
    if (n.startsWith("sharp-") && !PAQUETES_SHARP_LINUX.includes(`@img/${n}`)) rmSync(path.join(dirImg, n), { recursive: true, force: true });
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), "cementeria-sharp-"));
  const puestos = [];
  try {
    for (const nombre of PAQUETES_SHARP_LINUX) {
      const entrada = lock.packages?.[`node_modules/${nombre}`];
      if (!entrada?.version || !entrada.integrity?.startsWith("sha512-")) throw new Error(`El package-lock no tiene ${nombre} con su versión e integrity`);
      const salida = correr("npm", ["pack", `${nombre}@${entrada.version}`, "--pack-destination", temp, "--json", "--silent"], temp);
      const archivo = JSON.parse(salida)[0]?.filename;
      if (!archivo) throw new Error(`npm pack ${nombre}: no dijo qué archivo dejó`);
      const tgz = path.join(temp, archivo);
      const sha512 = `sha512-${createHash("sha512").update(readFileSync(tgz)).digest("base64")}`;
      if (sha512 !== entrada.integrity) throw new Error(`${nombre}@${entrada.version}: el integrity no coincide con el del package-lock`);
      const extraido = path.join(temp, nombre.replace("/", "__"));
      mkdirSync(extraido, { recursive: true });
      // Rutas relativas a temp: el tar de Git Bash toma "C:" como un host remoto.
      correr("tar", ["-xzf", archivo, "-C", path.basename(extraido)], temp);
      const destino = path.join(dirImg, nombre.split("/")[1]);
      rmSync(destino, { recursive: true, force: true });
      cpSync(path.join(extraido, "package"), destino, { recursive: true });
      puestos.push(`${nombre}@${entrada.version}`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return puestos;
}

/** Los binarios nativos de sharp para Linux que el control de "otra plataforma" tiene que dejar pasar. */
export function esBinarioSharpLinux(rutaRelativa) {
  return /^node_modules\/@img\/sharp-linux-x64\/lib\/sharp-linux-x64(-[\d.]+)?\.node$/.test(rutaRelativa) || /^node_modules\/@img\/sharp-libvips-linux-x64\/lib\/[^/]+\.so(\.\d+)*$/.test(rutaRelativa);
}
