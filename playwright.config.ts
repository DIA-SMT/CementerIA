import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de punta a punta (docs/propuesta-mvp.md, sección 6, "Tests"):
 * `npm run test:e2e`. Ver tests/e2e/README.md.
 *
 * No hay `webServer`: el globalSetup (tests/e2e/global-setup.ts) levanta un
 * PostgreSQL efímero con la semilla, hace `next build` y arranca `next start`
 * en un puerto libre, y deja la URL en E2E_BASE_URL. Este archivo se vuelve a
 * evaluar en cada worker, que nace después del globalSetup y hereda la
 * variable: así `baseURL` llega a las pruebas. Nunca usa el puerto 3000 ni la
 * base de desarrollo.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Cada prueba crea lo que necesita (expedientes nuevos, una plantilla con
  // código único) y no mira conteos globales: pueden correr en paralelo sobre
  // la misma base. Las de un mismo archivo van en orden, en un worker.
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: Boolean(process.env.CI),
  // Sin reintentos: una prueba que falla a veces es un defecto que hay que ver.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    locale: "es-AR",
    // La hora del navegador, como la de las personas que usan el sistema.
    timezoneId: "America/Argentina/Tucuman",
    // Que una acción que no encuentra su control falle pronto, con el detalle.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], locale: "es-AR", timezoneId: "America/Argentina/Tucuman" },
    },
  ],
});
