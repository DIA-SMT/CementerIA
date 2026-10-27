import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { hashearClave } from "./clave";
import { SISTEMA_ID } from "./ingreso";
import {
  cambiarClave,
  ingresarConClave,
  interpretarIdentificador,
  MENSAJE_INGRESO_RECHAZADO,
  politicaClave,
  type DependenciasClave,
} from "./ingreso-clave";
import { LimitePorIp } from "./limite-intentos";

// El login propio sin base: un usuario simulado en memoria, con lo que
// escriben conActor() y los triggers. Solo datos ficticios.

const AHORA = new Date("2026-10-27T12:00:00Z");
const CLAVE = "una frase de prueba larga";
let HASH: string;

beforeAll(async () => {
  HASH = await hashearClave(CLAVE);
});

interface Fila {
  id: number;
  cuil: string;
  apellido: string;
  email: string | null;
  activo: boolean;
  rol: string;
  claveHash: string | null;
  debeCambiarClave: boolean;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  sesionVersion: number;
}

function fila(cambios: Partial<Fila> = {}): Fila {
  return {
    id: 42,
    cuil: "20000000001",
    apellido: "Ficticio",
    email: "agente.ficticio@ejemplo.invalid",
    activo: true,
    rol: "operador",
    claveHash: HASH,
    debeCambiarClave: false,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    sesionVersion: 3,
    ...cambios,
  };
}

/** Una base simulada con un usuario (o ninguno). */
function base(usuario: Fila | null, limite = new LimitePorIp({ ahora: () => AHORA.getTime() })) {
  const escrituras: Array<{ actor: number; motivo: string | null }> = [];
  const accesos: Array<{ usuarioId: number | null; accion: string; ip: string | null; detalle: Record<string, unknown> }> = [];
  const u = usuario;

  const tx = {
    $queryRaw: vi.fn(async () => (u ? [{ intentos_fallidos: u.intentosFallidos, bloqueado_hasta: u.bloqueadoHasta }] : [])),
    usuario: {
      update: vi.fn(async ({ data }: { data: Partial<Fila> }) => Object.assign(u ?? {}, data)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!u || where.id !== u.id) return { count: 0 };
        if ("claveHash" in where && where.claveHash !== u.claveHash) return { count: 0 };
        if ("sesionVersion" in where && where.sesionVersion !== u.sesionVersion) return { count: 0 };
        if (where.activo === true && !u.activo) return { count: 0 };
        for (const [k, v] of Object.entries(data)) {
          (u as unknown as Record<string, unknown>)[k] =
            typeof v === "object" && v !== null && "increment" in v ? (u as unknown as Record<string, number>)[k] + (v as { increment: number }).increment : v;
        }
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ id: u?.id, rol: u?.rol, sesionVersion: u?.sesionVersion, debeCambiarClave: u?.debeCambiarClave })),
    },
    auditoriaAcceso: {
      create: vi.fn(async ({ data }: { data: (typeof accesos)[number] }) => {
        accesos.push(data);
        return {};
      }),
    },
  };

  const deps: DependenciasClave = {
    leer: {
      usuario: {
        findUnique: vi.fn(async ({ where }: { where: { cuil?: string; id?: number } }) =>
          u && (where.cuil === u.cuil || where.id === u.id) ? { ...u } : null,
        ),
        findMany: vi.fn(async ({ where }: { where: { email: { equals: string } } }) =>
          u && u.email?.toLowerCase() === where.email.equals.toLowerCase() ? [{ ...u }] : [],
        ),
      },
    } as unknown as DependenciasClave["leer"],
    escribir: async (actor, motivo, fn) => {
      escrituras.push({ actor, motivo });
      return fn(tx as unknown as Transaccion);
    },
    ahora: () => AHORA,
    limiteIp: limite,
  };
  return { deps, escrituras, accesos, tx, usuario: u };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("interpretarIdentificador", () => {
  it("CUIL con o sin guiones, puntos o espacios; correo en minúsculas; lo demás, inválido", () => {
    expect(interpretarIdentificador("20-00000000-1")).toEqual({ tipo: "cuil", cuil: "20000000001" });
    expect(interpretarIdentificador(" 20 00000000 1 ")).toEqual({ tipo: "cuil", cuil: "20000000001" });
    expect(interpretarIdentificador("Agente.Ficticio@Ejemplo.invalid")).toEqual({ tipo: "correo", correo: "agente.ficticio@ejemplo.invalid" });
    expect(interpretarIdentificador("2000000000")).toEqual({ tipo: "invalido" });
    expect(interpretarIdentificador("cualquier cosa")).toEqual({ tipo: "invalido" });
    expect(interpretarIdentificador("")).toEqual({ tipo: "invalido" });
  });
});

describe("ingresarConClave", () => {
  it("correcto: entra, lo firma el propio usuario, pone el contador en 0 y registra el ingreso (sin la contraseña)", async () => {
    const b = base(fila({ intentosFallidos: 3 }));
    const r = await ingresarConClave(b.deps, { identificador: "20-00000000-1", clave: CLAVE }, "10.0.0.1");
    expect(r).toEqual({ ok: true, usuario: { id: 42, rol: "operador", sesionVersion: 3, debeCambiarClave: false } });
    expect(b.escrituras).toEqual([{ actor: 42, motivo: "ingreso" }]);
    expect(b.usuario).toMatchObject({ intentosFallidos: 0, bloqueadoHasta: null, ultimoIngreso: AHORA });
    expect(b.accesos).toEqual([{ usuarioId: 42, accion: "ingreso", ip: "10.0.0.1", detalle: { via: "clave", debe_cambiar_clave: false } }]);
    expect(JSON.stringify(b.accesos)).not.toContain(CLAVE);
  });

  it("también por correo, sin importar mayúsculas", async () => {
    const b = base(fila());
    const r = await ingresarConClave(b.deps, { identificador: "AGENTE.FICTICIO@ejemplo.invalid", clave: CLAVE }, null);
    expect(r.ok).toBe(true);
  });

  it("con contraseña temporal entra, y avisa que la tiene que cambiar", async () => {
    const b = base(fila({ debeCambiarClave: true }));
    const r = await ingresarConClave(b.deps, { identificador: "20000000001", clave: CLAVE }, null);
    expect(r).toMatchObject({ ok: true, usuario: { debeCambiarClave: true } });
  });

  it("incorrecta: rechazo firmado por SISTEMA, un fallo más, y la contraseña no queda en ningún lado", async () => {
    const b = base(fila());
    const r = await ingresarConClave(b.deps, { identificador: "20000000001", clave: "no es esta contraseña" }, "10.0.0.1");
    expect(r).toEqual({ ok: false, motivo: "clave_incorrecta", usuarioId: 42, bloqueo: false });
    expect(b.escrituras).toEqual([{ actor: SISTEMA_ID, motivo: "ingreso_rechazado" }]);
    expect(b.usuario?.intentosFallidos).toBe(1);
    expect(b.accesos).toEqual([{ usuarioId: 42, accion: "ingreso_rechazado", ip: "10.0.0.1", detalle: { via: "clave", motivo: "clave_incorrecta" } }]);
    expect(JSON.stringify(b.accesos)).not.toContain("no es esta");
  });

  it("al quinto fallo seguido bloquea 15 minutos y lo registra; bloqueado, ni la correcta entra", async () => {
    const b = base(fila({ intentosFallidos: 4 }));
    const r = await ingresarConClave(b.deps, { identificador: "20000000001", clave: "otra contraseña cualquiera" }, null);
    expect(r).toMatchObject({ ok: false, motivo: "clave_incorrecta", bloqueo: true });
    expect(b.usuario).toMatchObject({ intentosFallidos: 0, bloqueadoHasta: new Date(AHORA.getTime() + 15 * 60_000) });
    expect(b.accesos.map((a) => a.accion)).toEqual(["ingreso_rechazado", "bloqueo"]);

    const correcta = await ingresarConClave(b.deps, { identificador: "20000000001", clave: CLAVE }, null);
    expect(correcta).toMatchObject({ ok: false, motivo: "bloqueado" });
    // Bloqueado no suma más fallos.
    expect(b.usuario?.intentosFallidos).toBe(0);
  });

  it("inexistente, inactivo, sin contraseña o SISTEMA: rechazo (el mensaje para la persona es siempre el mismo)", async () => {
    const casos: Array<[Fila | null, string, string]> = [
      [null, "20000000001", "sin_usuario"],
      [null, "texto raro", "identificador_invalido"],
      [fila({ activo: false }), "20000000001", "inactivo"],
      [fila({ id: SISTEMA_ID }), "20000000001", "inactivo"],
      [fila({ claveHash: null }), "20000000001", "sin_clave"],
    ];
    for (const [u, identificador, motivo] of casos) {
      const b = base(u);
      const r = await ingresarConClave(b.deps, { identificador, clave: CLAVE }, null);
      expect({ motivo, r }).toEqual({ motivo, r: expect.objectContaining({ ok: false, motivo }) });
      // No suman fallos a nadie.
      if (u) expect(u.intentosFallidos).toBe(0);
    }
    expect(MENSAJE_INGRESO_RECHAZADO).toBe("CUIL, correo o contraseña incorrectos");
  });

  it("de un inexistente guarda el CUIL solo si es válido, y nunca lo que se escribió si no es CUIL", async () => {
    const b = base(null);
    await ingresarConClave(b.deps, { identificador: "20-00000000-1", clave: "x" }, null);
    await ingresarConClave(b.deps, { identificador: "esto podría ser una contraseña", clave: "x" }, null);
    expect(b.accesos.map((a) => a.detalle)).toEqual([
      { via: "clave", motivo: "sin_usuario", identificador: "cuil", cuil: "20000000001" },
      { via: "clave", motivo: "identificador_invalido", identificador: "invalido" },
    ]);
  });

  it("el usuario inexistente tarda lo mismo: también calcula scrypt (contra un señuelo)", async () => {
    const existe = base(fila());
    const t0 = performance.now();
    await ingresarConClave(existe.deps, { identificador: "20000000001", clave: "incorrecta pero larga" }, null);
    const conUsuario = performance.now() - t0;
    const noExiste = base(null);
    const t1 = performance.now();
    await ingresarConClave(noExiste.deps, { identificador: "20000000001", clave: "incorrecta pero larga" }, null);
    const sinUsuario = performance.now() - t1;
    // Los dos hacen un cálculo de ~100 ms o más; sin señuelo, el segundo sería casi instantáneo.
    expect(sinUsuario).toBeGreaterThan(conUsuario * 0.4);
  });

  it("la IP con demasiados fallos se frena antes de buscar a nadie y sin escribir en la base", async () => {
    const limite = new LimitePorIp({ maximo: 2, ventanaMs: 60_000, ahora: () => AHORA.getTime() });
    const b = base(fila(), limite);
    await ingresarConClave(b.deps, { identificador: "20000000001", clave: "mal 1 de prueba" }, "10.0.0.9");
    await ingresarConClave(b.deps, { identificador: "20000000001", clave: "mal 2 de prueba" }, "10.0.0.9");
    const escriturasAntes = b.escrituras.length;
    const r = await ingresarConClave(b.deps, { identificador: "20000000001", clave: CLAVE }, "10.0.0.9");
    expect(r).toMatchObject({ ok: false, motivo: "limite_ip" });
    expect(b.escrituras.length).toBe(escriturasAntes);
    // Desde otra IP, la correcta entra.
    expect((await ingresarConClave(b.deps, { identificador: "20000000001", clave: CLAVE }, "10.0.0.10")).ok).toBe(true);
  });

  it("si lo desactivaron entre la lectura y la escritura, no entra", async () => {
    const b = base(fila());
    b.tx.usuario.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await ingresarConClave(b.deps, { identificador: "20000000001", clave: CLAVE }, null);
    expect(r).toMatchObject({ ok: false, motivo: "carrera" });
  });
});

describe("cambiarClave", () => {
  const sesion = { usuarioId: 42, sesionVersion: 3 };
  const NUEVA = "el mate de la tarde con tortillas";

  it("cambia: nuevo hash, sin cambio obligatorio, sesion_version + 1 y registro (sin contraseñas)", async () => {
    const b = base(fila({ debeCambiarClave: true, intentosFallidos: 2 }));
    const r = await cambiarClave(b.deps, sesion, { actual: CLAVE, nueva: NUEVA, repetida: NUEVA }, "10.0.0.1");
    expect(r).toEqual({ ok: true, sesionVersion: 4 });
    expect(b.usuario).toMatchObject({ debeCambiarClave: false, intentosFallidos: 0, bloqueadoHasta: null, claveCambiadaEn: AHORA, sesionVersion: 4 });
    expect(b.usuario?.claveHash).not.toBe(HASH);
    expect(b.escrituras).toEqual([{ actor: 42, motivo: "Cambio de contraseña" }]);
    expect(b.accesos).toEqual([{ usuarioId: 42, accion: "cambio_clave", ip: "10.0.0.1", detalle: { via: "usuario", obligatorio: true } }]);
    expect(JSON.stringify(b.accesos)).not.toContain(NUEVA);
  });

  it("la repetición tiene que coincidir; la nueva cumple la política y es distinta de la actual", async () => {
    const b = base(fila());
    expect(await cambiarClave(b.deps, sesion, { actual: CLAVE, nueva: NUEVA, repetida: `${NUEVA}x` }, null)).toMatchObject({
      ok: false,
      errores: [{ ruta: "repetida" }],
    });
    expect(await cambiarClave(b.deps, sesion, { actual: CLAVE, nueva: "corta", repetida: "corta" }, null)).toMatchObject({
      ok: false,
      errores: [{ ruta: "nueva", mensaje: expect.stringContaining("al menos 12") }],
    });
    expect(await cambiarClave(b.deps, sesion, { actual: CLAVE, nueva: CLAVE, repetida: CLAVE }, null)).toMatchObject({
      ok: false,
      errores: [{ ruta: "nueva", mensaje: "Tiene que ser distinta de la actual." }],
    });
    expect(await cambiarClave(b.deps, sesion, { actual: CLAVE, nueva: "Ficticio de corazón 2026", repetida: "Ficticio de corazón 2026" }, null)).toMatchObject({
      ok: false,
      errores: [{ ruta: "nueva", mensaje: "No puede contener tu apellido." }],
    });
    expect(b.escrituras).toEqual([]);
  });

  it("la actual incorrecta cuenta como un fallo (y al quinto bloquea)", async () => {
    const b = base(fila({ intentosFallidos: 4 }));
    const r = await cambiarClave(b.deps, sesion, { actual: "no es la actual", nueva: NUEVA, repetida: NUEVA }, null);
    expect(r).toMatchObject({ ok: false, errores: [{ ruta: "actual" }], mensaje: expect.stringContaining("bloqueado 15 minutos") });
    expect(b.accesos.map((a) => a.accion)).toEqual(["bloqueo"]);
    expect(await cambiarClave(b.deps, sesion, { actual: CLAVE, nueva: NUEVA, repetida: NUEVA }, null)).toMatchObject({
      ok: false,
      mensaje: expect.stringContaining("bloqueado hasta"),
    });
  });

  it("con la sesión ya cerrada (otra versión) o el usuario inactivo, no cambia nada", async () => {
    const b = base(fila({ sesionVersion: 5 }));
    expect(await cambiarClave(b.deps, sesion, { actual: CLAVE, nueva: NUEVA, repetida: NUEVA }, null)).toMatchObject({ ok: false, sesionCerrada: true });
    const c = base(fila({ activo: false }));
    expect(await cambiarClave(c.deps, sesion, { actual: CLAVE, nueva: NUEVA, repetida: NUEVA }, null)).toMatchObject({ ok: false, sesionCerrada: true });
    expect([...b.escrituras, ...c.escrituras]).toEqual([]);
  });
});

describe("politicaClave", () => {
  it("es estricta salvo CLAVE_POLITICA=libre", () => {
    expect(politicaClave({})).toBe("estricta");
    expect(politicaClave({ CLAVE_POLITICA: "estricta" })).toBe("estricta");
    expect(politicaClave({ CLAVE_POLITICA: "cualquiera" })).toBe("estricta");
    expect(politicaClave({ CLAVE_POLITICA: " libre " })).toBe("libre");
  });
});
