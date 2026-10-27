// Ayudas de las pruebas de punta a punta. Ver tests/e2e/README.md.
//
// Todo por rol y texto accesible (getByRole, getByLabel), como lo usa una
// persona con lector de pantalla: si una prueba no encuentra un control por su
// nombre, probablemente tampoco lo encuentre quien lo necesita.

import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Ingreso por /dev/login
// ---------------------------------------------------------------------------

/**
 * Los usuarios ficticios de la semilla (prisma/semilla/usuarios.ts), uno por
 * área, como los muestra /dev/login: "Apellido, Nombre".
 */
export const USUARIOS = {
  mesa: "Mesa de Entradas, Prueba",
  computo: "Cómputo, Prueba",
  liquidacion: "Liquidación, Prueba",
  legal: "Asesoría Legal, Prueba",
  administrativo: "Administrativo, Prueba",
  tributario: "Tributario, Prueba",
  direccion: "Dirección, Prueba",
  admin: "Inicial, Administración",
} as const;

export type Quien = keyof typeof USUARIOS;

/**
 * El administrador del modo prueba ("Ver como…"): lo crea global-setup.ts y su
 * CUIL (ficticio) es el único de PERFILES_PRUEBA_CUILS en la app de las
 * pruebas. No está en USUARIOS: solo lo usa tests/e2e/perfil-prueba.spec.ts,
 * así cambiarle el perfil no molesta a las demás pruebas.
 */
export const USUARIO_MODO_PRUEBA = { cuil: "20000000095", nombre: "Probador", apellido: "Modo Prueba" } as const;

/** Dónde cae cada uno al entrar (inicioPara): los operadores en la bandeja; Dirección y el admin, en el panel. */
const INICIO: Record<Quien, RegExp> = {
  mesa: /\/bandeja/,
  computo: /\/bandeja/,
  liquidacion: /\/bandeja/,
  legal: /\/bandeja/,
  administrativo: /\/bandeja/,
  tributario: /\/bandeja/,
  direccion: /\/panel/,
  admin: /\/panel/,
};

/** Entra como el usuario de esa área con "Entrar como…" de /dev/login. */
export async function entrarComo(page: Page, quien: Quien): Promise<void> {
  await page.goto("/dev/login");
  const fila = page.getByRole("listitem").filter({ hasText: USUARIOS[quien] });
  await fila.getByRole("button", { name: "Entrar como…" }).click();
  await expect(page).toHaveURL(INICIO[quien]);
}

/**
 * Una sesión aparte (contexto de navegador nuevo, con sus cookies) ya
 * ingresada. Hay que cerrarla con `context.close()` al terminar.
 */
export async function nuevaSesion(browser: Browser, quien: Quien): Promise<{ context: BrowserContext; page: Page }> {
  // Dentro del runner, browser.newContext() toma las opciones de `use` del
  // config (baseURL, locale, zona horaria).
  const context = await browser.newContext();
  const page = await context.newPage();
  await entrarComo(page, quien);
  return { context, page };
}

// ---------------------------------------------------------------------------
// Datos ficticios únicos
// ---------------------------------------------------------------------------

const LETRAS = "BCDFGHJKLMNPQRSTVWXZ";

/** Letras al azar: hace único un apellido sin depender del orden de las pruebas. */
export function letrasUnicas(cantidad = 6): string {
  let s = "";
  for (let i = 0; i < cantidad; i++) s += LETRAS[Math.floor(Math.random() * LETRAS.length)];
  return s;
}

/** Un DNI ficticio de 8 dígitos que empieza con 9 (los de la semilla son 99.999.0NN). */
export function dniUnico(): string {
  return `9${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

/** "93.456.789" */
export function conPuntos(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Hoy en Tucumán, como YYYY-MM-DD (el valor de un `<input type="date">`). */
export function hoyEnTucuman(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

export interface DatosAlta {
  apellido: string;
  nombres?: string;
  dni?: string;
  telefono?: string;
  email?: string;
  domicilio?: string;
  seccion?: string;
  lote?: string;
  padron?: string;
  numeroMunicipal?: string;
  /** Nombres de los documentos que se reciben con el alta (casillas). */
  documentos?: string[];
}

/** Datos ficticios completos para un alta, con apellido, DNI y ubicación únicos. */
export function datosAlta(cambios: Partial<DatosAlta> = {}): Required<Omit<DatosAlta, "documentos">> & Pick<DatosAlta, "documentos"> {
  const unico = letrasUnicas();
  const lote = String(1000 + Math.floor(Math.random() * 9000));
  return {
    apellido: `FICTICIO ${unico}`,
    nombres: "Ana Prueba",
    dni: dniUnico(),
    telefono: `0381 000-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    email: `${unico.toLowerCase()}@ejemplo.test`,
    domicilio: "Calle Ficticia 123",
    seccion: "C",
    lote,
    padron: `P-${unico}`,
    numeroMunicipal: `${Math.floor(Math.random() * 90000) + 10000}/2026`,
    documentos: [],
    ...cambios,
  };
}

/** Abre el alta y elige "Renovación, pago de contado" en el Cementerio del Oeste. */
export async function abrirAltaRenovacionOeste(page: Page): Promise<void> {
  await page.goto("/expedientes/nuevo");
  await page.getByLabel("Tipo de trámite y plantilla").selectOption({ label: "Renovación, pago de contado (v1)" });
  await page.getByLabel("Cementerio").selectOption({ label: "Cementerio del Oeste" });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("group", { name: "Monumento y ubicación" })).toBeVisible();
}

/** El grupo de campos del titular en el formulario del alta. */
export function grupoTitular(page: Page): Locator {
  return page.getByRole("group", { name: /^Titular de la concesión \(/ });
}

/** Completa el formulario del alta ya abierto (sin guardar). */
export async function completarAlta(page: Page, d: DatosAlta): Promise<void> {
  await page.getByLabel("Tipo de monumento").selectOption({ label: "Sepultura o bóveda" });
  if (d.seccion !== undefined) await page.getByRole("textbox", { name: "Sección", exact: true }).fill(d.seccion);
  if (d.lote !== undefined) await page.getByRole("textbox", { name: "Lote", exact: true }).fill(d.lote);
  if (d.padron !== undefined) await page.getByRole("textbox", { name: "Padrón", exact: true }).fill(d.padron);
  if (d.numeroMunicipal !== undefined) await page.getByRole("textbox", { name: "N° municipal", exact: true }).fill(d.numeroMunicipal);

  const titular = grupoTitular(page);
  await titular.getByRole("textbox", { name: "Apellido", exact: true }).fill(d.apellido);
  await titular.getByRole("textbox", { name: "Nombres", exact: true }).fill(d.nombres ?? "Ana Prueba");
  if (d.dni !== undefined) await titular.getByRole("textbox", { name: "DNI", exact: true }).fill(d.dni);
  if (d.telefono !== undefined) await titular.getByRole("textbox", { name: "Teléfono", exact: true }).fill(d.telefono);
  if (d.email !== undefined) await titular.getByRole("textbox", { name: "Correo", exact: true }).fill(d.email);
  if (d.domicilio !== undefined) await titular.getByRole("textbox", { name: "Domicilio", exact: true }).fill(d.domicilio);
  await titular.getByLabel("Es el contacto del trámite").check();

  for (const documento of d.documentos ?? []) {
    await page.getByRole("checkbox", { name: documento }).check();
  }
}

/** El número interno de la ficha abierta (el título de la página). */
export async function numeroDeLaFicha(page: Page): Promise<string> {
  const titulo = page.getByRole("heading", { level: 1, name: /^CEM-\d{4}-\d{5,6}$/ });
  await expect(titulo).toBeVisible();
  return (await titulo.textContent())!.trim();
}

/**
 * Alta completa como Mesa de Entradas (la página ya tiene que estar con esa
 * sesión): renovación de contado en el Oeste, "Guardar" y la ficha abierta.
 * Devuelve el número interno.
 */
export async function darDeAlta(page: Page, d: DatosAlta = datosAlta()): Promise<string> {
  await abrirAltaRenovacionOeste(page);
  await completarAlta(page, d);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  return numeroDeLaFicha(page);
}

// ---------------------------------------------------------------------------
// Ficha y flujo
// ---------------------------------------------------------------------------

export async function abrirFicha(page: Page, numero: string): Promise<void> {
  await page.goto(`/expedientes/${numero}`);
  await expect(page.getByRole("heading", { level: 1, name: numero })).toBeVisible();
}

/** El diálogo abierto (hay uno solo a la vez). */
export function dialogo(page: Page, nombre?: string | RegExp): Locator {
  return page.getByRole("dialog", nombre === undefined ? {} : { name: nombre });
}

/** El aviso de lo último que se hizo en la ficha (región viva). */
export async function esperarAviso(page: Page, texto: string | RegExp): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: texto })).toBeVisible();
}

/** "Confirmar recepción" desde la ficha. */
export async function confirmarRecepcion(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Confirmar recepción" }).click();
  const d = dialogo(page, "Confirmar recepción");
  await d.getByRole("button", { name: "Confirmar recepción" }).click();
  await expect(d).toBeHidden();
  await expect(page.getByRole("button", { name: "Confirmar recepción" })).toBeHidden();
}

const RE_FALTAN = /^(Faltan (\d+) cosas|Falta 1 cosa) para (avanzar|concluir)$/;

function cuantasFaltan(titulo: string): number {
  const m = RE_FALTAN.exec(titulo);
  if (!m) return 0;
  return m[2] ? Number(m[2]) : 1;
}

/**
 * Resuelve, uno por uno, lo que lista un diálogo "Faltan N" ya abierto, con el
 * acceso directo de cada ítem: tilda (con la fecha de hoy si la pide) y marca
 * documentos como presentados. Al resolver cada uno, la ficha vuelve sola al
 * diálogo de origen (el pase o concluir) con la lista al día: se espera a que
 * el título baje antes de seguir. Termina cuando el diálogo ya es el
 * formulario (`formulario`, "Dar pase" o "Concluir").
 */
export async function resolverFaltantes(page: Page, formulario: "Dar pase" | "Concluir"): Promise<void> {
  for (let vueltas = 0; vueltas < 30; vueltas++) {
    const abierto = dialogo(page);
    await expect(abierto).toBeVisible();
    const titulo = abierto.getByRole("heading", { level: 2 }).first();
    const texto = ((await titulo.textContent()) ?? "").trim();
    if (texto === formulario) return;
    const n = cuantasFaltan(texto);
    expect(n, `Diálogo inesperado: "${texto}"`).toBeGreaterThan(0);

    const acceso = abierto.getByRole("list").getByRole("button").first();
    const nombre = ((await acceso.getAttribute("aria-label")) ?? (await acceso.textContent()) ?? "").trim();
    await acceso.click();

    if (/^(Tildar|Completar el dato)/.test(nombre)) {
      const d = dialogo(page, /^(Tildar subtarea|Cambiar el dato)$/);
      await expect(d).toBeVisible();
      const fecha = d.getByLabel("Fecha");
      if (await fecha.count()) await fecha.fill(hoyEnTucuman());
      await d.getByRole("button", { name: /^(Tildar|Guardar)$/ }).click();
    } else if (/^(Marcar|Agregar la observación)/.test(nombre)) {
      const d = dialogo(page, "Documento");
      await expect(d).toBeVisible();
      await d.getByRole("radio", { name: "Presentado" }).check();
      await d.getByRole("button", { name: "Guardar" }).click();
    } else {
      throw new Error(`No sé resolver "${nombre}" desde el diálogo de faltantes`);
    }

    // De vuelta en el diálogo de origen, con uno menos (o ya el formulario).
    const siguiente = n - 1;
    const esperado = siguiente === 0 ? formulario : RE_FALTAN;
    await expect(dialogo(page).getByRole("heading", { level: 2 }).first()).toHaveText(esperado);
    if (siguiente > 0) {
      await expect(dialogo(page).getByRole("heading", { level: 2 }).first()).toHaveText(
        siguiente === 1 ? /^Falta 1 cosa/ : new RegExp(`^Faltan ${siguiente} cosas`),
      );
    }
  }
  throw new Error("Demasiados faltantes");
}

/**
 * Da el pase desde la ficha al destino preseleccionado (el paso siguiente),
 * resolviendo antes lo que falte. Devuelve cuando la ficha ya muestra el paso
 * nuevo (`pasoNuevo`, por ejemplo "3 de 7: Liquidación y boleta").
 */
export async function darPase(page: Page, pasoNuevo: string | RegExp, destino?: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: /^Dar pase/ }).click();
  await resolverFaltantes(page, "Dar pase");
  const d = dialogo(page, "Dar pase");
  if (destino !== undefined) await d.getByRole("radio", { name: destino }).check();
  await d.getByRole("button", { name: "Dar pase" }).click();
  await expect(d).toBeHidden();
  await expect(datoDeLaFicha(page, "Paso actual")).toHaveText(pasoNuevo);
}

/** El valor de un dato del encabezado de la ficha ("Paso actual", "Área actual"…). */
export function datoDeLaFicha(page: Page, titulo: string): Locator {
  return page.getByRole("term").filter({ hasText: new RegExp(`^${titulo}$`) }).locator("xpath=following-sibling::dd[1]");
}

/** Un PNG de 1×1 válido (los adjuntos se controlan por magic bytes). */
export const PNG_CHICO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// ---------------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------------

/** La fila de la bandeja (pestaña abierta) del expediente `numero`. */
export function filaDeBandeja(page: Page, numero: string): Locator {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name: numero, exact: true }) });
}

/** Abre una pestaña de la bandeja: "Por confirmar", "En mi área"… */
export async function abrirPestana(page: Page, pestana: "Por confirmar" | "En mi área" | "Afuera"): Promise<void> {
  await page.goto("/bandeja");
  const pestanas = page.getByRole("navigation", { name: "Pestañas de la bandeja" });
  await pestanas.getByRole("link", { name: new RegExp(`^${pestana}`) }).click();
  await expect(pestanas.getByRole("link", { name: new RegExp(`^${pestana}`) })).toHaveAttribute("aria-current", "page");
}

/**
 * El nombre accesible de un botón "Acción: objeto" de la ficha ("Tildar: …",
 * "Marcar: …"): el botón muestra solo la acción y lleva el nombre completo en
 * aria-label. Exacto: el panel "Qué falta para avanzar" tiene botones con el
 * mismo comienzo ("Tildar: X: falta tildarla").
 */
export function accion(verbo: string, objeto: string): RegExp {
  const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapar(verbo)}: ${escapar(objeto)}$`);
}
