import path from "node:path";
import { config as cargarEnv } from "dotenv";
import { defineConfig } from "prisma/config";
import { urlParaPrisma } from "./src/lib/db/tls";

// Next lee .env.local solo; la CLI de Prisma corre afuera y hay que decírselo.
// dotenv no pisa variables ya definidas: el arnés de integración le pasa a
// `prisma migrate deploy` las URLs de su base efímera y esas ganan.
cargarEnv({ path: ".env.local", quiet: true });

/**
 * Configuración de las herramientas de Prisma (migrate, studio, seed).
 *
 * Acá va solo la URL de MIGRACIONES, que es la de `cementeria_deploy`: al
 * conectarse toma el rol `cementeria_owner` (ALTER ROLE … SET role), así que
 * todo lo que crean las migraciones, incluida `_prisma_migrations`, queda a
 * nombre del owner. La app corre con `cementeria_app` y esa URL
 * (`DATABASE_URL`) se le pasa al adapter en `src/lib/db/crear-cliente.ts`.
 *
 * La URL se resuelve a mano y no con el helper `env()` de Prisma porque ese
 * helper tira al cargar el archivo, y este archivo lo carga cualquier comando
 * de Prisma, incluido `generate`, que no toca la base y corre en cada
 * `npm install`. Sin la variable no se declara datasource y `generate` anda
 * igual; los comandos que sí se conectan avisan con un mensaje que dice dónde
 * ponerla.
 */
const urlMigraciones = process.env.MIGRATE_DATABASE_URL;
const urlShadow = process.env.SHADOW_DATABASE_URL;

// `migrate diff --from-empty --to-schema` no se conecta a nada; con
// `--from-migrations` sí (usa la shadow database), y para eso alcanza con que
// la URL esté definida.
const NECESITAN_BASE = ["migrate", "db", "studio"];
const seConecta =
  NECESITAN_BASE.some((c) => process.argv.includes(c)) &&
  !(process.argv.includes("diff") && process.argv.includes("--from-empty"));
if (!urlMigraciones && seConecta) {
  throw new Error(
    "Falta MIGRATE_DATABASE_URL en .env.local.\n" +
      "Es la conexión del rol cementeria_deploy (no la de la app).\n" +
      "En local: npm run db:local y copiá .env.example a .env.local.",
  );
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  ...(urlMigraciones
    ? {
        datasource: {
          // Con DATABASE_CA_FILE o DATABASE_CA_PEM (Supabase), la URL lleva el
          // TLS con esa CA para el motor de migraciones (src/lib/db/tls.ts). Solo
          // en los comandos que se conectan: `generate` no tiene por qué leer
          // el certificado.
          url: seConecta ? urlParaPrisma(urlMigraciones) : urlMigraciones,
          ...(urlShadow ? { shadowDatabaseUrl: urlShadow } : {}),
        },
      }
    : {}),
});
