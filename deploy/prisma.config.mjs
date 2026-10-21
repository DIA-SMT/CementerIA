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

import { defineConfig } from "prisma/config";

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  throw new Error(
    "Falta MIGRATE_DATABASE_URL (rol cementeria_deploy). En el servidor las migraciones se corren con deploy/desplegar.sh, que la pide.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
