// Pantallas de la semana 3 contra la base real: la lógica de las Server
// Actions del flujo (src/lib/presentacion/acciones.ts) con la entrada que
// arman los diálogos, y los Route Handlers de adjuntos
// (src/lib/presentacion/adjuntos-http.ts) con Request de verdad y un almacén
// en una carpeta temporal. Los route.ts y las acciones de
// src/app/(app)/expedientes/acciones.ts solo agregan la sesión y refresh().

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAlmacenEnDisco } from "@/lib/adjuntos/almacen";
import { MAXIMO_BYTES_ADJUNTO } from "@/lib/adjuntos/tipos";
import { MENSAJE_CONFLICTO_VERSION, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import {
  procesarDevolucion,
  procesarDocumento,
  procesarPase,
  procesarRecepcion,
  procesarRecepciones,
  procesarSubtarea,
  procesarVerDatos,
} from "@/lib/presentacion/acciones";
import { responderLectura, responderSubida } from "@/lib/presentacion/adjuntos-http";
import { asegurarSemilla, avanzar, comando, completarPaso, datosAlta, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
let raiz: string;
let exp: ServicioExpedientes;
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let tributario: UsuarioPermisos;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.4\n% constancia ficticia\n%%EOF\n");
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const BASE = "http://localhost:3000";

beforeAll(async () => {
  await asegurarSemilla(prisma);
  raiz = await mkdtemp(join(tmpdir(), "cementeria-it-pantallas-flujo-"));
  exp = servicio(prisma, undefined, crearAlmacenEnDisco(raiz));
  [mesa, computo, liquidacion, tributario] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "TRIBUTARIO"),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(raiz, { recursive: true, force: true });
});

async function enComputo(): Promise<{ numero: string; version: number }> {
  const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
  const r = await avanzar(exp, prisma, alta.numero);
  return { numero: alta.numero, version: r.version };
}

describe("Server Actions del flujo", () => {
  it("recepción, tildar, destildar con motivo, documento y pase, con la versión de cada respuesta", async () => {
    const { numero, version } = await enComputo();
    const rec = await procesarRecepcion(exp, computo, { numero, versionVista: version, comandoId: comando(), fechaEfectiva: "" });
    expect(rec).toMatchObject({ ok: true, version: version + 1, repetido: false, mensaje: `Recepción de ${numero} confirmada.` });
    if (!rec.ok) return;

    // Tildar sin el dato obligatorio: el error vuelve en la ruta del campo.
    const tilde = await procesarSubtarea(exp, computo, { numero, clave: "COMP_GRABADO", hecha: true, dato: "R-123", versionVista: rec.version, comandoId: comando() });
    expect(tilde).toMatchObject({ ok: true, mensaje: "Subtarea tildada." });
    if (!tilde.ok) return;
    const sinMotivo = await procesarSubtarea(exp, computo, { numero, clave: "COMP_GRABADO", hecha: false, motivo: "corto", versionVista: tilde.version, comandoId: comando() });
    expect(sinMotivo).toMatchObject({ ok: false, codigo: "motivo_requerido", errores: [{ ruta: "motivo" }] });
    const destilde = await procesarSubtarea(exp, computo, {
      numero,
      clave: "COMP_GRABADO",
      hecha: false,
      motivo: "Se cargó en el expediente equivocado",
      versionVista: tilde.version,
      comandoId: comando(),
    });
    expect(destilde).toMatchObject({ ok: true, mensaje: "Subtarea destildada." });
    if (!destilde.ok) return;

    const noCorresponde = await procesarDocumento(exp, computo, { numero, clave: "CONST_COMPUTOS", estado: "no_corresponde", observacion: "", versionVista: destilde.version, comandoId: comando() });
    expect(noCorresponde).toMatchObject({ ok: false, codigo: "validacion", errores: [{ ruta: "observacion" }] });

    // "Faltan N": el pase no sale y dice qué falta.
    const faltan = await procesarPase(exp, computo, { numero, pasoDestino: "LIQUIDACION", versionVista: destilde.version, comandoId: comando() });
    expect(faltan).toMatchObject({ ok: false, codigo: "faltan_requisitos" });
    expect(!faltan.ok && faltan.errores.map((e) => e.ruta)).toEqual(expect.arrayContaining(["subtareas.COMP_GRABADO", "documentos.CONST_COMPUTOS"]));

    const v = await completarPaso(exp, prisma, numero);
    const pase = await procesarPase(exp, computo, { numero, pasoDestino: "LIQUIDACION", versionVista: v, comandoId: comando(), fechaEfectiva: "", observacion: "Va con la constancia" });
    expect(pase).toMatchObject({ ok: true, version: v + 1, mensaje: "Pase dado a Liquidación y boleta (Liquidación)." });
    expect((await proyeccion(prisma, numero)).pasoClave).toBe("LIQUIDACION");
  });

  it("devolución con atajo y subtareas a rehacer; conflicto de versión con el texto fijo", async () => {
    const { numero } = await enComputo();
    await avanzar(exp, prisma, numero);
    const v = (await exp.validarPase(liquidacion, numero)).version;
    const vieja = await procesarDevolucion(exp, liquidacion, { numero, pasoDestino: "COMPUTO_ALTA", motivo: "Falta firma: constancia", subtareas: [], versionVista: v - 1, comandoId: comando() });
    expect(vieja).toEqual({ ok: false, codigo: "conflicto_version", mensaje: MENSAJE_CONFLICTO_VERSION, errores: [] });
    const r = await procesarDevolucion(exp, liquidacion, {
      numero,
      pasoDestino: "COMPUTO_ALTA",
      motivo: "Falta firma: constancia sin firmar",
      subtareas: ["COMP_GRABADO"],
      versionVista: v,
      comandoId: comando(),
    });
    expect(r).toMatchObject({ ok: true, mensaje: "Expediente devuelto a Cómputo: alta." });
    const fila = (await exp.bandeja(computo, "por_confirmar")).filas.find((f) => f.numero === numero);
    expect(fila?.etiquetas).toContainEqual(expect.objectContaining({ tipo: "devuelto", motivo: "Falta firma: constancia sin firmar" }));
  });

  it("el lote confirma lo que puede y dice qué no; una entrada sin forma no es un 500", async () => {
    const a = await enComputo();
    const b = await enComputo();
    const r = await procesarRecepciones(exp, computo, {
      seleccion: [
        { numero: a.numero, version: a.version },
        { numero: b.numero, version: b.version - 1 },
      ],
      comandoId: comando(),
    });
    expect(r).toEqual({
      ok: true,
      resultados: [
        { ok: true, numero: a.numero },
        { ok: false, numero: b.numero, codigo: "conflicto_version", mensaje: MENSAJE_CONFLICTO_VERSION },
      ],
    });
    expect(await procesarRecepciones(exp, computo, { seleccion: [], comandoId: comando() })).toMatchObject({ ok: false, codigo: "validacion" });
    expect(await procesarPase(exp, computo, { numero: a.numero, pasoDestino: 3 })).toMatchObject({ ok: false, codigo: "validacion" });
    expect(await procesarRecepcion(exp, liquidacion, { numero: b.numero, versionVista: b.version, comandoId: comando() })).toMatchObject({ ok: false, codigo: "permiso" });
  });
});

function subida(numero: string, q: Record<string, string>, body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  const url = `${BASE}/api/expedientes/${numero}/adjuntos?${new URLSearchParams(q)}`;
  return new Request(url, { method: "POST", body, headers: { host: "localhost:3000", origin: BASE, ...headers }, duplex: "half" } as RequestInit);
}

function lectura(id: string, q = ""): Request {
  return new Request(`${BASE}/adjuntos/${id}${q}`);
}

describe("Route Handlers de adjuntos", () => {
  it("sube un PNG y un PDF en streaming, los sirve inline con los headers de la sección 6 y la descarga es attachment", async () => {
    const { numero, version } = await enComputo();
    const png = await responderSubida(exp, computo, numero, subida(numero, { nombre: "boleta.png", version: String(version), comando: comando() }, PNG));
    expect(png.status).toBe(201);
    const p = (await png.json()) as { ok: true; version: number; movimientoId: string; mime: string; recepcionImplicita: boolean };
    expect(p).toMatchObject({ ok: true, mime: "image/png", version: version + 1, recepcionImplicita: true });

    const pdf = await responderSubida(
      exp,
      computo,
      numero,
      subida(numero, { nombre: "Constancia de Cómputos.pdf", documento: "INFORME_TECNICO", version: String(p.version), comando: comando() }, PDF),
    );
    expect(pdf.status).toBe(201);
    const d = (await pdf.json()) as { movimientoId: string; documento: string };
    expect(d.documento).toBe("INFORME_TECNICO");

    const visor = await responderLectura(exp, computo, p.movimientoId, lectura(p.movimientoId), "127.0.0.1");
    expect(visor.status).toBe(200);
    expect(visor.headers.get("content-type")).toBe("image/png");
    expect(visor.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(visor.headers.get("x-content-type-options")).toBe("nosniff");
    expect(visor.headers.get("cache-control")).toBe("private, no-store");
    expect(visor.headers.get("content-disposition")).toBe(`inline; filename="boleta.png"; filename*=UTF-8''boleta.png`);
    expect(new Uint8Array(await visor.arrayBuffer())).toEqual(PNG);

    const baja = await responderLectura(exp, computo, d.movimientoId, lectura(d.movimientoId, "?descargar=1"), null);
    expect(baja.headers.get("content-disposition")).toBe(`attachment; filename="Constancia de C_mputos.pdf"; filename*=UTF-8''Constancia%20de%20C%C3%B3mputos.pdf`);
    expect(new Uint8Array(await baja.arrayBuffer())).toEqual(PDF);

    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: numero }, select: { id: true } });
    const accesos = await prisma.auditoriaAcceso.findMany({ where: { expedienteId: e.id, usuarioId: computo.id, accion: { in: ["ver_adjunto", "descargar_adjunto"] } } });
    expect(accesos.map((a) => a.accion).sort()).toEqual(["descargar_adjunto", "ver_adjunto"]);
  });

  it("HEIC y más de 10 MB se rechazan con un mensaje claro; sin permiso o con versión vieja, también", async () => {
    const { numero, version } = await enComputo();
    const heic = await responderSubida(exp, computo, numero, subida(numero, { nombre: "IMG_0001.HEIC", version: String(version), comando: comando() }, HEIC));
    expect(heic.status).toBe(415);
    expect(await heic.json()).toMatchObject({ ok: false, codigo: "adjunto_invalido", mensaje: "Subilo como JPG" });

    // Sin Content-Length (en streaming): el dominio corta pasados los 10 MB.
    let enviados = 0;
    const grande = new ReadableStream<Uint8Array>({
      pull(c) {
        if (enviados > MAXIMO_BYTES_ADJUNTO) return c.close();
        const bloque = new Uint8Array(256 * 1024);
        bloque.set(PDF);
        c.enqueue(bloque);
        enviados += bloque.length;
      },
    });
    const muyGrande = await responderSubida(exp, computo, numero, subida(numero, { nombre: "escaneo.pdf", version: String(version), comando: comando() }, grande));
    expect(muyGrande.status).toBe(413);
    expect(await muyGrande.json()).toMatchObject({ ok: false, codigo: "adjunto_muy_grande", mensaje: "El archivo supera los 10 MB" });

    const ajeno = await responderSubida(exp, tributario, numero, subida(numero, { nombre: "a.pdf", version: String(version), comando: comando() }, PDF));
    expect(ajeno.status).toBe(403);
    const vieja = await responderSubida(exp, computo, numero, subida(numero, { nombre: "a.pdf", version: String(version - 1), comando: comando() }, PDF));
    expect(vieja.status).toBe(409);
    expect(await vieja.json()).toMatchObject({ mensaje: MENSAJE_CONFLICTO_VERSION });
    expect((await responderSubida(exp, null, numero, subida(numero, {}, PDF))).status).toBe(401);
  });

  it("quien no trabaja el expediente no ve el adjunto sin motivo; con motivo sí, y queda registrado", async () => {
    const { numero, version } = await enComputo();
    const r = await responderSubida(exp, computo, numero, subida(numero, { nombre: "boleta.png", version: String(version), comando: comando() }, PNG));
    const { movimientoId } = (await r.json()) as { movimientoId: string };

    const sinMotivo = await responderLectura(exp, tributario, movimientoId, lectura(movimientoId), null);
    expect(sinMotivo.status).toBe(403);
    expect(await sinMotivo.text()).toMatch(/indicá el motivo/);
    const conMotivo = await responderLectura(exp, tributario, movimientoId, lectura(movimientoId, "?motivo=Consulta%20por%20la%20deuda%20del%20titular"), null);
    expect(conMotivo.status).toBe(200);
    await conMotivo.arrayBuffer();

    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: numero }, select: { id: true } });
    const acceso = await prisma.auditoriaAcceso.findFirstOrThrow({ where: { expedienteId: e.id, usuarioId: tributario.id, accion: "ver_adjunto" } });
    expect(acceso.detalle).toEqual({ movimiento: movimientoId, motivo: "Consulta por la deuda del titular" });

    // La lista con nombre la da "Ver datos completos" (la ficha los trae en null para Tributario).
    expect((await exp.obtenerFicha(tributario, numero)).adjuntos).toBeNull();
    const datos = await procesarVerDatos(exp, tributario, numero, "Consulta por la deuda del titular", null);
    expect(datos.ok && datos.datos.adjuntos).toEqual([{ documento: null, movimientoId, nombre: "boleta.png", mime: "image/png", bytes: PNG.length }]);
  });
});
