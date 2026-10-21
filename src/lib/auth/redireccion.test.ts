import { describe, expect, it } from "vitest";
import { redirigirA, rutaPropia } from "./redireccion";

describe("redirigirA", () => {
  it("redirige con Location relativo, sin host", () => {
    const r = redirigirA("/login?salida=1");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login?salida=1");
  });

  it("descarta rutas que el navegador tomaría como otro host", () => {
    expect(rutaPropia("//otro.sitio/x")).toBe("/");
    expect(rutaPropia(String.raw`/\otro.sitio`)).toBe("/");
    expect(rutaPropia("https://otro.sitio")).toBe("/");
    expect(rutaPropia("bandeja")).toBe("/");
    expect(rutaPropia("/expedientes/CEM-2026-00001")).toBe("/expedientes/CEM-2026-00001");
  });
});
