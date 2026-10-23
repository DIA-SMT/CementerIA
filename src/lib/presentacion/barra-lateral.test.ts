import { describe, expect, it } from "vitest";
import { COOKIE_BARRA, cookiePreferenciaBarra, leerPreferenciaBarra } from "./barra-lateral";

describe("preferencia de la barra lateral", () => {
  it("lee solo los dos valores válidos; lo demás es «nunca eligió»", () => {
    expect(leerPreferenciaBarra("colapsada")).toBe("colapsada");
    expect(leerPreferenciaBarra("expandida")).toBe("expandida");
    expect(leerPreferenciaBarra(undefined)).toBeNull();
    expect(leerPreferenciaBarra("")).toBeNull();
    expect(leerPreferenciaBarra("COLAPSADA")).toBeNull();
    expect(leerPreferenciaBarra("<script>")).toBeNull();
  });

  it("arma la cookie con la ruta raíz, un año, SameSite=Lax y Secure solo en https", () => {
    const http = cookiePreferenciaBarra("colapsada", false);
    expect(http).toBe(`${COOKIE_BARRA}=colapsada; Path=/; Max-Age=31536000; SameSite=Lax`);
    expect(cookiePreferenciaBarra("expandida", true)).toMatch(/; Secure$/);
  });
});
