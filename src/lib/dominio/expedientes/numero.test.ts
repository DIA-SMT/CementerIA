import { describe, expect, it } from "vitest";
import { canonizarNumeroInterno, formatearNumeroInterno, interpretarFormaCorta, interpretarNumeroInterno, numeroCorto } from "./numero";

describe("número interno (2.13(f))", () => {
  it("formato CEM-AAAA-NNNNN y forma corta", () => {
    expect(formatearNumeroInterno(2026, 42)).toBe("CEM-2026-00042");
    expect(formatearNumeroInterno(2026, 123456)).toBe("CEM-2026-123456");
    expect(numeroCorto(2026, 42)).toBe("42/2026");
  });

  it("interpreta lo que se escribe", () => {
    expect(interpretarNumeroInterno("CEM-2026-00042")).toEqual({ anio: 2026, secuencia: 42 });
    expect(interpretarNumeroInterno(" cem 2026 / 42 ")).toEqual({ anio: 2026, secuencia: 42 });
    expect(interpretarNumeroInterno("CEM-2026-0")).toBeNull();
    expect(interpretarNumeroInterno("CEM-26-42")).toBeNull();
    expect(interpretarFormaCorta("42/2026")).toEqual({ anio: 2026, secuencia: 42 });
    expect(interpretarFormaCorta("42-2026")).toBeNull();
  });

  it("canoniza para las URLs", () => {
    expect(canonizarNumeroInterno("cem-2026-42")).toBe("CEM-2026-00042");
    expect(canonizarNumeroInterno("42/2026")).toBe("CEM-2026-00042");
    expect(canonizarNumeroInterno("hola")).toBeNull();
  });
});
