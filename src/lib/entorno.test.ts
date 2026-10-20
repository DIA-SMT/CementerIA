import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { devLoginPara, EntornoInvalido, esHostDeStaging, leerEntorno, validarEntornoAlIniciar } from "./entorno";

const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
const BASE = "postgresql://cementeria_app:clave-ficticia@localhost:54329/cementeria";

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
  vi.unstubAllEnvs();
});

describe("leerEntorno: lo básico", () => {
  it("con lo mínimo arranca en desarrollo, sin Cidituc ni login simulado", () => {
    const e = leerEntorno({ SESSION_SECRET: SECRETO });
    expect(e).toMatchObject({
      nodeEnv: "development",
      produccion: false,
      secretoSesion: SECRETO,
      cidituc: { habilitado: false },
      devLogin: { habilitado: false },
    });
  });

  it("exige SESSION_SECRET de 32 caracteres o más, sin repetir el valor en el error", () => {
    expect(problemasDe(() => leerEntorno({}))).toEqual([expect.stringMatching(/^SESSION_SECRET: falta/)]);
    const problemas = problemasDe(() => leerEntorno({ SESSION_SECRET: "secreto-corto-ficticio" }));
    expect(problemas).toEqual([expect.stringMatching(/^SESSION_SECRET: .*32/)]);
    expect(problemas.join(" ")).not.toContain("secreto-corto-ficticio");
  });

  it("junta todos los problemas, no solo el primero", () => {
    const problemas = problemasDe(() =>
      leerEntorno({ NODE_ENV: "production", SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN: "1", CIDITUC_HABILITADO: "1" }),
    );
    expect(problemas).toHaveLength(2);
  });
});

describe("leerEntorno: login simulado", () => {
  it("en desarrollo, AUTH_DEV_LOGIN=1 lo habilita para cualquier usuario activo", () => {
    expect(leerEntorno({ SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN: "1" }).devLogin).toEqual({
      habilitado: true,
      listaBlanca: null,
    });
    expect(leerEntorno({ SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN: "0" }).devLogin).toEqual({ habilitado: false });
  });

  it.each([["1"], ["0"], [""], ["   "]])(
    "la app no arranca en producción con AUTH_DEV_LOGIN definida (%j)",
    (valor) => {
      expect(
        problemasDe(() => leerEntorno({ NODE_ENV: "production", SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN: valor })),
      ).toEqual([expect.stringMatching(/^AUTH_DEV_LOGIN: no puede estar definida en producción/)]);
    },
  );

  it("en producción sin AUTH_DEV_LOGIN no hay login simulado", () => {
    expect(leerEntorno({ NODE_ENV: "production", SESSION_SECRET: SECRETO }).devLogin).toEqual({ habilitado: false });
  });

  it("staging: AUTH_DEV_LOGIN_STAGING con la lista blanca y un host de staging", () => {
    const e = leerEntorno({
      NODE_ENV: "production",
      SESSION_SECRET: SECRETO,
      APP_URL: "https://cementeria-staging.ejemplo.invalid",
      AUTH_DEV_LOGIN_STAGING: "20000000001, 27000000022",
    });
    expect(e.devLogin).toEqual({ habilitado: true, listaBlanca: new Set(["20000000001", "27000000022"]) });
  });

  it("staging: se niega a arrancar si el host no es de staging", () => {
    expect(
      problemasDe(() =>
        leerEntorno({
          NODE_ENV: "production",
          SESSION_SECRET: SECRETO,
          APP_URL: "https://cementeria.ejemplo.invalid",
          AUTH_DEV_LOGIN_STAGING: "20000000001",
        }),
      ),
    ).toEqual([expect.stringMatching(/no es de staging/)]);
  });

  it("staging: sin APP_URL no puede saber el host, y no arranca", () => {
    expect(
      problemasDe(() =>
        leerEntorno({ NODE_ENV: "production", SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN_STAGING: "20000000001" }),
      ),
    ).toEqual([expect.stringMatching(/^APP_URL/)]);
  });

  it.each([["1"], ["si"], ["20000000001;27000000022"], ["2000000000"]])(
    "AUTH_DEV_LOGIN_STAGING tiene que ser una lista de CUILs: %j no sirve",
    (valor) => {
      expect(problemasDe(() => leerEntorno({ SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN_STAGING: valor }))).toEqual([
        expect.stringMatching(/^AUTH_DEV_LOGIN_STAGING/),
      ]);
    },
  );
});

describe("leerEntorno: Cidituc", () => {
  it("habilitado necesita CIDITUC_API_URL", () => {
    expect(problemasDe(() => leerEntorno({ SESSION_SECRET: SECRETO, CIDITUC_HABILITADO: "1" }))).toEqual([
      expect.stringMatching(/^CIDITUC_API_URL/),
    ]);
  });

  it("en producción la API tiene que ser https: el token viaja en esa consulta", () => {
    expect(
      problemasDe(() =>
        leerEntorno({
          NODE_ENV: "production",
          SESSION_SECRET: SECRETO,
          CIDITUC_HABILITADO: "1",
          CIDITUC_API_URL: "http://estadisticas.ejemplo.invalid:5000",
        }),
      ),
    ).toEqual([expect.stringMatching(/https/)]);
  });

  it("arma la configuración con la clave del derivador y sin barra final en la API", () => {
    const e = leerEntorno({
      SESSION_SECRET: SECRETO,
      CIDITUC_HABILITADO: "1",
      CIDITUC_API_URL: "https://estadisticas.ejemplo.invalid:5000/",
      CIDITUC_CLAVE: "cementeria-staging",
    });
    expect(e.cidituc).toEqual({
      habilitado: true,
      derivadorUrl: "https://cidituc.smt.gob.ar/",
      apiUrl: "https://estadisticas.ejemplo.invalid:5000",
      clave: "cementeria-staging",
    });
  });

  it("por defecto la clave es cementeria", () => {
    const e = leerEntorno({ SESSION_SECRET: SECRETO, CIDITUC_HABILITADO: "1", CIDITUC_API_URL: "https://x.invalid" });
    expect(e.cidituc.habilitado && e.cidituc.clave).toBe("cementeria");
  });

  it("CIDITUC_HABILITADO solo admite 0 o 1", () => {
    expect(problemasDe(() => leerEntorno({ SESSION_SECRET: SECRETO, CIDITUC_HABILITADO: "true" }))).toEqual([
      expect.stringMatching(/^CIDITUC_HABILITADO/),
    ]);
  });
});

describe("esHostDeStaging y devLoginPara", () => {
  it.each([
    ["cementeria-staging.smt.gob.ar", true],
    ["staging.cementerios.smt.gob.ar", true],
    // Un host local no es staging: detrás de nginx el cliente elige el Host.
    ["localhost", false],
    ["127.0.0.1", false],
    ["[::1]", false],
    ["cementeria.smt.gob.ar", false],
    ["stagingcementeria.smt.gob.ar", false],
  ])("%s → %s", (host, esperado) => {
    expect(esHostDeStaging(host)).toBe(esperado);
  });

  it.each(["http://localhost:3010", "http://127.0.0.1:3010", "https://localhost", "http://[::1]:3010"])(
    "en producción, con lista blanca y APP_URL=%s, no arranca",
    (appUrl) => {
      const problemas = problemasDe(() =>
        leerEntorno({ NODE_ENV: "production", SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN_STAGING: "20000000001", APP_URL: appUrl }),
      );
      expect(problemas).toEqual([expect.stringMatching(/^AUTH_DEV_LOGIN_STAGING: el host .* no es de staging/)]);
    },
  );

  it("en producción, con lista blanca, APP_URL tiene que ser https", () => {
    const problemas = problemasDe(() =>
      leerEntorno({
        NODE_ENV: "production",
        SESSION_SECRET: SECRETO,
        AUTH_DEV_LOGIN_STAGING: "20000000001",
        APP_URL: "http://cementeria-staging.ejemplo.invalid",
      }),
    );
    expect(problemas).toEqual([expect.stringMatching(/^APP_URL: .*https/)]);
  });

  it("en producción el request tiene que venir al host de APP_URL", () => {
    const e = leerEntorno({
      NODE_ENV: "production",
      SESSION_SECRET: SECRETO,
      APP_URL: "https://cementeria-staging.ejemplo.invalid",
      AUTH_DEV_LOGIN_STAGING: "20000000001",
    });
    expect(devLoginPara(e, "cementeria-staging.ejemplo.invalid")).not.toBeNull();
    expect(devLoginPara(e, "CEMENTERIA-STAGING.ejemplo.invalid")).not.toBeNull();
    expect(devLoginPara(e, "cementeria.ejemplo.invalid")).toBeNull();
    expect(devLoginPara(e, "otro-staging.ejemplo.invalid")).toBeNull();
  });

  it("en desarrollo no importa el host; deshabilitado, nunca", () => {
    expect(devLoginPara(leerEntorno({ SESSION_SECRET: SECRETO, AUTH_DEV_LOGIN: "1" }), "otra-pc")).not.toBeNull();
    expect(devLoginPara(leerEntorno({ SESSION_SECRET: SECRETO }), "localhost")).toBeNull();
  });
});

describe("arranque (src/instrumentation.ts)", () => {
  it("validarEntornoAlIniciar exige además DATABASE_URL", () => {
    expect(problemasDe(() => validarEntornoAlIniciar({ SESSION_SECRET: SECRETO }))).toEqual([
      expect.stringMatching(/^DATABASE_URL/),
    ]);
    expect(validarEntornoAlIniciar({ SESSION_SECRET: SECRETO, DATABASE_URL: BASE }).nodeEnv).toBe("development");
  });

  it("register() termina el proceso en producción con AUTH_DEV_LOGIN definida", async () => {
    // next start atrapa el error de register() y sigue escuchando: por eso
    // register() mismo hace process.exit(1). Acá se simula para no matar el
    // worker de Vitest.
    const salir = vi.spyOn(process, "exit").mockImplementation((codigo?: string | number | null) => {
      throw new Error(`process.exit(${String(codigo)})`);
    });
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SESSION_SECRET", SECRETO);
      vi.stubEnv("DATABASE_URL", BASE);
      vi.stubEnv("AUTH_DEV_LOGIN", "1");
      await expect(register()).rejects.toThrow("process.exit(1)");
      expect(consola).toHaveBeenCalledWith(expect.stringMatching(/"arranque\.rechazado".*AUTH_DEV_LOGIN/));

      vi.stubEnv("AUTH_DEV_LOGIN", undefined);
      await expect(register()).resolves.toBeUndefined();
      expect(salir).toHaveBeenCalledTimes(1);
    } finally {
      salir.mockRestore();
      consola.mockRestore();
    }
  });

  it("en desarrollo register() relanza el error, que next dev muestra", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", "corto");
    vi.stubEnv("DATABASE_URL", BASE);
    await expect(register()).rejects.toThrow(/SESSION_SECRET/);
  });

  it("register() no hace nada fuera del runtime de Node", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DEV_LOGIN", "1");
    await expect(register()).resolves.toBeUndefined();
  });
});
