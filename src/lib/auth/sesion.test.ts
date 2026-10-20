import { beforeEach, describe, expect, it, vi } from "vitest";

// La sesión se prueba sin Next ni base: se reemplazan las cookies del request y
// el cliente de Prisma. `cache()` de React fuera de un render de servidor no
// memoriza, así que acá cada llamada consulta (en Next, una vez por request).

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
vi.stubEnv("SESSION_SECRET", SECRETO);

const cookiesDelRequest = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nombre: string) => (cookiesDelRequest.has(nombre) ? { name: nombre, value: cookiesDelRequest.get(nombre) } : undefined),
    has: (nombre: string) => cookiesDelRequest.has(nombre),
  }),
}));

const findUnique = vi.fn();
vi.mock("@/lib/db/cliente", () => ({ prisma: { usuario: { findUnique } } }));
vi.mock("@/lib/db/transaccion", () => ({ conActor: vi.fn() }));

const { exigirPantalla, exigirUsuario, getUsuarioActual } = await import("./sesion");
const { COOKIE_SESION, emitirSesion } = await import("./sesion-token");
const { usuarioDeSesion } = await import("./usuario");

type Fila = NonNullable<Parameters<typeof usuarioDeSesion>[0]>;

function fila(cambios: Partial<Fila> = {}): Fila {
  return {
    id: 42,
    cuil: "20000000001",
    nombre: "Agente",
    apellido: "Ficticio",
    email: null,
    rol: "operador",
    activo: true,
    sesionVersion: 3,
    area: { id: 2, codigo: "COMPUTO", nombre: "Cómputo" },
    ...cambios,
  };
}

async function conSesion(usuarioId = 42, sesionVersion = 3): Promise<void> {
  const ahora = Math.floor(Date.now() / 1000);
  const emitido = await emitirSesion({ usuarioId, sesionVersion, inicio: ahora }, SECRETO, ahora);
  if (!emitido) throw new Error("se esperaba un token");
  cookiesDelRequest.set(COOKIE_SESION, emitido.token);
}

/** El destino de un redirect() de Next, que se implementa tirando un error. */
async function destinoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw error;
  }
  throw new Error("se esperaba un redirect");
}

beforeEach(() => {
  cookiesDelRequest.clear();
  findUnique.mockReset();
});

describe("getUsuarioActual", () => {
  it("sin cookie no consulta la base", async () => {
    expect(await getUsuarioActual()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("con una cookie válida carga el usuario de la base, con área y rol", async () => {
    await conSesion();
    findUnique.mockResolvedValue(fila());
    expect(await getUsuarioActual()).toEqual({
      id: 42,
      cuil: "20000000001",
      nombre: "Agente",
      apellido: "Ficticio",
      email: null,
      rol: "operador",
      activo: true,
      sesionVersion: 3,
      area: { id: 2, codigo: "COMPUTO", nombre: "Cómputo" },
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }));
  });

  it("una cookie con firma inválida no llega a la base", async () => {
    cookiesDelRequest.set(COOKIE_SESION, "eyJhbGciOiJIUzI1NiJ9.e30.firma-falsa");
    expect(await getUsuarioActual()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("si el usuario se desactivó, la sesión deja de valer en el request siguiente", async () => {
    await conSesion();
    findUnique.mockResolvedValue(fila({ activo: false }));
    expect(await getUsuarioActual()).toBeNull();
  });

  it("si sesion_version cambió (salió, o el admin le cambió el acceso), la sesión no vale", async () => {
    await conSesion(42, 3);
    findUnique.mockResolvedValue(fila({ sesionVersion: 4 }));
    expect(await getUsuarioActual()).toBeNull();
  });

  it("si el usuario ya no existe, null", async () => {
    await conSesion();
    findUnique.mockResolvedValue(null);
    expect(await getUsuarioActual()).toBeNull();
  });
});

describe("usuarioDeSesion", () => {
  const sesion = { usuarioId: 42, sesionVersion: 3, emitidaEn: 0, inicio: 0 };

  it("nunca deja pasar a SISTEMA, aunque alguien lo active", () => {
    expect(usuarioDeSesion(fila({ id: 1, rol: "admin", area: null }), { ...sesion, usuarioId: 1 })).toBeNull();
  });

  it("falla cerrado con un rol desconocido", () => {
    expect(usuarioDeSesion(fila({ rol: "jefe" }), sesion)).toBeNull();
  });

  it("falla cerrado si la fila es de otro usuario", () => {
    expect(usuarioDeSesion(fila({ id: 43 }), sesion)).toBeNull();
  });
});

describe("exigirUsuario y exigirPantalla", () => {
  it("sin cookie manda a /login", async () => {
    expect(await destinoDe(exigirUsuario())).toBe("/login");
  });

  it("con una cookie que ya no vale manda a /login avisando", async () => {
    await conSesion();
    findUnique.mockResolvedValue(fila({ activo: false }));
    expect(await destinoDe(exigirUsuario())).toBe("/login?error=sesion_invalida");
  });

  it("deja pasar a quien la pantalla le corresponde", async () => {
    await conSesion();
    findUnique.mockResolvedValue(fila());
    expect((await exigirPantalla("bandeja")).id).toBe(42);
  });

  it("a quien no le corresponde lo manda a su inicio", async () => {
    await conSesion();
    findUnique.mockResolvedValue(fila({ rol: "lectura", area: { id: 8, codigo: "DIRECCION", nombre: "Dirección" } }));
    expect(await destinoDe(exigirPantalla("bandeja"))).toBe("/panel");

    findUnique.mockResolvedValue(fila());
    expect(await destinoDe(exigirPantalla("admin"))).toBe("/bandeja");
  });
});
