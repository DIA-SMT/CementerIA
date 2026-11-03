import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Escritor } from "@/lib/dominio/expedientes/dependencias";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { RECORRIDOS } from "@/lib/presentacion/recorridos/contenido";
import { ayudaDePantalla, buscarEnLaGuia, esPantalla, guiaDelSistema } from "./ayuda-interna";
import { datosPublicosParaMigue } from "./datos-publicos";
import { fichaConDatosPersonales, LANDING, sitioDePrueba } from "./datos-de-prueba";
import type { ServiciosHerramientas } from "./herramientas";
import { herramientaSinModelo, responderInterno, type DependenciasMigueInterno } from "./interno";
import { pedirAlModelo, type ConexionModelo } from "./openrouter";
import { responderPublico, type DependenciasMiguePublico } from "./publico";
import { filaDeConsulta } from "./registro";
import { armarReporte, enviarReporte } from "./reporte";

// Nunca se llama a OpenRouter de verdad: cada prueba le pasa a Migue un
// `fetch` falso y mira lo que le llegó.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";

/** Un OpenRouter falso: contesta lo que diga `responder` y anota cada pedido. */
function openRouterFalso(responder: (cuerpo: Record<string, unknown>, n: number) => { status?: number; json?: unknown }) {
  const pedidos: Array<{ url: string; headers: Record<string, string>; cuerpo: Record<string, unknown> }> = [];
  const falso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const cuerpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    pedidos.push({ url: String(url), headers: init?.headers as Record<string, string>, cuerpo });
    const r = responder(cuerpo, pedidos.length);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return { fetch: falso as unknown as typeof fetch, pedidos };
}

function conexion(f: typeof fetch, clave: string | null = "clave-de-prueba-ficticia"): ConexionModelo {
  return { clave, modelo: "openai/gpt-4o-mini", url: "http://127.0.0.1:9/falso", referer: "https://cementeria.ejemplo.test", fetch: f };
}

/** El tope, sin base: cuenta en memoria. */
function topeEnMemoria(cuentaInicial = 0) {
  let cuenta = cuentaInicial;
  const escribir = (async (_u: number, _m: string | null, fn: (tx: never) => Promise<unknown>) =>
    fn({ $queryRaw: (partes: TemplateStringsArray) => Promise.resolve(partes.join("").includes("INSERT") ? [{ consultas: ++cuenta }] : [{ total: cuenta }]) } as never)) as unknown as Escritor;
  return { escribir, secreto: SECRETO, topes: { persona: 2, global: 300 } };
}

const texto = (contenido: string) => ({ json: { model: "openai/gpt-4o-mini", choices: [{ message: { content: contenido } }], usage: { prompt_tokens: 900, completion_tokens: 40 } } });

describe("pedirAlModelo: cómo se le habla a OpenRouter", () => {
  it("con fetch, el modelo, temperatura 0,2, max_tokens, data_collection deny, sin streaming, y los encabezados de atribución", async () => {
    const o = openRouterFalso(() => texto("Hola"));
    const r = await pedirAlModelo(conexion(o.fetch), { mensajes: [{ role: "user", content: "hola" }], maxTokens: 400 });
    expect(r).toMatchObject({ contenido: "Hola", llamadas: [], modelo: "openai/gpt-4o-mini", tokensEntrada: 900, tokensSalida: 40 });
    const [p] = o.pedidos;
    expect(p.url).toBe("http://127.0.0.1:9/falso");
    expect(p.cuerpo).toMatchObject({ model: "openai/gpt-4o-mini", temperature: 0.2, max_tokens: 400, stream: false, provider: { data_collection: "deny" } });
    expect(p.cuerpo.tools).toBeUndefined();
    expect(p.headers).toMatchObject({ Authorization: "Bearer clave-de-prueba-ficticia", "HTTP-Referer": "https://cementeria.ejemplo.test", "X-Title": "CementerIA" });
  });

  it("nunca tira: sin clave, con 500, con una respuesta rara o con la red caída, null", async () => {
    const o = openRouterFalso(() => texto("x"));
    expect(await pedirAlModelo(conexion(o.fetch, null), { mensajes: [], maxTokens: 10 })).toBeNull();
    expect(o.pedidos).toHaveLength(0);
    expect(await pedirAlModelo(conexion(openRouterFalso(() => ({ status: 500 })).fetch), { mensajes: [], maxTokens: 10 })).toBeNull();
    expect(await pedirAlModelo(conexion(openRouterFalso(() => ({ json: { choices: [] } })).fetch), { mensajes: [], maxTokens: 10 })).toBeNull();
    const caida = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await pedirAlModelo(conexion(caida), { mensajes: [], maxTokens: 10 })).toBeNull();
  });
});

describe("Migue de la página pública", () => {
  const datos = datosPublicosParaMigue(sitioDePrueba(), LANDING);
  const deps = (f: typeof fetch, clave: string | null = "clave-de-prueba-ficticia", tope = topeEnMemoria()): DependenciasMiguePublico => ({
    conexion: conexion(f, clave),
    tope,
    datos: async () => datos,
  });

  it("los atajos no llaman al modelo ni cuentan para el tope", async () => {
    const o = openRouterFalso(() => texto("no"));
    const r = await responderPublico(deps(o.fetch), { pregunta: "horarios", historial: [] }, "10.0.0.1");
    expect(r).toMatchObject({ resultado: "respondida", resuelta: true, enlaces: [{ href: "/horarios" }] });
    expect(o.pedidos).toHaveLength(0);
  });

  it("con el modelo: los datos van en <datos>, sin herramientas, con 400 tokens, y la respuesta trae solo enlaces válidos", async () => {
    const o = openRouterFalso(() => texto("El recorrido es los sábados a las 10.\nENLACE: /recorridos\nENLACE: /inventada"));
    const r = await responderPublico(deps(o.fetch), { pregunta: "¿cuándo es el recorrido de personalidades?", historial: [] }, "10.0.0.1");
    expect(r).toMatchObject({ resultado: "respondida", respuesta: "El recorrido es los sábados a las 10.", enlaces: [{ href: "/recorridos" }], tokensEntrada: 900 });
    const sistema = (o.pedidos[0].cuerpo.messages as Array<{ role: string; content: string }>).filter((m) => m.role === "system");
    expect(sistema[1].content).toMatch(/^<datos>/);
    expect(sistema[1].content).toContain("Personalidades tucumanas");
    expect(o.pedidos[0].cuerpo.tools).toBeUndefined();
    expect(o.pedidos[0].cuerpo.max_tokens).toBe(400);
  });

  it("si el modelo falla (500), contesta el buscador sobre los mismos datos (fallback)", async () => {
    const o = openRouterFalso(() => ({ status: 500 }));
    const r = await responderPublico(deps(o.fetch), { pregunta: "¿cuándo es el recorrido de personalidades?", historial: [] }, "10.0.0.1");
    expect(r).toMatchObject({ resultado: "fallback", resuelta: true });
    expect(r.respuesta).toContain("Personalidades tucumanas");
  });

  it("sin clave, el buscador; pasado el tope, el buscador y no se llama al modelo", async () => {
    const o = openRouterFalso(() => texto("no"));
    expect((await responderPublico(deps(o.fetch, null), { pregunta: "qué documentos para inhumación", historial: [] }, null)).resultado).toBe("fallback");
    const tope = topeEnMemoria(2);
    const r = await responderPublico(deps(o.fetch, "clave-de-prueba-ficticia", tope), { pregunta: "qué documentos para inhumación", historial: [] }, "10.0.0.1");
    expect(r.resultado).toBe("tope");
    expect(o.pedidos).toHaveLength(0);
  });

  it("una pregunta con un dato personal se rechaza: no viaja ni se responde con datos", async () => {
    const o = openRouterFalso(() => texto("no"));
    const r = await responderPublico(deps(o.fetch), { pregunta: "mi dni es 99999001, ¿en qué está mi trámite?", historial: [] }, "10.0.0.1");
    expect(r).toMatchObject({ resultado: "rechazada", resuelta: false });
    expect(o.pedidos).toHaveLength(0);
  });
});

describe("Migue del sistema", () => {
  const OPERADOR = { id: 10, rol: "operador", activo: true, area: { id: 3, codigo: "COMPUTO", nombre: "Cómputo" } } satisfies UsuarioPermisos & { area: { nombre: string } };
  const servicios = (): ServiciosHerramientas => ({
    obtenerFicha: vi.fn(async () => fichaConDatosPersonales()),
    bandeja: vi.fn(async () => ({ pestana: "en_mi_area" as const, area: { id: 3, codigo: "COMPUTO" }, filas: [], hayMas: false })),
    contadoresBandeja: vi.fn(async () => ({ por_confirmar: 0, en_mi_area: 0, afuera: 0, afueraCustodia: 0, plazos: 0, plazosAlerta: 0, carga_historica: 0 })),
    panel: vi.fn(),
    plantillas: vi.fn(async () => []),
  });
  const deps = (f: typeof fetch, clave: string | null = "clave-de-prueba-ficticia", s = servicios()): DependenciasMigueInterno => ({ conexion: conexion(f, clave), tope: topeEnMemoria(), servicios: s });

  it("el modelo pide estado_expediente, el servidor la corre con el usuario y le devuelve solo lo permitido; la respuesta enlaza la ficha", async () => {
    const o = openRouterFalso((cuerpo, n) =>
      n === 1
        ? { json: { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "estado_expediente", arguments: '{"numero":"42/2026"}' } }] } }] } }
        : texto("El CEM-2026-00042 está en Cómputo, en el paso 2 de 7.\nENLACE: /expedientes/CEM-2026-00042"),
    );
    const s = servicios();
    const r = await responderInterno(deps(o.fetch, "clave-de-prueba-ficticia", s), OPERADOR, "operador", { pregunta: "¿en qué está el 42/2026?", historial: [], pantalla: "bandeja" });
    expect(s.obtenerFicha).toHaveBeenCalledWith(OPERADOR, "CEM-2026-00042");
    expect(r).toMatchObject({ resultado: "respondida", herramientas: ["estado_expediente"], enlaces: [{ href: "/expedientes/CEM-2026-00042" }] });
    // Lo que volvió al modelo: la salida de la herramienta, sin personas.
    const mensajes = o.pedidos[1].cuerpo.messages as Array<{ role: string; content: string | null }>;
    const resultado = mensajes.find((m) => m.role === "tool")?.content ?? "";
    expect(resultado).toContain('"areaActual":"Cómputo"');
    for (const dato of ["FICTICIO", "99999001", "Calle Ficticia", "Sección A", "reservado"]) expect(resultado).not.toContain(dato);
    // Ni el nombre de la persona del personal viaja: rol y área.
    expect(JSON.stringify(mensajes)).toContain("rol operador y área Cómputo");
    expect(o.pedidos[0].cuerpo).toMatchObject({ max_tokens: 700, tool_choice: "auto", provider: { data_collection: "deny" } });
    expect((o.pedidos[0].cuerpo.tools as unknown[]).length).toBe(5);
  });

  it("sin modelo, la herramienta se elige por palabras y la respuesta se arma sin inventar", async () => {
    const o = openRouterFalso(() => texto("no"));
    const r = await responderInterno(deps(o.fetch, null), OPERADOR, "operador", { pregunta: "estado de CEM-2026-00042", historial: [], pantalla: null });
    expect(r).toMatchObject({ resultado: "fallback", herramientas: ["estado_expediente"], enlaces: [{ href: "/expedientes/CEM-2026-00042" }] });
    expect(r.respuesta).toContain("CEM-2026-00042 (Renovación de concesión): en trámite, en el paso 2 de 7 («Cómputo»).");
    expect(r.respuesta).toContain("Para el pase falta: Verificar el padrón; Título de la concesión.");
    expect(o.pedidos).toHaveLength(0);
  });

  it("si el modelo cae a mitad de camino, contesta igual sin él", async () => {
    const o = openRouterFalso(() => ({ status: 503 }));
    const r = await responderInterno(deps(o.fetch), OPERADOR, "operador", { pregunta: "¿cómo confirmo la recepción?", historial: [], pantalla: "bandeja" });
    expect(r).toMatchObject({ resultado: "fallback", resuelta: true, herramientas: ["como_se_hace"] });
    expect(r.respuesta).toMatch(/Confirmar la recepción/);
  });

  it("rechaza DNI, CUIL, CUIT, teléfono o correo con un mensaje amable; el número de expediente sí", async () => {
    const o = openRouterFalso(() => texto("no"));
    const r = await responderInterno(deps(o.fetch), OPERADOR, "operador", { pregunta: "buscame el expediente del DNI 99999001", historial: [], pantalla: null });
    expect(r).toMatchObject({ resultado: "rechazada" });
    expect(r.respuesta).toMatch(/No escribas DNI, CUIL, CUIT, teléfonos ni correos/);
    expect(o.pedidos).toHaveLength(0);
  });

  it.each([
    ["¿en qué está el 42/2026?", "estado_expediente"],
    ["qué tengo por confirmar", "mi_bandeja"],
    ["¿hay vencidos?", "vencidos_y_demorados"],
    ["los pasos del trámite de inhumación", "plantilla_tramite"],
    ["¿cómo doy el pase?", null],
  ])("herramientaSinModelo(«%s») → %s", (pregunta, nombre) => {
    const llamada = herramientaSinModelo(pregunta);
    expect(llamada?.ok ? llamada.nombre : null).toBe(nombre);
  });
});

describe("la ayuda por pantalla (los textos de los recorridos guiados)", () => {
  it("cada pantalla con recorrido ofrece preguntas con respuesta, y cada respuesta es el texto de un paso", () => {
    for (const id of Object.keys(RECORRIDOS)) {
      const ayuda = ayudaDePantalla(id, "admin");
      expect(ayuda.nombre).toBe(RECORRIDOS[id as keyof typeof RECORRIDOS].nombre);
      for (const p of ayuda.preguntas) expect(p.respuesta.length, `${id}: ${p.pregunta}`).toBeGreaterThan(10);
    }
    const bandeja = ayudaDePantalla("bandeja", "operador");
    expect(bandeja.preguntas.map((p) => p.pregunta)).toContain("¿Cómo confirmo que recibí un expediente?");
    expect(bandeja.preguntas[0].respuesta).toMatch(/Confirmar/);
  });

  it("las preguntas escritas a mano apuntan a pasos que existen (si un recorrido cambia, esto avisa)", () => {
    for (const perfil of ["mesa", "operador", "direccion", "admin"] as const) {
      for (const id of [...Object.keys(RECORRIDOS), "bienvenida"]) {
        const ayuda = ayudaDePantalla(id, perfil);
        expect(ayuda.preguntas.length, `${id} (${perfil})`).toBeLessThanOrEqual(5);
      }
    }
    expect(ayudaDePantalla("ficha", "operador").preguntas).toHaveLength(5);
    expect(ayudaDePantalla("pantalla-que-no-existe", "operador").nombre).toBe("Inicio");
    expect(esPantalla("bandeja")).toBe(true);
    expect(esPantalla("toString")).toBe(false);
  });

  it("la guía del modelo y como_se_hace usan el texto de cada perfil", () => {
    expect(guiaDelSistema("operador")).toContain("## Bandeja");
    expect(buscarEnLaGuia("confirmar recepción", "operador")[0]).toMatchObject({ pantalla: "Bandeja", titulo: "Confirmar la recepción" });
    expect(buscarEnLaGuia("zzzz", "operador")).toEqual([]);
  });
});

describe("el registro y el reporte al tablero", () => {
  it("lo público no guarda usuario ni pantalla ni herramientas; todo se recorta a 500", () => {
    const f = filaDeConsulta({ canal: "publico", resultado: "respondida", duracionMs: 12.6, pregunta: `soy Ana Ficticia ${"x".repeat(600)}`, respuesta: "y".repeat(600), usuarioId: 5, pantalla: "bandeja", herramientas: ["mi_bandeja"] });
    expect(f).toMatchObject({ canal: "publico", usuarioId: null, pantalla: null, herramientas: [], duracionMs: 13 });
    expect(f.pregunta.length).toBe(500);
    expect(f.pregunta.startsWith("soy [nombre] x")).toBe(true);
    expect(f.respuesta.length).toBe(500);
    expect(filaDeConsulta({ canal: "interno", resultado: "rechazada", duracionMs: 1, pregunta: "dni 99999001", respuesta: "No.", usuarioId: 5 }).pregunta).toBe("");
  });

  it("el reporte lleva solo id propio, started_at, canal y outcome", () => {
    const r = armarReporte({ canal: "publico", resuelta: true, empezo: new Date("2026-11-02T13:00:00Z") }, "3f2a1b4c-0000-4000-8000-000000000001");
    expect(r).toEqual({ conversation_id: "3f2a1b4c-0000-4000-8000-000000000001", started_at: "2026-11-02T13:00:00.000Z", channel: "Web", outcome: "resuelta" });
    expect(armarReporte({ canal: "interno", resuelta: false, empezo: new Date() }).conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(armarReporte({ canal: "interno", resuelta: false, empezo: new Date() })).toMatchObject({ channel: "App", outcome: "sin_respuesta" });
  });

  it("enviarReporte manda el contrato del tablero y nunca tira", async () => {
    const o = openRouterFalso(() => ({ json: { stored: 1, rejected: [] } }));
    const reporte = armarReporte({ canal: "publico", resuelta: true, empezo: new Date() });
    await enviarReporte(reporte, { clave: "clave-tablero-ficticia", url: "http://tablero.ejemplo.test" }, o.fetch);
    expect(o.pedidos[0]).toMatchObject({ url: "http://tablero.ejemplo.test/api/migue/conversaciones", headers: { Authorization: "Bearer clave-tablero-ficticia" }, cuerpo: { conversations: [reporte] } });
    const caido = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    await expect(enviarReporte(reporte, { clave: "clave-tablero-ficticia", url: "http://tablero.ejemplo.test" }, caido)).resolves.toBeUndefined();
  });
});
