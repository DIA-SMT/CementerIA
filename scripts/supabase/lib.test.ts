// Lo que no necesita base de los scripts de Supabase. La prueba de punta a
// punta, contra simuladores locales, es npm run supabase:probar.

import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PLANTILLAS } from "../../prisma/semilla/plantillas";
import { TIPOS_TRAMITE } from "../../prisma/semilla/catalogos";
import { USUARIOS_FICTICIOS } from "../../prisma/semilla/usuarios";
import { hashearClave, PARAMETROS_ACTUALES, RE_CLAVE_TEMPORAL, verificarClave } from "../../src/lib/auth/clave";
import { cuilValido as cuilValidoApp, digitoVerificadorCuil } from "../../src/lib/dominio/cuil";
import { INCREMENTALES, SALIDA, huellaSemilla } from "./generar-sql.mjs";
import {
  RAIZ,
  analizarUrlAdmin,
  armarUrl,
  claveAleatoria,
  claveDeUrl,
  claveTemporal,
  cuilValido,
  escribirArchivoClave,
  escribirBloqueEnv,
  hashClave,
  leerArchivoClave,
  PARAMETROS_SCRYPT,
  leerEnv,
  leerFuente,
  listarMigraciones,
  redactar,
  verificadorScram,
  verificarHashClave,
} from "./lib.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "cementeria-supa-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("cuilValido", () => {
  it("da lo mismo que el de la app (src/lib/dominio/cuil.ts)", () => {
    const casos = ["20000000001", "27000000022", "20123456786", "30999990015", "2000000000", "200000000011", "99000000001", "20-00000000-1"];
    for (let i = 0; i < 2000; i++) {
      const base = `${["20", "23", "24", "27", "30", "33", "34", "11"][i % 8]}${String((i * 7919) % 100_000_000).padStart(8, "0")}`;
      const d = digitoVerificadorCuil(base);
      casos.push(`${base}${d ?? 0}`, `${base}${((d ?? 0) + 1) % 10}`);
    }
    for (const c of casos) expect({ c, v: cuilValido(c) }).toEqual({ c, v: cuilValidoApp(c) });
  });
});

describe("URLs", () => {
  it("SUPABASE_ADMIN_URL del pooler: ref, host, puerto", () => {
    expect(analizarUrlAdmin("postgresql://postgres.abcdef:x@aws-1-sa-east-1.pooler.supabase.com:5432/postgres")).toEqual({
      host: "aws-1-sa-east-1.pooler.supabase.com",
      puerto: 5432,
      ref: "abcdef",
      base: "postgres",
      local: false,
      pooler: true,
    });
  });

  it("rechaza otro rol u otra base", () => {
    expect(() => analizarUrlAdmin("postgresql://cementeria_app.abc:x@h:5432/postgres")).toThrow(/rol postgres/);
    expect(() => analizarUrlAdmin("postgresql://postgres.abc:x@h:5432/cementeria")).toThrow(/postgres/);
  });

  it("los roles propios entran al pooler como rol.ref, con la clave escapada", () => {
    const url = armarUrl({ rol: "cementeria_app", ref: "abc", host: "h.pooler.supabase.com", puerto: 6543, clave: "a/b+c" });
    expect(url).toBe("postgresql://cementeria_app.abc:a%2Fb%2Bc@h.pooler.supabase.com:6543/postgres");
    expect(claveDeUrl(url, { rol: "cementeria_app", ref: "abc", host: "h.pooler.supabase.com" })).toBe("a/b+c");
    expect(claveDeUrl(url, { rol: "cementeria_app", ref: "otro", host: "h.pooler.supabase.com" })).toBeNull();
    expect(claveDeUrl(url, { rol: "cementeria_deploy", ref: "abc", host: "h.pooler.supabase.com" })).toBeNull();
  });
});

describe("claves", () => {
  it("aleatorias, largas y sin nada que escapar en una URL", () => {
    const a = claveAleatoria();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(claveAleatoria()).not.toBe(a);
  });

  it("el verificador SCRAM-SHA-256 es el de PostgreSQL (RFC 5802/7677) y no contiene la clave", () => {
    const sal = Buffer.from("0123456789abcdef");
    const v = verificadorScram("clave-de-prueba", sal, 4096);
    const salada = pbkdf2Sync("clave-de-prueba", sal, 4096, 32, "sha256");
    const guardada = createHash("sha256").update(createHmac("sha256", salada).update("Client Key").digest()).digest("base64");
    const servidor = createHmac("sha256", salada).update("Server Key").digest("base64");
    expect(v).toBe(`SCRAM-SHA-256$4096:${sal.toString("base64")}$${guardada}:${servidor}`);
    expect(v).not.toContain("clave-de-prueba");
  });

  it("redactar tapa la clave y su forma escapada", () => {
    expect(redactar("u:a/b@h y a%2Fb", ["a/b"])).toBe("u:***@h y ***");
  });
});

describe("contraseña del admin inicial (login propio)", () => {
  it("los mismos parámetros que la app, y la app verifica el hash que genera el script (y al revés)", async () => {
    expect(PARAMETROS_SCRYPT).toEqual(PARAMETROS_ACTUALES);
    const temporal = claveTemporal();
    expect(temporal).toMatch(RE_CLAVE_TEMPORAL);
    const delScript = hashClave(temporal);
    expect(delScript).not.toContain(temporal);
    expect(await verificarClave(temporal, delScript)).toEqual({ ok: true, rehacer: false });
    expect((await verificarClave("otra-cosa-cualquiera", delScript)).ok).toBe(false);
    const deLaApp = await hashearClave(temporal);
    expect(verificarHashClave(temporal, deLaApp)).toBe(true);
    expect(verificarHashClave("otra-cosa-cualquiera", deLaApp)).toBe(false);
  });

  it("el archivo local: se escribe y se vuelve a leer la misma (para no invalidar la ya entregada)", () => {
    const archivo = path.join(dir, "sub", "clave-admin-inicial.txt");
    expect(leerArchivoClave(archivo)).toBeNull();
    const temporal = claveTemporal();
    escribirArchivoClave(archivo, temporal, "prueba");
    expect(leerArchivoClave(archivo)).toBe(temporal);
    writeFileSync(archivo, ["# solo comentarios", "no-es-una-temporal", ""].join("\n"));
    expect(leerArchivoClave(archivo)).toBeNull();
  });
});

describe("archivo de entorno", () => {
  it("el bloque generado se reemplaza sin tocar lo que completó la persona", () => {
    const archivo = path.join(dir, "prueba.env");
    writeFileSync(archivo, "# mío\nSUPABASE_ADMIN_URL=postgresql://postgres.abc:x@h:5432/postgres\nADMIN_INICIAL_CUIL=20000000001\n");
    escribirBloqueEnv(archivo, { DATABASE_URL: "uno", MIGRATE_DATABASE_URL: "dos" });
    escribirBloqueEnv(archivo, { DATABASE_URL: "tres", MIGRATE_DATABASE_URL: "cuatro" });
    const texto = readFileSync(archivo, "utf8");
    expect(texto.match(/Generado por/g)).toHaveLength(1);
    expect(leerEnv(archivo)).toEqual({
      SUPABASE_ADMIN_URL: "postgresql://postgres.abc:x@h:5432/postgres",
      ADMIN_INICIAL_CUIL: "20000000001",
      DATABASE_URL: "tres",
      MIGRATE_DATABASE_URL: "cuatro",
    });
    expect(texto.startsWith("# mío\n")).toBe(true);
  });
});

describe("supabase/sql/ al día (sin base; la comparación completa es npm run supabase:probar)", () => {
  it("cada migración tiene su archivo, con el contenido tal cual y el checksum de Prisma", async () => {
    const migraciones = await listarMigraciones();
    expect(migraciones.length).toBeGreaterThan(0);
    for (const m of migraciones) {
      const archivo = path.join(SALIDA, `20_migracion_${m.nombre}.sql`);
      expect({ m: m.nombre, existe: existsSync(archivo) }).toEqual({ m: m.nombre, existe: true });
      const texto = readFileSync(archivo, "utf8");
      expect(texto).toContain(m.sql.trimEnd());
      expect(texto).toContain(`'${m.checksum}', now(), '${m.nombre}'`);
    }
  });

  it("la semilla volcada corresponde a prisma/semilla de hoy", () => {
    expect(readFileSync(path.join(SALIDA, "30_semilla_produccion.sql"), "utf8")).toContain(`Huella de prisma/semilla/ y prisma/seed.ts: ${huellaSemilla()}`);
  });

  it("los archivos fijos contienen su fuente", () => {
    for (const [archivo, fuente] of [
      ["00_roles.sql", "roles.sql"],
      ["01_extensiones.sql", "extensiones.sql"],
      ["45_storage.sql", "storage.sql"],
      ["99_verificar.sql", "verificar.sql"],
    ]) {
      expect(readFileSync(path.join(SALIDA, archivo), "utf8")).toContain(leerFuente(fuente).trimEnd());
    }
  });

  it("verificar.sql busca los mismos CUIL ficticios que la semilla de desarrollo", () => {
    const enSql = [...leerFuente("verificar.sql").matchAll(/'(\d{11})'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual(USUARIOS_FICTICIOS.map((u) => u.cuil).sort());
  });

  it("verificar.sql controla las mismas plantillas que la semilla", () => {
    const sql = leerFuente("verificar.sql");
    const lista = /unnest\(ARRAY\[([^\]]*)\]\) AS c\(codigo\)/.exec(sql)?.[1] ?? "";
    expect([...lista.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])).toEqual(PLANTILLAS.map((p) => p.codigo));
    expect(sql).toContain(`%s de ${PLANTILLAS.length} publicadas`);
  });

  it("cada archivo incremental agrega lo que la semilla tiene, por código y sin ids", () => {
    for (const inc of INCREMENTALES) {
      const texto = readFileSync(path.join(SALIDA, inc.archivo), "utf8");
      for (const codigo of inc.tiposTramite) expect(TIPOS_TRAMITE.map((t) => t.codigo)).toContain(codigo);
      for (const codigo of inc.plantillas) {
        expect(PLANTILLAS.map((p) => p.codigo)).toContain(codigo);
        expect(texto).toContain(`"codigo":"${codigo}"`);
      }
      expect(texto).toContain("ON CONFLICT (codigo) DO NOTHING");
      expect(texto).not.toMatch(/OVERRIDING SYSTEM VALUE|setval/);
    }
  });

  it("los archivos .local/ no se versionan", () => {
    expect(readFileSync(path.join(RAIZ, ".gitignore"), "utf8")).toMatch(/^\/supabase\/sql\/\.local\/$/m);
  });
});
