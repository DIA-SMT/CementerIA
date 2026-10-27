import { describe, expect, it } from "vitest";
import { CLAVE_DESARROLLO } from "../../../prisma/semilla/usuarios";
import {
  ALFABETO_TEMPORAL,
  generarClaveTemporal,
  hashearClave,
  leerHash,
  PARAMETROS_ACTUALES,
  problemasDeClave,
  RE_CLAVE_TEMPORAL,
  REGLAS_CLAVE,
  reglasClave,
  verificarClave,
} from "./clave";

// Solo datos ficticios. Parámetros bajos donde no importa el costo, para que
// los tests no tarden.
const BARATOS = { N: 1024, r: 8, p: 1 };
const PERSONA = { cuil: "20000000001", apellido: "Pérez de la Fuente" };

describe("hash versionado", () => {
  it("lleva el algoritmo y los parámetros adentro: scrypt$N$r$p$sal$hash", async () => {
    const h = await hashearClave("una frase bastante larga");
    expect(h).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(h).not.toContain("una frase");
    expect(leerHash(h)?.parametros).toEqual(PARAMETROS_ACTUALES);
  });

  it("la misma contraseña da hashes distintos (sal aleatoria)", async () => {
    const [a, b] = await Promise.all([hashearClave("misma clave de prueba", BARATOS), hashearClave("misma clave de prueba", BARATOS)]);
    expect(a).not.toBe(b);
  });

  it("verifica la correcta y rechaza otra", async () => {
    const h = await hashearClave("caballo correcto batería grapa");
    expect(await verificarClave("caballo correcto batería grapa", h)).toEqual({ ok: true, rehacer: false });
    expect(await verificarClave("caballo correcto bateria grapa", h)).toEqual({ ok: false, rehacer: false });
    expect(await verificarClave("", h)).toEqual({ ok: false, rehacer: false });
  });

  it("normaliza a NFC: la ñ compuesta y la ñ con la tilde aparte son la misma contraseña", async () => {
    const h = await hashearClave("la montaña de lejos", BARATOS);
    expect((await verificarClave("la montaña de lejos", h)).ok).toBe(true);
    expect((await verificarClave("la montana de lejos", h)).ok).toBe(false);
  });

  it("un hash con otros parámetros se verifica con los suyos y pide rehacerse (para subir el costo después)", async () => {
    const viejo = await hashearClave("clave con parámetros viejos", BARATOS);
    expect(viejo.startsWith("scrypt$1024$8$1$")).toBe(true);
    expect(await verificarClave("clave con parámetros viejos", viejo)).toEqual({ ok: true, rehacer: true });
    expect(await verificarClave("otra", viejo)).toEqual({ ok: false, rehacer: false });
  });

  it("sin hash (usuario inexistente o sin contraseña) o con uno roto: no, y con el mismo cálculo (señuelo)", async () => {
    for (const guardado of [null, undefined, "", "texto-plano", "scrypt$3$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA", "bcrypt$10$xxx"]) {
      expect(await verificarClave("cualquier cosa", guardado)).toEqual({ ok: false, rehacer: false });
    }
  });

  it("leerHash rechaza parámetros fuera de las cotas (un valor raro no pide un cálculo enorme)", () => {
    const sal = "A".repeat(22);
    const hash = "B".repeat(43);
    expect(leerHash(`scrypt$16384$8$1$${sal}$${hash}`)).not.toBeNull();
    expect(leerHash(`scrypt$16383$8$1$${sal}$${hash}`)).toBeNull(); // N no es potencia de 2
    expect(leerHash(`scrypt$${2 ** 21}$8$1$${sal}$${hash}`)).toBeNull();
    expect(leerHash(`scrypt$16384$64$1$${sal}$${hash}`)).toBeNull();
    expect(leerHash(`scrypt$16384$8$99$${sal}$${hash}`)).toBeNull();
    expect(leerHash(`scrypt$16384$8$1$corta$${hash}`)).toBeNull();
  });

  it("no acepta hashear una contraseña vacía o enorme", async () => {
    await expect(hashearClave("")).rejects.toThrow(/largo/);
    await expect(hashearClave("x".repeat(129))).rejects.toThrow(/largo/);
  });
});

describe("contraseñas temporales", () => {
  it("cuatro grupos de cuatro, en minúsculas y dígitos sin los ambiguos (i, l, o, 0, 1)", () => {
    for (let i = 0; i < 200; i++) {
      const t = generarClaveTemporal();
      expect(t).toMatch(RE_CLAVE_TEMPORAL);
      expect(t).not.toMatch(/[ilo01]/);
      for (const c of t.replaceAll("-", "")) expect(ALFABETO_TEMPORAL).toContain(c);
    }
    expect(ALFABETO_TEMPORAL).toHaveLength(31);
  });

  it("no se repiten (~79 bits)", () => {
    const vistas = new Set(Array.from({ length: 2000 }, generarClaveTemporal));
    expect(vistas.size).toBe(2000);
  });
});

describe("política de contraseñas", () => {
  it("acepta una frase larga y una clave larga con variedad", () => {
    expect(problemasDeClave("el mate de la tarde con tortillas", PERSONA)).toEqual([]);
    expect(problemasDeClave("Gx7!rT2q-Lm9#vB", PERSONA)).toEqual([]);
  });

  it("mínimo 12 caracteres", () => {
    expect(problemasDeClave("Gx7!rT2q-Lm", PERSONA)).toEqual([expect.stringContaining("tienen que ser al menos 12")]);
  });

  it("no puede ser el CUIL, con o sin guiones", () => {
    expect(problemasDeClave("20000000001", PERSONA).join(" ")).toMatch(/CUIL/);
    expect(problemasDeClave("20-00000000-1", PERSONA).join(" ")).toMatch(/CUIL/);
  });

  it("no puede contener el apellido (sin importar mayúsculas ni tildes; las partículas no cuentan)", () => {
    expect(problemasDeClave("mi clave es PEREZ y algo más", PERSONA)).toContain("No puede contener tu apellido.");
    expect(problemasDeClave("la fuente del parque 2026", PERSONA)).toContain("No puede contener tu apellido.");
    // "de" y "la" son partículas: no cuentan.
    expect(problemasDeClave("de la casa al trabajo en colectivo", PERSONA)).toEqual([]);
  });

  it("rechaza claves comunes, también con números o signos agregados", () => {
    for (const c of ["password1234", "Password2026!", "Cementeria123", "contraseña2026", "qwertyuiop12", "Tucuman-2026!"]) {
      expect({ c, p: problemasDeClave(c, PERSONA).join(" ") }).toEqual({ c, p: expect.stringMatching(/clave común/) });
    }
  });

  it("rechaza secuencias de números y lo que tiene menos de 5 caracteres distintos", () => {
    expect(problemasDeClave("123456789012", PERSONA).join(" ")).toMatch(/secuencia/);
    expect(problemasDeClave("111111111111", PERSONA).join(" ")).toMatch(/5 caracteres distintos/);
    expect(problemasDeClave("abababababab", PERSONA).join(" ")).toMatch(/5 caracteres distintos/);
  });

  it("la contraseña de desarrollo de la semilla (pública, en el README) no se puede elegir", () => {
    expect(problemasDeClave(CLAVE_DESARROLLO, PERSONA).join(" ")).toMatch(/clave común/);
  });

  it("las reglas que se muestran mencionan el mínimo, el CUIL, el apellido y las comunes", () => {
    const texto = REGLAS_CLAVE.join(" ");
    expect(texto).toMatch(/12 caracteres/);
    expect(texto).toMatch(/CUIL/);
    expect(texto).toMatch(/apellido/);
    expect(texto).toMatch(/común/);
  });
});

describe("política libre (CLAVE_POLITICA=libre, para probar)", () => {
  it("acepta cualquier contraseña de 1 a 128 caracteres", () => {
    expect(problemasDeClave("123456", PERSONA, "libre")).toEqual([]);
    expect(problemasDeClave("20000000001", PERSONA, "libre")).toEqual([]);
    expect(problemasDeClave("a", PERSONA, "libre")).toEqual([]);
  });

  it("sigue rechazando la vacía y la de más de 128", () => {
    expect(problemasDeClave("", PERSONA, "libre")).toHaveLength(1);
    expect(problemasDeClave("x".repeat(129), PERSONA, "libre")).toHaveLength(1);
  });

  it("muestra sus propias reglas, y la estricta sigue siendo la de siempre", () => {
    expect(reglasClave("libre").join(" ")).toMatch(/CLAVE_POLITICA=libre/);
    expect(reglasClave()).toBe(REGLAS_CLAVE);
    expect(problemasDeClave("123456", PERSONA)).not.toEqual([]);
  });
});
