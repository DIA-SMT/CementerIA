import { describe, expect, it } from "vitest";
import {
  enlaceWhatsapp,
  leerHoja,
  mensajeWhatsapp,
  origenPublico,
  rutaEditar,
  rutaFicha,
  rutaImprimir,
  telefonoParaWhatsapp,
  urlAbsoluta,
} from "./enlaces";

describe("URL absoluta de la ficha (QR de la carátula)", () => {
  it("con APP_URL manda APP_URL, aunque el request venga a otro host", () => {
    const origen = origenPublico({ appUrl: new URL("https://cementeria.smt.gob.ar/algo"), host: "127.0.0.1:3010", protocoloReenviado: "http" });
    expect(origen).toBe("https://cementeria.smt.gob.ar");
    expect(urlAbsoluta("/expedientes/CEM-2026-00042", origen)).toBe("https://cementeria.smt.gob.ar/expedientes/CEM-2026-00042");
  });

  it("sin APP_URL usa el Host del request, con http salvo que nginx diga https", () => {
    expect(origenPublico({ appUrl: null, host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(origenPublico({ appUrl: null, host: "cementeria.test", protocoloReenviado: "https" })).toBe("https://cementeria.test");
    expect(origenPublico({ appUrl: null, host: "cementeria.test", protocoloReenviado: "https, http" })).toBe("https://cementeria.test");
    expect(origenPublico({ appUrl: null, host: "cementeria.test", protocoloReenviado: "javascript" })).toBe("http://cementeria.test");
    expect(origenPublico({ appUrl: null, host: "[::1]:3000" })).toBe("http://[::1]:3000");
  });

  it("un Host vacío o con cosas raras no se usa: queda la ruta sola", () => {
    for (const host of [null, "", "evil.com/x", "a b", "user@evil.com"]) {
      expect(origenPublico({ appUrl: null, host })).toBeNull();
    }
    expect(urlAbsoluta("/expedientes/CEM-2026-00001", null)).toBe("/expedientes/CEM-2026-00001");
  });

  it("solo acepta rutas de la app", () => {
    expect(() => urlAbsoluta("https://otro.sitio/x", "http://localhost:3000")).toThrow(RangeError);
  });
});

describe("WhatsApp (wa.me)", () => {
  it.each([
    ["0381 456-7890", "5493814567890"],
    ["381 15 456-7890", "5493814567890"],
    ["0381 15 4567890", "5493814567890"],
    ["+54 9 381 456-7890", "5493814567890"],
    ["+54 381 456 7890", "5493814567890"],
    ["0054 381 4567890", "5493814567890"],
    ["011 15 2345-6789", "5491123456789"],
    ["(0385) 15-421-2345", "5493854212345"],
    ["456-7890", "5493814567890"],
    ["15 456-7890", "5493814567890"],
    ["0381 000-0123", "5493810000123"],
  ])("%s → %s", (entrada, esperado) => {
    expect(telefonoParaWhatsapp(entrada)).toBe(esperado);
  });

  it.each([null, "", "123", "0381 456", "0381 4567 89012 3"])("no arma número con %s", (entrada) => {
    expect(telefonoParaWhatsapp(entrada)).toBeNull();
  });

  it("el mensaje lleva solo el N° interno y el área", () => {
    const mensaje = mensajeWhatsapp("CEM-2026-00042", "Mesa de Entradas");
    expect(mensaje).toContain("CEM-2026-00042");
    expect(mensaje).toContain("Mesa de Entradas");
    expect(enlaceWhatsapp("0381 456-7890", mensaje)).toBe(`https://wa.me/5493814567890?text=${encodeURIComponent(mensaje)}`);
    expect(enlaceWhatsapp("123", mensaje)).toBeNull();
  });
});

describe("rutas", () => {
  it("ficha, edición e imprimibles", () => {
    expect(rutaFicha("CEM-2026-00042")).toBe("/expedientes/CEM-2026-00042");
    expect(rutaEditar("CEM-2026-00042")).toBe("/expedientes/CEM-2026-00042/editar");
    expect(rutaImprimir("CEM-2026-00042", "historial")).toBe("/expedientes/CEM-2026-00042/imprimir?hoja=historial");
  });

  it("?hoja= es la carátula salvo que diga historial", () => {
    expect(leerHoja(undefined)).toBe("caratula");
    expect(leerHoja("cualquiera")).toBe("caratula");
    expect(leerHoja("historial")).toBe("historial");
    expect(leerHoja(["historial", "caratula"])).toBe("historial");
    // 28/10/2026: el comprobante para el concesionario.
    expect(leerHoja("comprobante")).toBe("comprobante");
  });

  it("al terminar el alta, la carátula con nuevo=1 (ofrece el comprobante)", () => {
    expect(rutaImprimir("CEM-2026-00042", "caratula", { nuevo: true })).toBe("/expedientes/CEM-2026-00042/imprimir?hoja=caratula&nuevo=1");
    expect(rutaImprimir("CEM-2026-00042", "comprobante")).toBe("/expedientes/CEM-2026-00042/imprimir?hoja=comprobante");
  });
});
