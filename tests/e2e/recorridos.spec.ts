import { expect, test, type Page } from "@playwright/test";
import { entrarComo } from "./ayudas";

// Recorridos guiados (docs/diseno.md, "Recorridos guiados"): el "?" del
// encabezado, el globo (diálogo modal con teclado y foco) y la invitación
// (una tarjeta que no bloquea), con lo que se recuerda en localStorage.
// Cada prueba corre en un contexto nuevo: su localStorage empieza vacío.

const BIENVENIDA = "¿Es tu primera vez en CementerIA?";
const DE_LA_PANTALLA = "¿Querés un recorrido de esta pantalla?";

function invitacion(page: Page, titulo: string) {
  return page.getByRole("complementary", { name: titulo });
}

/** El globo del recorrido (el único diálogo abierto). */
function globo(page: Page) {
  return page.getByRole("dialog");
}

/** "Paso N de M" del globo → [N, M]. */
async function progreso(page: Page): Promise<[number, number]> {
  const texto = (await globo(page).getByText(/^Paso \d+ de \d+$/).textContent()) ?? "";
  const m = /^Paso (\d+) de (\d+)$/.exec(texto.trim());
  expect(m, `progreso: "${texto}"`).not.toBeNull();
  return [Number(m![1]), Number(m![2])];
}

/** Lo que el navegador recuerda de una pantalla (cualquier usuario y versión). */
async function recordado(page: Page, pantalla: string): Promise<string | null> {
  return page.evaluate((p) => {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i) ?? "";
      if (clave.startsWith("cementeria:recorrido:") && clave.includes(`:${p}:v`)) return localStorage.getItem(clave);
    }
    return null;
  }, pantalla);
}

test("el recorrido de la bandeja se inicia con «?», se navega con el teclado y Escape devuelve el foco", async ({ page }) => {
  await entrarComo(page, "liquidacion");
  // El recorrido nunca se abre solo: solo la invitación.
  await expect(invitacion(page, BIENVENIDA)).toBeVisible();
  await expect(globo(page)).toHaveCount(0);

  const ayuda = page.getByRole("button", { name: "Recorrido de esta pantalla" });
  await ayuda.click();
  const g = globo(page);
  await expect(g).toBeVisible();
  await expect(g).toHaveAttribute("aria-modal", "true");
  await expect(g).toBeFocused();
  await expect(g.getByRole("heading", { level: 2 })).toHaveText("Tu bandeja, por pestañas");
  // Mientras está, la invitación se va (no compiten).
  await expect(invitacion(page, BIENVENIDA)).toHaveCount(0);
  const [, total] = await progreso(page);
  expect(total).toBeGreaterThanOrEqual(3);
  expect(total).toBeLessThanOrEqual(8);
  // El elemento resaltado está a la vista.
  await expect(page.getByRole("navigation", { name: "Pestañas de la bandeja" })).toBeInViewport();

  // → avanza, ← vuelve, Enter avanza; cada paso se anuncia.
  await page.keyboard.press("ArrowRight");
  await expect(g.getByText(`Paso 2 de ${total}`, { exact: true })).toBeVisible();
  await expect(g.locator("[aria-live]")).toHaveText(new RegExp(`^Paso 2 de ${total}\\. `));
  await page.keyboard.press("ArrowLeft");
  await expect(g.getByText(`Paso 1 de ${total}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(g.getByText(`Paso 2 de ${total}`, { exact: true })).toBeVisible();

  // El foco no sale del globo con Tab.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await g.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  // Escape sale y devuelve el foco al "?".
  await page.keyboard.press("Escape");
  await expect(g).toHaveCount(0);
  await expect(ayuda).toBeFocused();

  // Y hasta el final: "Terminar" en el último paso, con el foco de vuelta en el "?".
  await ayuda.click();
  for (let i = 1; i < total; i++) await page.keyboard.press("ArrowRight");
  await expect(g.getByText(`Paso ${total} de ${total}`, { exact: true })).toBeVisible();
  await g.getByRole("button", { name: "Terminar" }).click();
  await expect(g).toHaveCount(0);
  await expect(ayuda).toBeFocused();
});

test("el recorrido de la ficha se adapta al rol: Dirección no ve el paso de Dar pase", async ({ page }) => {
  await entrarComo(page, "direccion");
  await page.goto("/expedientes");
  await page.getByRole("table", { name: "Resultados de la búsqueda" }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^CEM-\d{4}-\d{5,6}$/ })).toBeVisible();

  await page.getByRole("button", { name: "Recorrido de esta pantalla" }).click();
  const g = globo(page);
  await expect(g.getByRole("heading", { level: 2 })).toHaveText("El expediente");
  const [, total] = await progreso(page);
  const titulos: string[] = [];
  for (let i = 1; i <= total; i++) {
    await expect(g.getByText(`Paso ${i} de ${total}`, { exact: true })).toBeVisible();
    titulos.push(((await g.getByRole("heading", { level: 2 }).textContent()) ?? "").trim());
    if (i < total) await g.getByRole("button", { name: "Siguiente" }).click();
  }
  expect(titulos).toContain("El historial");
  expect(titulos).not.toContain("Dar pase o devolver");
  await g.getByRole("button", { name: "Salir del recorrido" }).click();
  await expect(g).toHaveCount(0);
});

test("la invitación aparece la primera vez, no bloquea y respeta «Ahora no» y «No volver a mostrar»", async ({ page }) => {
  await entrarComo(page, "mesa");

  // La bienvenida, una sola vez: no toma el foco y la pantalla se sigue usando.
  const bienvenida = invitacion(page, BIENVENIDA);
  await expect(bienvenida).toBeVisible();
  expect(await bienvenida.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  const pestanas = page.getByRole("navigation", { name: "Pestañas de la bandeja" });
  await pestanas.getByRole("link", { name: /^En mi área/ }).click();
  await expect(pestanas.getByRole("link", { name: /^En mi área/ })).toHaveAttribute("aria-current", "page");
  await bienvenida.getByRole("button", { name: "Ahora no" }).click();
  await expect(bienvenida).toHaveCount(0);
  // En la misma vista no se encadena la de la pantalla.
  await expect(invitacion(page, DE_LA_PANTALLA)).toHaveCount(0);
  expect(await recordado(page, "bienvenida")).toBe("descartado");

  // Otra pantalla: su propia invitación (y la bienvenida ya no).
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Buscar" }).click();
  const deBusqueda = invitacion(page, DE_LA_PANTALLA);
  await expect(deBusqueda).toBeVisible();
  await expect(deBusqueda).toContainText("Buscar expedientes");
  await expect(invitacion(page, BIENVENIDA)).toHaveCount(0);
  await deBusqueda.getByRole("button", { name: "No volver a mostrar" }).click();
  await expect(deBusqueda).toHaveCount(0);
  expect(await recordado(page, "busqueda")).toBe("descartado");

  // La bandeja todavía no se contestó: invita. "Ahora no" la pospone hasta mañana.
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Bandeja" }).click();
  const deBandeja = invitacion(page, DE_LA_PANTALLA);
  await expect(deBandeja).toContainText("Bandeja");
  await deBandeja.getByRole("button", { name: "Ahora no" }).click();
  await expect(deBandeja).toHaveCount(0);
  expect(await recordado(page, "bandeja")).toMatch(/^pospuesto:\d{4}-\d{2}-\d{2}$/);

  // Recargando, ya no aparece ninguna.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Bandeja" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("complementary", { name: /recorrido|primera vez/ })).toHaveCount(0);

  // Al día siguiente, la bandeja (Ahora no) vuelve a invitar; la búsqueda (No volver a mostrar), no.
  await page.clock.setFixedTime(new Date(Date.now() + 36 * 60 * 60 * 1000));
  await page.reload();
  await expect(invitacion(page, DE_LA_PANTALLA)).toContainText("Bandeja");
  await page.goto("/expedientes");
  await expect(page.getByRole("heading", { level: 1, name: "Buscar expedientes" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("complementary", { name: /recorrido|primera vez/ })).toHaveCount(0);
});

test("«Empezar» abre el recorrido y no vuelve a invitar; «Reiniciar los recorridos» vuelve a ofrecerlos", async ({ page }) => {
  await entrarComo(page, "computo");
  const bienvenida = invitacion(page, BIENVENIDA);
  await bienvenida.getByRole("button", { name: "Empezar" }).click();
  const g = globo(page);
  await expect(g.getByRole("heading", { level: 2 })).toHaveText("Te damos la bienvenida a CementerIA");
  // La bienvenida resalta el menú, el buscador y el "?".
  const [, total] = await progreso(page);
  for (let i = 1; i < total; i++) await page.keyboard.press("ArrowRight");
  await expect(g.getByRole("heading", { level: 2 })).toHaveText("¿Dudas? Tocá el signo de pregunta");
  await page.keyboard.press("Escape");
  // La invitación ya no estaba (el botón que lo abrió desapareció): el foco va al "?".
  await expect(page.getByRole("button", { name: "Recorrido de esta pantalla" })).toBeFocused();
  expect(await recordado(page, "bienvenida")).toBe("visto");

  // /avisos: "Reiniciar los recorridos" borra lo recordado.
  await page.goto("/avisos");
  await expect(page.getByRole("heading", { level: 1, name: "Avisos" })).toBeVisible();
  await page.getByRole("button", { name: "Reiniciar los recorridos" }).click();
  await expect(page.getByText("Listo: cada pantalla te va a volver a ofrecer su recorrido.")).toBeVisible();
  expect(await recordado(page, "bienvenida")).toBeNull();
  await page.goto("/bandeja");
  await expect(invitacion(page, BIENVENIDA)).toBeVisible();
});

test("en el celular el «?» está en el encabezado compacto y el globo es una hoja inferior", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await entrarComo(page, "legal");
  const ayuda = page.getByRole("button", { name: "Recorrido de esta pantalla" });
  await expect(ayuda).toBeInViewport();
  // El encabezado sigue siendo una sola fila.
  const alto = await page.locator("header").first().evaluate((el) => el.getBoundingClientRect().height);
  expect(alto).toBeLessThan(70);
  await ayuda.click();
  const g = globo(page);
  await expect(g).toBeVisible();
  const caja = (await g.boundingBox())!;
  // Pegada abajo y a lo ancho (menos la barra de desplazamiento, si la hay).
  expect(Math.round(caja.x)).toBe(0);
  expect(caja.width).toBeGreaterThanOrEqual(370);
  expect(Math.abs(caja.y + caja.height - 844)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(ayuda).toBeFocused();
});
