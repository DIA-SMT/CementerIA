import { expect, test, type Locator, type Page } from "@playwright/test";
import { accion, darDeAlta, dialogo, entrarComo } from "./ayudas";

// Los diálogos (src/components/dialogo.tsx, <dialog> nativo con showModal):
// al abrirse el foco entra al diálogo, Escape lo cierra y el foco vuelve al
// botón que lo abrió.

async function abrirYCerrarConEscape(page: Page, boton: Locator, nombre: string | RegExp): Promise<void> {
  await boton.click();
  const d = dialogo(page, nombre);
  await expect(d).toBeVisible();
  // El foco está adentro del diálogo.
  await expect.poll(() => d.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(d).toBeHidden();
  await expect(boton).toBeFocused();
}

test("los diálogos de la ficha se cierran con Escape y devuelven el foco", async ({ page }) => {
  await entrarComo(page, "mesa");
  await darDeAlta(page);

  await abrirYCerrarConEscape(page, page.getByRole("button", { name: "Dar pase · Faltan 4" }), "Faltan 4 cosas para avanzar");
  await abrirYCerrarConEscape(page, page.getByRole("button", { name: accion("Tildar", "Carátula impresa y agregada al expediente") }), "Tildar subtarea");
  await abrirYCerrarConEscape(page, page.getByRole("button", { name: accion("Marcar", "Fotocopia del DNI") }), "Documento");
  await abrirYCerrarConEscape(page, page.getByRole("button", { name: "Agregar nota" }), "Agregar nota");

  // Cerrar con Escape no hizo nada: sigue faltando lo mismo.
  await expect(page.getByRole("button", { name: "Dar pase · Faltan 4" })).toBeVisible();
});

test("el diálogo de «Nueva plantilla» de administración también", async ({ page }) => {
  await entrarComo(page, "admin");
  await page.goto("/admin/plantillas");
  await abrirYCerrarConEscape(page, page.getByRole("button", { name: "Nueva plantilla" }), "Nueva plantilla");
});
