import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { RespuestaCidituc } from "./https";
import { normalizarCuil, RUTA_AUTH_STATUS, TIMEOUT_MS, validarTokenCidituc, type TransporteCidituc } from "./validar";

// Solo datos ficticios: CUIL de DNI 00000001 y nombres inventados.

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6OTk5OX0.firma-ficticia-de-prueba";
const API = "https://cidituc.prueba.invalid:5000";

const PERSONA = {
  id_persona: 9999,
  documento_persona: "20000000001",
  nombre_persona: "Agente",
  apellido_persona: "Ficticio",
  email_persona: "Agente.Ficticio@ejemplo.invalid",
  fecha_nacimiento_persona: "1990-01-01",
  validado: 1,
  habilita: 1,
};

/** Un transporte simulado que responde siempre lo mismo y anota cómo lo llamaron. */
function transporte(status: number, cuerpo: unknown): TransporteCidituc & { llamadas: [string, string, number][] } {
  const llamadas: [string, string, number][] = [];
  const fn = async (url: string, token: string, timeoutMs: number): Promise<RespuestaCidituc> => {
    llamadas.push([url, token, timeoutMs]);
    return { status, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) };
  };
  return Object.assign(fn, { llamadas });
}

function validar(t: TransporteCidituc, token = TOKEN, apiUrl: string | null = API) {
  return validarTokenCidituc(token, { apiUrl, transporte: t });
}

let consola: MockInstance[] = [];

beforeEach(() => {
  consola = [
    vi.spyOn(console, "info").mockImplementation(() => undefined),
    vi.spyOn(console, "warn").mockImplementation(() => undefined),
    vi.spyOn(console, "error").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Todo lo que se escribió en la consola durante el test, como texto. */
function logs(): string {
  return consola.flatMap((espia) => espia.mock.calls.map((args) => args.map(String).join(" "))).join("\n");
}

describe("validarTokenCidituc: la consulta", () => {
  it("pide /usuarios/authStatusIA con el token crudo y timeout de 10 s", async () => {
    const t = transporte(200, { user: PERSONA });
    await validar(t);
    expect(t.llamadas).toEqual([[`${API}${RUTA_AUTH_STATUS}`, TOKEN, 10_000]]);
    expect(RUTA_AUTH_STATUS).toBe("/usuarios/authStatusIA");
    expect(TIMEOUT_MS).toBe(10_000);
  });

  it("no duplica la barra si CIDITUC_API_URL termina en /", async () => {
    const t = transporte(200, { user: PERSONA });
    await validar(t, TOKEN, `${API}/`);
    expect(t.llamadas[0]?.[0]).toBe(`${API}/usuarios/authStatusIA`);
  });

  it("recorta espacios alrededor del token, pero no le agrega Bearer", async () => {
    const t = transporte(200, { user: PERSONA });
    await validar(t, `  ${TOKEN}\n`);
    expect(t.llamadas[0]?.[1]).toBe(TOKEN);
  });

  it("sin CIDITUC_API_URL no consulta y dice sin_configurar", async () => {
    const t = transporte(200, { user: PERSONA });
    expect(await validar(t, TOKEN, null)).toEqual({ ok: false, error: "sin_configurar" });
    expect(t.llamadas).toHaveLength(0);
  });

  it.each([
    ["vacío", ""],
    ["corto", "abc"],
    ["con prefijo Bearer (tiene espacio)", `Bearer ${TOKEN}`],
    ["con salto de línea en el medio", `${TOKEN.slice(0, 20)}\r\nX-Otro: 1`],
    ["con caracteres fuera de ASCII", `${TOKEN}ñ`],
    ["demasiado largo", "a".repeat(5000)],
  ])("un token %s se rechaza sin salir a la red", async (_caso, token) => {
    const t = transporte(200, { user: PERSONA });
    expect(await validar(t, token)).toEqual({ ok: false, error: "token_invalido" });
    expect(t.llamadas).toHaveLength(0);
  });
});

describe("validarTokenCidituc: códigos de respuesta", () => {
  it("401 es token_invalido: es lo que recibe un token de vecino en el endpoint de empleados", async () => {
    expect(await validar(transporte(401, { message: "No autorizado" }))).toEqual({
      ok: false,
      error: "token_invalido",
    });
  });

  it("403 también es token_invalido", async () => {
    expect(await validar(transporte(403, ""))).toEqual({ ok: false, error: "token_invalido" });
  });

  it.each([404, 500, 502, 302])("%i es no_disponible y se loguea con host y status", async (status) => {
    expect(await validar(transporte(status, "<html></html>"))).toEqual({ ok: false, error: "no_disponible" });
    expect(logs()).toContain("cidituc.prueba.invalid:5000");
    expect(logs()).toContain(`"status":${status}`);
  });

  it("si el transporte falla (DNS, firewall, TLS, timeout) es sin_conexion, con el motivo en el log", async () => {
    const t: TransporteCidituc = async () => {
      throw Object.assign(new Error("Cidituc no respondió en 10000 ms"), { code: "ETIMEDOUT" });
    };
    expect(await validar(t)).toEqual({ ok: false, error: "sin_conexion" });
    expect(logs()).toContain("ETIMEDOUT");
    expect(logs()).toContain("cidituc.prueba.invalid:5000");
  });

  it("un error de certificado se nombra en el log", async () => {
    const t: TransporteCidituc = async () => {
      throw Object.assign(new Error("unable to verify the first certificate"), {
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      });
    };
    expect(await validar(t)).toEqual({ ok: false, error: "sin_conexion" });
    expect(logs()).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  it("nunca escribe el token en los logs, en ningún camino", async () => {
    const caminos: TransporteCidituc[] = [
      transporte(200, { user: PERSONA }),
      transporte(401, ""),
      transporte(500, ""),
      transporte(200, "no es json"),
      transporte(200, { user: { ...PERSONA, documento_persona: "123" } }),
      transporte(200, { user: { ...PERSONA, validado: "algo raro" } }),
      async () => {
        throw new Error(`falló con ${TOKEN}`);
      },
    ];
    for (const t of caminos) await validar(t);
    expect(logs()).not.toContain(TOKEN);
    // Tampoco pedazos reconocibles del token.
    expect(logs()).not.toContain(TOKEN.split(".")[1]);
  });
});

describe("validarTokenCidituc: lectura tolerante de la persona", () => {
  const esperada = {
    ciditucId: "9999",
    cuil: "20000000001",
    nombre: "Agente",
    apellido: "Ficticio",
    email: "agente.ficticio@ejemplo.invalid",
  };

  it("lee el envoltorio { user } de authStatusIA", async () => {
    expect(await validar(transporte(200, { user: PERSONA }))).toEqual({ ok: true, persona: esperada });
  });

  it("lee el envoltorio { usuarioSinContraseña } de authStatus", async () => {
    expect(await validar(transporte(200, { usuarioSinContraseña: PERSONA }))).toEqual({
      ok: true,
      persona: esperada,
    });
  });

  it("lee la forma plana", async () => {
    expect(await validar(transporte(200, PERSONA))).toEqual({ ok: true, persona: esperada });
  });

  it("acepta números donde se esperaba texto y null donde se esperaba un dato", async () => {
    const resultado = await validar(
      transporte(200, {
        user: {
          id_persona: "9999",
          documento_persona: 20000000001,
          nombre_persona: null,
          apellido_persona: "  ",
          email_persona: null,
          fecha_nacimiento_persona: null,
          validado: null,
          habilita: null,
        },
      }),
    );
    expect(resultado).toEqual({
      ok: true,
      persona: { ciditucId: "9999", cuil: "20000000001", nombre: "", apellido: "", email: null },
    });
  });

  it("acepta campos que no vienen (validado, habilita, nombre, email)", async () => {
    expect(await validar(transporte(200, { user: { id_persona: 9999, documento_persona: "20000000001" } }))).toEqual({
      ok: true,
      persona: { ...esperada, nombre: "", apellido: "", email: null },
    });
  });

  it("normaliza el CUIL con guiones y completa con ceros a la izquierda", async () => {
    const conGuiones = await validar(transporte(200, { user: { ...PERSONA, documento_persona: "20-00000000-1" } }));
    expect(conGuiones.ok && conGuiones.persona.cuil).toBe("20000000001");

    // Una columna numérica se come los ceros a la izquierda.
    const sinCeros = await validar(transporte(200, { user: { ...PERSONA, documento_persona: 2000000001 } }));
    expect(sinCeros.ok && sinCeros.persona.cuil).toBe("02000000001");
    expect(logs()).toContain("cidituc.cuil_completado");
    expect(logs()).not.toContain("2000000001");
  });

  it.each([
    ["más de 11 dígitos", "200000000011"],
    ["sin dígitos", "sin-documento"],
    ["todo ceros (el CUIL de SISTEMA)", "00000000000"],
    ["un objeto", { numero: 1 }],
  ])("un documento_persona %s es respuesta_inesperada", async (_caso, documento) => {
    expect(await validar(transporte(200, { user: { ...PERSONA, documento_persona: documento } }))).toEqual({
      ok: false,
      error: "respuesta_inesperada",
    });
    expect(logs()).toContain("documento_persona");
  });

  it("sin id_persona es respuesta_inesperada", async () => {
    const { id_persona: _sinId, ...sinId } = PERSONA;
    void _sinId;
    expect(await validar(transporte(200, { user: sinId }))).toEqual({ ok: false, error: "respuesta_inesperada" });
  });

  it.each([
    ["no es JSON", "<html>error</html>"],
    ["es un array", [PERSONA]],
    ["es null", "null"],
    ["{ user: null } sin la persona", { user: null }],
  ])("un 200 que %s es respuesta_inesperada", async (_caso, cuerpo) => {
    expect(await validar(transporte(200, cuerpo))).toEqual({ ok: false, error: "respuesta_inesperada" });
  });
});

describe("validarTokenCidituc: validado y habilita", () => {
  it.each([
    ["validado", 0],
    ["validado", "0"],
    ["validado", false],
    ["validado", "false"],
    ["validado", "NO"],
    ["habilita", 0],
    ["habilita", "0"],
    ["habilita", " no "],
    ["habilita", "baja"],
  ])("rechaza la baja explícita (%s = %j) como cuenta_inactiva", async (campo, valor) => {
    expect(await validar(transporte(200, { user: { ...PERSONA, [campo]: valor } }))).toEqual({
      ok: false,
      error: "cuenta_inactiva",
    });
  });

  it.each([
    ["validado", 1],
    ["validado", 2],
    ["validado", "2"],
    ["validado", true],
    ["validado", "SI"],
    ["validado", null],
    ["validado", undefined],
    ["validado", ""],
    ["habilita", "S"],
    ["habilita", "un valor que nadie conoce"],
  ])("no rechaza %s = %j: solo frena la baja explícita", async (campo, valor) => {
    const resultado = await validar(transporte(200, { user: { ...PERSONA, [campo]: valor } }));
    expect(resultado.ok).toBe(true);
  });
});

describe("normalizarCuil", () => {
  it.each([
    ["20000000001", "20000000001"],
    [20000000001, "20000000001"],
    ["20-00000000-1", "20000000001"],
    [" 20 00000000 1 ", "20000000001"],
    [2000000001, "02000000001"],
  ])("%j → %s", (entrada, salida) => {
    expect(normalizarCuil(entrada)).toBe(salida);
  });

  it.each([[null], [undefined], [""], ["abc"], ["123456789012"], [0], [{}], [true]])("%j → null", (entrada) => {
    expect(normalizarCuil(entrada)).toBeNull();
  });
});
