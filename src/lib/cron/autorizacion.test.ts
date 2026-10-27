import { afterEach, describe, expect, it, vi } from "vitest";
import { correrCron, cronAutorizado } from "./autorizacion";

const SECRETO = "cron-secreto-de-prueba-con-mas-de-32-caracteres";

function pedido(authorization?: string): Request {
  return new Request("https://cementeria.example/api/cron/avisos", { headers: authorization ? { authorization } : {} });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autenticación de los crons (Authorization: Bearer CRON_SECRET)", () => {
  it("solo con el encabezado exacto", () => {
    expect(cronAutorizado(`Bearer ${SECRETO}`, SECRETO)).toBe(true);
    expect(cronAutorizado(`Bearer ${SECRETO}x`, SECRETO)).toBe(false);
    expect(cronAutorizado(`bearer ${SECRETO}`, SECRETO)).toBe(false);
    expect(cronAutorizado(SECRETO, SECRETO)).toBe(false);
    expect(cronAutorizado(`Bearer ${SECRETO.slice(0, -1)}`, SECRETO)).toBe(false);
    expect(cronAutorizado(null, SECRETO)).toBe(false);
  });

  it("sin CRON_SECRET (o con uno corto) no entra nadie, ni con 'Bearer ' vacío", () => {
    expect(cronAutorizado("Bearer ", undefined)).toBe(false);
    expect(cronAutorizado("Bearer undefined", undefined)).toBe(false);
    expect(cronAutorizado("Bearer ", "")).toBe(false);
    expect(cronAutorizado("Bearer corto", "corto")).toBe(false);
  });

  it("401 sin correr la tarea; con el secreto, corre y responde el resumen", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const tarea = vi.fn(async () => ({ ok: true, datos: { creados: 3 } }));
    const sin = await correrCron(pedido(), "avisos", tarea, SECRETO);
    expect(sin.status).toBe(401);
    expect((await correrCron(pedido("Bearer otro"), "avisos", tarea, SECRETO)).status).toBe(401);
    expect((await correrCron(pedido(`Bearer ${SECRETO}`), "avisos", tarea, undefined)).status).toBe(401);
    expect(tarea).not.toHaveBeenCalled();

    const con = await correrCron(pedido(`Bearer ${SECRETO}`), "avisos", tarea, SECRETO);
    expect(con.status).toBe(200);
    expect(await con.json()).toEqual({ ok: true, tarea: "avisos", creados: 3 });
    expect(con.headers.get("cache-control")).toBe("no-store");
  });

  it("problema encontrado: 500 con el resumen; error inesperado: 500 sin detalles, y el log no lleva el secreto", async () => {
    const lineas: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: string) => void lineas.push(l));
    vi.spyOn(console, "warn").mockImplementation((l: string) => void lineas.push(l));
    const rota = await correrCron(pedido(`Bearer ${SECRETO}`), "historial", async () => ({ ok: false, datos: { rotos: 1 } }), SECRETO);
    expect(rota.status).toBe(500);
    expect(await rota.json()).toMatchObject({ ok: false, rotos: 1 });
    const falla = await correrCron(
      pedido(`Bearer ${SECRETO}`),
      "avisos",
      async () => {
        throw new Error("la base no responde\nSELECT … con datos");
      },
      SECRETO,
    );
    expect(falla.status).toBe(500);
    expect(await falla.json()).toEqual({ ok: false, tarea: "avisos", error: "La tarea falló: ver el log" });
    await correrCron(pedido("Bearer intento"), "avisos", async () => ({ ok: true, datos: {} }), SECRETO);
    expect(lineas.join("\n")).not.toContain(SECRETO);
    expect(lineas.join("\n")).not.toContain("con datos");
  });
});
