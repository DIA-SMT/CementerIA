import { decodeJwt, decodeProtectedHeader, SignJWT, UnsecuredJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  COOKIE_SESION,
  DURACION_MAXIMA_SEG,
  emitirSesion,
  firmarSinAcceso,
  INACTIVIDAD_MAXIMA_SEG,
  renovarSesion,
  verificarSesion,
  verificarSinAcceso,
  VIDA_SIN_ACCESO_SEG,
} from "./sesion-token";

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
const OTRO_SECRETO = "otro-secreto-de-prueba-tambien-de-mas-de-32-caracteres";
const T0 = 1_792_400_000; // un instante fijo cualquiera (segundos epoch)
const MIN = 60;
const HORA = 60 * MIN;

async function emitir(ahora = T0, inicio = ahora, datos: { usuarioId?: number; sesionVersion?: number } = {}) {
  const emitido = await emitirSesion(
    { usuarioId: datos.usuarioId ?? 42, sesionVersion: datos.sesionVersion ?? 3, inicio },
    SECRETO,
    ahora,
  );
  if (!emitido) throw new Error("se esperaba un token");
  return emitido;
}

describe("constantes de la sesión", () => {
  it("cookie cem_sesion, 60 min de inactividad y 10 h como máximo", () => {
    expect(COOKIE_SESION).toBe("cem_sesion");
    expect(INACTIVIDAD_MAXIMA_SEG).toBe(HORA);
    expect(DURACION_MAXIMA_SEG).toBe(10 * HORA);
  });
});

describe("emitirSesion", () => {
  it("firma con HS256 un token con {sub, sv, iat, inicio} y nada del rol ni el área", async () => {
    const { token } = await emitir();
    expect(decodeProtectedHeader(token).alg).toBe("HS256");
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({ sub: "42", sv: 3, iat: T0, inicio: T0, exp: T0 + HORA });
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "inicio", "sub", "sv"]);
  });

  it("la cookie vive lo que le queda a la sesión: 60 min, o menos cerca de las 10 h", async () => {
    expect((await emitir()).maxAge).toBe(HORA);
    const cerca = await emitir(T0 + 9 * HORA + 30 * MIN, T0);
    expect(cerca.maxAge).toBe(30 * MIN);
    expect(decodeJwt(cerca.token).exp).toBe(T0 + 10 * HORA);
  });

  it("no emite una sesión que ya cumplió las 10 h", async () => {
    expect(await emitirSesion({ usuarioId: 42, sesionVersion: 0, inicio: T0 }, SECRETO, T0 + 10 * HORA)).toBeNull();
  });

  it("no emite con un inicio en el futuro", async () => {
    expect(await emitirSesion({ usuarioId: 42, sesionVersion: 0, inicio: T0 + HORA }, SECRETO, T0)).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])("rechaza usuarioId %s", async (usuarioId) => {
    await expect(emitirSesion({ usuarioId, sesionVersion: 0, inicio: T0 }, SECRETO, T0)).rejects.toThrow(
      /usuarioId/,
    );
  });

  it("rechaza una sesionVersion negativa", async () => {
    await expect(emitirSesion({ usuarioId: 1, sesionVersion: -1, inicio: T0 }, SECRETO, T0)).rejects.toThrow(
      /sesionVersion/,
    );
  });

  it("se niega a firmar con un secreto corto", async () => {
    await expect(emitirSesion({ usuarioId: 1, sesionVersion: 0, inicio: T0 }, "corto", T0)).rejects.toThrow(/32/);
  });
});

describe("verificarSesion", () => {
  it("acepta un token recién emitido y devuelve la sesión", async () => {
    const { token } = await emitir();
    expect(await verificarSesion(token, SECRETO, T0 + 5 * MIN)).toEqual({
      ok: true,
      sesion: { usuarioId: 42, sesionVersion: 3, emitidaEn: T0, inicio: T0 },
    });
  });

  it("vence a los 60 min sin actividad", async () => {
    const { token } = await emitir();
    expect((await verificarSesion(token, SECRETO, T0 + HORA - 1)).ok).toBe(true);
    expect(await verificarSesion(token, SECRETO, T0 + HORA)).toEqual({ ok: false, motivo: "inactividad" });
    expect(await verificarSesion(token, SECRETO, T0 + 3 * HORA)).toEqual({ ok: false, motivo: "inactividad" });
  });

  it("vence a las 10 h del ingreso aunque haya actividad", async () => {
    const { token } = await emitir(T0 + 9 * HORA + 30 * MIN, T0);
    expect((await verificarSesion(token, SECRETO, T0 + 10 * HORA - 1)).ok).toBe(true);
    expect(await verificarSesion(token, SECRETO, T0 + 10 * HORA)).toEqual({ ok: false, motivo: "duracion" });
  });

  it("no confía solo en exp: recalcula los vencimientos desde iat e inicio", async () => {
    // Un token "de otra versión" con un exp generoso no estira la sesión.
    const token = await new SignJWT({ sv: 0, inicio: T0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("42")
      .setAudience("cementeria:sesion")
      .setIssuedAt(T0)
      .setExpirationTime(T0 + 48 * HORA)
      .sign(new TextEncoder().encode(SECRETO));
    expect(await verificarSesion(token, SECRETO, T0 + 2 * HORA)).toEqual({ ok: false, motivo: "inactividad" });
    expect(await verificarSesion(token, SECRETO, T0 + 11 * HORA)).toEqual({ ok: false, motivo: "duracion" });
  });

  it("rechaza la firma de otro secreto", async () => {
    const { token } = await emitir();
    expect(await verificarSesion(token, OTRO_SECRETO, T0)).toEqual({ ok: false, motivo: "firma" });
  });

  it("rechaza un token alterado", async () => {
    const { token } = await emitir();
    const [cabecera, , firma] = token.split(".");
    const otroCuerpo = Buffer.from(JSON.stringify({ ...decodeJwt(token), sub: "1" })).toString("base64url");
    expect(await verificarSesion(`${cabecera}.${otroCuerpo}.${firma}`, SECRETO, T0)).toEqual({
      ok: false,
      motivo: "firma",
    });
  });

  it("rechaza un token sin firmar (alg none)", async () => {
    const token = new UnsecuredJWT({ sv: 0, inicio: T0 })
      .setSubject("42")
      .setAudience("cementeria:sesion")
      .setIssuedAt(T0)
      .setExpirationTime(T0 + HORA)
      .encode();
    expect(await verificarSesion(token, SECRETO, T0)).toEqual({ ok: false, motivo: "firma" });
  });

  it.each(["", "basura", "a.b.c"])("rechaza %j", async (token) => {
    expect(await verificarSesion(token, SECRETO, T0)).toEqual({ ok: false, motivo: "firma" });
  });

  it("rechaza un iat en el futuro (más allá del margen de reloj)", async () => {
    const { token } = await emitir(T0 + 10 * MIN, T0 + 10 * MIN);
    expect((await verificarSesion(token, SECRETO, T0 + 9 * MIN)).ok).toBe(true);
    expect(await verificarSesion(token, SECRETO, T0)).toEqual({ ok: false, motivo: "futuro" });
  });

  it.each([
    ["sub no numérico", { sv: 0, inicio: T0 }, "abc"],
    ["sub cero", { sv: 0, inicio: T0 }, "0"],
    ["sin sv", { inicio: T0 }, "42"],
    ["sv negativo", { sv: -1, inicio: T0 }, "42"],
    ["sv de texto", { sv: "0", inicio: T0 }, "42"],
    ["sin inicio", { sv: 0 }, "42"],
    ["inicio posterior a iat", { sv: 0, inicio: T0 + 1 }, "42"],
  ])("rechaza la forma: %s", async (_caso, claims, sub) => {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setAudience("cementeria:sesion")
      .setIssuedAt(T0)
      .setExpirationTime(T0 + HORA)
      .sign(new TextEncoder().encode(SECRETO));
    expect(await verificarSesion(token, SECRETO, T0)).toEqual({ ok: false, motivo: "forma" });
  });

  it("un token de /sin-acceso no sirve como sesión aunque lo firme el mismo secreto", async () => {
    const token = await firmarSinAcceso(
      { cuil: "20000000001", nombre: "Agente", apellido: "Ficticio", motivo: "sin_alta" },
      SECRETO,
      T0,
    );
    expect(await verificarSesion(token, SECRETO, T0)).toEqual({ ok: false, motivo: "firma" });
  });
});

describe("renovarSesion (deslizante)", () => {
  it("emite con iat nuevo y el mismo inicio, usuario y versión", async () => {
    const original = await emitir();
    const verificada = await verificarSesion(original.token, SECRETO, T0 + 50 * MIN);
    if (!verificada.ok) throw new Error("se esperaba válida");
    const renovada = await renovarSesion(verificada.sesion, SECRETO, T0 + 50 * MIN);
    if (!renovada) throw new Error("se esperaba renovada");
    expect(decodeJwt(renovada.token)).toMatchObject({ sub: "42", sv: 3, inicio: T0, iat: T0 + 50 * MIN });
    // Con la renovación, la sesión sigue viva pasada la hora del ingreso.
    expect((await verificarSesion(renovada.token, SECRETO, T0 + 100 * MIN)).ok).toBe(true);
  });

  it("con actividad constante, igual termina a las 10 h", async () => {
    let actual = await emitir();
    let ahora = T0;
    for (;;) {
      ahora += 45 * MIN;
      const verificada = await verificarSesion(actual.token, SECRETO, ahora);
      if (!verificada.ok) {
        expect(verificada.motivo).toBe("duracion");
        break;
      }
      const renovada = await renovarSesion(verificada.sesion, SECRETO, ahora);
      if (!renovada) break;
      actual = renovada;
    }
    expect(ahora).toBeGreaterThanOrEqual(T0 + 10 * HORA);
    expect(ahora).toBeLessThan(T0 + 10 * HORA + 45 * MIN);
  });
});

describe("cookie de /sin-acceso", () => {
  const datos = { cuil: "20000000001", nombre: "Agente", apellido: "Ficticio", motivo: "sin_alta" } as const;

  it("ida y vuelta con los datos para pedir el alta", async () => {
    const token = await firmarSinAcceso(datos, SECRETO, T0);
    expect(await verificarSinAcceso(token, SECRETO, T0 + 5 * MIN)).toEqual(datos);
  });

  it("vence a los diez minutos", async () => {
    expect(VIDA_SIN_ACCESO_SEG).toBe(10 * MIN);
    const token = await firmarSinAcceso(datos, SECRETO, T0);
    expect(await verificarSinAcceso(token, SECRETO, T0 + 10 * MIN)).toBeNull();
  });

  it("no acepta una sesión ni otro secreto", async () => {
    const { token } = await emitir();
    expect(await verificarSinAcceso(token, SECRETO, T0)).toBeNull();
    expect(await verificarSinAcceso(await firmarSinAcceso(datos, SECRETO, T0), OTRO_SECRETO, T0)).toBeNull();
  });
});
