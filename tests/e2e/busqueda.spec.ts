import { expect, test, type Page } from "@playwright/test";
import { conPuntos, darDeAlta, datosAlta, dniUnico, entrarComo, letrasUnicas } from "./ayudas";

// La caja única de búsqueda (2.13(g)), desde el buscador del encabezado:
// DNI con puntos, N° interno en su forma corta y apellido sin acento.

async function buscarDesdeElEncabezado(page: Page, texto: string): Promise<void> {
  const busqueda = page.getByRole("search", { name: "Búsqueda global" });
  await busqueda.getByRole("searchbox", { name: "Buscar expediente" }).fill(texto);
  await busqueda.getByRole("searchbox", { name: "Buscar expediente" }).press("Enter");
}

/**
 * El expediente aparece: o la búsqueda abrió su ficha directo (un número con
 * un solo resultado), o está en la lista de resultados.
 */
async function esperarEncontrado(page: Page, numero: string): Promise<void> {
  const ficha = page.getByRole("heading", { level: 1, name: numero, exact: true });
  const enLista = page.getByRole("table", { name: "Resultados de la búsqueda" }).getByRole("link", { name: numero, exact: true });
  await expect(ficha.or(enLista)).toBeVisible();
}

test("encuentra un expediente por DNI con puntos, por N° interno corto y por apellido sin acento", async ({ page }) => {
  await entrarComo(page, "mesa");
  const unico = letrasUnicas(7);
  const apellido = `PÉREZ ÑANDÚ ${unico}`;
  const dni = dniUnico();
  const numero = await darDeAlta(page, datosAlta({ apellido, dni }));

  // 1. DNI escrito con puntos: un solo resultado, abre la ficha directo.
  await page.goto("/bandeja");
  await buscarDesdeElEncabezado(page, conPuntos(dni));
  await expect(page).toHaveURL(new RegExp(`/expedientes/${numero}$`));
  await expect(page.getByRole("heading", { level: 1, name: numero, exact: true })).toBeVisible();

  // 2. N° interno corto ("31/2026"), como se dice en voz alta.
  const [, anio, secuencia] = /^CEM-(\d{4})-(\d+)$/.exec(numero)!;
  const corto = `${Number(secuencia)}/${anio}`;
  await expect(page.getByText(`(${corto})`)).toBeVisible();
  await page.goto("/bandeja");
  await buscarDesdeElEncabezado(page, corto);
  await esperarEncontrado(page, numero);

  // 3. Apellido en minúsculas y sin acentos ni eñe.
  await page.goto("/bandeja");
  await buscarDesdeElEncabezado(page, `perez nandu ${unico.toLowerCase()}`);
  await expect(page).toHaveURL(/\/expedientes\?q=/);
  const resultados = page.getByRole("table", { name: "Resultados de la búsqueda" });
  const fila = resultados.getByRole("row").filter({ has: page.getByRole("link", { name: numero, exact: true }) });
  await expect(fila).toBeVisible();
  await expect(fila).toContainText(apellido);
  await expect(page.getByText("1 expediente.", { exact: true })).toBeVisible();
});

test("un DNI que no está no encuentra nada", async ({ page }) => {
  await entrarComo(page, "mesa");
  // 8 dígitos que empiezan con 1: fuera del rango de los ficticios (9…).
  await buscarDesdeElEncabezado(page, conPuntos(`1${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`));
  await expect(page.getByText("No se encontraron expedientes con esos datos.")).toBeVisible();
});
