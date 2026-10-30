import { expect, test, type Page } from "@playwright/test";
import { CLAVE_DESARROLLO, USUARIOS_FICTICIOS } from "../../prisma/semilla/usuarios";
import { dialogo, entrarComo, letrasUnicas } from "./ayudas";

// Login propio (27/10/2026): el formulario real de /login (no /dev/login), el
// cambio obligatorio de la contraseña temporal y el mensaje único de error.

/** Un CUIL ficticio válido (prefijo 20, DNI 9x.xxx.xxx, dígito verificador correcto). */
function cuilFicticio(): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `209${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
    const resto = 11 - (pesos.reduce((a, p, i) => a + p * Number(base[i]), 0) % 11);
    if (resto === 10) continue;
    return `${base}${resto === 11 ? 0 : resto}`;
  }
}

const MENSAJE = "CUIL, correo o contraseña incorrectos";

/** El aviso del formulario (Next agrega otro role=alert, el anunciador de rutas). */
function errorDelIngreso(page: Page) {
  return page.getByRole("alert").filter({ hasText: MENSAJE });
}

async function ingresar(page: Page, identificador: string, clave: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("CUIL o correo").fill(identificador);
  await page.getByLabel("Contraseña", { exact: true }).fill(clave);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
}

test("un usuario nuevo entra por el formulario con su contraseña temporal, la tiene que cambiar y llega a la bandeja", async ({ page, browser }) => {
  // El admin lo da de alta y ve la contraseña temporal una sola vez.
  const cuil = cuilFicticio();
  const apellido = `Ficticio ${letrasUnicas(5)}`;
  await entrarComo(page, "admin");
  await page.goto("/admin/usuarios");
  await page.getByRole("button", { name: "Alta de usuario" }).click();
  const alta = dialogo(page, "Alta de usuario");
  await alta.getByRole("textbox", { name: "CUIL" }).fill(`${cuil.slice(0, 2)}-${cuil.slice(2, 10)}-${cuil.slice(10)}`);
  await alta.getByRole("textbox", { name: "Apellido" }).fill(apellido);
  await alta.getByRole("textbox", { name: "Nombre" }).fill("Prueba");
  await alta.getByLabel("Área").selectOption({ label: "Mesa de Entradas" });
  await alta.getByRole("button", { name: "Dar de alta" }).click();

  const mostrada = dialogo(page, `Contraseña temporal de Prueba ${apellido}`);
  await expect(mostrada).toContainText("no se vuelve a mostrar");
  const temporal = ((await mostrada.locator("[data-clave-temporal]").textContent()) ?? "").trim();
  expect(temporal).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  await mostrada.getByRole("button", { name: "Listo, ya la copié" }).click();
  await expect(mostrada).toHaveCount(0);

  // La persona, en otra computadora (sin las cookies del admin).
  const context = await browser.newContext();
  const otra = await context.newPage();
  try {
    await ingresar(otra, `${cuil.slice(0, 2)}-${cuil.slice(2, 10)}-${cuil.slice(10)}`, temporal);
    await expect(otra).toHaveURL(/\/cambiar-clave$/);
    await expect(otra.getByRole("heading", { name: "Cambiar contraseña" })).toBeVisible();
    await expect(otra.getByText("Tu contraseña es temporal")).toBeVisible();

    // No puede usar otra pantalla hasta cambiarla.
    await otra.goto("/bandeja");
    await expect(otra).toHaveURL(/\/cambiar-clave$/);

    // La política se muestra, y una nueva que no la cumple se rechaza junto al campo.
    await expect(otra.getByText("La contraseña nueva tiene que cumplir:")).toBeVisible();
    await otra.getByLabel(/^Contraseña temporal/).fill(temporal);
    await otra.getByLabel(/^Contraseña nueva/).fill("Password2026!");
    await otra.getByLabel(/^Repetí la contraseña nueva/).fill("Password2026!");
    await otra.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(otra.getByText(/Es una clave común/)).toBeVisible();

    const nueva = `el mate de la tarde ${letrasUnicas(4).toLowerCase()}`;
    await otra.getByLabel(/^Contraseña temporal/).fill(temporal);
    await otra.getByLabel(/^Contraseña nueva/).fill(nueva);
    await otra.getByLabel(/^Repetí la contraseña nueva/).fill(nueva);
    await otra.getByLabel("Mostrar las contraseñas").check();
    await expect(otra.getByLabel(/^Contraseña nueva/)).toHaveAttribute("type", "text");
    await otra.getByRole("button", { name: "Cambiar contraseña" }).click();

    // Llega a su bandeja, ya con la contraseña propia.
    await expect(otra).toHaveURL(/\/bandeja/);
    await expect(otra.getByRole("heading", { level: 1, name: /Bandeja/ })).toBeVisible();

    // La temporal ya no vale; la nueva sí.
    await otra.getByRole("button", { name: "Salir" }).click();
    await expect(otra).toHaveURL(/\/login\?salida=1/);
    await ingresar(otra, cuil, temporal);
    await expect(errorDelIngreso(otra)).toBeVisible();
    await ingresar(otra, cuil, nueva);
    await expect(otra).toHaveURL(/\/bandeja/);
  } finally {
    await context.close();
  }
});

test("un usuario de la semilla entra con la contraseña de desarrollo; una incorrecta y un CUIL inexistente dan el mismo mensaje", async ({ page }) => {
  const tributario = USUARIOS_FICTICIOS.find((u) => u.area === "TRIBUTARIO");
  if (!tributario) throw new Error("Falta el usuario de Tributario en la semilla");

  await ingresar(page, tributario.cuil, "no es la contraseña");
  await expect(errorDelIngreso(page)).toBeVisible();
  // Conserva el CUIL escrito y borra la contraseña.
  await expect(page.getByLabel("CUIL o correo")).toHaveValue(tributario.cuil);
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue("");

  await ingresar(page, cuilFicticio(), CLAVE_DESARROLLO);
  await expect(errorDelIngreso(page)).toBeVisible();

  // "Mostrar" cambia el tipo del campo.
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE_DESARROLLO);
  await page.getByRole("button", { name: "Mostrar la contraseña" }).click();
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar la contraseña" }).click();
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute("type", "password");

  await ingresar(page, tributario.cuil, CLAVE_DESARROLLO);
  await expect(page).toHaveURL(/\/bandeja/);
});

test("el ingreso del kit institucional: 55/45 con el logo sobre la foto en escritorio; en el celular, el formulario primero y sin descargar la foto", async ({ page }) => {
  // Escritorio: la foto a la izquierda (55 %), con el logo oficial y la prioridad alta; el formulario a la derecha.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  const foto = page.locator("[data-panel-foto]");
  await expect(foto).toBeVisible();
  await expect(foto.getByRole("img", { name: "Ciudad San Miguel de Tucumán" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "CementerIA" })).toBeVisible();
  const cajaFoto = (await foto.boundingBox())!;
  const cajaForm = (await page.locator("[data-panel-ingreso]").boundingBox())!;
  expect(cajaFoto.x).toBe(0);
  expect(cajaFoto.width / 1440).toBeGreaterThan(0.53);
  expect(cajaFoto.width / 1440).toBeLessThan(0.57);
  expect(cajaForm.x).toBeGreaterThanOrEqual(cajaFoto.x + cajaFoto.width - 1);
  const imagen = foto.locator("picture img");
  await expect(imagen).toHaveAttribute("fetchpriority", "high");
  await expect.poll(() => imagen.evaluate((i: HTMLImageElement) => i.currentSrc)).toContain("/assets/cementeria/login-patrimonio");

  // Celular: la franja con el logo y enseguida el formulario, entero a la vista; la foto ni se descarga.
  const celular = await page.context().newPage();
  await celular.setViewportSize({ width: 390, height: 844 });
  await celular.goto("/login");
  await expect(celular.locator("[data-panel-foto]")).toBeHidden();
  await expect(celular.getByRole("img", { name: "Ciudad San Miguel de Tucumán" })).toBeVisible();
  const ingresar = (await celular.getByRole("button", { name: "Ingresar", exact: true }).boundingBox())!;
  expect(ingresar.y + ingresar.height).toBeLessThanOrEqual(844);
  expect(await celular.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(await celular.evaluate(() => performance.getEntriesByType("resource").some((r) => r.name.includes("login-patrimonio")))).toBe(false);
  // El comportamiento es el de siempre: el mismo mensaje y el CUIL conservado.
  await celular.getByLabel("CUIL o correo").fill("20-12345678-6");
  await celular.getByLabel("Contraseña", { exact: true }).fill("no es la contraseña");
  await celular.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(celular.getByRole("alert").filter({ hasText: MENSAJE })).toBeVisible();
  await expect(celular.getByLabel("CUIL o correo")).toHaveValue("20-12345678-6");
  await celular.close();
});
