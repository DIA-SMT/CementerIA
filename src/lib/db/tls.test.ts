import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { conexionPg, leerCaDeBase, sinParametrosTls, urlParaPrisma } from "./tls";

// Un PEM con la forma de un certificado (estas funciones no lo parsean: eso lo
// hace TLS al conectarse; la prueba de punta a punta es npm run supabase:probar).
const PEM = "-----BEGIN CERTIFICATE-----\nMIIBPRUEBA\n-----END CERTIFICATE-----\n";
const dir = mkdtempSync(path.join(os.tmpdir(), "cementeria-tls-"));
const archivo = path.join(dir, "ca.crt");
writeFileSync(archivo, PEM);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SUPABASE = "postgresql://cementeria_app.abc:clave@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?pgbouncer=true&sslmode=require";

describe("leerCaDeBase", () => {
  it("sin variables no hay CA", () => {
    expect(leerCaDeBase({})).toBeNull();
  });

  it("DATABASE_CA_PEM gana sobre DATABASE_CA_FILE", () => {
    expect(leerCaDeBase({ DATABASE_CA_PEM: `  ${PEM}`, DATABASE_CA_FILE: "/no/existe" })).toMatchObject({ origen: "DATABASE_CA_PEM" });
  });

  it("DATABASE_CA_FILE se resuelve desde el directorio de trabajo", () => {
    expect(leerCaDeBase({ DATABASE_CA_FILE: "ca.crt" }, dir)).toEqual({ pem: PEM, origen: "DATABASE_CA_FILE", archivo });
  });

  it("un archivo que no existe o que no es un PEM es un error que dice de dónde bajarlo", () => {
    expect(() => leerCaDeBase({ DATABASE_CA_FILE: "falta.crt" }, dir)).toThrow(/SSL Configuration/);
    const malo = path.join(dir, "malo.crt");
    writeFileSync(malo, "no es un certificado");
    expect(() => leerCaDeBase({ DATABASE_CA_FILE: malo })).toThrow(/PEM/);
  });
});

describe("conexionPg", () => {
  it("con CA: saca los ssl* de la URL (pg los pondría por encima) y verifica cadena y host", () => {
    const c = conexionPg(SUPABASE, { DATABASE_CA_FILE: archivo });
    expect(c.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    const u = new URL(c.connectionString);
    expect(u.searchParams.has("sslmode")).toBe(false);
    expect(u.searchParams.get("pgbouncer")).toBe("true");
    expect(u.username).toBe("cementeria_app.abc");
  });

  it("Supabase sin CA es un error claro (nunca una conexión sin verificar)", () => {
    expect(() => conexionPg(SUPABASE, {})).toThrow(/DATABASE_CA_FILE/);
    expect(() => conexionPg("postgresql://u:c@db.abc.supabase.co:5432/postgres", {})).toThrow(/certificado raíz/);
  });

  it("la base local sin CA queda como estaba", () => {
    const url = "postgresql://cementeria_app:c@localhost:54329/cementeria";
    expect(conexionPg(url, {})).toEqual({ connectionString: url });
  });
});

describe("urlParaPrisma", () => {
  it("con CA: TLS obligatorio, la CA como sslcert y sslaccept=strict", () => {
    const u = new URL(urlParaPrisma(SUPABASE, { DATABASE_CA_FILE: archivo }));
    expect(u.searchParams.get("sslmode")).toBe("require");
    expect(u.searchParams.get("sslcert")).toBe(archivo.replaceAll("\\", "/"));
    expect(u.searchParams.get("sslaccept")).toBe("strict");
  });

  it("con la CA como PEM la escribe en un temporal (el motor necesita una ruta)", () => {
    const u = new URL(urlParaPrisma(SUPABASE, { DATABASE_CA_PEM: PEM }));
    expect(readFileSync(u.searchParams.get("sslcert") ?? "", "utf8")).toBe(PEM);
  });

  it("sin CA no toca la URL", () => {
    expect(urlParaPrisma(SUPABASE, {})).toBe(SUPABASE);
  });

  it("sinParametrosTls deja el resto", () => {
    expect(sinParametrosTls("postgresql://u:c@h:1/b?sslmode=verify-full&sslrootcert=x&a=1")).toBe("postgresql://u:c@h:1/b?a=1");
  });
});
