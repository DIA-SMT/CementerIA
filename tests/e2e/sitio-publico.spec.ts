import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { dialogo, entrarComo, letrasUnicas } from "./ayudas";

// El sitio público (28/10/2026; docs/api-dominio.md, sección 25): una página
// por sección (/, /cementerios, /horarios, /recorridos, /tramites, /consulta y
// /contacto) con el contenido de ejemplo de la semilla de desarrollo; la barra
// que marca la página actual; la navegación desde el inicio; Dirección que
// edita un horario desde /admin/sitio-publico y lo ve en /horarios; un
// operador que no entra; 375 px sin desplazamiento lateral en todas; y las
// páginas VACÍAS (como arranca en producción) sin nada roto.
//
// Las pruebas de este archivo van en orden, en un mismo worker. La de las
// páginas vacías saca el contenido del sitio (con la credencial del dueño de
// la base efímera, E2E_URL_BASE_DUENO) y lo restituye al terminar, pase lo que
// pase. Mientras tanto, las demás pruebas que abren el sitio
// (consulta-publica.spec.ts) miran solo lo que está siempre.

const TABLAS_SITIO = ["sitio_cementerios", "sitio_recorridos", "sitio_recorrido_fechas", "sitio_novedades", "sitio_contacto", "sitio_preguntas"] as const;

/** Las páginas internas: la ruta, la etiqueta en la barra y el h1 (src/lib/presentacion/sitio-publico.ts). */
const PAGINAS = [
  { ruta: "/cementerios", etiqueta: "Cementerios", titulo: "Cementerios municipales" },
  { ruta: "/horarios", etiqueta: "Horarios de visita", titulo: "Horarios de visita" },
  { ruta: "/recorridos", etiqueta: "Recorridos", titulo: "Recorridos históricos" },
  { ruta: "/tramites", etiqueta: "Trámites", titulo: "Trámites y requisitos" },
  { ruta: "/consulta", etiqueta: "Consultá tu trámite", titulo: "Consultá tu trámite" },
  { ruta: "/contacto", etiqueta: "Contacto", titulo: "Contacto" },
] as const;

const SITIO = "Cementerios de San Miguel de Tucumán";

async function desborde(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Nada de lo que el boceto marcaba como pendiente, ni restos de datos que faltan. */
async function sinRestos(page: Page): Promise<void> {
  const texto = await page.locator("body").innerText();
  expect(texto).not.toMatch(/A completar|A validar|Boceto|undefined|null|NaN|\[object/);
}

/** Todas las imágenes cargaron (ninguna rota). */
async function imagenesSanas(page: Page): Promise<void> {
  // Las perezosas, a la vista: se recorre la página.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc || i.src)))
    .toEqual([]);
}

/** Los errores de la consola de una página, desde ahora. */
function erroresDeConsola(page: Page): string[] {
  const errores: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });
  return errores;
}

/** Una página interna: un solo h1, su título, las migas, la barra con ella marcada y las dos invitaciones al pie. */
async function esPaginaInterna(page: Page, p: (typeof PAGINAS)[number]): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`${p.ruta}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: p.titulo })).toBeVisible();
  await expect(page).toHaveTitle(`${p.titulo} · ${SITIO}`);
  const migas = page.getByRole("navigation", { name: "Migas de pan" });
  await expect(migas.getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
  await expect(migas.locator('[aria-current="page"]')).toHaveText(p.etiqueta);
  const secciones = page.getByRole("banner").getByRole("navigation", { name: "Secciones" });
  await expect(secciones.getByRole("link", { name: p.etiqueta, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(secciones.locator('[aria-current="page"]')).toHaveCount(1);
  const otras = page.getByRole("navigation", { name: "También te puede servir" }).getByRole("link");
  await expect(otras).toHaveCount(2);
  for (const href of await otras.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) expect(href).not.toBe(p.ruta);
}

test("cada página del sitio público con el contenido de ejemplo de la semilla", async ({ page }) => {
  const errores = erroresDeConsola(page);

  // El inicio: el hero, los seis accesos, la novedad vigente, los próximos recorridos y la banda de la consulta.
  const respuesta = await page.goto("/");
  expect(respuesta?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: SITIO })).toBeVisible();
  const barra = page.getByRole("banner");
  const secciones = barra.getByRole("navigation", { name: "Secciones" });
  for (const p of PAGINAS) await expect(secciones.getByRole("link", { name: p.etiqueta, exact: true })).toHaveAttribute("href", p.ruta);
  await expect(secciones.locator('[aria-current="page"]')).toHaveCount(0);
  await expect(barra.getByRole("link", { name: /CementerIA/ })).toHaveAttribute("aria-current", "page");
  await expect(barra.getByRole("link", { name: "Ingreso del personal" })).toHaveAttribute("href", "/login");
  const accesos = page.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link");
  await expect(accesos).toHaveCount(6);
  expect(await accesos.evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual(PAGINAS.map((p) => p.ruta));
  await expect(page.locator("[data-novedades]")).toContainText("Horario especial por el Día de los Fieles Difuntos (ejemplo)");
  const proximos = page.getByRole("region", { name: "Próximos recorridos" });
  await expect(proximos.locator("[data-proximas-fechas] > li")).toHaveCount(3);
  await expect(proximos.getByRole("link", { name: "Ver todos los recorridos" })).toHaveAttribute("href", "/recorridos");
  await expect(page.getByRole("region", { name: "Consultá tu trámite" }).getByRole("link", { name: "Consultar mi trámite" })).toHaveAttribute("href", "/consulta");
  await sinRestos(page);
  await imagenesSanas(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // Cementerios: tarjetas con foto (ilustrativa), domicilio de prueba, "Cómo llegar" y "Horarios" a /horarios.
  await page.goto("/cementerios");
  await esPaginaInterna(page, PAGINAS[0]);
  await expect(page.getByRole("main")).toContainText("Tres cementerios municipales: dónde están, qué tienen y cómo llegar. Las fotos son ilustrativas.");
  const oeste = page.getByRole("article", { name: "Cementerio del Oeste" });
  await expect(oeste.getByRole("img", { name: /ilustrativa/ })).toBeVisible();
  await expect(oeste).toContainText("(dato de prueba)");
  await expect(oeste.getByRole("link", { name: /Cómo llegar/ })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\//);
  await expect(oeste.getByRole("link", { name: /^Horarios/ })).toHaveAttribute("href", "/horarios");
  await expect(page.getByRole("article", { name: "Cementerio Jardín Norte" })).toContainText("Sepulturas en parque");

  // Horarios: la tabla en escritorio y la novedad vigente arriba.
  await page.goto("/horarios");
  await esPaginaInterna(page, PAGINAS[1]);
  const tabla = page.getByRole("table", { name: "Horarios de visita de cada cementerio" });
  await expect(tabla).toBeVisible();
  await expect(tabla.getByRole("row", { name: /Cementerio del Oeste/ })).toContainText("2 de noviembre: de 7 a 19 (ejemplo)");
  await expect(page.locator("[data-novedades]")).toContainText("Horario especial por el Día de los Fieles Difuntos (ejemplo)");

  // Recorridos: la ficha destacada, las próximas fechas (3, futuras) y los grupos.
  await page.goto("/recorridos");
  await esPaginaInterna(page, PAGINAS[2]);
  await expect(page.getByRole("article", { name: "Recorrido histórico guiado (ejemplo)" })).toContainText("25 personas");
  await expect(page.locator("[data-proximas-fechas] > li")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 2, name: "Grupos, escuelas e instituciones" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Consultas/ }).first()).toHaveAttribute("href", "/contacto");

  // Trámites: los de las plantillas publicadas, como antes; al pie, a la consulta.
  await page.goto("/tramites");
  await esPaginaInterna(page, PAGINAS[3]);
  await expect(page.getByRole("heading", { level: 2, name: "Renovación de concesión" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Inhumación" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "También te puede servir" }).getByRole("link", { name: /¿Ya iniciaste un trámite\? Consultalo/ })).toHaveAttribute(
    "href",
    "/consulta",
  );

  // La consulta: la banda con los tres pasos y el formulario de siempre.
  await page.goto("/consulta");
  await esPaginaInterna(page, PAGINAS[4]);
  const pasos = page.getByRole("region", { name: "Cómo funciona" });
  await expect(pasos.getByRole("list").first().getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("form", { name: "Datos del comprobante" }).getByRole("button", { name: "Consultar" })).toBeVisible();

  // Contacto y preguntas frecuentes: lo cargado, y el acordeón (la primera abierta).
  await page.goto("/contacto");
  await esPaginaInterna(page, PAGINAS[5]);
  const contacto = page.locator("[data-contacto]");
  await expect(contacto).toContainText("0381 400-0000 (dato de prueba)");
  await expect(contacto.getByRole("link", { name: "mesa.entradas@ejemplo.invalid" })).toHaveAttribute("href", "mailto:mesa.entradas@ejemplo.invalid");
  await expect(page.getByRole("heading", { level: 2, name: "Preguntas frecuentes" })).toBeVisible();
  const preguntas = page.locator("[data-preguntas] details");
  await expect(preguntas).toHaveCount(3);
  await expect(preguntas.first()).toHaveAttribute("open", "");
  await page.getByText("¿Dónde pago las tasas?").click();
  await expect(page.getByText(/Rapipago, Pago Fácil o Banco Macro/)).toBeVisible();

  for (const p of PAGINAS) {
    await page.goto(p.ruta);
    await sinRestos(page);
    await imagenesSanas(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
  expect(errores).toEqual([]);
});

test("desde el inicio se llega a cada página por su acceso, y la barra marca la actual", async ({ page }) => {
  for (const p of PAGINAS) {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link", { name: new RegExp(`^${p.titulo}`) }).click();
    await esPaginaInterna(page, p);
  }
  // Por la barra y por las migas de pan, también.
  const secciones = page.getByRole("banner").getByRole("navigation", { name: "Secciones" });
  await secciones.getByRole("link", { name: "Recorridos", exact: true }).click();
  await esPaginaInterna(page, PAGINAS[2]);
  await secciones.getByRole("link", { name: "Horarios de visita", exact: true }).click();
  await esPaginaInterna(page, PAGINAS[1]);
  await page.getByRole("navigation", { name: "Migas de pan" }).getByRole("link", { name: "Inicio" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: SITIO })).toBeVisible();
  await page.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link", { name: /^Consultá tu trámite/ }).click();
  await expect(page).toHaveURL(/\/consulta$/);
  // Las anclas viejas ya no existen: /#consulta es el inicio, sin nada roto.
  await page.goto("/#consulta");
  await expect(page.getByRole("heading", { level: 1, name: SITIO })).toBeVisible();
});

test("Dirección cambia un horario desde Administración y se ve en /horarios; un operador no entra", async ({ page, browser }) => {
  const horario = `De 6 a 20 (e2e ${letrasUnicas(5)})`;
  await entrarComo(page, "direccion");
  // En el menú de Dirección (en escritorio, la barra lateral).
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Sitio público" }).click();
  await expect(page).toHaveURL(/\/admin\/sitio-publico/);
  await expect(page.getByRole("heading", { level: 1, name: "Sitio público" })).toBeVisible();
  // Dirección ve solo esta sección de Administración.
  const menu = page.getByRole("navigation", { name: "Administración" });
  await expect(menu.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Ver la página pública/ })).toHaveAttribute("href", "/?vista=publica");
  // Cada pestaña ofrece la página donde se ve lo suyo.
  await expect(page.getByRole("link", { name: /Ver «Cementerios municipales»/ })).toHaveAttribute("href", "/cementerios");
  await page.getByRole("navigation", { name: "Partes del sitio público" }).getByRole("link", { name: "Recorridos" }).click();
  await expect(page.getByRole("link", { name: /Ver «Recorridos históricos»/ })).toHaveAttribute("href", "/recorridos");
  await page.getByRole("navigation", { name: "Partes del sitio público" }).getByRole("link", { name: "Cementerios" }).click();

  await page.getByRole("button", { name: "Modificar Cementerio del Norte" }).click();
  const d = dialogo(page, "Cementerio del Norte en la página pública");
  await d.getByRole("textbox", { name: "Lunes a viernes" }).fill(horario);
  await d.getByRole("textbox", { name: "Motivo (opcional)" }).fill("Prueba de punta a punta");
  await d.getByRole("button", { name: "Guardar" }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Datos del cementerio guardados" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Datos públicos de cada cementerio" })).toContainText(horario);

  // Una URL https que no es de mapas se rechaza en su campo.
  await page.getByRole("button", { name: "Modificar Cementerio del Norte" }).click();
  const d2 = dialogo(page, "Cementerio del Norte en la página pública");
  await d2.getByRole("textbox", { name: "Enlace al mapa" }).fill("https://example.com/no-es-un-mapa");
  await d2.getByRole("button", { name: "Guardar" }).click();
  await expect(d2.getByText(/Pegá el enlace https de Google Maps/)).toBeVisible();
  await d2.getByRole("button", { name: "Cancelar" }).click();

  // Con sesión, el inicio público es la vista previa; las páginas internas se ven igual que sin sesión.
  await page.goto("/?vista=publica");
  await expect(page.getByRole("heading", { level: 1, name: SITIO })).toBeVisible();
  await page.goto("/horarios");
  await expect(page.getByRole("table", { name: "Horarios de visita de cada cementerio" }).getByRole("row", { name: /Cementerio del Norte/ })).toContainText(horario);
  const anonimo = await browser.newContext();
  const publica = await anonimo.newPage();
  await publica.goto("/cementerios");
  await expect(publica.getByRole("article", { name: "Cementerio del Norte" })).toContainText(horario);
  await anonimo.close();

  // Un operador no entra: vuelve a su bandeja.
  const otro = await browser.newContext();
  const mesa = await otro.newPage();
  await entrarComo(mesa, "mesa");
  await mesa.goto("/admin/sitio-publico");
  await expect(mesa).toHaveURL(/\/bandeja/);
  await otro.close();
});

test("en 375 px ninguna página tiene desplazamiento lateral: menú, horarios en tarjetas y consulta", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const ruta of ["/", ...PAGINAS.map((p) => p.ruta)]) {
    await page.goto(ruta);
    expect(await desborde(page), ruta).toBeLessThanOrEqual(0);
  }
  // El menú: details/summary, sin JavaScript, con la página actual marcada.
  await page.goto("/recorridos");
  const barra = page.getByRole("banner");
  await barra.getByText("Menú").click();
  const menu = barra.getByRole("navigation", { name: "Secciones" });
  await expect(menu.getByRole("link", { name: "Recorridos", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Inicio", exact: true })).toHaveAttribute("href", "/");
  await expect(menu.getByRole("link", { name: "Ingreso del personal" })).toBeVisible();
  expect(await desborde(page)).toBeLessThanOrEqual(0);
  await menu.getByRole("link", { name: "Horarios de visita" }).click();
  await expect(page).toHaveURL(/\/horarios$/);
  await expect(page.getByRole("heading", { level: 1, name: "Horarios de visita" })).toBeVisible();
  // En celular, los horarios van en tarjetas, no en la tabla.
  await expect(page.getByRole("table", { name: "Horarios de visita de cada cementerio" })).toBeHidden();
  await expect(page.getByRole("list", { name: "Horarios de visita de cada cementerio" })).toBeVisible();
  expect(await desborde(page)).toBeLessThanOrEqual(0);
});

test("las páginas vacías, como arrancan en producción: cada una dice qué hacer y nada se rompe", async ({ page }) => {
  const url = process.env.E2E_URL_BASE_DUENO;
  test.skip(!url, "Falta E2E_URL_BASE_DUENO (la pone tests/e2e/global-setup.ts)");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const respaldo: Record<string, unknown[]> = {};
  try {
    // Se guarda el contenido y se vacía, como SISTEMA (auditar_cambio exige actor).
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.usuario_id', '1', true), set_config('app.motivo', 'Prueba e2e: la página vacía', true)");
    for (const t of TABLAS_SITIO) respaldo[t] = (await c.query(`SELECT coalesce(json_agg(t), '[]'::json) AS f FROM public.${t} t`)).rows[0].f as unknown[];
    for (const t of ["sitio_recorrido_fechas", "sitio_recorridos", "sitio_cementerios", "sitio_novedades", "sitio_contacto", "sitio_preguntas"]) await c.query(`DELETE FROM public.${t}`);
    await c.query("COMMIT");

    const errores = erroresDeConsola(page);

    // El inicio: los seis accesos siguen; sin novedades ni fechas, ni la franja ni el adelanto.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: SITIO })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link")).toHaveCount(6);
    await expect(page.locator("[data-novedades]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Próximos recorridos" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Consultar mi trámite" })).toBeVisible();

    // Cementerios: los del catálogo, solo con el nombre; sin domicilio, sin "Cómo llegar".
    await page.goto("/cementerios");
    for (const n of ["Cementerio del Oeste", "Cementerio del Norte", "Cementerio Jardín Norte"]) {
      await expect(page.getByRole("article", { name: n })).toContainText("Para saber más, consultá en Mesa de Entradas.");
    }
    await expect(page.getByRole("link", { name: /Cómo llegar/ })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("Las fotos son ilustrativas");

    // Sin horarios, a Mesa de Entradas; sin recorridos, escribinos.
    await page.goto("/horarios");
    await expect(page.locator("[data-sin-horarios]")).toContainText("Consultá los horarios en Mesa de Entradas.");
    await expect(page.locator("[data-novedades]")).toHaveCount(0);
    await page.goto("/recorridos");
    await expect(page.locator("[data-sin-recorridos]")).toContainText("Por ahora no hay recorridos programados. Para visitas de grupos o instituciones, escribinos.");
    await expect(page.locator("[data-sin-recorridos]").getByRole("link", { name: "Ver contacto" })).toHaveAttribute("href", "/contacto");

    // Contacto sin datos y sin preguntas: la tarjeta con su texto, sin acordeón ni "Cómo llegar".
    await page.goto("/contacto");
    await expect(page.getByRole("heading", { level: 1, name: "Contacto" })).toBeVisible();
    await expect(page.locator("[data-preguntas]")).toHaveCount(0);
    await expect(page.locator("[data-contacto] dl")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Cómo llegar/ })).toHaveCount(0);

    // Los trámites y la consulta no dependen del sitio: igual que siempre.
    await page.goto("/consulta");
    await expect(page.getByRole("form", { name: "Datos del comprobante" })).toBeVisible();

    for (const ruta of ["/", ...PAGINAS.map((p) => p.ruta)]) {
      await page.goto(ruta);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await sinRestos(page);
      await imagenesSanas(page);
    }
    expect(errores).toEqual([]);
  } finally {
    // Se restituye todo, con sus ids (identity BY DEFAULT), padres antes que hijos.
    await c.query("ROLLBACK").catch(() => undefined);
    if (Object.keys(respaldo).length === TABLAS_SITIO.length) {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.usuario_id', '1', true), set_config('app.motivo', 'Prueba e2e: se restituye el sitio', true)");
      for (const t of ["sitio_cementerios", "sitio_recorridos", "sitio_recorrido_fechas", "sitio_novedades", "sitio_contacto", "sitio_preguntas"]) {
        await c.query(`INSERT INTO public.${t} SELECT * FROM json_populate_recordset(NULL::public.${t}, $1::json)`, [JSON.stringify(respaldo[t])]);
      }
      await c.query("COMMIT");
    }
    await c.end();
  }
});
