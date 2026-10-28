import { expect, test, type Page } from "@playwright/test";
import { entrarComo } from "./ayudas";

// La página pública y la consulta del trámite (28/10/2026; docs/api-dominio.md,
// sección 24): el inicio sin sesión (que lleva a /consulta), la redirección de
// siempre con sesión, la consulta con un código de la semilla (los del README:
// secuencias 1, 52 y 58, con códigos fijos de prisma/semilla vía
// codigoDeSemilla), el mismo mensaje ante cualquier error,
// /consulta/NUMERO#CODIGO que se completa solo, el comprobante con su código y
// su QR, y /consulta en 375 px sin scroll horizontal.
//
// No regeneran ningún código de la semilla (otras pruebas los usan) y fallan
// a propósito muy pocas veces: todas las pruebas comparten la IP (sin nginx
// delante, sin IP), y el límite es de 10 fallidos cada 15 minutos.

/** El año de la numeración: el de hoy en Tucumán (la semilla corre hoy). */
const ANIO = new Intl.DateTimeFormat("en", { timeZone: "America/Argentina/Tucuman", year: "numeric" }).format(new Date());
const numero = (secuencia: number): string => `CEM-${ANIO}-${String(secuencia).padStart(5, "0")}`;

async function consultar(page: Page, numeroEscrito: string, codigo: string): Promise<void> {
  const form = page.getByRole("main");
  await form.getByRole("textbox", { name: "Número de expediente" }).fill(numeroEscrito);
  await form.getByRole("textbox", { name: "Código de consulta" }).fill(codigo);
  await form.getByRole("button", { name: "Consultar" }).click();
}

test("sin sesión, / es el inicio público: un solo h1, la banda que lleva a /consulta y el ingreso del personal", async ({ page }) => {
  const respuesta = await page.goto("/");
  expect(respuesta?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  // 28/10/2026: el sitio de los cementerios, una página por sección (tests/e2e/sitio-publico.spec.ts
  // prueba el contenido; acá, solo lo que está siempre, con o sin contenido cargado: ese archivo
  // vacía el sitio un rato).
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Cementerios de San Miguel de Tucumán" })).toBeVisible();
  // El formulario ya no está en el inicio: la banda y el acceso destacado llevan a /consulta.
  await expect(page.getByRole("form", { name: "Datos del comprobante" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Consultá tu trámite" }).getByRole("link", { name: "Consultar mi trámite" })).toHaveAttribute("href", "/consulta");
  await expect(page.getByRole("contentinfo")).toContainText("Desarrollado por la Dirección de Inteligencia Artificial");

  // [C] Sin indexar mientras la Dirección no apruebe la publicación.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // Los trámites salen de la base (plantillas publicadas); los cementerios, del catálogo.
  await page.goto("/tramites");
  await expect(page.getByRole("heading", { level: 2, name: "Renovación de concesión" })).toBeVisible();
  await expect(page.getByText("Fotocopia del DNI").first()).toBeVisible();
  await page.goto("/cementerios");
  for (const c of ["Cementerio del Oeste", "Cementerio del Norte", "Cementerio Jardín Norte"]) await expect(page.getByRole("heading", { level: 2, name: c })).toBeVisible();

  await page.getByRole("banner").getByRole("link", { name: "Ingreso del personal" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("con sesión, / lleva al inicio de cada uno, como antes", async ({ browser }) => {
  for (const [quien, inicio] of [
    ["mesa", /\/bandeja$/],
    ["direccion", /\/panel$/],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await entrarComo(page, quien);
    await page.goto("/");
    await expect(page).toHaveURL(inicio);
    await context.close();
  }
});

test("consulta correcta con un código de la semilla (llegando desde el inicio y abriendo /consulta): solo lo público", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Consultar mi trámite" }).click();
  await expect(page).toHaveURL(/\/consulta$/);
  await expect(page.getByRole("heading", { level: 1, name: "Consultá tu trámite" })).toBeVisible();
  // La forma corta y el código en minúsculas, con guion: también sirven.
  await consultar(page, `1/${ANIO}`, "prve-8a01");
  const resultado = page.locator("[data-resultado-consulta]");
  await expect(resultado).toBeVisible();
  await expect(resultado.getByRole("heading", { name: `Trámite ${numero(1)}` })).toBeVisible();
  await expect(resultado).toContainText("En trámite");
  await expect(resultado).toContainText("Mesa de Entradas");
  await expect(resultado).toContainText(/Paso 1 de \d+/);
  await expect(resultado).toContainText("Información orientativa: el expediente oficial es el de papel.");
  // Nada de las personas, la ubicación ni las observaciones.
  await expect(resultado).not.toContainText(/DNI|Ficticio|Sección|Lote|Titular/);

  // El concluido (K1 · 00058), en lenguaje del ciudadano.
  await page.goto("/consulta");
  await consultar(page, numero(58), "PRVE8A58");
  await expect(page.locator("[data-estado-ciudadano]")).toHaveText("Finalizado: acercate a Mesa de Entradas");
  // El número y el código nunca quedan en la URL.
  expect(page.url()).not.toMatch(/PRVE|codigo=|numero=/i);
});

test("consulta incorrecta: el mismo mensaje para un código equivocado y un número que no existe; y sin caché ni Referer", async ({ page }) => {
  const respuesta = await page.goto("/consulta");
  expect(respuesta?.headers()["cache-control"]).toContain("no-store");
  expect(respuesta?.headers()["referrer-policy"]).toBe("no-referrer");

  await consultar(page, numero(2), "ZZZZ-ZZZZ");
  const error = page.getByRole("main").getByRole("alert");
  await expect(error).toHaveText("No encontramos un trámite con ese número y código");
  await expect(page.locator("[data-resultado-consulta]")).toHaveCount(0);

  await consultar(page, `CEM-${ANIO}-99999`, "PRVE8A01");
  await expect(error).toHaveText("No encontramos un trámite con ese número y código");
});

test("/consulta/NUMERO#CODIGO (el QR del comprobante) completa el código, lo saca de la barra y consulta solo", async ({ page }) => {
  await page.goto(`/consulta/${numero(52)}#prve-8a52`);
  await expect(page.getByRole("textbox", { name: "Número de expediente" })).toHaveValue(numero(52));
  await expect(page.getByRole("textbox", { name: "Código de consulta" })).toHaveValue("PRVE8A52");
  await expect(page.locator("[data-estado-ciudadano]")).toHaveText("Esperando el pago en la DIM");
  await expect(page.locator("[data-resultado-consulta]")).toContainText("Dirección de Ingresos Municipales (DIM)");
  expect(new URL(page.url()).hash).toBe("");
});

test("el comprobante para el concesionario muestra el código y el QR, y se ofrece desde la ficha", async ({ page }) => {
  await entrarComo(page, "mesa");
  await page.goto(`/expedientes/${numero(1)}`);
  await expect(page.locator("[data-codigo-consulta]")).toHaveText("PRVE-8A01");
  await page.getByRole("link", { name: "Imprimir comprobante" }).click();
  await expect(page).toHaveURL(/\/imprimir\?hoja=comprobante$/);
  const hoja = page.getByRole("article", { name: `Comprobante del expediente ${numero(1)}` });
  await expect(hoja).toBeVisible();
  await expect(hoja.locator("[data-codigo-comprobante]")).toHaveText("PRVE-8A01");
  await expect(hoja.getByRole("img", { name: `Código QR para consultar el trámite ${numero(1)}` })).toBeVisible();
  await expect(hoja).toContainText("/consulta");
  await expect(hoja).toContainText("Cementerio");
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
});

test("en 375 px la consulta no tiene scroll horizontal (tampoco con un resultado)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const desborde = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto("/consulta");
  expect(await desborde()).toBeLessThanOrEqual(0);
  await consultar(page, numero(1), "PRVE8A01");
  await expect(page.locator("[data-resultado-consulta]")).toBeVisible();
  expect(await desborde()).toBeLessThanOrEqual(0);
});
