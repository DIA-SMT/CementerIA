import { expect, test, type Page } from "@playwright/test";
import { USUARIO_MODO_PRUEBA } from "./ayudas";

// Modo prueba, "Ver como…" (docs/diseno.md, "Modo prueba"): el administrador
// de prueba (su CUIL ficticio es el de PERFILES_PRUEBA_CUILS de la app de las
// pruebas, ver global-setup.ts) pasa a Liquidación, ve la bandeja de
// Liquidación con la franja y vuelve a Administrador. Las pruebas de este
// archivo van en orden y en un mismo worker; cada una deja al usuario como
// Administrador.

const NOMBRE = `${USUARIO_MODO_PRUEBA.apellido}, ${USUARIO_MODO_PRUEBA.nombre}`;

function selector(page: Page) {
  return page.getByRole("button", { name: /^Ver como…/ });
}

function franja(page: Page) {
  return page.getByRole("region", { name: "Modo prueba" });
}

/** Entra por /dev/login como el admin de prueba; si quedó en otro perfil (una prueba anterior que falló), vuelve a Administrador. */
async function entrarComoAdminDePrueba(page: Page): Promise<void> {
  await page.goto("/dev/login");
  await page.getByRole("listitem").filter({ hasText: NOMBRE }).getByRole("button", { name: "Entrar como…" }).click();
  await expect(page).toHaveURL(/\/(panel|bandeja)/);
  if (await franja(page).isVisible()) {
    await franja(page).getByRole("button", { name: "Volver a Administrador" }).click();
    await expect(page).toHaveURL(/\/panel/);
  }
  await expect(franja(page)).toHaveCount(0);
}

test("el admin de prueba elige «Ver como Liquidación», ve la bandeja de Liquidación con la franja y vuelve a Administrador", async ({ page }) => {
  await entrarComoAdminDePrueba(page);
  await expect(page.getByRole("link", { name: "Administración", exact: true }).first()).toBeAttached();

  // El menú: aria-expanded, el perfil actual marcado y con el foco, Escape lo cierra.
  const boton = selector(page);
  await expect(boton).toHaveAccessibleName("Ver como… (modo prueba, ahora Administrador)");
  await expect(boton).toHaveAttribute("aria-expanded", "false");
  await boton.click();
  await expect(boton).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: "Ver como…" });
  await expect(menu).toBeVisible();
  const admin = menu.getByRole("menuitemradio", { name: /^Administrador/ });
  await expect(admin).toHaveAttribute("aria-checked", "true");
  await expect(admin).toBeFocused();
  await expect(menu.getByRole("menuitemradio", { name: /^Liquidación/ })).toHaveAttribute("aria-checked", "false");
  await expect(menu.getByRole("menuitemradio", { name: /^Dirección.*Solo lectura/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(boton).toBeFocused();
  await expect(boton).toHaveAttribute("aria-expanded", "false");

  // Con el teclado: ↓ abre en el actual, Inicio va al primero, ↓ ↓ hasta Liquidación, Enter elige.
  await page.keyboard.press("ArrowDown");
  await expect(admin).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitemradio", { name: /^Mesa de Entradas/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: /^Liquidación/ })).toBeFocused();
  await page.keyboard.press("Enter");

  // La bandeja de Liquidación, con la franja, el contador "Por confirmar" y la campana.
  await expect(page).toHaveURL(/\/bandeja/);
  const titulo = page.getByRole("heading", { level: 1, name: /Bandeja/ });
  await expect(titulo).toBeVisible();
  await expect(page.locator("#titulo-bandeja").locator("..")).toContainText("Liquidación");
  await expect(franja(page)).toContainText("Modo prueba: estás viendo como Liquidación");
  await expect(page.locator("header").getByRole("link", { name: /^Por confirmar/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Avisos,/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Administración", exact: true })).toHaveCount(0);
  await expect(selector(page)).toHaveAccessibleName("Ver como… (modo prueba, ahora Liquidación)");

  // No sale al imprimir.
  await page.emulateMedia({ media: "print" });
  await expect(franja(page)).toBeHidden();
  await expect(selector(page)).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(franja(page)).toBeVisible();

  // Como Administración no entra: lo manda a su inicio.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/bandeja/);

  // Volver a Administrador desde la franja.
  await franja(page).getByRole("button", { name: "Volver a Administrador" }).click();
  await expect(page).toHaveURL(/\/panel/);
  await expect(franja(page)).toHaveCount(0);
  await expect(page.locator("header").getByRole("link", { name: /^Por confirmar/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administración", exact: true }).first()).toBeAttached();
  await expect(selector(page)).toHaveAccessibleName("Ver como… (modo prueba, ahora Administrador)");
});

test("en el celular el selector entra en el encabezado compacto (una fila, sin desplazamiento lateral)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await entrarComoAdminDePrueba(page);

  await selector(page).click();
  const menu = page.getByRole("menu", { name: "Ver como…" });
  await menu.getByRole("menuitemradio", { name: /^Liquidación/ }).click();
  await expect(page).toHaveURL(/\/bandeja/);
  await expect(franja(page)).toBeVisible();

  // Una sola fila con el buscador, "Por confirmar", el selector, el "?", la campana, la llave y Salir.
  for (const control of [
    page.getByRole("button", { name: "Buscador" }),
    page.locator("header").getByRole("link", { name: /^Por confirmar/ }),
    selector(page),
    page.getByRole("button", { name: "Recorrido de esta pantalla" }),
    page.getByRole("button", { name: /^Avisos,/ }),
    page.getByRole("button", { name: "Salir" }),
  ]) {
    await expect(control).toBeInViewport();
  }
  const alto = await page.locator("header").first().evaluate((el) => el.getBoundingClientRect().height);
  expect(alto).toBeLessThan(70);
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(ancho).toBeLessThanOrEqual(390);

  // El menú se abre debajo del encabezado, dentro de la pantalla.
  await selector(page).click();
  await expect(menu).toBeInViewport();
  const caja = (await menu.boundingBox())!;
  expect(caja.x).toBeGreaterThanOrEqual(0);
  expect(caja.x + caja.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");

  await franja(page).getByRole("button", { name: "Volver a Administrador" }).click();
  await expect(page).toHaveURL(/\/panel/);
  await expect(franja(page)).toHaveCount(0);
});
