import { X509Certificate } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { autoridadesConfiables, getDeCidituc, motivoDeFallo } from "./https";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6OTk5OX0.firma-ficticia-de-prueba";

describe("autoridadesConfiables", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("suma el intermedio de Sectigo a las raíces del runtime, sin quitar ninguna", () => {
    const cas = autoridadesConfiables();
    expect(cas.length).toBe(tls.rootCertificates.length + 1);
    expect(cas.slice(0, -1)).toEqual([...tls.rootCertificates]);
  });

  it("el intermedio embebido es el documentado (huella SHA-1, emisor y vencimiento)", () => {
    vi.stubEnv("CIDITUC_CA_PEM", "");
    const certificado = new X509Certificate(autoridadesConfiables().at(-1) ?? "");
    expect(certificado.fingerprint).toBe("DD:55:B4:52:02:91:E2:76:58:8F:0D:D0:2F:AF:D8:3A:73:68:E0:FA");
    expect(certificado.subject).toContain("Sectigo Public Server Authentication CA DV R36");
    expect(certificado.issuer).toContain("Sectigo Public Server Authentication Root R46");
    expect(certificado.ca).toBe(true);
    expect(new Date(certificado.validTo).toISOString().slice(0, 10)).toBe("2036-03-21");
  });

  it("CIDITUC_CA_PEM reemplaza al embebido, para rotarlo sin desplegar", () => {
    vi.stubEnv("CIDITUC_CA_PEM", "  -----BEGIN CERTIFICATE-----\nOTRO\n-----END CERTIFICATE-----\n");
    const cas = autoridadesConfiables();
    expect(cas.at(-1)).toBe("-----BEGIN CERTIFICATE-----\nOTRO\n-----END CERTIFICATE-----");
    expect(cas.length).toBe(tls.rootCertificates.length + 1);
  });
});

describe("getDeCidituc contra un backend local", () => {
  let servidor: http.Server;
  let base: string;
  const recibidos: http.IncomingHttpHeaders[] = [];
  const rutas: string[] = [];

  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      recibidos.push(req.headers);
      rutas.push(req.url ?? "");
      if (req.url?.startsWith("/lento")) return; // nunca responde
      if (req.url?.startsWith("/enorme")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("x".repeat(1_100_000));
        return;
      }
      if (req.url?.startsWith("/redirige")) {
        res.writeHead(302, { Location: "/otro" });
        res.end();
        return;
      }
      res.writeHead(req.headers.authorization === TOKEN ? 200 : 401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id_persona: 9999 } }));
    });
    await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    servidor.closeAllConnections();
    await new Promise((listo) => servidor.close(listo));
  });

  it("manda el token CRUDO en Authorization, sin Bearer, y pide JSON", async () => {
    const respuesta = await getDeCidituc(`${base}/usuarios/authStatusIA?x=1`, TOKEN, 2_000);
    expect(respuesta).toEqual({ status: 200, body: JSON.stringify({ user: { id_persona: 9999 } }) });
    expect(recibidos.at(-1)?.authorization).toBe(TOKEN);
    expect(recibidos.at(-1)?.accept).toBe("application/json");
    expect(rutas.at(-1)).toBe("/usuarios/authStatusIA?x=1");
  });

  it("devuelve el status del backend tal cual, también 401", async () => {
    expect((await getDeCidituc(`${base}/usuarios/authStatusIA`, "otro-token-ficticio-cualquiera", 2_000)).status).toBe(
      401,
    );
  });

  it("no sigue redirecciones: un 3xx vuelve como status", async () => {
    expect((await getDeCidituc(`${base}/redirige`, TOKEN, 2_000)).status).toBe(302);
  });

  it("corta con ETIMEDOUT si el backend no contesta a tiempo", async () => {
    await expect(getDeCidituc(`${base}/lento`, TOKEN, 150)).rejects.toMatchObject({ code: "ETIMEDOUT" });
  });

  it("corta si la respuesta supera el tope de tamaño", async () => {
    await expect(getDeCidituc(`${base}/enorme`, TOKEN, 2_000)).rejects.toThrow(/supera el tamaño/);
  });

  it("si no hay nadie escuchando, falla con el código de red", async () => {
    const libre = http.createServer();
    await new Promise<void>((listo) => libre.listen(0, "127.0.0.1", listo));
    const puerto = (libre.address() as AddressInfo).port;
    await new Promise((listo) => libre.close(listo));
    await expect(getDeCidituc(`http://127.0.0.1:${puerto}/`, TOKEN, 2_000)).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
  });
});

describe("motivoDeFallo", () => {
  it("nombra el certificado cuando la cadena no valida", () => {
    expect(motivoDeFallo(Object.assign(new Error("x"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }))).toMatch(
      /^UNABLE_TO_VERIFY_LEAF_SIGNATURE: el certificado del backend no valida/,
    );
  });

  it("usa el code del error o de su causa", () => {
    expect(motivoDeFallo(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toBe("ENOTFOUND");
    expect(motivoDeFallo(new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }))).toBe("ECONNREFUSED");
  });

  it("sin code, el mensaje; sin nada, un texto fijo", () => {
    expect(motivoDeFallo(new Error("algo pasó"))).toBe("algo pasó");
    expect(motivoDeFallo("texto suelto")).toBe("error desconocido");
    expect(motivoDeFallo(null)).toBe("error desconocido");
  });
});
