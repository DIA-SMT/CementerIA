import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// El callback de punta a punta, sin red ni base: el transporte HTTPS y la base
// se reemplazan por simulados. Lo que se prueba es el contrato del handler:
// los errores del state por separado, la URL limpia, las cookies y la auditoría.

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6OTk5OX0.firma-ficticia-de-prueba";
const STATE = "0b7e6c1a-3f4d-4e5a-9b8c-7d6e5f4a3b2c";
const ORIGEN = "https://cementeria.ejemplo.invalid";

vi.stubEnv("SESSION_SECRET", SECRETO);
vi.stubEnv("CIDITUC_HABILITADO", "1");
vi.stubEnv("CIDITUC_API_URL", "https://cidituc.prueba.invalid:5000");

const simulado = vi.hoisted(() => ({
  respuestaCidituc: { status: 200, body: "" } as { status: number; body: string },
  usuario: null as null | Record<string, unknown>,
  accesos: [] as unknown[],
  actores: [] as { actor: number; motivo: string | null }[],
  fallaBase: null as Error | null,
  llamadasCidituc: 0,
}));

vi.mock("@/lib/auth/cidituc/https", async (original) => ({
  ...(await original<typeof import("@/lib/auth/cidituc/https")>()),
  getDeCidituc: async () => {
    simulado.llamadasCidituc++;
    return simulado.respuestaCidituc;
  },
}));

vi.mock("@/lib/auth/sesion", () => {
  const tx = {
    usuario: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ id: simulado.usuario?.id, rol: simulado.usuario?.rol, sesionVersion: 7 }),
    },
    auditoriaAcceso: {
      create: async ({ data }: { data: unknown }) => {
        simulado.accesos.push(data);
        return {};
      },
    },
  };
  return {
    dependenciasIngreso: {
      leer: {
        usuario: {
          findUnique: async () => {
            if (simulado.fallaBase) throw simulado.fallaBase;
            return simulado.usuario;
          },
        },
      },
      escribir: async (actor: number, motivo: string | null, fn: (t: typeof tx) => Promise<unknown>) => {
        simulado.actores.push({ actor, motivo });
        return fn(tx);
      },
    },
  };
});

const { GET } = await import("./route");
const { COOKIE_SESION, COOKIE_SIN_ACCESO, verificarSesion, verificarSinAcceso } = await import(
  "@/lib/auth/sesion-token"
);
const { codificarFlujo, COOKIE_STATE } = await import("@/lib/auth/cidituc/derivador");

const PERSONA = {
  id_persona: 9999,
  documento_persona: "20000000001",
  nombre_persona: "Agente",
  apellido_persona: "Ficticio",
  email_persona: null,
  validado: 1,
  habilita: 1,
};

function callback(parametros: Record<string, string>, cookieState?: string): NextRequest {
  const url = new URL("/auth/callback", ORIGEN);
  for (const [clave, valor] of Object.entries(parametros)) url.searchParams.set(clave, valor);
  return new NextRequest(url, {
    headers: { ...(cookieState ? { cookie: `${COOKIE_STATE}=${cookieState}` } : {}), "x-real-ip": "10.0.0.7" },
  });
}

let consola: MockInstance[] = [];

beforeEach(() => {
  simulado.respuestaCidituc = { status: 200, body: JSON.stringify({ user: PERSONA }) };
  simulado.usuario = {
    id: 42,
    activo: true,
    ciditucId: null,
    nombre: "Agente",
    apellido: "Ficticio",
    email: null,
    rol: "operador",
  };
  simulado.accesos = [];
  simulado.actores = [];
  simulado.fallaBase = null;
  simulado.llamadasCidituc = 0;
  consola = [
    vi.spyOn(console, "info").mockImplementation(() => undefined),
    vi.spyOn(console, "warn").mockImplementation(() => undefined),
    vi.spyOn(console, "error").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  // Pase lo que pase, el token no aparece en ningún log.
  const todo = consola.flatMap((espia) => espia.mock.calls.flat().map(String)).join("\n");
  expect(todo).not.toContain(TOKEN);
  vi.restoreAllMocks();
});

function destino(respuesta: Response): URL {
  return new URL(respuesta.headers.get("location") ?? "", ORIGEN);
}

function expectStateBorrado(respuesta: { cookies: { get(n: string): { value: string; maxAge?: number; path?: string } | undefined } }) {
  expect(respuesta.cookies.get(COOKIE_STATE)).toMatchObject({ value: "", maxAge: 0, path: "/" });
}

describe("GET /auth/callback: el state", () => {
  it("sin state en la URL: state_ausente (el derivador no lo devolvió)", async () => {
    const respuesta = await GET(callback({ auth: TOKEN }, codificarFlujo(STATE, null)));
    expect(respuesta.status).toBe(303);
    expect(destino(respuesta).pathname).toBe("/login");
    expect(destino(respuesta).searchParams.get("error")).toBe("state_ausente");
    expectStateBorrado(respuesta);
    expect(simulado.llamadasCidituc).toBe(0);
  });

  it("sin cookie: state_vencido (pasaron los diez minutos o el navegador no la mandó)", async () => {
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }));
    expect(destino(respuesta).searchParams.get("error")).toBe("state_vencido");
    expect(simulado.llamadasCidituc).toBe(0);
  });

  it("distintos: state_distinto (dos ingresos pisándose)", async () => {
    const otro = "1b7e6c1a-3f4d-4e5a-9b8c-7d6e5f4a3b2c";
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(otro, null)));
    expect(destino(respuesta).searchParams.get("error")).toBe("state_distinto");
    expect(simulado.llamadasCidituc).toBe(0);
  });

  it("sin ?auth=: sin_token", async () => {
    const respuesta = await GET(callback({ state: STATE }, codificarFlujo(STATE, null)));
    expect(destino(respuesta).searchParams.get("error")).toBe("sin_token");
  });

  it("el destino guardado en la cookie sobrevive a un error, para reintentar", async () => {
    const respuesta = await GET(callback({ auth: TOKEN }, codificarFlujo(STATE, "/expedientes/2026-00012")));
    expect(destino(respuesta).searchParams.get("volver")).toBe("/expedientes/2026-00012");
  });
});

describe("GET /auth/callback: la validación", () => {
  it("token rechazado por Cidituc (401): token_invalido, sin sesión", async () => {
    simulado.respuestaCidituc = { status: 401, body: "" };
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, null)));
    expect(destino(respuesta).searchParams.get("error")).toBe("token_invalido");
    expect(respuesta.cookies.get(COOKIE_SESION)).toBeUndefined();
    expectStateBorrado(respuesta);
  });

  it("Cidituc caído: no_disponible, distinto de un token inválido", async () => {
    simulado.respuestaCidituc = { status: 503, body: "" };
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, null)));
    expect(destino(respuesta).searchParams.get("error")).toBe("no_disponible");
  });
});

describe("GET /auth/callback: el ingreso", () => {
  it("emite la sesión, registra el ingreso y redirige a una URL limpia", async () => {
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, null)));

    expect(respuesta.status).toBe(303);
    expect(respuesta.headers.get("location")).toBe("/bandeja");
    expect(respuesta.headers.get("location")).not.toContain("auth=");
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    expect(respuesta.headers.get("referrer-policy")).toBe("no-referrer");
    expectStateBorrado(respuesta);

    const cookie = respuesta.cookies.get(COOKIE_SESION);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
    const verificada = await verificarSesion(cookie?.value ?? "", SECRETO);
    expect(verificada).toMatchObject({ ok: true, sesion: { usuarioId: 42, sesionVersion: 7 } });

    expect(simulado.actores).toEqual([{ actor: 42, motivo: "ingreso" }]);
    expect(simulado.accesos).toEqual([
      { usuarioId: 42, accion: "ingreso", ip: "10.0.0.7", detalle: { via: "cidituc", primer_ingreso: true } },
    ]);
  });

  it("vuelve a donde iba la persona (el QR de una carátula)", async () => {
    const respuesta = await GET(
      callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, "/expedientes/2026-00012")),
    );
    expect(respuesta.headers.get("location")).toBe("/expedientes/2026-00012");
  });

  it("Dirección y el admin empiezan en el panel", async () => {
    simulado.usuario = { ...simulado.usuario, rol: "lectura" };
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, null)));
    expect(respuesta.headers.get("location")).toBe("/panel");
  });

  it("sin alta: /sin-acceso con nombre y CUIL firmados en una cookie, y registra ingreso_rechazado", async () => {
    simulado.usuario = null;
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, null)));

    expect(respuesta.headers.get("location")).toBe("/sin-acceso");
    expect(respuesta.cookies.get(COOKIE_SESION)?.value ?? "").toBe("");
    const aviso = respuesta.cookies.get(COOKIE_SIN_ACCESO);
    expect(aviso).toMatchObject({ httpOnly: true, path: "/sin-acceso", maxAge: 600 });
    expect(await verificarSinAcceso(aviso?.value ?? "", SECRETO)).toEqual({
      cuil: "20000000001",
      nombre: "Agente",
      apellido: "Ficticio",
      motivo: "sin_alta",
    });
    expect(simulado.actores).toEqual([{ actor: 1, motivo: "ingreso_rechazado" }]);
    expect(simulado.accesos).toEqual([
      expect.objectContaining({ usuarioId: null, accion: "ingreso_rechazado", ip: "10.0.0.7" }),
    ]);
  });

  it("si el CUIL está vinculado a otra cuenta de Cidituc, rechaza con cidituc_distinto", async () => {
    simulado.usuario = { ...simulado.usuario, ciditucId: "1234" };
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, null)));
    expect(destino(respuesta).searchParams.get("error")).toBe("cidituc_distinto");
    expect(respuesta.cookies.get(COOKIE_SESION)).toBeUndefined();
    expect(simulado.accesos).toEqual([expect.objectContaining({ usuarioId: 42, accion: "ingreso_rechazado" })]);
  });

  it("si la base falla, error_interno (no 'Cidituc no está disponible')", async () => {
    simulado.fallaBase = new Error("conexión rechazada");
    const respuesta = await GET(callback({ auth: TOKEN, state: STATE }, codificarFlujo(STATE, null)));
    expect(destino(respuesta).searchParams.get("error")).toBe("error_interno");
    expect(respuesta.cookies.get(COOKIE_SESION)).toBeUndefined();
  });
});
