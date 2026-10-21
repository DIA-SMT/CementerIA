import { expect, test } from "@playwright/test";
import { dialogo, entrarComo, letrasUnicas } from "./ayudas";

// Administración de plantillas (semana 5, `/admin/plantillas`): una plantilla
// nueva con código único nace como borrador v1, "Validar" muestra cada error
// en su pestaña y el borrador se descarta. No se publica nada, así que no
// cambia lo que ven las otras pruebas (las altas siguen con las de la semilla).

test("el admin crea un borrador de plantilla, ve un error de validación en su pestaña y lo descarta", async ({ page }) => {
  const codigo = `E2E_${letrasUnicas(8)}`;
  await entrarComo(page, "admin");
  await page.goto("/admin/plantillas");
  await expect(page.getByRole("heading", { level: 1, name: "Plantillas de trámite" })).toBeVisible();

  // Nueva plantilla.
  await page.getByRole("button", { name: "Nueva plantilla" }).click();
  const nueva = dialogo(page, "Nueva plantilla");
  const campoCodigo = nueva.getByRole("textbox", { name: "Código" });
  await expect(campoCodigo).toBeFocused();
  await campoCodigo.fill(codigo);
  await nueva.getByLabel("Tipo de trámite").selectOption({ label: "Renovación de concesión" });
  await nueva.getByRole("textbox", { name: "Nombre" }).fill("Plantilla de prueba e2e (se descarta)");
  await nueva.getByRole("button", { name: "Crear borrador" }).click();

  // El editor del borrador v1.
  await expect(page).toHaveURL(new RegExp(`/admin/plantillas/${codigo}/v/1$`));
  const acciones = page.getByRole("toolbar", { name: "Acciones del borrador" });
  await expect(acciones).toContainText("Todo guardado");

  // Validar: la plantilla nueva no tiene pasos.
  await acciones.getByRole("button", { name: "Validar" }).click();
  const errores = page.getByRole("navigation", { name: "Errores de la validación" });
  await expect(errores).toBeVisible();
  await expect(errores).toContainText(/\d+ (error|errores) para corregir antes de publicar/);

  // La pestaña Pasos dice cuántos errores tiene, y el error de la lista lleva a ella.
  const pestanas = page.getByRole("tablist", { name: "Partes de la plantilla" });
  const pasos = pestanas.getByRole("tab", { name: /^Pasos\s*\d+\s*errore?s?$/ });
  await expect(pasos).toBeVisible();
  await expect(pasos).toHaveAttribute("aria-selected", "false");
  const errorDePasos = errores.getByRole("button", { name: /^Pasos · / }).first();
  const mensaje = ((await errorDePasos.textContent()) ?? "").split(": ").slice(1).join(": ").trim();
  expect(mensaje).not.toBe("");
  await errorDePasos.click();
  await expect(pasos).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: /^Pasos/ });
  await expect(panel).toContainText(mensaje);

  // Descartar el borrador (con confirmación): vuelve al catálogo y el código ya no está.
  await acciones.getByRole("button", { name: "Descartar borrador…" }).click();
  const descartar = dialogo(page, `Descartar el borrador ${codigo} v1`);
  await expect(descartar.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await descartar.getByRole("button", { name: "Descartar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/plantillas$/);
  await expect(page.getByRole("heading", { level: 1, name: "Plantillas de trámite" })).toBeVisible();
  const catalogo = page.getByRole("table", { name: "Plantillas por código" });
  await expect(catalogo.getByRole("rowheader", { name: "RENOV_CONTADO" })).toBeVisible();
  await expect(catalogo.getByRole("rowheader", { name: codigo })).toHaveCount(0);
});
