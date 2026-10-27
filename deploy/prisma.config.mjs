// Configuración de la CLI de Prisma DENTRO DEL PAQUETE de despliegue.
// `npm run empaquetar` la copia a la raíz del paquete como prisma.config.mjs;
// en el repositorio se usa prisma.config.ts.
//
// Diferencias con prisma.config.ts: no carga .env.local con dotenv (en el
// servidor no hay dotenv ni .env), no declara shadow database (en producción
// solo corre `migrate deploy`, que no la usa) y no tiene semilla (la semilla
// necesita tsx; ver docs/despliegue.md, "Primer despliegue").
//
// La URL del rol cementeria_deploy llega por el entorno SOLO mientras corre la
// migración: deploy/desplegar.sh la pide por teclado y no la escribe en ningún
// lado (sección 2, "Roles de base": su credencial no queda en el servidor).

import path from "node:path";
import { defineConfig } from "prisma/config";

const urlCruda = process.env.MIGRATE_DATABASE_URL;
if (!urlCruda) {
  throw new Error(
    "Falta MIGRATE_DATABASE_URL (rol cementeria_deploy). En el servidor las migraciones se corren con deploy/desplegar.sh, que la pide.",
  );
}

// Base en Supabase (docs/despliegue.md, "Base en Supabase"): con DATABASE_CA_FILE
// (la ruta del certificado raíz de Supabase) el motor de migraciones exige TLS y
// verifica la cadena y el host con esa CA. Es lo mismo que urlParaPrisma() de
// src/lib/db/tls.ts, que el paquete no trae.
const ca = process.env.DATABASE_CA_FILE?.trim();
const url = ca ? conCa(urlCruda, path.resolve(ca)) : urlCruda;

function conCa(cruda, archivo) {
  const u = new URL(cruda);
  for (const p of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "sslaccept", "sslidentity"]) {
    u.searchParams.delete(p);
  }
  u.searchParams.set("sslmode", "require");
  u.searchParams.set("sslcert", archivo.replaceAll("\\", "/"));
  u.searchParams.set("sslaccept", "strict");
  return u.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
