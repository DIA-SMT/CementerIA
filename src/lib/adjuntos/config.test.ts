import { describe, expect, it } from "vitest";
import { configAlmacen, modoDeSubida, problemasAlmacen, tipoDeAlmacen } from "./config";
import { firmarTicket, verificarTicket, VIGENCIA_TICKET_MS } from "./ticket";

const URL_SB = "https://abcdefghijklmnop.supabase.co";
const CLAVE = "sb_secret_0123456789abcdef";

describe("ADJUNTOS_ALMACEN", () => {
  it("por defecto el disco, con la subida por la app; supabase, con la subida directa", () => {
    expect(tipoDeAlmacen({})).toBe("disco");
    expect(modoDeSubida({})).toBe("app");
    expect(tipoDeAlmacen({ ADJUNTOS_ALMACEN: "Supabase " })).toBe("supabase");
    expect(modoDeSubida({ ADJUNTOS_ALMACEN: "supabase" })).toBe("directa");
    expect(configAlmacen({ ADJUNTOS_ALMACEN: "supabase", SUPABASE_URL: URL_SB, SUPABASE_SECRET_KEY: CLAVE })).toEqual({ tipo: "supabase", url: URL_SB, clave: CLAVE });
  });

  it("disco en producción: ADJUNTOS_DIR obligatoria y absoluta (como antes)", () => {
    expect(problemasAlmacen({}, true)).toEqual([expect.stringMatching(/^ADJUNTOS_DIR: falta/)]);
    expect(problemasAlmacen({ ADJUNTOS_DIR: "rel/ativa" }, true)).toEqual([expect.stringMatching(/ruta absoluta/)]);
    expect(problemasAlmacen({ ADJUNTOS_DIR: "/var/lib/cementeria/adjuntos" }, true)).toEqual([]);
    expect(problemasAlmacen({}, false)).toEqual([]);
  });

  it("en Vercel y producción no hay disco", () => {
    expect(problemasAlmacen({ VERCEL: "1", ADJUNTOS_DIR: "/tmp/x" }, true)).toEqual([expect.stringMatching(/^ADJUNTOS_ALMACEN: en Vercel/)]);
  });

  it("supabase: no pide ADJUNTOS_DIR; sí SUPABASE_URL (https, solo el origen) y la clave SECRETA", () => {
    const base = { ADJUNTOS_ALMACEN: "supabase" };
    expect(problemasAlmacen({ ...base, SUPABASE_URL: URL_SB, SUPABASE_SECRET_KEY: CLAVE }, true)).toEqual([]);
    expect(problemasAlmacen(base, true)).toEqual([expect.stringMatching(/^SUPABASE_URL: falta/), expect.stringMatching(/^SUPABASE_SECRET_KEY: falta/)]);
    expect(problemasAlmacen({ ...base, SUPABASE_URL: "http://x.supabase.co", SUPABASE_SECRET_KEY: CLAVE }, true)).toEqual([expect.stringMatching(/https/)]);
    expect(problemasAlmacen({ ...base, SUPABASE_URL: `${URL_SB}/storage/v1`, SUPABASE_SECRET_KEY: CLAVE }, true)).toEqual([expect.stringMatching(/solo el origen/)]);
    const publicable = problemasAlmacen({ ...base, SUPABASE_URL: URL_SB, SUPABASE_SECRET_KEY: "sb_publishable_xyz" }, true);
    expect(publicable).toEqual([expect.stringMatching(/clave publicable/)]);
    expect(problemasAlmacen({ ...base, SUPABASE_URL: URL_SB, SUPABASE_SECRET_KEY: "cualquiera" }, true)).toEqual([expect.stringMatching(/no parece/)]);
    // Los mensajes nunca llevan el valor.
    expect(publicable.join(" ")).not.toContain("sb_publishable_xyz");
    expect(problemasAlmacen({ ADJUNTOS_ALMACEN: "s3" }, true)).toEqual(["ADJUNTOS_ALMACEN: tiene que ser disco o supabase"]);
  });
});

describe("ticket de la subida directa", () => {
  const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
  const id = "0b0e7c6e-5a1f-4e43-9a43-0e7d2b6f1c11";
  const destino = { usuarioId: 7, numero: "2026-00012", comando: "6f1c9a43-0e7d-4e43-9a43-0b0e7c6e5a1f" };

  it("vale para el mismo usuario, expediente y comando, hasta que vence", () => {
    const t = firmarTicket(SECRETO, destino, id, 1_000_000);
    expect(verificarTicket(SECRETO, t, destino, 1_000_000)).toEqual({ ok: true, id });
    // El número, sin importar mayúsculas (la ruta puede llegar en minúsculas).
    expect(verificarTicket(SECRETO, t, { ...destino, numero: "2026-00012 " }, 1_000_000)).toEqual({ ok: true, id });
    expect(verificarTicket(SECRETO, t, destino, 1_000_000 + VIGENCIA_TICKET_MS + 1000)).toEqual({ ok: false, motivo: "vencido" });
  });

  it("no sirve para otro usuario, expediente, comando, temporal ni con otro secreto", () => {
    const t = firmarTicket(SECRETO, destino, id, 1_000_000);
    const invalido = { ok: false, motivo: "invalido" };
    expect(verificarTicket(SECRETO, t, { ...destino, usuarioId: 8 }, 1_000_000)).toEqual(invalido);
    expect(verificarTicket(SECRETO, t, { ...destino, numero: "2026-00013" }, 1_000_000)).toEqual(invalido);
    expect(verificarTicket(SECRETO, t, { ...destino, comando: "otro" }, 1_000_000)).toEqual(invalido);
    expect(verificarTicket(`${SECRETO}x`, t, destino, 1_000_000)).toEqual(invalido);
    const [, vence, firma] = t.split(".");
    expect(verificarTicket(SECRETO, `1b0e7c6e-5a1f-4e43-9a43-0e7d2b6f1c11.${vence}.${firma}`, destino, 1_000_000)).toEqual(invalido);
    expect(verificarTicket(SECRETO, `${id}.${Number(vence) + 3600}.${firma}`, destino, 1_000_000)).toEqual(invalido);
    expect(verificarTicket(SECRETO, "basura", destino, 1_000_000)).toEqual(invalido);
    expect(verificarTicket(SECRETO, "", destino, 1_000_000)).toEqual(invalido);
  });
});
