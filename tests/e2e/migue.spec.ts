import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { entrarComo } from "./ayudas";
import { RESPUESTA_PUBLICA, type PedidoRecibido } from "./openrouter-falso";

// Migue (02/11/2026; docs/api-dominio.md, sección 26; docs/diseno.md, "Migue")
// contra el OpenRouter de mentira que levanta global-setup.ts
// (tests/e2e/openrouter-falso.ts): nunca se llama a OpenRouter real.
//
// - En la página pública, sin sesión: abrir la burbuja, preguntar y ver la
//   respuesta con su enlace (el inventado se descarta); que al "modelo" le
//   llegaron los datos en <datos>, con data_collection deny; y el fallback al
//   buscador cuando el falso responde 500.
// - En el sistema, como Mesa de Entradas: las preguntas de la pantalla se
//   contestan sin llamar a nadie; el estado de un expediente de la semilla va
//   al "modelo", que pide estado_expediente, y lo que le vuelve no trae datos
//   personales (ni la respuesta en pantalla).
// - En 375 px: la burbuja no tapa los controles principales ni da
//   desplazamiento lateral.
//
// Con E2E_CAPTURAS_MIGUE=<carpeta>, además deja capturas ahí (docs/diseno.md).

const CAPTURAS = process.env.E2E_CAPTURAS_MIGUE;

async function capturar(page: Page, nombre: string): Promise<void> {
  if (!CAPTURAS) return;
  // Con el panel ya del todo visible (la transición de apertura terminó).
  await page.waitForFunction(() => [...document.querySelectorAll("[data-migue] [role=dialog][data-abierto]")].every((d) => getComputedStyle(d).opacity === "1"));
  await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
}

async function registro(): Promise<PedidoRecibido[]> {
  const url = process.env.E2E_OPENROUTER_FALSO;
  if (!url) throw new Error("Falta E2E_OPENROUTER_FALSO (lo deja global-setup.ts)");
  return (await (await fetch(`${url}/__registro`)).json()) as PedidoRecibido[];
}

const burbuja = (page: Page) => page.getByRole("button", { name: "Abrir el chat con Migue, el asistente de la Dirección de Cementerios" });
const panel = (page: Page) => page.getByRole("dialog", { name: "Migue" });

/** En el sistema, la invitación a un recorrido ocupa el rincón de Migue: se pospone. */
async function abrirMigue(page: Page): Promise<void> {
  const ahoraNo = page.getByRole("complementary").getByRole("button", { name: "Ahora no" });
  await expect(ahoraNo.or(burbuja(page)).first()).toBeVisible();
  if (await ahoraNo.isVisible()) await ahoraNo.click();
  await burbuja(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "Escribí tu pregunta para Migue" })).toBeFocused();
}

async function preguntar(page: Page, pregunta: string): Promise<void> {
  const campo = panel(page).getByRole("textbox", { name: "Escribí tu pregunta para Migue" });
  await campo.fill(pregunta);
  await campo.press("Enter");
}

test.describe("Migue en la página pública", () => {
  test("se abre sin sesión, contesta con el modelo y su enlace válido, y Esc lo cierra devolviendo el foco", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await burbuja(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toHaveAttribute("aria-modal", "false");
    await expect(panel(page).getByText("¡Hola! Soy Migue")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "¿Cómo consulto mi trámite?" })).toBeVisible();

    // Sin dígitos: un número largo es, para Migue, un posible documento o teléfono (y lo rechaza).
    const marca = `recorridos guiados ${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8)}`;
    await preguntar(page, `¿Hay ${marca} este mes?`);
    await expect(panel(page).getByText(RESPUESTA_PUBLICA)).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "Horarios de visita" })).toHaveAttribute("href", "/horarios");
    await expect(panel(page).getByRole("link", { name: /inventada/i })).toHaveCount(0);
    await capturar(page, "landing-claro");

    const pedido = (await registro()).find((p) => p.mensajes.some((m) => m.role === "user" && m.content?.includes(marca)));
    expect(pedido, "el falso no recibió la pregunta").toBeTruthy();
    expect(pedido).toMatchObject({ titulo: "CementerIA", temperatura: 0.2, maxTokens: 400, proveedor: { data_collection: "deny" }, herramientas: [] });
    expect(pedido?.autorizacion).toBe("Bearer sk-or-clave-ficticia-de-las-pruebas");
    const sistema = pedido?.mensajes.filter((m) => m.role === "system").map((m) => m.content ?? "") ?? [];
    expect(sistema[0]).toMatch(/^Sos Migue, el asistente de la Dirección de Cementerios/);
    expect(sistema[1]).toMatch(/^<datos>[\s\S]*<\/datos>$/);

    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(burbuja(page)).toBeFocused();
  });

  test("las sugerencias y los atajos contestan sin modelo (la consulta del trámite manda a /consulta)", async ({ page }) => {
    await page.goto("/horarios");
    await burbuja(page).click();
    const antes = (await registro()).length;
    await panel(page).getByRole("button", { name: "¿Cómo consulto mi trámite?" }).click();
    await expect(panel(page).getByText(/número de expediente y el código de consulta/)).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "Consultá tu trámite" })).toHaveAttribute("href", "/consulta");
    expect((await registro()).length).toBe(antes);
  });

  test("si el modelo falla (el falso responde 500), contesta el buscador con los mismos datos", async ({ page }) => {
    await page.goto("/");
    await burbuja(page).click();
    await preguntar(page, "provocar falla: ¿qué tiene el cementerio del Oeste?");
    await expect(panel(page).getByText(/Esto es lo que encontré|no encontré nada en lo que publica la Dirección/)).toBeVisible();
    await expect(panel(page).getByText(RESPUESTA_PUBLICA)).toHaveCount(0);
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  });

  test("en oscuro toma los colores del sitio", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator("[data-sitio-publico]")).toHaveCSS("color", "rgb(232, 238, 247)");
    await burbuja(page).click();
    await preguntar(page, "¿Qué trámites se pueden hacer?");
    await expect(panel(page).getByText(/trámites que se inician en Mesa de Entradas|no hay trámites cargados|no pude leer la lista/)).toBeVisible();
    // La superficie del panel es la del modo oscuro del sitio (pub-superficie), no blanca.
    expect(await panel(page).evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgb(255, 255, 255)");
    await capturar(page, "landing-oscuro");
  });
});

test.describe("Migue en el sistema", () => {
  test("las preguntas de la pantalla se contestan con el texto del recorrido, sin llamar al modelo", async ({ page }) => {
    await entrarComo(page, "mesa");
    await abrirMigue(page);
    await expect(panel(page).getByText("Ayuda del sistema · Bandeja")).toBeVisible();
    const antes = (await registro()).length;
    await panel(page).getByRole("button", { name: "¿Cómo confirmo que recibí un expediente?" }).click();
    await expect(panel(page).getByText(/confirmá que lo recibiste/)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Otra consulta" })).toBeVisible();
    expect((await registro()).length).toBe(antes);
    await capturar(page, "sistema-ayuda-bandeja");
  });

  test("la respuesta del modelo se muestra con su formato: negritas y lista, sin asteriscos", async ({ page }) => {
    await entrarComo(page, "mesa");
    await abrirMigue(page);
    await preguntar(page, "¿Cómo manejo las plantillas? Con formato");
    const respuesta = panel(page).locator("[data-mensaje]").last();
    await expect(respuesta.locator("strong").first()).toHaveText("Plantillas de trámite");
    await expect(respuesta.getByRole("listitem")).toHaveCount(2);
    await expect(respuesta.locator("em")).toHaveText("borrador");
    expect(await respuesta.innerText()).not.toContain("*");
  });

  test("el estado de un expediente de la semilla: el modelo pide la herramienta y lo que le vuelve no trae datos personales", async ({ page }) => {
    // Un expediente de la semilla que está en Mesa de Entradas, con su titular (para buscarlo después en lo que viajó).
    const c = new pg.Client({ connectionString: process.env.E2E_URL_BASE_DUENO });
    await c.connect();
    const { rows } = await c
      .query<{ numero: string; apellido: string | null; nombres: string | null; dni: string | null; telefono: string | null; email: string | null; domicilio: string | null }>(
        `SELECT e.numero_interno AS numero, p.apellido, p.nombres, p.dni, p.telefono, p.email, p.domicilio
           FROM public.expedientes e
           JOIN public.areas a ON a.id = e.area_actual_id AND a.codigo = 'MESA_ENTRADAS'
           JOIN public.expediente_personas p ON p.expediente_id = e.id AND p.vigente AND p.rol = 'titular' AND p.tipo_persona = 'fisica'
          WHERE e.estado = 'en_tramite' AND NOT e.carga_historica
          ORDER BY e.id LIMIT 1`,
      )
      .finally(() => c.end());
    const exp = rows[0];
    expect(exp, "la semilla no tiene un expediente en Mesa de Entradas").toBeTruthy();

    await entrarComo(page, "mesa");
    await abrirMigue(page);
    await preguntar(page, `¿En qué está el expediente ${exp.numero}?`);
    const respuesta = panel(page).getByText(new RegExp(`El expediente ${exp.numero} \\(.+\\) está en trámite en Mesa de Entradas`));
    await expect(respuesta).toBeVisible();
    await expect(panel(page).getByRole("link", { name: `Abrir ${exp.numero}` })).toHaveAttribute("href", `/expedientes/${exp.numero}`);
    await capturar(page, "sistema-estado-expediente");

    const pedidos = (await registro()).filter((p) => p.mensajes.some((m) => m.role === "user" && m.content?.includes(exp.numero)));
    expect(pedidos.length).toBeGreaterThanOrEqual(2);
    expect(pedidos[0]).toMatchObject({ maxTokens: 700, proveedor: { data_collection: "deny" } });
    expect(pedidos[0].herramientas).toEqual(["estado_expediente", "mi_bandeja", "vencidos_y_demorados", "plantilla_tramite", "como_se_hace"]);
    const conResultado = pedidos.find((p) => p.mensajes.some((m) => m.role === "tool"));
    expect(conResultado, "el falso no recibió el resultado de la herramienta").toBeTruthy();
    const llamada = conResultado?.mensajes.find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(llamada?.tool_calls?.[0].function.name).toBe("estado_expediente");
    const resultado = conResultado?.mensajes.find((m) => m.role === "tool")?.content ?? "";
    expect(resultado).toContain(`"numero":"${exp.numero}"`);
    expect(resultado).toContain('"areaActual":"Mesa de Entradas"');

    // Ni lo que viajó al modelo ni lo que se ve en pantalla trae a la persona.
    const enPantalla = (await panel(page).textContent()) ?? "";
    const todoLoQueViajo = JSON.stringify(pedidos.map((p) => p.mensajes));
    for (const dato of [exp.apellido, exp.nombres, exp.dni, exp.telefono, exp.email, exp.domicilio].filter((d): d is string => Boolean(d))) {
      expect(resultado, `«${dato}» viajó en el resultado de la herramienta`).not.toContain(dato);
      expect(todoLoQueViajo, `«${dato}» viajó al modelo`).not.toContain(dato);
      expect(enPantalla, `«${dato}» se ve en la respuesta`).not.toContain(dato);
    }
  });

  test("una pregunta con un DNI se rechaza con un mensaje amable y no viaja", async ({ page }) => {
    await entrarComo(page, "computo");
    await abrirMigue(page);
    const antes = (await registro()).length;
    await preguntar(page, "buscame el expediente del DNI 99.999.001");
    await expect(panel(page).getByText(/No escribas DNI, CUIL, CUIT, teléfonos ni correos acá/)).toBeVisible();
    expect((await registro()).length).toBe(antes);
  });
});

test.describe("Migue en 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const ARRIBA = "header a, header button, header input, header summary";
  const TODO = `${ARRIBA}, main a, main button, main input, main summary, footer a, footer button`;

  /**
   * Ningún control visible de `selector` se cruza con la burbuja, y no hay
   * desplazamiento lateral. Mientras se desplaza, una burbuja flotante pasa por
   * encima del contenido (como en El Sanmiguelino): por eso se arrastra, y la
   * página le reserva lugar al pie para que lo último suba por encima. Lo que
   * se mira: arriba, los controles de la barra y el encabezado (siempre a la
   * vista); al pie de la página, todo.
   */
  async function nadaTapado(page: Page, donde: string, selector: string) {
    const caja = await burbuja(page).boundingBox();
    expect(caja, `${donde}: no está la burbuja`).toBeTruthy();
    const tapados = await page.evaluate(([b, sel]) => {
      if (!b) return [];
      const lista: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (el.closest("[data-migue]")) continue;
        const r = el.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(el).visibility !== "hidden";
        if (visible && r.left < b.x + b.width && r.right > b.x && r.top < b.y + b.height && r.bottom > b.y) lista.push((el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40));
      }
      return lista;
    }, [caja, selector] as const);
    expect(tapados, `${donde}: la burbuja tapa ${tapados.join(", ")}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${donde}: desplazamiento lateral`).toBe(true);
  }

  test("en la página pública, arriba y al pie de la página", async ({ page }) => {
    await page.goto("/");
    await expect(burbuja(page)).toBeVisible();
    await nadaTapado(page, "inicio, arriba", ARRIBA);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await nadaTapado(page, "inicio, al pie", TODO);
    await burbuja(page).click();
    await expect(panel(page)).toBeVisible();
    const p = await panel(page).boundingBox();
    expect(p && p.x >= 0 && p.x + p.width <= 375, "el panel entra en la pantalla").toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capturar(page, "landing-375");
  });

  test("en la bandeja, arriba y al pie", async ({ page }) => {
    await entrarComo(page, "mesa");
    const ahoraNo = page.getByRole("complementary").getByRole("button", { name: "Ahora no" });
    await expect(ahoraNo.or(burbuja(page)).first()).toBeVisible();
    if (await ahoraNo.isVisible()) await ahoraNo.click();
    await expect(burbuja(page)).toBeVisible();
    await nadaTapado(page, "bandeja, arriba", ARRIBA);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await nadaTapado(page, "bandeja, al pie", TODO);
  });
});
