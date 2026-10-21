// Adjuntos (src/lib/dominio/expedientes/adjuntos.ts y src/lib/adjuntos/)
// contra la base real y un almacén en una carpeta temporal: docs/propuesta-mvp.md,
// sección 6 "Adjuntos", 3.2 y decisión 13.

import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAlmacenEnDisco } from "@/lib/adjuntos/almacen";
import { MAXIMO_BYTES_ADJUNTO } from "@/lib/adjuntos/tipos";
import { ErrorDominio, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { leerItems } from "@/lib/dominio/expedientes/items";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { asegurarSemilla, avanzar, comando, datosAlta, forzarEstado, movimientos, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
let raiz: string;
let exp: ServicioExpedientes;
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let legal: UsuarioPermisos;
let liquidacion: UsuarioPermisos;

const PDF = new TextEncoder().encode("%PDF-1.4\n% documento ficticio de prueba\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);

function flujo(bytes: Uint8Array, tamano = 7): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + tamano));
      i += tamano;
    },
  });
}

/** Un flujo grande sin armar el arreglo entero: `total` bytes que empiezan como un PDF. */
function flujoGrande(total: number): ReadableStream<Uint8Array> {
  let enviados = 0;
  const bloque = new Uint8Array(64 * 1024);
  bloque.set(PDF);
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (enviados >= total) return c.close();
      const n = Math.min(bloque.length, total - enviados);
      c.enqueue(bloque.slice(0, n));
      enviados += n;
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

async function temporales(): Promise<string[]> {
  return readdir(join(raiz, "tmp")).catch(() => []);
}

async function errorDe(p: Promise<unknown>): Promise<ErrorDominio> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorDominio) return e;
    throw e;
  }
  throw new Error("se esperaba ErrorDominio");
}

beforeAll(async () => {
  await asegurarSemilla(prisma);
  raiz = await mkdtemp(join(tmpdir(), "cementeria-it-adjuntos-"));
  exp = servicio(prisma, undefined, crearAlmacenEnDisco(raiz));
  [mesa, computo, legal, liquidacion] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "LIQUIDACION"),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(raiz, { recursive: true, force: true });
});

/** Un RENOV_CONTADO en Cómputo, sin confirmar. */
async function enComputo(): Promise<{ numero: string; version: number }> {
  const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
  const r = await avanzar(exp, prisma, alta.numero);
  return { numero: alta.numero, version: r.version };
}

describe("subir un adjunto", () => {
  it("PDF de un documento: sha256 al vuelo, movimiento, items y archivo en AAAA/MM/<uuid>; nada en tmp/", async () => {
    const { numero, version } = await enComputo();
    const r = await exp.subirAdjunto(computo, numero, flujo(PDF), { nombre: "C:\\escaneos\\informe técnico.pdf", documento: "INFORME_TECNICO" }, version, comando());
    const sha = createHash("sha256").update(PDF).digest("hex");
    expect(r).toMatchObject({
      repetido: false,
      documento: "INFORME_TECNICO",
      nombre: "informe técnico.pdf",
      mime: "application/pdf",
      bytes: PDF.length,
      sha256: sha,
      recepcionImplicita: true,
      version: version + 1,
    });
    const m = (await movimientos(prisma, numero)).at(-1);
    const datos = m?.datos as { ruta: string; sha256: string };
    expect(m).toMatchObject({ tipo: "adjunto", id: BigInt(r.movimientoId) });
    expect(datos).toMatchObject({ nombre: "informe técnico.pdf", mime: "application/pdf", bytes: PDF.length, sha256: sha, documento: "INFORME_TECNICO" });
    expect(datos.ruta).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(new Uint8Array(await readFile(join(raiz, ...datos.ruta.split("/"))))).toEqual(PDF);
    expect(await temporales()).toEqual([]);

    const items = leerItems((await proyeccion(prisma, numero)).items);
    expect(items.adjuntos[r.movimientoId]).toEqual({ documento: "INFORME_TECNICO", vigente: true, purgado: false });
    // Adjuntar no marca el documento como presentado.
    expect(items.documentos.INFORME_TECNICO).toEqual({ estado: "pendiente", obs: null, mov: null, adjuntos: [Number(r.movimientoId)] });

    // La ficha: el adjunto, con su documento.
    const f = await exp.obtenerFicha(computo, numero);
    expect(f.adjuntos).toEqual([expect.objectContaining({ movimientoId: r.movimientoId, documento: "INFORME_TECNICO", nombre: "informe técnico.pdf", bytes: PDF.length })]);
    expect(f.documentacion.direccion.find((d) => d.clave === "INFORME_TECNICO")).toMatchObject({ adjuntos: [r.movimientoId], cantidadAdjuntos: 1 });
    // Quien no trabaja el expediente: enmascarado, con la cantidad.
    const deLegal = await exp.obtenerFicha(legal, numero);
    expect(deLegal.adjuntos).toBeNull();
    expect(deLegal.cantidadAdjuntos).toBe(1);

    // Un PNG suelto (sin documento) también.
    const png = await exp.subirAdjunto(computo, numero, flujo(PNG), { nombre: "foto.png", documento: null }, r.version, comando());
    expect(png).toMatchObject({ mime: "image/png", documento: null, recepcionImplicita: false });
  });

  it("rechaza por magic bytes (también un .pdf que no lo es y una foto HEIC), vacío y más de 10 MB, sin dejar temporales", async () => {
    const { numero, version } = await enComputo();
    const subir = (contenido: ReadableStream<Uint8Array>, nombre = "x.pdf") =>
      errorDe(exp.subirAdjunto(computo, numero, contenido, { nombre, documento: null }, version, comando()));

    expect(await subir(flujo(new TextEncoder().encode("<html>no soy un PDF</html>")))).toMatchObject({
      codigo: "adjunto_invalido",
      message: "Solo se admiten PDF, JPG o PNG",
    });
    expect(await subir(flujo(HEIC), "IMG_0001.HEIC")).toMatchObject({ codigo: "adjunto_invalido", message: "Subilo como JPG" });
    expect(await subir(flujo(new Uint8Array(0)))).toMatchObject({ codigo: "adjunto_invalido", message: "El archivo está vacío" });
    expect(await subir(flujoGrande(MAXIMO_BYTES_ADJUNTO + 1))).toMatchObject({ codigo: "adjunto_muy_grande" });
    expect(await temporales()).toEqual([]);
    // Justo 10 MB, sí.
    const r = await exp.subirAdjunto(computo, numero, flujoGrande(MAXIMO_BYTES_ADJUNTO), { nombre: "grande.pdf", documento: null }, version, comando());
    expect(r.bytes).toBe(MAXIMO_BYTES_ADJUNTO);
    expect((await movimientos(prisma, numero)).filter((m) => m.tipo === "adjunto")).toHaveLength(1);
  });

  it("si la transacción falla (otro usuario cambió el expediente), borra el temporal y no deja movimiento", async () => {
    const { numero, version } = await enComputo();
    const err = await errorDe(exp.subirAdjunto(computo, numero, flujo(PDF), { nombre: "a.pdf", documento: null }, version - 1, comando()));
    expect(err.codigo).toBe("conflicto_version");
    expect(await temporales()).toEqual([]);
    expect((await movimientos(prisma, numero)).some((m) => m.tipo === "adjunto")).toBe(false);
  });

  it("controla antes de leer el cuerpo: permiso, documento, estado; y el comando repetido no vuelve a subir", async () => {
    const { numero, version } = await enComputo();
    let leido = false;
    // highWaterMark 0: el stream no pide datos hasta que alguien lee.
    const vigilado = () =>
      new ReadableStream<Uint8Array>(
        {
          pull(c) {
            leido = true;
            c.enqueue(PDF);
            c.close();
          },
        },
        { highWaterMark: 0 },
      );
    await expect(exp.subirAdjunto(legal, numero, vigilado(), { nombre: "a.pdf", documento: null }, version, comando())).rejects.toBeInstanceOf(PermisoDenegado);
    expect((await errorDe(exp.subirAdjunto(computo, numero, vigilado(), { nombre: "a.pdf", documento: "NO_EXISTE" }, version, comando()))).codigo).toBe("validacion");
    // DNI tiene `adjunto: no` en la plantilla.
    expect((await errorDe(exp.subirAdjunto(computo, numero, vigilado(), { nombre: "a.pdf", documento: "DNI" }, version, comando()))).message).toMatch(
      /no lleva archivo/,
    );
    expect(leido).toBe(false);

    const c = comando();
    const r = await exp.subirAdjunto(computo, numero, flujo(PDF), { nombre: "a.pdf", documento: null }, version, c);
    leido = false;
    const otra = await exp.subirAdjunto(computo, numero, vigilado(), { nombre: "a.pdf", documento: null }, version, c);
    expect(otra).toMatchObject({ repetido: true, movimientoId: r.movimientoId, sha256: r.sha256 });
    expect(leido).toBe(false);
    expect(await temporales()).toEqual([]);

    await forzarEstado(prisma, numero, "anulado");
    expect((await errorDe(exp.subirAdjunto(mesa, numero, vigilado(), { nombre: "a.pdf", documento: null }, version, comando()))).codigo).toBe("estado_no_admite");
  });
});

describe("leer un adjunto", () => {
  it("quien trabaja el expediente lo ve (ver_adjunto) o lo descarga (descargar_adjunto); el resto, con motivo", async () => {
    const { numero, version } = await enComputo();
    const r = await exp.subirAdjunto(computo, numero, flujo(PDF), { nombre: "constancia.pdf", documento: null }, version, comando());
    const e = await proyeccion(prisma, numero);

    // Liquidación no pasó por este expediente todavía (está en Cómputo): le pide motivo.
    expect((await errorDe(exp.leerAdjunto(liquidacion, r.movimientoId))).codigo).toBe("motivo_requerido");

    const a = await exp.leerAdjunto(computo, r.movimientoId, { ip: "10.0.0.9" });
    expect(a).toMatchObject({ numero, nombre: "constancia.pdf", mime: "application/pdf", bytes: PDF.length, disposicion: "inline" });
    expect(await leerTodo(a.contenido)).toEqual(PDF);
    const d = await exp.leerAdjunto(mesa, r.movimientoId, { descargar: true });
    expect(d.disposicion).toBe("attachment");
    await d.contenido.cancel();
    const conMotivo = await exp.leerAdjunto(liquidacion, r.movimientoId, { motivo: "Control de la boleta del concesionario" });
    await conMotivo.contenido.cancel();

    const accesos = await prisma.auditoriaAcceso.findMany({ where: { expedienteId: e.id, accion: { in: ["ver_adjunto", "descargar_adjunto"] } }, orderBy: { id: "asc" } });
    expect(accesos.map((x) => [x.usuarioId, x.accion, x.detalle])).toEqual([
      [computo.id, "ver_adjunto", { movimiento: r.movimientoId }],
      [mesa.id, "descargar_adjunto", { movimiento: r.movimientoId }],
      [liquidacion.id, "ver_adjunto", { movimiento: r.movimientoId, motivo: "Control de la boleta del concesionario" }],
    ]);
    expect(accesos[0]?.ip).toBe("10.0.0.9");

    expect((await errorDe(exp.leerAdjunto(computo, "999999999"))).codigo).toBe("no_encontrado");
    expect((await errorDe(exp.leerAdjunto(computo, "abc"))).codigo).toBe("no_encontrado");
    // Un movimiento que no es un adjunto, tampoco.
    const alta = (await movimientos(prisma, numero))[0];
    expect((await errorDe(exp.leerAdjunto(computo, String(alta?.id)))).codigo).toBe("no_encontrado");
  });
});
