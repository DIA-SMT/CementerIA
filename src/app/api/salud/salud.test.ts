import { describe, expect, it, vi } from "vitest";
import { comprobarSalud, versionDelBuild } from "./salud";

describe("comprobarSalud", () => {
  it("200 con la versión si la base responde", async () => {
    const alFallar = vi.fn();
    const r = await comprobarSalud(async () => [{ "?column?": 1 }], "0.1.0-abc1234", alFallar);
    expect(r).toEqual({ status: 200, cuerpo: { estado: "ok", version: "0.1.0-abc1234", base: "ok" } });
    expect(alFallar).not.toHaveBeenCalled();
  });

  it("503 si la consulta falla, sin el mensaje del error en la respuesta", async () => {
    const alFallar = vi.fn();
    const error = new Error("connect ECONNREFUSED 10.0.0.5:5432 postgresql://cementeria_app:secreto@db");
    const r = await comprobarSalud(() => Promise.reject(error), "v", alFallar);
    expect(r.status).toBe(503);
    expect(r.cuerpo).toEqual({ estado: "degradado", version: "v", base: "sin_respuesta" });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(JSON.stringify(r)).not.toContain("10.0.0.5");
    expect(alFallar).toHaveBeenCalledWith(error);
  });

  it("503 si la base no contesta a tiempo", async () => {
    vi.useFakeTimers();
    try {
      const alFallar = vi.fn();
      const pendiente = comprobarSalud(() => new Promise(() => undefined), "v", alFallar, 3000);
      await vi.advanceTimersByTimeAsync(3000);
      const r = await pendiente;
      expect(r.status).toBe(503);
      expect(alFallar).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("versionDelBuild", () => {
  it("toma NEXT_DEPLOYMENT_ID, que pone npm run empaquetar, con los puntos de la versión", () => {
    expect(versionDelBuild({ NEXT_DEPLOYMENT_ID: "0_1_0-abc1234" })).toBe("0.1.0-abc1234");
    expect(versionDelBuild({ NEXT_DEPLOYMENT_ID: "0_1_0-arbol-abc1234" })).toBe("0.1.0-arbol-abc1234");
    expect(versionDelBuild({ NEXT_DEPLOYMENT_ID: "otro_id" })).toBe("otro_id");
  });

  it("en Vercel, el commit (el id dpl_… no dice qué código corre)", () => {
    expect(versionDelBuild({ VERCEL_GIT_COMMIT_SHA: "3d7e88b0123456789" })).toBe("vercel-3d7e88b");
    expect(versionDelBuild({ VERCEL_GIT_COMMIT_SHA: "3d7e88b0123456789", NEXT_DEPLOYMENT_ID: "dpl_AbC" })).toBe("vercel-3d7e88b");
    expect(versionDelBuild({ VERCEL_GIT_COMMIT_SHA: "3d7e88b0123456789", NEXT_DEPLOYMENT_ID: "0_1_0-abc1234" })).toBe("0.1.0-abc1234");
  });

  it("fuera de un paquete dice desarrollo", () => {
    expect(versionDelBuild({})).toBe("desarrollo");
    expect(versionDelBuild({ NEXT_DEPLOYMENT_ID: " " })).toBe("desarrollo");
  });
});
