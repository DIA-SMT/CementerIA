import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("SESSION_SECRET", "secreto-de-prueba-que-tiene-mas-de-32-caracteres");
vi.stubEnv("CIDITUC_HABILITADO", "1");
vi.stubEnv("CIDITUC_API_URL", "https://cidituc.prueba.invalid:5000");
// Como en un .env.local mal escrito: el fragmento de la variable se reemplaza.
vi.stubEnv("CIDITUC_DERIVADOR_URL", "https://cidituc.smt.gob.ar/#/login?next=otra");

const { GET } = await import("./route");
const { COOKIE_STATE, leerFlujo } = await import("@/lib/auth/cidituc/derivador");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /auth/ingresar", () => {
  it("genera el state, lo guarda en cem_cidituc_state y manda al derivador con next=cementeria", async () => {
    const respuesta = await GET(new NextRequest("https://cementeria.ejemplo.invalid/auth/ingresar"));
    expect(respuesta.status).toBe(303);

    const cookie = respuesta.cookies.get(COOKIE_STATE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
    const flujo = leerFlujo(cookie?.value);
    expect(flujo?.volver).toBeNull();

    const ubicacion = respuesta.headers.get("location") ?? "";
    expect(ubicacion).toBe(`https://cidituc.smt.gob.ar/#/login?next=cementeria&state=${flujo?.state}`);
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
  });

  it("cada ingreso tiene su propio state", async () => {
    const a = await GET(new NextRequest("https://cementeria.ejemplo.invalid/auth/ingresar"));
    const b = await GET(new NextRequest("https://cementeria.ejemplo.invalid/auth/ingresar"));
    expect(a.cookies.get(COOKIE_STATE)?.value).not.toBe(b.cookies.get(COOKIE_STATE)?.value);
  });

  it("guarda el destino saneado en la cookie, no en la URL del derivador", async () => {
    const respuesta = await GET(
      new NextRequest("https://cementeria.ejemplo.invalid/auth/ingresar?volver=%2Fexpedientes%2F2026-00012"),
    );
    expect(leerFlujo(respuesta.cookies.get(COOKIE_STATE)?.value)?.volver).toBe("/expedientes/2026-00012");
    expect(respuesta.headers.get("location")).not.toContain("expedientes");
  });

  it("descarta un destino a otro sitio", async () => {
    const respuesta = await GET(
      new NextRequest("https://cementeria.ejemplo.invalid/auth/ingresar?volver=%2F%2Fotro.sitio"),
    );
    expect(leerFlujo(respuesta.cookies.get(COOKIE_STATE)?.value)?.volver).toBeNull();
  });
});
