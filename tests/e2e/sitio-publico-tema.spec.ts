import { expect, test, type Page } from "@playwright/test";

// El modo claro u oscuro del sitio público (28/10/2026; docs/diseno.md,
// "Página pública", "Modo oscuro"): por defecto el del sistema; el botón de la
// barra alterna, lo recuerda en localStorage y vuelve a "sistema" cuando lo
// elegido coincide con él; sin localStorage alterna igual. 375 px sin
// desplazamiento lateral en las siete páginas, en los dos modos. Y el
// contraste de los tokens `pub-*` contra sus superficies, en los dos modos,
// incluido el texto blanco sobre el velo de las fotos con la peor foto
// posible (desde el kit institucional del 30/10/2026; el del texto sobre la
// foto real se mide aparte, con capturas: docs/diseno.md).
//
// Solo mira lo que está siempre (la barra, los encabezados): las páginas de
// contenido las vacía un rato sitio-publico.spec.ts.

const CLAVE = "cementeria.sitio-publico.tema";
const PAGINAS = ["/", "/cementerios", "/horarios", "/recorridos", "/tramites", "/consulta", "/contacto"] as const;

const botonTema = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Modo oscuro" });

/**
 * El modo en que se pinta: el color del texto del contenedor (pub-texto: claro
 * en oscuro, azul pizarra en claro). No el del h1: va sobre la foto y es
 * blanco en los dos modos.
 */
async function modo(page: Page): Promise<"oscuro" | "claro"> {
  const color = await page.locator("[data-sitio-publico]").evaluate((s) => getComputedStyle(s).color);
  return color === "rgb(232, 238, 247)" ? "oscuro" : "claro";
}

function erroresDePagina(page: Page): string[] {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });
  return errores;
}

test("el botón alterna claro y oscuro, lo recuerda al recargar y vuelve al del sistema", async ({ page }) => {
  const errores = erroresDePagina(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const boton = botonTema(page);
  await expect(boton).toHaveAttribute("aria-pressed", "false");
  expect(await modo(page)).toBe("claro");

  await boton.click();
  await expect(boton).toHaveAttribute("aria-pressed", "true");
  expect(await modo(page)).toBe("oscuro");
  await expect(page.locator("[data-sitio-publico]")).toHaveAttribute("data-tema", "oscuro");
  expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBe("oscuro");

  // Al recargar y en otra página, sigue en oscuro (el script lo pone antes de pintar).
  await page.reload();
  await expect(page.locator("[data-sitio-publico]")).toHaveAttribute("data-tema", "oscuro");
  await expect(botonTema(page)).toHaveAttribute("aria-pressed", "true");
  expect(await modo(page)).toBe("oscuro");
  await page.getByRole("banner").getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Recorridos", exact: true }).click();
  await expect(page).toHaveURL(/\/recorridos$/);
  expect(await modo(page)).toBe("oscuro");

  // Volver a claro, que es el del sistema: se borra lo guardado y el sitio sigue al sistema.
  await botonTema(page).click();
  await expect(botonTema(page)).toHaveAttribute("aria-pressed", "false");
  expect(await modo(page)).toBe("claro");
  expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBeNull();
  await expect(page.locator("[data-sitio-publico]")).not.toHaveAttribute("data-tema");

  // La app interna no tiene modo oscuro: el ingreso del personal se ve como siempre.
  await botonTema(page).click();
  await page.goto("/login");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("normal");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(244, 247, 251)");
  expect(errores).toEqual([]);
});

test.describe("con el sistema en oscuro", () => {
  test.use({ colorScheme: "dark" });

  test("sin nada guardado, el sitio arranca en oscuro; el botón lo pasa a claro y lo recuerda", async ({ page }) => {
    await page.goto("/horarios");
    await expect(page.locator("[data-sitio-publico]")).not.toHaveAttribute("data-tema");
    expect(await modo(page)).toBe("oscuro");
    await expect(botonTema(page)).toHaveAttribute("aria-pressed", "true");
    // Los formularios y la barra de desplazamiento, del mismo modo.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light dark");

    await botonTema(page).click();
    expect(await modo(page)).toBe("claro");
    expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBe("claro");
    await page.reload();
    expect(await modo(page)).toBe("claro");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  });
});

test("sin localStorage (bloqueado) la página carga y el botón alterna igual", async ({ page }) => {
  const errores = erroresDePagina(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Almacenamiento bloqueado", "SecurityError");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/contacto");
  expect(await modo(page)).toBe("claro");
  await botonTema(page).click();
  await expect(botonTema(page)).toHaveAttribute("aria-pressed", "true");
  expect(await modo(page)).toBe("oscuro");
  await botonTema(page).click();
  expect(await modo(page)).toBe("claro");
  expect(errores).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`375 px sin desplazamiento lateral en las siete páginas (${colorScheme === "light" ? "claro" : "oscuro"})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 375, height: 812 });
    for (const ruta of PAGINAS) {
      await page.goto(ruta);
      expect(await modo(page), ruta).toBe(colorScheme === "dark" ? "oscuro" : "claro");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), ruta).toBeLessThanOrEqual(0);
    }
  });
}

/**
 * Los pares de tokens del sitio (texto, foco y bordes de controles contra sus
 * superficies) en los dos modos. Los colores se leen ya resueltos del
 * navegador (light-dark()); las superficies translúcidas se componen sobre lo
 * peor que puede haber detrás: negro en claro, blanco en oscuro. El texto
 * blanco del hero y de la banda de las internas, sobre una foto blanca (lo
 * peor para texto claro, en los dos modos) con el punto más liviano del velo
 * donde hay texto (`pub-velo`); el del cierre, sobre su velo claro con la
 * peor foto para cada modo. También la banda azul, la barra y el pie.
 */
for (const colorScheme of ["light", "dark"] as const) {
  test(`los tokens del sitio público llegan a AA (${colorScheme === "light" ? "claro" : "oscuro"})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/contacto");
    const fallas = await page.evaluate((oscuro) => {
      const sitio = document.querySelector("[data-sitio-publico]")!;
      const resolver = (token: string): number[] => {
        const el = document.createElement("span");
        el.style.color = `var(--color-${token})`;
        sitio.appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove();
        // rgb(…) / rgba(…) / color(srgb …): los tres primeros en 0-255 y la opacidad.
        const n = c.match(/[\d.]+/g)!.map(Number);
        if (c.startsWith("color(")) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
        return [n[0], n[1], n[2], n[3] ?? 1];
      };
      const sobre = (arriba: number[], abajo: number[]) => arriba.slice(0, 3).map((v, i) => v * arriba[3] + abajo[i] * (1 - arriba[3])).concat(1);
      const peor = oscuro ? [255, 255, 255, 1] : [0, 0, 0, 1];
      const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const contraste = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const superficie = sobre(resolver("pub-superficie"), peor);
      const seccion = sobre(resolver("pub-seccion"), peor);
      const fondo = sobre(resolver("pub-fondo"), peor);
      const tinte = sobre(resolver("pub-tinte"), superficie);
      const chip = sobre(resolver("pub-chip"), superficie);
      const errorFondo = sobre(resolver("pub-error-fondo"), superficie);
      const blanco = [255, 255, 255, 1];
      const negro = [0, 0, 0, 1];
      // El velo de las fotos con texto blanco encima, sobre una foto blanca (lo peor para el texto claro).
      const velo = sobre(resolver("pub-velo"), blanco);
      // El velo claro del cierre: en claro, sobre una foto negra; en oscuro, sobre una blanca.
      const veloCierre = sobre(resolver("pub-velo-cierre"), oscuro ? blanco : negro);
      const banda = sobre(resolver("pub-banda"), peor);
      const barra = sobre(resolver("pub-barra"), peor);
      const pie = sobre(resolver("pub-pie"), peor);
      const textoSobreAzul = resolver("institucional-texto");
      const pares: Array<[string, number[], number[], number]> = [
        ["texto / superficie", resolver("pub-texto"), superficie, 4.5],
        ["texto / sección", resolver("pub-texto"), seccion, 4.5],
        ["texto / fondo", resolver("pub-texto"), fondo, 4.5],
        ["texto-secundario / superficie", resolver("pub-texto-secundario"), superficie, 4.5],
        ["texto-secundario / sección", resolver("pub-texto-secundario"), seccion, 4.5],
        ["texto-secundario / fondo", resolver("pub-texto-secundario"), fondo, 4.5],
        ["texto-secundario / tinte", resolver("pub-texto-secundario"), tinte, 4.5],
        ["titulo / superficie", resolver("pub-titulo"), superficie, 4.5],
        ["titulo / sección", resolver("pub-titulo"), seccion, 4.5],
        ["titulo / fondo", resolver("pub-titulo"), fondo, 4.5],
        ["titulo / tinte", resolver("pub-titulo"), tinte, 4.5],
        ["enlace / superficie", resolver("pub-enlace"), superficie, 4.5],
        ["enlace / sección", resolver("pub-enlace"), seccion, 4.5],
        ["enlace / fondo", resolver("pub-enlace"), fondo, 4.5],
        ["enlace / chip", resolver("pub-enlace"), chip, 4.5],
        ["texto / chip", resolver("pub-texto"), chip, 4.5],
        ["error / error-fondo", resolver("pub-error"), errorFondo, 4.5],
        ["blanco / primario (botón)", blanco, resolver("primario"), 4.5],
        ["borde-control / superficie", resolver("pub-borde-control"), superficie, 3],
        ["foco / superficie", resolver("pub-foco"), superficie, 3],
        ["foco / sección", resolver("pub-foco"), seccion, 3],
        ["foco / fondo", resolver("pub-foco"), fondo, 3],
        ["blanco / velo sobre foto blanca (hero, banda de las internas)", blanco, velo, 4.5],
        ["institucional-texto / velo (aclaración de la imagen)", textoSobreAzul, velo, 4.5],
        ["texto / velo del cierre", resolver("pub-texto"), veloCierre, 4.5],
        ["texto-secundario / velo del cierre", resolver("pub-texto-secundario"), veloCierre, 4.5],
        ["enlace / velo del cierre", resolver("pub-enlace"), veloCierre, 4.5],
        ["blanco / banda del seguimiento", blanco, banda, 4.5],
        ["institucional-texto / banda", textoSobreAzul, banda, 4.5],
        ["institucional-texto / barra", textoSobreAzul, barra, 4.5],
        ["institucional-texto / pie", textoSobreAzul, pie, 4.5],
        ["institucional / amarillo (botón de la banda)", resolver("institucional"), resolver("amarillo"), 4.5],
      ];
      return pares.map(([nombre, a, b, minimo]) => ({ nombre, contraste: +contraste(sobre(a, b), b).toFixed(2), minimo })).filter((p) => p.contraste < p.minimo);
    }, colorScheme === "dark");
    expect(fallas).toEqual([]);
  });
}
