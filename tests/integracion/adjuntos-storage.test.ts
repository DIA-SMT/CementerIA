// Adjuntos en Supabase Storage (ADJUNTOS_ALMACEN=supabase, el despliegue en
// Vercel; docs/despliegue-vercel.md): el flujo de dos fases (autorizar →
// el navegador sube directo → confirmar) contra la base efímera y un Storage
// falso en memoria (tests/stubs/storage-falso.ts). Los mismos permisos,
// versión, comando y movimiento que la subida de siempre
// (tests/integracion/adjuntos.test.ts, que sigue con el disco).

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAlmacenEnDisco, type AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
import { crearAlmacenSupabase } from "@/lib/adjuntos/supabase";
import { MAXIMO_BYTES_ADJUNTO } from "@/lib/adjuntos/tipos";
import type { ServicioExpedientes } from "@/lib/dominio/expedientes";
import { leerItems } from "@/lib/dominio/expedientes/items";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { responderAutorizacion, responderConfirmacion, responderLectura } from "@/lib/presentacion/adjuntos-http";
import { tareaBarrerAdjuntos } from "@/lib/tareas/programadas";
import { levantarStorageFalso, type StorageFalso } from "../stubs/storage-falso";
import { asegurarSemilla, avanzar, comando, datosAlta, movimientos, proyeccion, servicio, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const SECRETO = "secreto-de-sesion-de-prueba-con-mas-de-32-caracteres";
const BASE = "http://localhost:3000";

let falso: StorageFalso;
let almacen: AlmacenAdjuntos;
let exp: ServicioExpedientes;
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let legal: UsuarioPermisos;
let admin: UsuarioPermisos;

const PDF_INICIO = new TextEncoder().encode("%PDF-1.4\n% documento ficticio de prueba\n");

/** Un PDF ficticio de `total` bytes (más de 4,5 MB: lo que Vercel no deja pasar por una función). */
function pdfDe(total: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(total);
  for (let i = 0; i < total; i++) b[i] = (i * 31) % 251;
  b.set(PDF_INICIO);
  return b;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function pedidoJson(numero: string, ruta: "autorizar" | "confirmar", cuerpo: unknown): Request {
  return new Request(`${BASE}/api/expedientes/${numero}/adjuntos/${ruta}`, {
    method: "POST",
    body: JSON.stringify(cuerpo),
    headers: { host: "localhost:3000", origin: BASE, "content-type": "application/json" },
  });
}

interface Autorizada {
  url: string;
  ticket: string;
  id: string;
}

async function autorizar(u: UsuarioPermisos, numero: string, version: number, c: string, documento: string | null = null): Promise<Response> {
  return responderAutorizacion(exp, u, numero, pedidoJson(numero, "autorizar", { documento, version, comando: c, bytes: 1 }), SECRETO);
}

async function autorizada(r: Response): Promise<Autorizada> {
  expect(r.status).toBe(200);
  const cuerpo = (await r.json()) as { subida: { url: string; ticket: string } };
  return { ...cuerpo.subida, id: cuerpo.subida.ticket.split(".")[0] };
}

/** Lo que hace el navegador: PUT a la URL firmada, sin cookies ni clave. */
function subirAStorage(url: string, datos: Uint8Array<ArrayBuffer>, tipo = "application/pdf"): Promise<Response> {
  return fetch(url, { method: "PUT", body: datos, headers: { "Content-Type": tipo, "x-upsert": "false" } });
}

function confirmar(u: UsuarioPermisos, numero: string, ticket: string, version: number, c: string, nombre = "escaneo.pdf", documento: string | null = null): Promise<Response> {
  return responderConfirmacion(exp, u, numero, pedidoJson(numero, "confirmar", { ticket, nombre, documento, version, comando: c }), SECRETO);
}

const temporales = () => [...falso.objetos.keys()].filter((k) => k.startsWith("tmp/"));

beforeAll(async () => {
  await asegurarSemilla(prisma);
  falso = await levantarStorageFalso();
  almacen = crearAlmacenSupabase({ url: falso.url, clave: falso.clave });
  exp = servicio(prisma, undefined, almacen);
  [mesa, computo, legal, admin] = await Promise.all([usuario(prisma, "MESA_ENTRADAS"), usuario(prisma, "COMPUTO"), usuario(prisma, "LEGAL"), usuario(prisma, "ADMIN")]);
});

afterAll(async () => {
  await prisma.$disconnect();
  await falso?.cerrar();
});

/** Un RENOV_CONTADO en Cómputo, sin confirmar. */
async function enComputo(): Promise<{ numero: string; version: number }> {
  const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
  const r = await avanzar(exp, prisma, alta.numero);
  return { numero: alta.numero, version: r.version };
}

describe("subida en dos fases a Supabase Storage", () => {
  it("un PDF de 6 MB: autoriza, el navegador lo sube directo, la app lo verifica, registra y mueve a AAAA/MM/<uuid>; la lectura lo sirve en streaming", async () => {
    const { numero, version } = await enComputo();
    const pdf = pdfDe(6 * 1024 * 1024);
    const c = comando();
    const a = await autorizada(await autorizar(computo, numero, version, c, "INFORME_TECNICO"));
    expect(a.url).toContain(`/storage/v1/object/upload/sign/adjuntos/tmp/${a.id}?token=`);
    // La autorización no escribió nada en la base.
    expect((await movimientos(prisma, numero)).some((m) => m.tipo === "adjunto")).toBe(false);

    expect((await subirAStorage(a.url, pdf)).status).toBe(200);
    const r = await confirmar(computo, numero, a.ticket, version, c, "C:\\escaneos\\informe técnico.pdf", "INFORME_TECNICO");
    expect(r.status).toBe(201);
    const cuerpo = (await r.json()) as { movimientoId: string; version: number; sha256: string; bytes: number; nombre: string; recepcionImplicita: boolean };
    expect(cuerpo).toMatchObject({ ok: true, version: version + 1, bytes: pdf.length, sha256: sha(pdf), nombre: "informe técnico.pdf", recepcionImplicita: true });

    const m = (await movimientos(prisma, numero)).at(-1);
    const datos = m?.datos as { ruta: string; sha256: string; mime: string };
    expect(datos).toMatchObject({ mime: "application/pdf", sha256: sha(pdf), documento: "INFORME_TECNICO" });
    expect(datos.ruta).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(datos.ruta.endsWith(a.id)).toBe(true);
    expect(Buffer.compare(falso.objetos.get(datos.ruta)!.datos, Buffer.from(pdf))).toBe(0);
    expect(temporales()).toEqual([]);
    expect(leerItems((await proyeccion(prisma, numero)).items).adjuntos[cuerpo.movimientoId]).toEqual({ documento: "INFORME_TECNICO", vigente: true, purgado: false });

    // La lectura pasa por la app (permisos, auditoría, headers) con el contenido desde Storage.
    const visor = await responderLectura(exp, computo, cuerpo.movimientoId, new Request(`${BASE}/adjuntos/${cuerpo.movimientoId}`), "10.0.0.7");
    expect(visor.status).toBe(200);
    expect(visor.headers.get("content-length")).toBe(String(pdf.length));
    expect(visor.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(sha(new Uint8Array(await visor.arrayBuffer()))).toBe(sha(pdf));
    const acceso = await prisma.auditoriaAcceso.findFirst({ where: { accion: "ver_adjunto", usuarioId: computo.id }, orderBy: { id: "desc" } });
    expect(acceso?.detalle).toMatchObject({ movimiento: cuerpo.movimientoId });
  });

  it("magic bytes: un HTML subido como application/pdf se rechaza al confirmar y se borra el temporal", async () => {
    const { numero, version } = await enComputo();
    const c = comando();
    const a = await autorizada(await autorizar(computo, numero, version, c));
    await subirAStorage(a.url, new TextEncoder().encode("<html><script>alert(1)</script></html>"));
    expect(temporales()).toEqual([`tmp/${a.id}`]);
    const r = await confirmar(computo, numero, a.ticket, version, c);
    expect(r.status).toBe(415);
    expect(await r.json()).toMatchObject({ codigo: "adjunto_invalido", mensaje: "Solo se admiten PDF, JPG o PNG" });
    expect(temporales()).toEqual([]);
    expect((await movimientos(prisma, numero)).some((m) => m.tipo === "adjunto")).toBe(false);
  });

  it("tamaño: más de 10 MB en el temporal (aunque el bucket lo hubiera dejado) se rechaza y se borra; vacío también", async () => {
    const { numero, version } = await enComputo();
    const c1 = comando();
    const a = await autorizada(await autorizar(computo, numero, version, c1));
    falso.poner(`tmp/${a.id}`, pdfDe(MAXIMO_BYTES_ADJUNTO + 1));
    const grande = await confirmar(computo, numero, a.ticket, version, c1);
    expect(grande.status).toBe(413);
    expect(temporales()).toEqual([]);

    const c2 = comando();
    const b = await autorizada(await autorizar(computo, numero, version, c2));
    falso.poner(`tmp/${b.id}`, new Uint8Array(0));
    expect(await (await confirmar(computo, numero, b.ticket, version, c2)).json()).toMatchObject({ codigo: "adjunto_invalido", mensaje: "El archivo está vacío" });
    expect(temporales()).toEqual([]);

    // Justo 10 MB, sí (el bucket tiene el mismo límite).
    const c3 = comando();
    const d = await autorizada(await autorizar(computo, numero, version, c3));
    expect((await subirAStorage(d.url, pdfDe(MAXIMO_BYTES_ADJUNTO))).status).toBe(200);
    expect((await confirmar(computo, numero, d.ticket, version, c3)).status).toBe(201);
  });

  it("si el navegador no llegó a subirlo: 422 y nada en la base", async () => {
    const { numero, version } = await enComputo();
    const c = comando();
    const a = await autorizada(await autorizar(computo, numero, version, c));
    const r = await confirmar(computo, numero, a.ticket, version, c);
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ codigo: "validacion", mensaje: expect.stringMatching(/no llegó/) });
    expect((await movimientos(prisma, numero)).some((m) => m.tipo === "adjunto")).toBe(false);
  });

  it("mismos permisos, versión y comando que hoy: ajeno 403 sin firmar nada; versión vieja 409 al autorizar; cambio entre las dos fases 409 y borra el temporal", async () => {
    const { numero, version } = await enComputo();
    const firmasAntes = falso.pedidos.filter((p) => p.ruta.includes("/upload/sign/") && p.metodo === "POST").length;
    expect((await autorizar(legal, numero, version, comando())).status).toBe(403);
    const vieja = await autorizar(computo, numero, version - 1, comando());
    expect(vieja.status).toBe(409);
    expect(await vieja.json()).toMatchObject({ codigo: "conflicto_version" });
    expect((await autorizar(computo, numero, version, comando(), "NO_EXISTE")).status).toBe(422);
    expect(falso.pedidos.filter((p) => p.ruta.includes("/upload/sign/") && p.metodo === "POST").length).toBe(firmasAntes);

    // Entre autorizar y confirmar, otro adjunto cambia la versión.
    const c = comando();
    const a = await autorizada(await autorizar(computo, numero, version, c));
    await subirAStorage(a.url, pdfDe(2048));
    const otro = await exp.subirAdjunto(computo, numero, new Blob([pdfDe(1024)]).stream(), { nombre: "otro.pdf", documento: null }, version, comando());
    const r = await confirmar(computo, numero, a.ticket, version, c);
    expect(r.status).toBe(409);
    expect(temporales()).toEqual([]);
    expect((await movimientos(prisma, numero)).filter((m) => m.tipo === "adjunto").map((m) => String(m.id))).toEqual([otro.movimientoId]);
  });

  it("el ticket es de quien lo pidió, para ese expediente y comando", async () => {
    const { numero, version } = await enComputo();
    const c = comando();
    const a = await autorizada(await autorizar(computo, numero, version, c));
    await subirAStorage(a.url, pdfDe(2048));
    const mesaIntenta = await confirmar(mesa, numero, a.ticket, version, c);
    expect(mesaIntenta.status).toBe(403);
    expect((await confirmar(computo, numero, a.ticket, version, comando())).status).toBe(403);
    // Una firma alterada (el primer carácter: el último de un base64url puede llevar bits de relleno).
    const [id, vence, firma] = a.ticket.split(".");
    const alterada = `${id}.${vence}.${firma[0] === "A" ? "B" : "A"}${firma.slice(1)}`;
    expect((await confirmar(computo, numero, alterada, version, c)).status).toBe(403);
    // El temporal sigue (lo confirma su dueño o lo borra el barrido).
    expect(temporales()).toEqual([`tmp/${a.id}`]);
    expect((await confirmar(computo, numero, a.ticket, version, c)).status).toBe(201);
    expect(temporales()).toEqual([]);
  });

  it("comando repetido: autorizar devuelve lo de antes sin firmar; un reintento de confirmar devuelve lo de antes y borra su temporal", async () => {
    const { numero, version } = await enComputo();
    const c = comando();
    const a = await autorizada(await autorizar(computo, numero, version, c));
    await subirAStorage(a.url, pdfDe(4096));
    const primero = (await (await confirmar(computo, numero, a.ticket, version, c)).json()) as { movimientoId: string };

    const otraVez = await autorizar(computo, numero, version, c);
    expect(otraVez.status).toBe(200);
    expect(await otraVez.json()).toMatchObject({ ok: true, repetido: true, movimientoId: primero.movimientoId });

    // Un segundo temporal con el mismo comando (dos pestañas): al confirmar, gana el primero.
    const c2 = comando();
    const b = await autorizada(await autorizar(computo, numero, version + 1, c2));
    await subirAStorage(b.url, pdfDe(4096));
    const okB = (await (await confirmar(computo, numero, b.ticket, version + 1, c2)).json()) as { movimientoId: string; version: number };
    const reintento = await confirmar(computo, numero, b.ticket, version + 1, c2);
    expect(reintento.status).toBe(200);
    expect(await reintento.json()).toMatchObject({ repetido: true, movimientoId: okB.movimientoId });
    expect(temporales()).toEqual([]);
    expect((await movimientos(prisma, numero)).filter((m) => m.tipo === "adjunto")).toHaveLength(2);
  });
});

describe("purga y barrido sobre Storage", () => {
  it("la purga del admin borra el objeto de Storage y deja nombre, tamaño y sha256 en el movimiento", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const c = comando();
    const a = await autorizada(await autorizar(mesa, alta.numero, 0, c, "INFORME_TECNICO"));
    const pdf = pdfDe(3000);
    await subirAStorage(a.url, pdf);
    const r = (await (await confirmar(mesa, alta.numero, a.ticket, 0, c, "equivocado.pdf", "INFORME_TECNICO")).json()) as { movimientoId: string; version: number };
    const ruta = ((await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(r.movimientoId) } })).datos as { ruta: string }).ruta;
    expect(falso.objetos.has(ruta)).toBe(true);

    await exp.purgarAdjunto(admin, alta.numero, r.movimientoId, "Datos de un tercero cargados por error (Ley 25.326)", r.version, comando());
    expect(falso.objetos.has(ruta)).toBe(false);
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(r.movimientoId) } })).datos).toMatchObject({ nombre: "equivocado.pdf", bytes: 3000, sha256: sha(pdf) });
  });

  it("el barrido borra los temporales de más de 24 h que nadie confirmó", async () => {
    const viejo = "0b0e7c6e-5a1f-4e43-9a43-0e7d2b6f1c11";
    falso.poner(`tmp/${viejo}`, pdfDe(100), "application/pdf", new Date(Date.now() - 25 * 60 * 60 * 1000));
    const r = await tareaBarrerAdjuntos(almacen);
    expect(r.borrados).toBe(1);
    expect(temporales()).toEqual([]);
  });

  it("con el disco, autorizar responde que la subida es por la app (y el camino de siempre sigue)", async () => {
    const raiz = await mkdtemp(join(tmpdir(), "cementeria-it-disco-"));
    try {
      const enDisco = servicio(prisma, undefined, crearAlmacenEnDisco(raiz));
      const { numero, version } = await enComputo();
      const r = await responderAutorizacion(enDisco, computo, numero, pedidoJson(numero, "autorizar", { version, comando: comando() }), SECRETO);
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ codigo: "validacion", mensaje: expect.stringMatching(/por la app/) });
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});
