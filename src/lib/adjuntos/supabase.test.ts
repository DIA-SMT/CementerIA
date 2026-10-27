import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { levantarStorageFalso, type StorageFalso } from "../../../tests/stubs/storage-falso";
import { ArchivoMuyGrande, barrerTemporales, rutaParaAdjunto, TemporalAusente, type AlmacenAdjuntos, type ArchivoRecibido } from "./almacen";
import { crearAlmacenSupabase, encabezadosClave, ErrorStorage } from "./supabase";

// El almacén de Supabase Storage contra un Storage falso en memoria
// (tests/stubs/storage-falso.ts), sin red ni el proyecto real.

const PDF = new TextEncoder().encode("%PDF-1.4\n% ficticio de prueba\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

function flujo(bytes: Uint8Array, tamano = 5): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + tamano));
      i += tamano;
    },
  });
}

async function leerTodo(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let falso: StorageFalso;
let almacen: AlmacenAdjuntos;

beforeEach(async () => {
  falso = await levantarStorageFalso();
  almacen = crearAlmacenSupabase({ url: falso.url, clave: falso.clave });
});

afterEach(async () => {
  await falso.cerrar();
});

describe("autenticación ante Storage", () => {
  it("una clave nueva (sb_secret_…) va solo en apikey; una heredada (JWT), también como Bearer", () => {
    expect(encabezadosClave("sb_secret_abc")).toEqual({ apikey: "sb_secret_abc" });
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma";
    expect(encabezadosClave(jwt)).toEqual({ apikey: jwt, Authorization: `Bearer ${jwt}` });
  });

  it("cada pedido del servidor lleva la clave en apikey y nunca en Authorization", async () => {
    await almacen.recibir(flujo(PDF), 1000);
    await almacen.barrerTemporales(new Date());
    expect(falso.pedidos.length).toBeGreaterThan(0);
    for (const p of falso.pedidos) expect(p).toMatchObject({ apikey: falso.clave, authorization: null });
  });

  it("con otra clave, Storage rechaza y el error no lleva la clave", async () => {
    const otro = crearAlmacenSupabase({ url: falso.url, clave: "sb_secret_equivocada" });
    const e = await otro.barrerTemporales(new Date()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorStorage);
    expect(String((e as Error).message)).not.toContain("sb_secret_equivocada");
  });
});

describe("el ciclo de un archivo (recibir → confirmar → abrir → borrar)", () => {
  it("sube a tmp/<uuid> con su tipo, sha256 al vuelo, lo mueve a AAAA/MM/<uuid> y lo sirve igual", async () => {
    const a = await almacen.recibir(flujo(PDF), 1000);
    expect(a).toMatchObject({ bytes: PDF.length, sha256: sha(PDF) });
    expect(a.cabecera).toEqual(PDF.slice(0, 16));
    expect(falso.objetos.get(`tmp/${a.id}`)?.tipo).toBe("application/pdf");

    const ruta = rutaParaAdjunto(new Date("2026-10-27T12:00:00Z"), a.id);
    await almacen.confirmar(a, ruta);
    expect([...falso.objetos.keys()]).toEqual([ruta]);

    const abierto = await almacen.abrir(ruta);
    expect(abierto.bytes).toBe(PDF.length);
    expect(await leerTodo(abierto.contenido)).toEqual(PDF);

    await almacen.borrar(ruta);
    await almacen.borrar(ruta); // repetido: no falla
    expect(falso.objetos.size).toBe(0);
    await expect(almacen.abrir(ruta)).rejects.toThrow(/no está/);
  });

  it("más grande que el máximo: ArchivoMuyGrande y no sube nada", async () => {
    await expect(almacen.recibir(flujo(PDF), PDF.length - 1)).rejects.toBeInstanceOf(ArchivoMuyGrande);
    expect(falso.objetos.size).toBe(0);
  });

  it("vacío u otro tipo: no lo sube (lo rechaza el dominio) y descartar no falla", async () => {
    const vacio = await almacen.recibir(flujo(new Uint8Array(0)), 1000);
    const html = await almacen.recibir(flujo(new TextEncoder().encode("<html>")), 1000);
    expect([vacio.bytes, html.bytes]).toEqual([0, 6]);
    expect(falso.objetos.size).toBe(0);
    await almacen.descartar(html);
  });

  it("rechaza rutas e ids que no son los suyos (nunca fuera de AAAA/MM/<uuid> ni tmp/<uuid>)", async () => {
    await expect(almacen.abrir("../../otro-bucket/x")).rejects.toThrow(/Ruta de adjunto inválida/);
    await expect(almacen.borrar("2026/10/../../x")).rejects.toThrow(/Ruta de adjunto inválida/);
    const raro: ArchivoRecibido = { id: "../x", bytes: 1, sha256: "", cabecera: new Uint8Array() };
    await expect(almacen.descartar(raro)).rejects.toThrow(/Id de adjunto inválido/);
  });

  it("'no existe' también como lo contestan las versiones viejas (400 con statusCode 404), y sin Content-Length", async () => {
    await falso.cerrar();
    falso = await levantarStorageFalso({ noEncontrado400: true, sinLargo: true });
    almacen = crearAlmacenSupabase({ url: falso.url, clave: falso.clave });
    await expect(almacen.abrir(`2026/10/${randomUUID()}`)).rejects.toThrow(/no está/);
    const ruta = `2026/10/${randomUUID()}`;
    falso.poner(ruta, PNG, "image/png");
    const a = await almacen.abrir(ruta);
    expect(a.bytes).toBeNull();
    expect(await leerTodo(a.contenido)).toEqual(PNG);
  });
});

describe("subida directa (URL firmada) e inspección del temporal", () => {
  it("la URL firmada sirve para subir tmp/<uuid> una sola vez y la inspección mide tamaño, sha256 y cabecera", async () => {
    const s = await almacen.prepararSubidaDirecta!();
    expect(s.url).toMatch(new RegExp(`/storage/v1/object/upload/sign/adjuntos/tmp/${s.id}\\?token=`));
    // El navegador: PUT sin clave, con el tipo detectado.
    const put = await fetch(s.url, { method: "PUT", body: PDF, headers: { "Content-Type": "application/pdf", "x-upsert": "false" } });
    expect(put.status).toBe(200);
    // Otra vez con la misma URL: el objeto ya existe y no se pisa.
    const otra = await fetch(s.url, { method: "PUT", body: PNG, headers: { "Content-Type": "image/png" } });
    expect(otra.ok).toBe(false);

    const a = await almacen.inspeccionarTemporal!(s.id, 1000);
    expect(a).toMatchObject({ id: s.id, bytes: PDF.length, sha256: sha(PDF) });
    expect(a.cabecera).toEqual(PDF.slice(0, 16));
    // Inspeccionar no lo mueve ni lo borra.
    expect(falso.objetos.has(`tmp/${s.id}`)).toBe(true);
  });

  it("si el temporal pasa del máximo, lo borra y avisa (con y sin Content-Length)", async () => {
    for (const sinLargo of [false, true]) {
      await falso.cerrar();
      falso = await levantarStorageFalso({ sinLargo });
      almacen = crearAlmacenSupabase({ url: falso.url, clave: falso.clave });
      const id = randomUUID();
      falso.poner(`tmp/${id}`, PDF);
      await expect(almacen.inspeccionarTemporal!(id, PDF.length - 1)).rejects.toBeInstanceOf(ArchivoMuyGrande);
      expect(falso.objetos.has(`tmp/${id}`)).toBe(false);
    }
  });

  it("si el navegador no llegó a subirlo: TemporalAusente", async () => {
    await expect(almacen.inspeccionarTemporal!(randomUUID(), 1000)).rejects.toBeInstanceOf(TemporalAusente);
    await expect(almacen.inspeccionarTemporal!("no-es-un-uuid", 1000)).rejects.toThrow(/Id de adjunto inválido/);
  });
});

describe("barrido de temporales", () => {
  it("borra solo los tmp/<uuid> de más de 24 h; no toca los nuevos ni los confirmados", async () => {
    const ahora = new Date("2026-10-27T12:00:00Z");
    const viejo = randomUUID();
    const nuevo = randomUUID();
    falso.poner(`tmp/${viejo}`, PDF, "application/pdf", new Date("2026-10-26T11:00:00Z"));
    falso.poner(`tmp/${nuevo}`, PDF, "application/pdf", new Date("2026-10-27T11:00:00Z"));
    falso.poner(`2026/10/${randomUUID()}`, PDF, "application/pdf", new Date("2026-01-01T00:00:00Z"));
    expect(await barrerTemporales(almacen, ahora)).toBe(1);
    expect(falso.objetos.has(`tmp/${viejo}`)).toBe(false);
    expect(falso.objetos.has(`tmp/${nuevo}`)).toBe(true);
    expect(falso.objetos.size).toBe(2);
    // Otra vez: nada (idempotente).
    expect(await barrerTemporales(almacen, ahora)).toBe(0);
  });

  it("pagina el listado y borra en tandas", async () => {
    const viejos = Array.from({ length: 1205 }, () => randomUUID());
    for (const id of viejos) falso.poner(`tmp/${id}`, PNG, "image/png", new Date("2026-01-01T00:00:00Z"));
    expect(await barrerTemporales(almacen, new Date("2026-10-27T12:00:00Z"))).toBe(1205);
    expect(falso.objetos.size).toBe(0);
  });
});
