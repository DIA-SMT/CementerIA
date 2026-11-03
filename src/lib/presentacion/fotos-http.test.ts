import { describe, expect, it } from "vitest";
import { CACHE_FOTO, responderFotoPublica, type LectorFotoPublica } from "./fotos-http";

/**
 * La ruta pública de las fotos del sitio (GET /sitio/fotos/[id]/[archivo]),
 * con una base y un almacén falsos: los encabezados de una foto activa y 404
 * para todo lo demás.
 */

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const VERSION = SHA.slice(0, 16);

function base(fila: { ruta: string; sha256: string; activa: boolean } | null): LectorFotoPublica & { pedidos: string[] } {
  const pedidos: string[] = [];
  return {
    pedidos,
    sitioFoto: {
      async findUnique({ where }) {
        pedidos.push(where.id);
        return where.id === ID ? fila : null;
      },
    },
  };
}

function almacen(contenido = new Uint8Array([0x52, 0x49, 0x46, 0x46])) {
  const abiertos: string[] = [];
  return {
    abiertos,
    async abrir(ruta: string) {
      abiertos.push(ruta);
      return { contenido: new Response(contenido).body as ReadableStream<Uint8Array>, bytes: contenido.byteLength };
    },
  };
}

const ACTIVA = { ruta: `fotos/${ID}`, sha256: SHA, activa: true };

describe("GET /sitio/fotos/[id]/[archivo]", () => {
  it("una foto activa: image/webp, caché larga e immutable con s-maxage, nosniff y el ancho pedido", async () => {
    const a = almacen();
    const r = await responderFotoPublica(base(ACTIVA), a, ID, `${VERSION}-1920.webp`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("cache-control")).toBe(CACHE_FOTO);
    expect(CACHE_FOTO).toMatch(/^public, max-age=31536000, s-maxage=\d+, immutable$/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-length")).toBe("4");
    expect(a.abiertos).toEqual([`fotos/${ID}/1920.webp`]);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  });

  it.each([
    ["un id que no es uuid", "no-es-un-uuid", `${VERSION}-960.webp`],
    ["un id con mayúsculas (no es el de la base)", ID.toUpperCase(), `${VERSION}-960.webp`],
    ["un id que no existe", "00000000-0000-4000-8000-000000000000", `${VERSION}-960.webp`],
    ["otra versión (la foto cambió o se inventó)", ID, `${"0".repeat(16)}-960.webp`],
    ["otro ancho", ID, `${VERSION}-480.webp`],
    ["otra extensión", ID, `${VERSION}-960.jpg`],
    ["un intento de salir de la carpeta", ID, `..%2F..%2Fadjuntos`],
    ["sin nombre", ID, ""],
  ])("404 con %s, sin abrir nada del almacén", async (_n, id, archivo) => {
    const a = almacen();
    const r = await responderFotoPublica(base(ACTIVA), a, id, archivo);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(a.abiertos).toEqual([]);
  });

  it("404 con una foto dada de baja, igual que si no existiera", async () => {
    const a = almacen();
    const r = await responderFotoPublica(base({ ...ACTIVA, activa: false }), a, ID, `${VERSION}-960.webp`);
    expect(r.status).toBe(404);
    expect(a.abiertos).toEqual([]);
  });

  it("si el archivo no está en el almacén, 404 (y lo registra)", async () => {
    const errores: unknown[] = [];
    const r = await responderFotoPublica(
      base(ACTIVA),
      {
        abrir: async () => {
          throw new Error("no está");
        },
      },
      ID,
      `${VERSION}-960.webp`,
      (e) => errores.push(e),
    );
    expect(r.status).toBe(404);
    expect(errores).toHaveLength(1);
  });

  it("si la base no responde, 503 sin caché", async () => {
    const r = await responderFotoPublica(
      {
        sitioFoto: {
          findUnique: async () => {
            throw new Error("sin base");
          },
        },
      },
      almacen(),
      ID,
      `${VERSION}-960.webp`,
    );
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
