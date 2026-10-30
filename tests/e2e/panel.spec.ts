import { expect, test } from "@playwright/test";
import { darDeAlta, entrarComo, nuevaSesion } from "./ayudas";

// Panel de Dirección (sección 5, `/panel`): cada número lleva a la búsqueda
// con el filtro equivalente. No se comparan cantidades exactas: las otras
// pruebas crean expedientes en paralelo sobre la misma base. Sí se busca el
// expediente que crea esta prueba: la búsqueda ordena del más nuevo al más
// viejo y trae 50, y en una corrida no se crean 50 después de él.

test("como Dirección, un número del panel lleva a la búsqueda filtrada", async ({ page, browser }) => {
  // Un expediente en Mesa de Entradas, para que la celda Mesa × Renovación tenga al menos uno propio.
  const mesa = await nuevaSesion(browser, "mesa");
  const numero = await darDeAlta(mesa.page);
  await mesa.context.close();

  await entrarComo(page, "direccion");
  await expect(page.getByRole("heading", { level: 1, name: "Panel" })).toBeVisible();

  // 1. El conteo "En trámite" → /expedientes con estado=en_tramite.
  const estados = page.getByRole("region", { name: /^Expedientes por estado/ });
  const enTramite = estados.getByRole("link", { name: /En trámite\s*[\d.]+\s*expedientes: ver en la búsqueda/ });
  const cantidad = Number(((await enTramite.textContent()) ?? "").replace(/\D/g, ""));
  expect(cantidad).toBeGreaterThan(0);
  await enTramite.click();
  await expect(page).toHaveURL(/\/expedientes\?(.*&)?estado=en_tramite(&|$)/);
  await expect(page.getByRole("heading", { level: 1, name: "Buscar expedientes" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "En trámite", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Archivado", exact: true })).not.toBeChecked();
  const resultados = page.getByRole("table", { name: "Resultados de la búsqueda" });
  await expect(resultados.getByRole("row").nth(1)).toBeVisible();
  await expect(resultados.getByRole("link", { name: numero, exact: true })).toBeVisible();
  // Todo lo que trae está en trámite.
  for (const otro of ["Concluido", "Archivado", "Anulado"]) {
    await expect(resultados.getByRole("cell", { name: new RegExp(`^${otro}`) })).toHaveCount(0);
  }

  // 2. Una celda de la matriz (Mesa de Entradas × Renovación de concesión) → área y tipo de trámite.
  await page.goto("/panel");
  const matriz = page.getByRole("region", { name: "En trámite por área y tipo de trámite" });
  await matriz.getByRole("link", { name: /en Mesa de Entradas, Renovación de concesión: ver en la búsqueda$/ }).click();
  await expect(page).toHaveURL(/\/expedientes\?.*area=\d+/);
  await expect(page).toHaveURL(/tramite=\d+/);
  await expect(page.getByLabel("Área actual").locator("option:checked")).toHaveText("Mesa de Entradas");
  await expect(page.getByLabel("Tipo de trámite").locator("option:checked")).toHaveText("Renovación de concesión");
  const filas = page.getByRole("table", { name: "Resultados de la búsqueda" }).getByRole("row");
  await expect(filas.nth(1)).toBeVisible();
  // Cada resultado está en Mesa de Entradas y es una renovación.
  const cuerpo = filas.filter({ has: page.getByRole("cell") });
  const total = await cuerpo.count();
  for (let i = 0; i < total; i++) {
    await expect(cuerpo.nth(i)).toContainText("Mesa de Entradas");
    await expect(cuerpo.nth(i)).toContainText("Renovación");
  }
  // El que se acaba de crear está, y su ficha se abre desde ahí.
  await page.getByRole("link", { name: numero, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: numero })).toBeVisible();
});

test("como Dirección, el panel arranca con el banner de bienvenida: saludo, fecha, los accesos del rol y ninguna cifra inventada", async ({ page }) => {
  await entrarComo(page, "direccion");
  // El logo oficial va en la barra lateral (sobre el azul institucional), con su alt.
  await expect(page.getByRole("img", { name: "Ciudad San Miguel de Tucumán" })).toBeVisible();

  const banner = page.locator("[data-banner-bienvenida]");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Hola, Prueba");
  await expect(banner).toContainText("Dirección de Cementerios");
  await expect(banner.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  // La foto del kit es la imagen principal de la pantalla.
  const foto = banner.locator("img");
  await expect(foto).toHaveAttribute("fetchpriority", "high");
  await expect(foto).toHaveAttribute("src", /\/assets\/cementeria\/hero-dashboard/);
  // Fuera de la fecha, el banner no muestra números: las cifras del panel son las del dominio, abajo.
  expect(
    await banner.evaluate((b) => {
      const copia = b.cloneNode(true) as HTMLElement;
      copia.querySelectorAll("time").forEach((t) => t.remove());
      return /\d/.test(copia.textContent ?? "");
    }),
  ).toBe(false);
  // Los accesos son los módulos del menú del rol, menos el panel: ni uno más.
  const accesos = await banner.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const menu = await page.getByRole("navigation", { name: "Principal" }).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(accesos.length).toBeGreaterThan(0);
  expect(accesos).toEqual(menu.filter((href) => href !== "/panel"));
  // Los conteos por estado siguen llevando a la búsqueda.
  await expect(page.getByRole("region", { name: /^Expedientes por estado/ }).getByRole("link").first()).toHaveAttribute("href", /\/expedientes/);
});
