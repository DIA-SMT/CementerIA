import { expect, test } from "@playwright/test";
import { abrirAltaRenovacionOeste, completarAlta, datosAlta, entrarComo, grupoTitular } from "./ayudas";

// Alta completa desde Mesa de Entradas (sección 5, `/expedientes/nuevo`):
// renovación de contado en el Oeste, un error de campo antes de guardar y
// "Guardar e imprimir carátula", que lleva a la carátula con número y QR.

test("Mesa de Entradas da de alta una renovación de contado en el Oeste y la carátula sale con número y QR", async ({ page }) => {
  await entrarComo(page, "mesa");
  await abrirAltaRenovacionOeste(page);

  const d = datosAlta({ documentos: ["Fotocopia del DNI"] });
  // Primero con una sección que no existe en el Oeste (va de la A a la H).
  await completarAlta(page, { ...d, seccion: "Z" });
  await page.getByRole("button", { name: "Guardar e imprimir carátula" }).click();

  const resumen = page.getByRole("alert").filter({ hasText: "Revisá los datos marcados" });
  await expect(resumen).toBeVisible();
  await expect(resumen).toBeFocused();
  const seccion = page.getByRole("textbox", { name: "Sección", exact: true });
  await expect(seccion).toHaveAttribute("aria-invalid", "true");
  await expect(seccion).toHaveAccessibleDescription(/Sección: el formato no es válido \(una letra de la A a la H\)/);
  // El resumen lleva al campo.
  await resumen.getByRole("link", { name: /Sección: el formato no es válido/ }).click();
  await expect(seccion).toBeFocused();
  // Nada se guardó: seguimos en el alta.
  await expect(page).toHaveURL(/\/expedientes\/nuevo/);

  // Corregido, el error se va del campo.
  await seccion.fill("c");
  await expect(seccion).not.toHaveAttribute("aria-invalid", "true");
  await expect(grupoTitular(page).getByRole("textbox", { name: "Apellido", exact: true })).toHaveValue(d.apellido);

  await page.getByRole("button", { name: "Guardar e imprimir carátula" }).click();

  // La carátula: número interno grande, N° municipal, titular y el QR que lleva a la ficha.
  await expect(page).toHaveURL(/\/expedientes\/CEM-\d{4}-\d{5,6}\/imprimir/);
  const carátula = page.getByRole("article", { name: /^Carátula del expediente CEM-\d{4}-\d{5,6}$/ });
  await expect(carátula).toBeVisible();
  const numero = ((await carátula.getByRole("heading", { level: 1 }).textContent()) ?? "").trim();
  expect(numero).toMatch(/^CEM-\d{4}-\d{5,6}$/);
  await expect(carátula.getByRole("img", { name: `Código QR de la ficha del expediente ${numero}` })).toBeVisible();
  await expect(carátula).toContainText(`N° municipal: ${d.numeroMunicipal}`);
  await expect(carátula).toContainText(d.apellido);
  await expect(carátula).toContainText("Cementerio del Oeste");
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();

  // Y la ficha existe, en el primer paso, con la sección normalizada.
  await page.goto(`/expedientes/${numero}`);
  await expect(page.getByRole("heading", { level: 1, name: numero })).toBeVisible();
  await expect(page.getByText("Sección C · Lote")).toBeVisible();
});
