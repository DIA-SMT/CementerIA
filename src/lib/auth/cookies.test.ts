import { describe, expect, it } from "vitest";
import { cookieSegura, nombreCookie } from "./cookies";

describe("nombreCookie", () => {
  it("en producción lleva el prefijo __Host- (no la puede plantar otro subdominio)", () => {
    expect(nombreCookie("cem_sesion", "production")).toBe("__Host-cem_sesion");
    expect(nombreCookie("cem_cidituc_state", "production")).toBe("__Host-cem_cidituc_state");
  });

  it("fuera de producción no: en http://localhost la cookie no es Secure y el prefijo la haría descartar", () => {
    expect(nombreCookie("cem_sesion", "development")).toBe("cem_sesion");
    expect(nombreCookie("cem_sesion", "test")).toBe("cem_sesion");
  });

  it("en producción la cookie es siempre Secure, que el prefijo exige", () => {
    expect(cookieSegura(new URL("http://127.0.0.1:3010/"), "production")).toBe(true);
    expect(cookieSegura(new URL("http://localhost:3000/"), "development")).toBe(false);
  });
});
