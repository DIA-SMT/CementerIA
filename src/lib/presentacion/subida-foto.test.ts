import { describe, expect, it } from "vitest";
import { MENSAJES_FOTO } from "@/lib/imagenes/tipos";
import { RUTA_AUTORIZAR_FOTO, RUTA_CONFIRMAR_FOTO, revisarFotoElegida, subirFoto, urlSubidaFoto } from "./subida-foto";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const ARCHIVO = new Blob([JPEG], { type: "image/jpeg" });

/** Un fetch falso que contesta en orden y guarda los pedidos. */
function fetchFalso(respuestas: Array<() => Response>) {
  const pedidos: Array<{ url: string; metodo: string; tipo: string | null; cuerpo: unknown }> = [];
  const pedir = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    pedidos.push({ url, metodo: init?.method ?? "GET", tipo: headers.get("content-type"), cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
    const r = respuestas.shift();
    if (!r) throw new Error("pedido de más");
    return r();
  }) as unknown as typeof fetch;
  return { pedir, pedidos };
}

describe("antes de subir", () => {
  it("revisa tipo, tamaño y medidas", () => {
    expect(revisarFotoElegida(1000, JPEG, { ancho: 1200, alto: 800 })).toEqual({ ok: true, mime: "image/jpeg" });
    expect(revisarFotoElegida(1000, new TextEncoder().encode("GIF89a"), null)).toEqual({ ok: false, mensaje: MENSAJES_FOTO.gif });
    expect(revisarFotoElegida(16 * 1024 * 1024, JPEG, null)).toEqual({ ok: false, mensaje: MENSAJES_FOTO.grande });
    expect(revisarFotoElegida(1000, JPEG, { ancho: 400, alto: 300 })).toMatchObject({ ok: false });
    // Si el navegador no la pudo leer, decide el servidor.
    expect(revisarFotoElegida(1000, JPEG, null)).toEqual({ ok: true, mime: "image/jpeg" });
  });

  it("la URL de la subida por la app lleva el texto en la query (el crédito, solo si hay)", () => {
    expect(urlSubidaFoto({ alt: "Portón del Oeste", credito: "" })).toBe("/api/sitio/fotos?alt=Port%C3%B3n+del+Oeste");
    expect(urlSubidaFoto({ alt: "Portón", credito: "Archivo" })).toBe("/api/sitio/fotos?alt=Port%C3%B3n&credito=Archivo");
  });
});

describe("subirFoto", () => {
  it("por la app: un POST con la foto como cuerpo y su tipo por magic bytes", async () => {
    const f = fetchFalso([() => Response.json({ ok: true, id: "x", alt: "Portón", src: "/sitio/fotos/x/y-960.webp" }, { status: 201 })]);
    const r = await subirFoto(ARCHIVO, "image/jpeg", { alt: "Portón", credito: "" }, "app", f.pedir);
    expect(r).toMatchObject({ ok: true, id: "x" });
    expect(f.pedidos).toEqual([{ url: "/api/sitio/fotos?alt=Port%C3%B3n", metodo: "POST", tipo: "image/jpeg", cuerpo: ARCHIVO }]);
  });

  it("por la app: un 413 de nginx o de Vercel (sin JSON) dice que supera los 15 MB", async () => {
    const f = fetchFalso([() => new Response("Request Entity Too Large", { status: 413 })]);
    expect(await subirFoto(ARCHIVO, "image/jpeg", { alt: "Portón", credito: "" }, "app", f.pedir)).toMatchObject({ ok: false, mensaje: MENSAJES_FOTO.grande });
  });

  it("directa: autorizar, PUT del original a la URL firmada, confirmar con el ticket", async () => {
    const url = "https://almacen.ejemplo.invalid/storage/v1/object/upload/sign/sitio-publico/tmp/abc?token=t";
    const f = fetchFalso([
      () => Response.json({ ok: true, subida: { url, ticket: "tk" } }),
      () => Response.json({ Key: "sitio-publico/tmp/abc" }),
      () => Response.json({ ok: true, id: "x", alt: "Portón", src: "/sitio/fotos/x/y-960.webp" }, { status: 201 }),
    ]);
    const r = await subirFoto(ARCHIVO, "image/jpeg", { alt: "Portón", credito: "Archivo" }, "directa", f.pedir);
    expect(r).toMatchObject({ ok: true, id: "x" });
    expect(f.pedidos.map((p) => [p.url, p.metodo, p.tipo])).toEqual([
      [RUTA_AUTORIZAR_FOTO, "POST", "application/json"],
      [url, "PUT", "image/jpeg"],
      [RUTA_CONFIRMAR_FOTO, "POST", "application/json"],
    ]);
    expect(f.pedidos[0].cuerpo).toEqual({ alt: "Portón", credito: "Archivo", bytes: JPEG.byteLength });
    expect(f.pedidos[2].cuerpo).toEqual({ ticket: "tk", alt: "Portón", credito: "Archivo" });
  });

  it("directa: si el bucket la rechaza por tamaño, el mensaje de las fotos (no el de los adjuntos)", async () => {
    const f = fetchFalso([
      () => Response.json({ ok: true, subida: { url: "https://almacen.ejemplo.invalid/x?token=t", ticket: "tk" } }),
      () => Response.json({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" }, { status: 400 }),
    ]);
    expect(await subirFoto(ARCHIVO, "image/jpeg", { alt: "Portón", credito: "" }, "directa", f.pedir)).toMatchObject({ ok: false, mensaje: MENSAJES_FOTO.grande });
  });

  it("directa: un error del dominio al autorizar (sin permiso, límite) llega tal cual y no sube nada", async () => {
    const f = fetchFalso([() => Response.json({ ok: false, codigo: "limite_alcanzado", mensaje: "Ya hay 200 fotos activas", errores: [] }, { status: 409 })]);
    expect(await subirFoto(ARCHIVO, "image/jpeg", { alt: "Portón", credito: "" }, "directa", f.pedir)).toMatchObject({ ok: false, codigo: "limite_alcanzado" });
    expect(f.pedidos).toHaveLength(1);
  });
});
