import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("SESSION_SECRET", "secreto-de-prueba-que-tiene-mas-de-32-caracteres");

const simulado = vi.hoisted(() => ({
  usuario: null as null | { id: number; sesionVersion: number },
  cierres: [] as { usuarioId: number; sesionVersion: number; ip: string | null }[],
  falla: null as Error | null,
}));

vi.mock("@/lib/auth/sesion", () => ({
  sesionDesdeToken: async (token: string | undefined) => (token ? simulado.usuario : null),
  dependenciasIngreso: {},
}));

vi.mock("@/lib/auth/ingreso", () => ({
  cerrarSesion: async (_deps: unknown, usuarioId: number, sesionVersion: number, ip: string | null) => {
    if (simulado.falla) throw simulado.falla;
    simulado.cierres.push({ usuarioId, sesionVersion, ip });
    return true;
  },
}));

const { POST } = await import("./route");
const { COOKIE_SESION, COOKIE_SIN_ACCESO } = await import("@/lib/auth/sesion-token");

const ORIGEN = "https://cementeria.ejemplo.invalid";

function salir(cabeceras: Record<string, string>): NextRequest {
  return new NextRequest(`${ORIGEN}/auth/salir`, {
    method: "POST",
    headers: { host: "cementeria.ejemplo.invalid", "x-real-ip": "10.0.0.7", ...cabeceras },
  });
}

beforeEach(() => {
  simulado.usuario = { id: 42, sesionVersion: 3 };
  simulado.cierres = [];
  simulado.falla = null;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /auth/salir", () => {
  it("cierra todas las sesiones del usuario (sesion_version), borra las cookies y va a /login", async () => {
    const respuesta = await POST(salir({ origin: ORIGEN, cookie: `${COOKIE_SESION}=token-ficticio` }));
    expect(respuesta.status).toBe(303);
    expect(respuesta.headers.get("location")).toBe("/login?salida=1");
    expect(simulado.cierres).toEqual([{ usuarioId: 42, sesionVersion: 3, ip: "10.0.0.7" }]);
    expect(respuesta.cookies.get(COOKIE_SESION)).toMatchObject({ value: "", maxAge: 0, path: "/" });
    expect(respuesta.cookies.get(COOKIE_SIN_ACCESO)).toMatchObject({ value: "", maxAge: 0, path: "/sin-acceso" });
  });

  it("sin sesión (desde /sin-acceso) solo borra las cookies", async () => {
    const respuesta = await POST(salir({ origin: ORIGEN }));
    expect(respuesta.status).toBe(303);
    expect(simulado.cierres).toHaveLength(0);
  });

  it("si la base falla, la cookie se borra igual", async () => {
    simulado.falla = new Error("base caída");
    const respuesta = await POST(salir({ origin: ORIGEN, cookie: `${COOKIE_SESION}=token-ficticio` }));
    expect(respuesta.status).toBe(303);
    expect(respuesta.cookies.get(COOKIE_SESION)?.value).toBe("");
  });

  it("un POST desde otro sitio no cierra nada", async () => {
    const respuesta = await POST(salir({ origin: "https://otro.sitio", cookie: `${COOKIE_SESION}=token-ficticio` }));
    expect(respuesta.status).toBe(403);
    expect(simulado.cierres).toHaveLength(0);
  });
});
