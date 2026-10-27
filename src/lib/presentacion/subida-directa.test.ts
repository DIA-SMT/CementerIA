import { describe, expect, it, vi } from "vitest";
import { revisarRecibido } from "@/lib/dominio/expedientes/adjuntos";
import { MENSAJE_GRANDE, MENSAJE_TIPO, type ArchivoParaSubir } from "./imagen";
import { mensajeRechazoStorage, rutaAutorizar, rutaConfirmar, subirDirecto } from "./subida-directa";

// El transporte de la subida directa (navegador → app → Storage → app), con
// un fetch falso. El flujo contra la base y un Storage falso está en
// tests/integracion/adjuntos-storage.test.ts.

const archivo: ArchivoParaSubir = { contenido: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])]), nombre: "escaneo.pdf", mime: "application/pdf" };
const meta = { documento: "DNI", version: 3, comando: "c1" };
const URL_FIRMADA = "https://ref.supabase.co/storage/v1/object/upload/sign/adjuntos/tmp/u?token=t";

function respuesta(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

describe("subirDirecto", () => {
  it("autoriza, sube a la URL firmada con el tipo detectado y confirma con el ticket", async () => {
    const pedir = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u === rutaAutorizar("CEM-1")) return respuesta({ ok: true, subida: { url: URL_FIRMADA, ticket: "tk" } });
      if (u === URL_FIRMADA) return respuesta({ Key: "adjuntos/tmp/u" });
      if (u === rutaConfirmar("CEM-1")) return respuesta({ ok: true, version: 4, nombre: "escaneo.pdf" }, 201);
      throw new Error(`inesperado: ${u} ${init?.method}`);
    });
    const r = await subirDirecto("CEM-1", archivo, meta, pedir as typeof fetch);
    expect(r).toEqual({ ok: true, version: 4, nombre: "escaneo.pdf" });
    const [aut, put, conf] = pedir.mock.calls;
    expect(JSON.parse(String(aut[1]?.body))).toEqual({ documento: "DNI", version: 3, comando: "c1", bytes: 5 });
    expect(put[1]).toMatchObject({ method: "PUT", body: archivo.contenido, headers: { "Content-Type": "application/pdf", "x-upsert": "false" } });
    // La URL firmada no lleva nada de la sesión ni la clave del servidor.
    expect(put[1]?.credentials).toBeUndefined();
    expect(JSON.parse(String(conf[1]?.body))).toEqual({ ticket: "tk", nombre: "escaneo.pdf", documento: "DNI", version: 3, comando: "c1" });
  });

  it("comando repetido: lo de antes, sin subir", async () => {
    const pedir = vi.fn(async () => respuesta({ ok: true, repetido: true, version: 4, nombre: "a.pdf" }));
    expect(await subirDirecto("CEM-1", archivo, meta, pedir as typeof fetch)).toMatchObject({ ok: true, version: 4 });
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("errores: los del dominio tal cual; los de Storage y de red, en castellano", async () => {
    const dominio = { ok: false, codigo: "permiso", mensaje: "No podés hacer esto.", errores: [] };
    expect(await subirDirecto("CEM-1", archivo, meta, (async () => respuesta(dominio, 403)) as typeof fetch)).toEqual(dominio);
    expect(await subirDirecto("CEM-1", archivo, meta, (async () => new Response("<html>", { status: 401 })) as typeof fetch)).toMatchObject({
      ok: false,
      codigo: "401",
    });
    expect(
      await subirDirecto("CEM-1", archivo, meta, (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch),
    ).toMatchObject({ ok: false, codigo: "red" });

    const storageRechaza = vi.fn(async (url: string | URL | Request) =>
      String(url) === URL_FIRMADA
        ? respuesta({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" }, 400)
        : respuesta({ ok: true, subida: { url: URL_FIRMADA, ticket: "tk" } }),
    );
    expect(await subirDirecto("CEM-1", archivo, meta, storageRechaza as typeof fetch)).toMatchObject({ ok: false, mensaje: MENSAJE_GRANDE });
    // No se confirma lo que no se subió.
    expect(storageRechaza).toHaveBeenCalledTimes(2);
  });

  it("los rechazos de Storage", () => {
    expect(mensajeRechazoStorage(400, { statusCode: "413", error: "Payload too large" })).toBe(MENSAJE_GRANDE);
    expect(mensajeRechazoStorage(413, null)).toBe(MENSAJE_GRANDE);
    expect(mensajeRechazoStorage(400, { statusCode: "415", error: "invalid_mime_type" })).toBe(MENSAJE_TIPO);
    expect(mensajeRechazoStorage(500, {})).toMatch(/No se pudo subir/);
  });
});

describe("revisarRecibido (lo que confirma el servidor, por magic bytes)", () => {
  const cab = (...b: number[]) => new Uint8Array(b);
  it("PDF, JPG y PNG sí; vacío, HEIC y otros no, con el mensaje de siempre", () => {
    expect(revisarRecibido({ bytes: 9, cabecera: cab(0x25, 0x50, 0x44, 0x46, 0x2d) })).toEqual({ ok: true, mime: "application/pdf" });
    expect(revisarRecibido({ bytes: 9, cabecera: cab(0xff, 0xd8, 0xff, 0xe0) })).toEqual({ ok: true, mime: "image/jpeg" });
    const mensaje = (r: ReturnType<typeof revisarRecibido>) => (r.ok ? null : { codigo: r.error.codigo, m: r.error.message });
    expect(mensaje(revisarRecibido({ bytes: 0, cabecera: cab() }))).toEqual({ codigo: "adjunto_invalido", m: "El archivo está vacío" });
    expect(mensaje(revisarRecibido({ bytes: 16, cabecera: cab(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63) }))).toEqual({
      codigo: "adjunto_invalido",
      m: "Subilo como JPG",
    });
    expect(mensaje(revisarRecibido({ bytes: 6, cabecera: new TextEncoder().encode("<html>") }))).toEqual({ codigo: "adjunto_invalido", m: "Solo se admiten PDF, JPG o PNG" });
  });
});
