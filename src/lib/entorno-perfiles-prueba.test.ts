import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntornoInvalido, leerEntorno, leerPerfilesPrueba, validarEntornoAlIniciar } from "./entorno";

// PERFILES_PRUEBA_CUILS (modo prueba, "Ver como…"). CUILs ficticios: los de la
// semilla de desarrollo.

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
const BASE = "postgresql://cementeria_app:clave-ficticia@localhost:54329/cementeria";
const ADMIN = "20000000001";
const MESA = "27000000022";

function problemasDe(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EntornoInvalido) return [...error.problemas];
    throw error;
  }
  throw new Error("se esperaba EntornoInvalido");
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PERFILES_PRUEBA_CUILS", () => {
  it("ausente, vacía o con espacios: modo prueba apagado (conjunto vacío)", () => {
    expect(leerEntorno({ SESSION_SECRET: SECRETO }).perfilesPrueba.size).toBe(0);
    expect(leerEntorno({ SESSION_SECRET: SECRETO, PERFILES_PRUEBA_CUILS: "" }).perfilesPrueba.size).toBe(0);
    expect(leerEntorno({ SESSION_SECRET: SECRETO, PERFILES_PRUEBA_CUILS: "   " }).perfilesPrueba.size).toBe(0);
  });

  it("CUILs separados por coma, con o sin guiones, puntos o espacios; quedan de 11 dígitos", () => {
    const e = leerEntorno({ SESSION_SECRET: SECRETO, PERFILES_PRUEBA_CUILS: ` 20-00000000-1 , ${MESA},27.000.000.02-2,` });
    expect([...e.perfilesPrueba]).toEqual([ADMIN, MESA]);
  });

  it("también en producción (se prueba en Vercel)", () => {
    const e = leerEntorno({ NODE_ENV: "production", SESSION_SECRET: SECRETO, PERFILES_PRUEBA_CUILS: ADMIN });
    expect(e.produccion).toBe(true);
    expect(e.perfilesPrueba).toEqual(new Set([ADMIN]));
  });

  it("inválida: nombra la variable y cuántos fallan, nunca los valores", () => {
    for (const valor of ["2000000000", "20-00000000-2", `${ADMIN},abc`, ",,", `${ADMIN};${MESA}`]) {
      const problemas = problemasDe(() => leerEntorno({ SESSION_SECRET: SECRETO, PERFILES_PRUEBA_CUILS: valor }));
      expect(problemas).toEqual([expect.stringMatching(/^PERFILES_PRUEBA_CUILS: tiene que ser una lista de CUILs/)]);
      expect(problemas.join(" ")).not.toContain("00000000");
    }
    expect(problemasDe(() => leerEntorno({ SESSION_SECRET: SECRETO, PERFILES_PRUEBA_CUILS: "20000000002,27000000023" }))[0]).toMatch(/\(2 no lo son\)$/);
  });

  it("leerPerfilesPrueba suma el problema a la lista y devuelve vacío", () => {
    const problemas: string[] = [];
    expect(leerPerfilesPrueba("123", problemas).size).toBe(0);
    expect(problemas).toHaveLength(1);
    expect(leerPerfilesPrueba(undefined, problemas).size).toBe(0);
    expect(problemas).toHaveLength(1);
  });

  it("al arrancar con la variable: log.warn con la cantidad (no los números), en desarrollo y en producción", () => {
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    validarEntornoAlIniciar({ SESSION_SECRET: SECRETO, DATABASE_URL: BASE, PERFILES_PRUEBA_CUILS: `${ADMIN},${MESA}` });
    validarEntornoAlIniciar({
      NODE_ENV: "production",
      SESSION_SECRET: SECRETO,
      DATABASE_URL: BASE,
      ADJUNTOS_DIR: "/var/lib/cementeria/adjuntos",
      PERFILES_PRUEBA_CUILS: ADMIN,
    });
    const lineas = avisos.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    const modoPrueba = lineas.filter((l) => l.evento === "entorno.modo_prueba_activo");
    expect(modoPrueba).toEqual([
      expect.objectContaining({ nivel: "warn", cuils: 2, produccion: false, aviso: expect.stringContaining("PERFILES_PRUEBA_CUILS") }),
      expect.objectContaining({ nivel: "warn", cuils: 1, produccion: true }),
    ]);
    const todo = [...avisos.mock.calls, ...info.mock.calls].map((c) => String(c[0])).join("\n");
    expect(todo).not.toContain(ADMIN);
    expect(todo).not.toContain(MESA);
    expect(todo).toContain('"perfilesPrueba":2');
  });

  it("sin la variable no hay advertencia", () => {
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    validarEntornoAlIniciar({ SESSION_SECRET: SECRETO, DATABASE_URL: BASE });
    expect(avisos.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("modo_prueba");
  });
});
