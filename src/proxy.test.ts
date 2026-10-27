import { decodeJwt } from "jose";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { COOKIE_SESION, emitirSesion, segundosAhora } from "@/lib/auth/sesion-token";

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
vi.stubEnv("SESSION_SECRET", SECRETO);

const { config, proxy } = await import("./proxy");

function corre(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url, nextConfig: {} });
}

describe("matcher del proxy", () => {
  it.each([
    "/",
    "/bandeja",
    "/expedientes",
    "/expedientes/2026-00012",
    "/expedientes/2026-00012/imprimir?hoja=caratula",
    "/panel?x=1",
    "/admin/usuarios",
    "/adjuntos/123?descargar=1",
    "/api/expedientes/2026-00012/otra-cosa",
    // Las páginas de avisos sí renuevan la sesión (es actividad de la persona).
    "/avisos",
    "/api/avisos/otra-cosa",
    "/api/cronx",
    // Un prefijo parecido no alcanza para quedar afuera.
    "/loginx",
    "/dev/loginx",
    "/sin-accesox",
  ])("corre en %s", (url) => {
    expect(corre(url)).toBe(true);
  });

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image?url=%2Flogo.png&w=64&q=75",
    "/favicon.ico",
    "/logo.svg",
    "/login",
    "/login?error=state_vencido&volver=%2Fbandeja",
    "/auth/ingresar",
    "/auth/callback?auth=token-ficticio&state=x",
    "/auth/salir",
    "/dev/login",
    "/dev/login/entrar",
    "/sin-acceso",
    "/api/salud",
    // La subida de adjuntos se autentica sola: el proxy no toca ese cuerpo.
    "/api/expedientes/2026-00012/adjuntos",
    // La subida directa a Supabase Storage (Vercel): igual.
    "/api/expedientes/2026-00012/adjuntos/autorizar",
    "/api/expedientes/2026-00012/adjuntos/confirmar",
    // El refresco automático de la campana no renueva la sesión (se verifica en la ruta).
    "/api/avisos/resumen",
    // Vercel Cron: sin sesión, con Authorization: Bearer CRON_SECRET.
    "/api/cron/avisos",
    "/api/cron/historial",
    "/api/cron/adjuntos-tmp",
  ])("no corre en %s", (url) => {
    expect(corre(url)).toBe(false);
  });
});

async function token(edadSeg = 0, inicioHaceSeg = edadSeg): Promise<string> {
  const ahora = segundosAhora();
  const emitido = await emitirSesion(
    { usuarioId: 42, sesionVersion: 3, inicio: ahora - inicioHaceSeg },
    SECRETO,
    ahora - edadSeg,
  );
  if (!emitido) throw new Error("se esperaba un token");
  return emitido.token;
}

function solicitud(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, { headers: cookie ? { cookie: `${COOKIE_SESION}=${cookie}` } : {} });
}

describe("proxy", () => {
  it("sin sesión redirige a /login recordando a dónde iba", async () => {
    const respuesta = await proxy(solicitud("https://cementeria.ejemplo.invalid/expedientes/2026-00012?x=1"));
    expect(respuesta.status).toBe(303);
    expect(respuesta.headers.get("location")).toBe(
      "https://cementeria.ejemplo.invalid/login?volver=%2Fexpedientes%2F2026-00012%3Fx%3D1",
    );
    expect(respuesta.headers.get("set-cookie")).toBeNull();
  });

  it("con sesión válida deja pasar y renueva la cookie con iat nuevo y el mismo inicio", async () => {
    const vieja = await token(20 * 60, 3 * 60 * 60);
    const respuesta = await proxy(solicitud("https://cementeria.ejemplo.invalid/bandeja", vieja));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("x-middleware-next")).toBe("1");

    const cookie = respuesta.cookies.get(COOKIE_SESION);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 });
    const antes = decodeJwt(vieja);
    const despues = decodeJwt(cookie?.value ?? "");
    expect(despues.inicio).toBe(antes.inicio);
    expect(despues.sub).toBe("42");
    expect(despues.sv).toBe(3);
    expect(Number(despues.iat)).toBeGreaterThan(Number(antes.iat));
  });

  it("cerca de las 10 h la cookie dura solo lo que le queda a la sesión", async () => {
    const respuesta = await proxy(solicitud("https://cementeria.ejemplo.invalid/panel", await token(5 * 60, 9.75 * 60 * 60)));
    const maxAge = respuesta.cookies.get(COOKIE_SESION)?.maxAge ?? 0;
    expect(maxAge).toBeGreaterThan(14 * 60);
    expect(maxAge).toBeLessThanOrEqual(15 * 60);
  });

  it("con la sesión vencida por inactividad redirige avisando y borra la cookie", async () => {
    const respuesta = await proxy(solicitud("https://cementeria.ejemplo.invalid/bandeja", await token(61 * 60)));
    expect(respuesta.status).toBe(303);
    expect(respuesta.headers.get("location")).toBe(
      "https://cementeria.ejemplo.invalid/login?error=sesion_vencida&volver=%2Fbandeja",
    );
    expect(respuesta.cookies.get(COOKIE_SESION)).toMatchObject({ value: "", maxAge: 0, path: "/" });
  });

  it("con la sesión de más de 10 h también", async () => {
    const respuesta = await proxy(solicitud("https://cementeria.ejemplo.invalid/panel", await token(10 * 60, 10 * 60 * 60)));
    expect(respuesta.headers.get("location")).toContain("error=sesion_vencida");
  });

  it("con una cookie falsificada redirige y la borra", async () => {
    const respuesta = await proxy(solicitud("https://cementeria.ejemplo.invalid/admin", "eyJhbGciOiJub25lIn0.e30."));
    expect(respuesta.status).toBe(303);
    expect(respuesta.cookies.get(COOKIE_SESION)?.value).toBe("");
  });

  it("una API sin sesión responde 401 en vez de redirigir", async () => {
    const respuesta = await proxy(solicitud("https://cementeria.ejemplo.invalid/api/expedientes/2026-00012/otra"));
    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ error: "Sin sesión" });
  });

  it("en http://localhost (next dev) la cookie va sin Secure, para que el navegador la guarde", async () => {
    const respuesta = await proxy(solicitud("http://localhost:3000/bandeja", await token(60)));
    expect(respuesta.cookies.get(COOKIE_SESION)?.secure).toBe(false);
  });
});
