import { expect, test } from "@playwright/test";
import { abrirFicha, accion, darDeAlta, dialogo, entrarComo, esperarAviso, nuevaSesion } from "./ayudas";

// Bloqueo optimista (3.3, punto 3): cada acción manda la versión que vio la
// persona. Dos sesiones del mismo área abren el mismo expediente; la primera
// tilda y la segunda, con la ficha vieja, recibe el aviso y puede recargar.

test("la segunda sesión sobre el mismo expediente recibe «Otro usuario modificó el expediente; recargá»", async ({ page, browser }) => {
  await entrarComo(page, "mesa");
  const numero = await darDeAlta(page);

  // La otra persona de Mesa de Entradas abre la misma ficha (misma versión).
  const otra = await nuevaSesion(browser, "mesa");
  await abrirFicha(otra.page, numero);
  await expect(otra.page.getByRole("button", { name: accion("Marcar", "Fotocopia del DNI") })).toBeVisible();

  // La primera tilda la carátula: la versión sube.
  await page.getByRole("button", { name: accion("Tildar", "Carátula impresa y agregada al expediente") }).click();
  const tildar = dialogo(page, "Tildar subtarea");
  await tildar.getByRole("button", { name: "Tildar", exact: true }).click();
  await expect(tildar).toBeHidden();
  await esperarAviso(page, /./);
  await expect(page.getByRole("button", { name: accion("Destildar", "Carátula impresa y agregada al expediente") })).toBeVisible();

  // La segunda, con la ficha vieja, marca un documento y el dominio lo rechaza.
  await otra.page.getByRole("button", { name: accion("Marcar", "Fotocopia del DNI") }).click();
  const documento = dialogo(otra.page, "Documento");
  await documento.getByRole("radio", { name: "Presentado" }).check();
  await documento.getByRole("button", { name: "Guardar", exact: true }).click();
  const aviso = documento.getByRole("alert");
  await expect(aviso).toContainText("Otro usuario modificó el expediente; recargá");
  // El diálogo sigue abierto (no se perdió lo elegido) y ofrece recargar.
  await expect(documento).toBeVisible();
  await aviso.getByRole("link", { name: "Recargar la página" }).click();

  // Con la ficha al día, ve lo que hizo la otra sesión y su acción sale.
  await expect(otra.page.getByRole("button", { name: accion("Destildar", "Carátula impresa y agregada al expediente") })).toBeVisible();
  await otra.page.getByRole("button", { name: accion("Marcar", "Fotocopia del DNI") }).click();
  const deNuevo = dialogo(otra.page, "Documento");
  await deNuevo.getByRole("radio", { name: "Presentado" }).check();
  await deNuevo.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(deNuevo).toBeHidden();
  const documentacion = otra.page.getByRole("region", { name: "Documentación" });
  await expect(documentacion.getByRole("listitem").filter({ hasText: "Fotocopia del DNI" })).toContainText("Presentado");

  await otra.context.close();
});
