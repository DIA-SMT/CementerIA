import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests unitarios: rápidos, sin base. Los de integración tienen su propia
// configuración (vitest.integracion.config.mts) y no entran acá.

const raiz = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${raiz}src/` },
      // `server-only` tira error fuera de Next. Los módulos del servidor se
      // testean igual: en los tests se reemplaza por un módulo vacío.
      { find: /^server-only$/, replacement: `${raiz}tests/stubs/server-only.ts` },
    ],
  },
  test: {
    // prisma/: los datos de la semilla se testean junto a ellos (sin base).
    // scripts/: lo que no necesita base de los scripts (scripts/supabase/).
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // El servidor corre con TZ de Tucumán, pero el código no puede depender de
    // eso (sección 6, "Fechas"): los tests corren en UTC para que se note.
    env: { TZ: "UTC" },
  },
});
