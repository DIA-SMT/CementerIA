import { expect, test } from "@playwright/test";
import { darDeAlta, entrarComo, nuevaSesion } from "./ayudas";

// Métricas de gestión (/panel/metricas, Dirección y admin). No se comparan
// cantidades exactas: las otras pruebas crean expedientes en paralelo sobre la
// misma base (las cuentas exactas están en la integración, con fechas
// conocidas). Sí: que se llega desde la barra y desde el panel, que cada
// sección tiene su gráfico con texto alternativo y su tabla, que un número
// enlazado lleva a la búsqueda equivalente y que el CSV baja.

test("como Dirección, las métricas se abren desde el panel y la barra, se enlazan a la búsqueda y se exportan", async ({ page }) => {
  await entrarComo(page, "direccion");

  // Desde el panel.
  await page.getByRole("link", { name: "Métricas de gestión" }).first().click();
  await expect(page).toHaveURL(/\/panel\/metricas$/);
  await expect(page.getByRole("heading", { level: 1, name: "Métricas de gestión" })).toBeVisible();
  // En la barra lateral, "Métricas" es el ítem actual.
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Métricas" })).toHaveAttribute("aria-current", "page");

  // Las secciones, cada una con su título; los gráficos con texto alternativo y sus tablas.
  for (const titulo of [
    "Resumen",
    "Tiempo de punta a punta de los concluidos",
    "Tiempo por paso y área",
    "Flujo por mes",
    "Tiempo hasta confirmar la recepción",
    "Plazo DIM (30 días hábiles)",
    "Devoluciones",
    "Carga por área",
    "Antes y con el sistema (línea de base)",
    "Papel",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name: titulo, exact: true })).toBeVisible();
  }
  const pasos = page.getByRole("region", { name: "Tiempo por paso y área" });
  await expect(pasos.getByRole("img", { name: /^Mediana de días hábiles en cada paso/ })).toBeVisible();
  await expect(pasos.getByRole("table", { name: "Tiempo en cada paso y área, en días hábiles" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Flujo por mes" }).getByRole("img")).toHaveCount(2);

  // "Hoy" en Mesa de Entradas (la semilla tiene expedientes ahí, ninguno de carga histórica
  // terminada) lleva a la búsqueda equivalente: esa área, en trámite o en espera de pago.
  const carga = page.getByRole("table", { name: "Carga por área" });
  await carga.getByRole("link", { name: /en trámite en Mesa de Entradas: ver en la búsqueda$/ }).click();
  await expect(page).toHaveURL(/\/expedientes\?estado=en_tramite&estado=espera_pago_dim&area=\d+&historica=0$/);
  await expect(page.getByLabel("Área actual").locator("option:checked")).toHaveText("Mesa de Entradas");
  await expect(page.getByRole("table", { name: "Resultados de la búsqueda" }).getByRole("row").nth(1)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Métricas de gestión" })).toBeVisible();

  // CSV de una tabla: attachment para Excel.
  const descarga = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar CSV de Tiempo por paso y área" }).click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toMatch(/^metricas-pasos-\d{4}-\d{2}-\d{2}\.csv$/);

  // Por semana y con la carga histórica: los filtros quedan en la URL.
  await page.getByLabel("Flujo", { exact: true }).selectOption("semana");
  await page.getByLabel("Desde", { exact: true }).fill("2026-09-01");
  await page.getByRole("checkbox", { name: /Contar también los expedientes de carga histórica/ }).check();
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/agrupar=semana/);
  await expect(page).toHaveURL(/historicos=incluir/);
  await expect(page.getByRole("heading", { level: 2, name: "Flujo por semana" })).toBeVisible();
});

test("un ingreso nuevo cuenta en el flujo del mes y su número lleva a la búsqueda", async ({ page, browser }) => {
  const mesa = await nuevaSesion(browser, "mesa");
  const numero = await darDeAlta(mesa.page);
  await mesa.context.close();

  await entrarComo(page, "admin");
  await page.goto("/panel/metricas");
  const flujo = page.getByRole("table", { name: "Flujo por mes" });
  // La última fila es el mes en curso: el alta de recién tiene fecha de inicio hoy.
  const fila = flujo.getByRole("row").last();
  const ingresados = fila.getByRole("cell").first();
  await expect(ingresados).not.toHaveText("0");
  const enlace = ingresados.getByRole("link");
  if ((await enlace.count()) > 0) {
    await enlace.click();
    await expect(page).toHaveURL(/\/expedientes\?.*desde=\d{4}-\d{2}-01/);
    await expect(page.getByRole("link", { name: numero, exact: true })).toBeVisible();
  }
});

test("los operadores no ven las métricas", async ({ page }) => {
  await entrarComo(page, "computo");
  await expect(page.getByRole("link", { name: "Métricas", exact: true })).toHaveCount(0);
  await page.goto("/panel/metricas");
  await expect(page).toHaveURL(/\/bandeja/);
  const r = await page.request.get("/panel/metricas/exportar?tabla=flujo");
  expect(r.status()).toBe(403);
});
