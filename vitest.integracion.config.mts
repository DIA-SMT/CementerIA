import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de integración contra un PostgreSQL 15 real y efímero (embedded-postgres).
// El globalSetup lo crea en un directorio temporal y un puerto libre, aplica
// db-init.sql y las migraciones, y lo borra al terminar. Ver
// tests/integracion/README.md.

const raiz = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${raiz}src/` },
      { find: /^server-only$/, replacement: `${raiz}tests/stubs/server-only.ts` },
    ],
  },
  test: {
    include: ["tests/integracion/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integracion/global-setup.ts"],
    // Una sola base para toda la corrida: los archivos van de a uno para que
    // un test que mira conteos globales no vea filas de otro archivo.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Ver vitest.config.mts: el código no puede depender de la TZ del proceso.
    env: { TZ: "UTC" },
  },
});
