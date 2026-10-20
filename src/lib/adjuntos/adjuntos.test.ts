import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArchivoMuyGrande, barrerTemporales, crearAlmacenEnDisco, raizAdjuntos, rutaParaAdjunto, type AlmacenAdjuntos } from "./almacen";
import { detectarTipo, esHeic, limpiarNombreArchivo } from "./tipos";

const PDF = new TextEncoder().encode("%PDF-1.4\n% ficticio\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);

/** Un ReadableStream que entrega `bytes` en pedazos de `tamano`. */
function flujo(bytes: Uint8Array, tamano = 5): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) {
        c.close();
        return;
      }
      c.enqueue(bytes.slice(i, i + tamano));
      i += tamano;
    },
  });
}

async function leerTodo(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const partes: Uint8Array[] = [];
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    partes.push(value);
  }
  return new Uint8Array(Buffer.concat(partes));
}

describe("tipos por magic bytes", () => {
  it("PDF, JPG y PNG; el resto, no", () => {
    expect(detectarTipo(PDF)).toEqual({ mime: "application/pdf", extension: "pdf" });
    expect(detectarTipo(JPG)).toEqual({ mime: "image/jpeg", extension: "jpg" });
    expect(detectarTipo(PNG)).toEqual({ mime: "image/png", extension: "png" });
    expect(detectarTipo(new TextEncoder().encode("<html>"))).toBeNull();
    expect(detectarTipo(new Uint8Array([0x25, 0x50]))).toBeNull();
    expect(detectarTipo(HEIC)).toBeNull();
    expect(esHeic(HEIC)).toBe(true);
    expect(esHeic(PDF)).toBe(false);
  });

  it("el nombre: sin carpetas ni caracteres de control, con un máximo", () => {
    expect(limpiarNombreArchivo("C:\\Users\\x\\DNI frente.pdf")).toBe("DNI frente.pdf");
    expect(limpiarNombreArchivo("../../etc/passwd")).toBe("passwd");
    expect(limpiarNombreArchivo("a\u0000b\nc.png")).toBe("abc.png");
    expect(limpiarNombreArchivo("")).toBe("archivo");
    expect(limpiarNombreArchivo("..")).toBe("archivo");
    expect(limpiarNombreArchivo(`${"x".repeat(300)}.pdf`)).toHaveLength(150);
  });
});

describe("almacén en disco", () => {
  let raiz: string;
  let almacen: AlmacenAdjuntos;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "cementeria-adjuntos-"));
    almacen = crearAlmacenEnDisco(raiz);
  });
  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it("recibe en streaming a tmp/ con sha256 y tamaño, y confirma en AAAA/MM/<uuid>", async () => {
    const archivo = await almacen.recibir(flujo(PDF), 1000);
    expect(archivo.bytes).toBe(PDF.length);
    expect(archivo.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(detectarTipo(archivo.cabecera)?.mime).toBe("application/pdf");
    expect(await readdir(join(raiz, "tmp"))).toEqual([archivo.id]);

    const ruta = rutaParaAdjunto(new Date("2026-10-20T15:00:00Z"), archivo.id);
    expect(ruta).toBe(`2026/10/${archivo.id}`);
    await almacen.confirmar(archivo, ruta);
    expect(await readdir(join(raiz, "tmp"))).toEqual([]);
    expect(new Uint8Array(await readFile(join(raiz, "2026", "10", archivo.id)))).toEqual(PDF);

    const abierto = await almacen.abrir(ruta);
    expect(abierto.bytes).toBe(PDF.length);
    expect(await leerTodo(abierto.contenido)).toEqual(PDF);
  });

  it("si pasa del máximo corta y no deja el temporal", async () => {
    await expect(almacen.recibir(flujo(new Uint8Array(100)), 99)).rejects.toBeInstanceOf(ArchivoMuyGrande);
    expect(await readdir(join(raiz, "tmp"))).toEqual([]);
  });

  it("descartar borra el temporal y no falla si ya no está", async () => {
    const archivo = await almacen.recibir(flujo(PNG), 1000);
    await almacen.descartar(archivo);
    await almacen.descartar(archivo);
    expect(await readdir(join(raiz, "tmp"))).toEqual([]);
  });

  it("no abre rutas fuera de su forma (ni fuera de la raíz)", async () => {
    await expect(almacen.abrir("../../etc/passwd")).rejects.toThrow(/Ruta de adjunto inválida/);
  });

  it("el barrido borra los temporales de más de 24 h y deja los nuevos", async () => {
    const viejo = await almacen.recibir(flujo(JPG), 1000);
    const nuevo = await almacen.recibir(flujo(JPG), 1000);
    const ahora = new Date();
    const hace25h = new Date(ahora.getTime() - 25 * 60 * 60 * 1000);
    await utimes(join(raiz, "tmp", viejo.id), hace25h, hace25h);
    expect(await barrerTemporales(almacen, ahora)).toBe(1);
    expect(await readdir(join(raiz, "tmp"))).toEqual([nuevo.id]);
    expect((await stat(join(raiz, "tmp", nuevo.id))).size).toBe(JPG.length);
    // Sin carpeta tmp todavía: nada que barrer.
    expect(await barrerTemporales(crearAlmacenEnDisco(join(raiz, "otra")), ahora)).toBe(0);
  });

  it("la carpeta: ADJUNTOS_DIR, o ./.data/adjuntos en desarrollo; en producción, obligatoria y absoluta", () => {
    expect(raizAdjuntos({ ADJUNTOS_DIR: raiz })).toBe(raiz);
    expect(raizAdjuntos({})).toMatch(/[\\/]\.data[\\/]adjuntos$/);
    expect(() => raizAdjuntos({ NODE_ENV: "production" })).toThrow(/ADJUNTOS_DIR: falta/);
    expect(() => raizAdjuntos({ NODE_ENV: "production", ADJUNTOS_DIR: "relativa" })).toThrow(/absoluta/);
  });
});
