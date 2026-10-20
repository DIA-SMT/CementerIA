import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaccion } from "@/lib/db/crear-cliente";
import type { PersonaCidituc } from "./cidituc/validar";
import {
  cerrarSesion,
  decidirIngreso,
  ingresarConCidituc,
  ingresarSimulado,
  SISTEMA_ID,
  type DependenciasIngreso,
  type UsuarioIngreso,
} from "./ingreso";

// Solo datos ficticios.

const PERSONA: PersonaCidituc = {
  ciditucId: "9999",
  cuil: "20000000001",
  nombre: "Agente",
  apellido: "Ficticio",
  email: "agente.ficticio@ejemplo.invalid",
};

const USUARIO: UsuarioIngreso = {
  id: 42,
  activo: true,
  ciditucId: null,
  nombre: "Nombre Cargado",
  apellido: "Apellido Cargado",
  email: null,
};

const AHORA = new Date("2026-10-19T12:00:00Z");

interface Escritura {
  actor: number;
  motivo: string | null;
}

/**
 * Una base simulada: guarda quién escribió y qué, como lo haría conActor()
 * con los triggers. `updateMany` devuelve lo que diga `filasActualizadas`.
 */
function baseSimulada(usuario: UsuarioIngreso | null) {
  const escrituras: Escritura[] = [];
  const accesos: unknown[] = [];
  const updates: unknown[] = [];
  const estado = { filasActualizadas: 1, sesionVersion: 5, falla: null as unknown };

  const tx = {
    usuario: {
      updateMany: vi.fn(async (args: unknown) => {
        if (estado.falla) throw estado.falla;
        updates.push(args);
        return { count: estado.filasActualizadas };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ id: usuario?.id ?? 0, rol: "operador", sesionVersion: estado.sesionVersion })),
    },
    auditoriaAcceso: {
      create: vi.fn(async (args: { data: unknown }) => {
        accesos.push(args.data);
        return {};
      }),
    },
  };

  const deps: DependenciasIngreso = {
    leer: { usuario: { findUnique: vi.fn(async () => usuario) } } as unknown as DependenciasIngreso["leer"],
    escribir: async (actor, motivo, fn) => {
      escrituras.push({ actor, motivo });
      return fn(tx as unknown as Transaccion);
    },
    ahora: () => AHORA,
  };
  return { deps, escrituras, accesos, updates, estado, tx };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("decidirIngreso", () => {
  it("sin fila para el CUIL: sin alta", () => {
    expect(decidirIngreso(null, PERSONA)).toEqual({ aceptar: false, motivo: "sin_alta" });
  });

  it("usuario inactivo o SISTEMA: no entra", () => {
    expect(decidirIngreso({ ...USUARIO, activo: false }, PERSONA)).toEqual({ aceptar: false, motivo: "inactivo" });
    expect(decidirIngreso({ ...USUARIO, id: SISTEMA_ID }, PERSONA)).toEqual({ aceptar: false, motivo: "inactivo" });
  });

  it("primer ingreso: entra y vincula cidituc_id", () => {
    expect(decidirIngreso(USUARIO, PERSONA)).toEqual({ aceptar: true, vincular: true });
  });

  it("ingresos siguientes: entra si el cidituc_id coincide", () => {
    expect(decidirIngreso({ ...USUARIO, ciditucId: "9999" }, PERSONA)).toEqual({ aceptar: true, vincular: false });
  });

  it("si el CUIL está vinculado a otra cuenta de Cidituc, rechaza", () => {
    expect(decidirIngreso({ ...USUARIO, ciditucId: "1234" }, PERSONA)).toEqual({
      aceptar: false,
      motivo: "cidituc_distinto",
    });
  });
});

describe("ingresarConCidituc", () => {
  it("primer ingreso: vincula, actualiza nombre, email y último ingreso como el propio usuario y registra el ingreso", async () => {
    const base = baseSimulada(USUARIO);
    const resultado = await ingresarConCidituc(base.deps, PERSONA, "10.0.0.1");

    expect(resultado).toEqual({ ok: true, usuario: { id: 42, rol: "operador", sesionVersion: 5 }, primerIngreso: true });
    expect(base.escrituras).toEqual([{ actor: 42, motivo: "ingreso" }]);
    expect(base.updates).toEqual([
      {
        where: { id: 42, activo: true, OR: [{ ciditucId: null }, { ciditucId: "9999" }] },
        data: {
          ciditucId: "9999",
          nombre: "Agente",
          apellido: "Ficticio",
          email: "agente.ficticio@ejemplo.invalid",
          ultimoIngreso: AHORA,
        },
      },
    ]);
    expect(base.accesos).toEqual([
      { usuarioId: 42, accion: "ingreso", ip: "10.0.0.1", detalle: { via: "cidituc", primer_ingreso: true } },
    ]);
  });

  it("si Cidituc no trae nombre ni email, conserva los que había", async () => {
    const base = baseSimulada({ ...USUARIO, ciditucId: "9999", email: "anterior@ejemplo.invalid" });
    await ingresarConCidituc(base.deps, { ...PERSONA, nombre: "", apellido: "", email: null }, null);
    expect(base.updates[0]).toMatchObject({
      data: { nombre: "Nombre Cargado", apellido: "Apellido Cargado", email: "anterior@ejemplo.invalid" },
    });
  });

  it("sin alta: registra ingreso_rechazado como SISTEMA, con el CUIL, y no toca usuarios", async () => {
    const base = baseSimulada(null);
    expect(await ingresarConCidituc(base.deps, PERSONA, "10.0.0.1")).toEqual({
      ok: false,
      motivo: "sin_alta",
      usuarioId: null,
    });
    expect(base.escrituras).toEqual([{ actor: SISTEMA_ID, motivo: "ingreso_rechazado" }]);
    expect(base.accesos).toEqual([
      {
        usuarioId: null,
        accion: "ingreso_rechazado",
        ip: "10.0.0.1",
        detalle: { via: "cidituc", motivo: "sin_alta", cuil: "20000000001" },
      },
    ]);
    expect(base.updates).toHaveLength(0);
  });

  it("usuario inactivo: rechaza y lo registra", async () => {
    const base = baseSimulada({ ...USUARIO, activo: false });
    expect(await ingresarConCidituc(base.deps, PERSONA, null)).toEqual({ ok: false, motivo: "inactivo", usuarioId: 42 });
    expect(base.accesos).toEqual([
      { usuarioId: 42, accion: "ingreso_rechazado", ip: null, detalle: { via: "cidituc", motivo: "inactivo" } },
    ]);
  });

  it("cidituc_id distinto: rechaza, registra qué cuenta intentó y no vincula", async () => {
    const base = baseSimulada({ ...USUARIO, ciditucId: "1234" });
    expect(await ingresarConCidituc(base.deps, PERSONA, null)).toEqual({
      ok: false,
      motivo: "cidituc_distinto",
      usuarioId: 42,
    });
    expect(base.accesos).toEqual([
      {
        usuarioId: 42,
        accion: "ingreso_rechazado",
        ip: null,
        detalle: { via: "cidituc", motivo: "cidituc_distinto", cidituc_id: "9999" },
      },
    ]);
    expect(base.updates).toHaveLength(0);
  });

  it("si la cuenta de Cidituc ya está vinculada a otro CUIL (índice único), rechaza como cidituc_distinto", async () => {
    const base = baseSimulada(USUARIO);
    base.estado.falla = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    expect(await ingresarConCidituc(base.deps, PERSONA, null)).toEqual({
      ok: false,
      motivo: "cidituc_distinto",
      usuarioId: 42,
    });
    expect(base.accesos).toEqual([
      {
        usuarioId: 42,
        accion: "ingreso_rechazado",
        ip: null,
        detalle: { via: "cidituc", motivo: "cidituc_en_otro_usuario", cidituc_id: "9999" },
      },
    ]);
  });

  it("si el usuario cambió entre la lectura y la escritura, falla sin emitir nada", async () => {
    const base = baseSimulada(USUARIO);
    base.estado.filasActualizadas = 0;
    await expect(ingresarConCidituc(base.deps, PERSONA, null)).rejects.toThrow(/cambió/);
    expect(base.accesos).toHaveLength(0);
  });

  it("un error de la base que no es de unicidad se propaga", async () => {
    const base = baseSimulada(USUARIO);
    base.estado.falla = new Error("conexión perdida");
    await expect(ingresarConCidituc(base.deps, PERSONA, null)).rejects.toThrow("conexión perdida");
  });

  it("si no se puede registrar el rechazo, el rechazo sigue en pie", async () => {
    const base = baseSimulada(null);
    base.deps.escribir = async () => {
      throw new Error("base caída");
    };
    expect(await ingresarConCidituc(base.deps, PERSONA, null)).toEqual({
      ok: false,
      motivo: "sin_alta",
      usuarioId: null,
    });
  });
});

describe("ingresarSimulado", () => {
  it("registra el ingreso con via dev_login como el propio usuario", async () => {
    const base = baseSimulada(USUARIO);
    expect(await ingresarSimulado(base.deps, 42, "127.0.0.1")).toEqual({
      ok: true,
      usuario: { id: 42, rol: "operador", sesionVersion: 5 },
      primerIngreso: false,
    });
    expect(base.escrituras).toEqual([{ actor: 42, motivo: "ingreso" }]);
    expect(base.updates).toEqual([{ where: { id: 42, activo: true }, data: { ultimoIngreso: AHORA } }]);
    expect(base.accesos).toEqual([{ usuarioId: 42, accion: "ingreso", ip: "127.0.0.1", detalle: { via: "dev_login" } }]);
  });

  it("no entra como SISTEMA ni como un usuario inactivo", async () => {
    const base = baseSimulada(USUARIO);
    expect(await ingresarSimulado(base.deps, SISTEMA_ID, null)).toMatchObject({ ok: false, motivo: "inactivo" });
    expect(base.escrituras).toHaveLength(0);

    base.estado.filasActualizadas = 0;
    expect(await ingresarSimulado(base.deps, 42, null)).toMatchObject({ ok: false, motivo: "inactivo" });
    expect(base.accesos).toHaveLength(0);
  });
});

describe("cerrarSesion", () => {
  it("incrementa sesion_version solo si sigue siendo la de la cookie, y registra la salida", async () => {
    const base = baseSimulada(USUARIO);
    expect(await cerrarSesion(base.deps, 42, 5, "10.0.0.1")).toBe(true);
    expect(base.escrituras).toEqual([{ actor: 42, motivo: "salida" }]);
    expect(base.updates).toEqual([{ where: { id: 42, sesionVersion: 5 }, data: { sesionVersion: { increment: 1 } } }]);
    expect(base.accesos).toEqual([{ usuarioId: 42, accion: "salida", ip: "10.0.0.1", detalle: {} }]);
  });

  it("con una versión vieja no hay sesión que cerrar: no registra nada", async () => {
    const base = baseSimulada(USUARIO);
    base.estado.filasActualizadas = 0;
    expect(await cerrarSesion(base.deps, 42, 4, null)).toBe(false);
    expect(base.accesos).toHaveLength(0);
  });
});
