import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
vi.stubEnv("SESSION_SECRET", SECRETO);
vi.stubEnv("AUTH_DEV_LOGIN", "1");

const simulado = vi.hoisted(() => ({
  filas: new Map<number, { cuil: string; activo: boolean }>(),
  ingresos: [] as number[],
}));

vi.mock("@/lib/db/cliente", () => ({
  prisma: { usuario: { findUnique: async ({ where }: { where: { id: number } }) => simulado.filas.get(where.id) ?? null } },
}));
vi.mock("@/lib/auth/sesion", () => ({ dependenciasIngreso: {} }));
vi.mock("@/lib/auth/ingreso", async (original) => ({
  ...(await original<typeof import("@/lib/auth/ingreso")>()),
  ingresarSimulado: async (_deps: unknown, usuarioId: number) => {
    simulado.ingresos.push(usuarioId);
    return { ok: true, usuario: { id: usuarioId, rol: "admin", sesionVersion: 2 }, primerIngreso: false };
  },
}));

const { POST } = await import("./route");
const { COOKIE_SESION, verificarSesion } = await import("@/lib/auth/sesion-token");

function entrar(campos: Record<string, string>, origen = "http://localhost:3000"): NextRequest {
  return new NextRequest("http://localhost:3000/dev/login/entrar", {
    method: "POST",
    headers: { host: "localhost:3000", origin: origen, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(campos).toString(),
  });
}

beforeEach(() => {
  simulado.filas = new Map([
    [5, { cuil: "20000000001", activo: true }],
    [6, { cuil: "27000000022", activo: false }],
  ]);
  simulado.ingresos = [];
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /dev/login/entrar", () => {
  it("entra como el usuario elegido, con una sesión real, y va a su inicio", async () => {
    const respuesta = await POST(entrar({ usuarioId: "5" }));
    expect(respuesta.status).toBe(303);
    expect(respuesta.headers.get("location")).toBe("/panel");
    expect(simulado.ingresos).toEqual([5]);
    const cookie = respuesta.cookies.get(COOKIE_SESION);
    // http://localhost en desarrollo: sin Secure, o el navegador no la guarda.
    expect(cookie).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax" });
    expect(await verificarSesion(cookie?.value ?? "", SECRETO)).toMatchObject({
      ok: true,
      sesion: { usuarioId: 5, sesionVersion: 2 },
    });
  });

  it("respeta el destino, saneado", async () => {
    expect((await POST(entrar({ usuarioId: "5", volver: "/admin" }))).headers.get("location")).toBe(
      "/admin",
    );
    expect((await POST(entrar({ usuarioId: "5", volver: "//otro.sitio" }))).headers.get("location")).toBe(
      "/panel",
    );
  });

  it("un usuario inactivo o inexistente da 404, sin registrar ingreso", async () => {
    expect((await POST(entrar({ usuarioId: "6" }))).status).toBe(404);
    expect((await POST(entrar({ usuarioId: "99" }))).status).toBe(404);
    expect(simulado.ingresos).toHaveLength(0);
  });

  it.each(["", "abc", "0", "-1", "1.5", "1e3"])("un usuarioId %j da 400", async (usuarioId) => {
    expect((await POST(entrar({ usuarioId }))).status).toBe(400);
  });

  it("un POST desde otro sitio da 403", async () => {
    expect((await POST(entrar({ usuarioId: "5" }, "https://otro.sitio"))).status).toBe(403);
    expect(simulado.ingresos).toHaveLength(0);
  });
});
