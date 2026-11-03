// Fotos propias del sitio público (30/10/2026; docs/api-dominio.md, sección
// 25.7) contra la base real y un almacén en disco temporal: subir (con el
// procesamiento de verdad, sharp), elegirla para un cementerio y un recorrido,
// verla en la página pública sin "ilustrativa", darla de baja estando en uso
// (avisa dónde; confirmada, esos quedan sin foto), la auditoría de cada paso,
// los permisos (un operador no puede), el límite de fotos activas, la ruta
// pública (200 activa, 404 dada de baja) y las reglas de la base por fuera de
// la app (CHECK de una sola foto, triggers, sin DELETE).
//
// Lo de la base va en una transacción que se deshace (./admin.ts); los
// archivos, en una carpeta temporal que se borra al final.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAlmacenEnDisco } from "@/lib/adjuntos/almacen";
import { RE_RUTA_FOTO } from "@/lib/adjuntos/fabrica";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { crearServicioSitio, type ServicioSitio } from "@/lib/dominio/sitio";
import { contenidoSitioPublico } from "@/lib/dominio/sitio/lectura";
import { procesarFoto } from "@/lib/imagenes/procesar";
import { MAXIMO_FOTOS_ACTIVAS } from "@/lib/imagenes/tipos";
import { procesarSitio } from "@/lib/presentacion/acciones-sitio";
import { responderFotoPublica, responderSubidaFoto } from "@/lib/presentacion/fotos-http";
import { conServiciosQueSeDeshacen, type ServiciosEnTransaccion } from "./admin";
import { asegurarSemilla, usuario } from "./dominio";
import { clientePrisma, enTransaccion, fijarActor, intentar, SISTEMA } from "./helper";

const prisma = clientePrisma();
const carpeta = mkdtempSync(path.join(tmpdir(), "cementeria-fotos-"));
const almacen = crearAlmacenEnDisco(carpeta, { rutaValida: RE_RUTA_FOTO });
let direccion: UsuarioPermisos;
let adminSistema: UsuarioPermisos;
let mesa: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [direccion, adminSistema, mesa] = await Promise.all([usuario(prisma, "DIRECCION"), usuario(prisma, "ADMIN"), usuario(prisma, "MESA_ENTRADAS")]);
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(carpeta, { recursive: true, force: true });
});

function conSitio<T>(fn: (s: ServiciosEnTransaccion & { sitio: ServicioSitio }) => Promise<T>): Promise<T> {
  return conServiciosQueSeDeshacen(prisma, (s) => fn({ ...s, sitio: crearServicioSitio({ leer: s.tx, escribir: s.escribir, fotos: { almacen, procesar: procesarFoto } }) }));
}

/** Una foto ficticia: un JPEG con EXIF de cámara y GPS inventados; `semilla` cambia el color (y así el sha256). */
async function fotoDePrueba(semilla: number, ancho = 2000, alto = 1200): Promise<Buffer> {
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: semilla % 256, g: 90, b: 140 } } })
    .withExifMerge({ IFD0: { Make: "CamaraFicticia" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "26/1 49/1 0/1" } })
    .jpeg()
    .toBuffer();
}

async function cambios(tx: Transaccion, tabla: string, registroId: string | number) {
  return tx.auditoriaCambio.findMany({ where: { tabla, registroId: String(registroId) }, orderBy: { id: "asc" } });
}

async function idCementerio(tx: Transaccion, codigo: string): Promise<number> {
  return (await tx.cementerio.findUniqueOrThrow({ where: { codigo }, select: { id: true } })).id;
}

describe("subir una foto", () => {
  it("la procesa, guarda dos WebP sin metadatos, la registra con su auditoría y no la acepta dos veces", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const original = await fotoDePrueba(1);
      const r = await sitio.subirFoto(direccion, original, { alt: "  Portón de ingreso   (dato de prueba) ", credito: "Archivo ficticio" }, "Primera foto");
      expect(r.alt).toBe("Portón de ingreso (dato de prueba)");
      expect(r.src).toMatch(new RegExp(`^/sitio/fotos/${r.id}/[0-9a-f]{16}-960\\.webp$`));

      const fila = await tx.sitioFoto.findUniqueOrThrow({ where: { id: r.id } });
      expect(fila).toMatchObject({ ruta: `fotos/${r.id}`, ancho: 2000, alto: 1200, bytes: original.byteLength, activa: true, subidaPor: direccion.id, credito: "Archivo ficticio" });
      expect(fila.sha256).toMatch(/^[0-9a-f]{64}$/);

      for (const [ancho, esperado] of [
        [960, 960],
        [1920, 1920],
      ] as const) {
        const archivo = path.join(carpeta, "fotos", r.id, `${ancho}.webp`);
        expect(existsSync(archivo)).toBe(true);
        const datos = readFileSync(archivo);
        const m = await sharp(datos).metadata();
        expect([m.format, m.width, m.exif, m.icc]).toEqual(["webp", esperado, undefined, undefined]);
        expect(datos.includes("CamaraFicticia")).toBe(false);
      }

      const audit = await cambios(tx, "sitio_fotos", r.id);
      expect(audit.map((a) => [a.operacion, a.usuarioId, a.motivo])).toEqual([["I", direccion.id, "Primera foto"]]);
      expect(audit[0].despues).toMatchObject({ alt: "Portón de ingreso (dato de prueba)", activa: true });

      // La misma foto otra vez: no.
      await expect(sitio.subirFoto(direccion, original, { alt: "Otra vez la misma" })).rejects.toMatchObject({ codigo: "ya_existe" });
      // Corregir el texto (y sin cambios, no escribe).
      expect(await sitio.guardarFoto(adminSistema, { id: r.id, alt: "Portón de ingreso", credito: "" }, "Texto más corto")).toEqual({ id: r.id, repetido: false });
      expect(await sitio.guardarFoto(adminSistema, { id: r.id, alt: "Portón de ingreso", credito: null })).toEqual({ id: r.id, repetido: true });
      expect((await cambios(tx, "sitio_fotos", r.id)).map((a) => [a.operacion, a.usuarioId])).toEqual([
        ["I", direccion.id],
        ["U", adminSistema.id],
      ]);

      const admin = await sitio.contenidoAdmin(direccion);
      expect(admin.fotos.find((f) => f.id === r.id)).toMatchObject({ alt: "Portón de ingreso", credito: null, usos: [], src: r.src });
    });
  });

  it("rechaza lo que no sirve sin escribir nada: el texto, otro tipo, una foto angosta", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const antes = await tx.sitioFoto.count();
      await expect(sitio.subirFoto(direccion, await fotoDePrueba(2), { alt: "abc" })).rejects.toMatchObject({ codigo: "validacion", errores: [{ ruta: "alt" }] });
      const gif = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#f00" } }).gif().toBuffer();
      await expect(sitio.subirFoto(direccion, gif, { alt: "Un GIF de prueba" })).rejects.toMatchObject({ codigo: "imagen_invalida", errores: [{ ruta: "archivo" }] });
      await expect(sitio.subirFoto(direccion, await fotoDePrueba(3, 500, 400), { alt: "Una foto angosta" })).rejects.toMatchObject({ codigo: "imagen_invalida" });
      expect(await tx.sitioFoto.count()).toBe(antes);
    });
  });

  it(`no pasa de ${MAXIMO_FOTOS_ACTIVAS} fotos activas`, async () => {
    await conSitio(async ({ sitio, tx, comoActor }) => {
      await comoActor(SISTEMA, "Prueba del límite");
      const faltan = MAXIMO_FOTOS_ACTIVAS - (await tx.sitioFoto.count({ where: { activa: true } }));
      await tx.$executeRawUnsafe(
        `INSERT INTO public.sitio_fotos (id, ruta, alt, ancho, alto, bytes, sha256, subida_por)
         SELECT g.id, 'fotos/' || g.id, 'Foto de relleno ' || g.n, 1920, 1080, 1000, encode(sha256(g.n::text::bytea), 'hex'), ${direccion.id}
           FROM (SELECT gen_random_uuid() AS id, n FROM generate_series(1, ${faltan}) n) g`,
      );
      await expect(sitio.subirFoto(direccion, await fotoDePrueba(4), { alt: "Una de más" })).rejects.toMatchObject({ codigo: "limite_alcanzado" });
    });
  });
});

describe("elegirla, verla en la página y darla de baja", () => {
  it("un cementerio y un recorrido con la foto subida; la página la muestra sin «ilustrativa»; la baja avisa dónde y, confirmada, los deja sin foto", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const foto = await sitio.subirFoto(direccion, await fotoDePrueba(5), { alt: "Galería de nichos (dato de prueba)" });
      const oeste = await idCementerio(tx, "OESTE");
      await sitio.guardarCementerio(direccion, { cementerioId: oeste, visible: true, fotoId: foto.id }, "Foto propia");
      const r = await sitio.guardarRecorrido(direccion, { nombre: "Recorrido con foto (it)", activo: true, orden: 0, fotoId: foto.id });
      // O una o la otra.
      await expect(sitio.guardarCementerio(direccion, { cementerioId: oeste, visible: true, foto: "panoramica", fotoId: foto.id })).rejects.toMatchObject({ codigo: "validacion" });

      const publico = await contenidoSitioPublico(tx);
      const imagen = publico.cementerios.find((c) => c.id === oeste)?.foto;
      expect(imagen).toMatchObject({ alt: "Galería de nichos (dato de prueba)", ilustrativa: false, src: foto.src, ancho: 1920, alto: 1152 });
      expect(imagen?.alt).not.toMatch(/ilustrativa/);
      expect(publico.recorridos.find((x) => x.id === r.id)?.foto?.ilustrativa).toBe(false);

      const admin = await sitio.contenidoAdmin(direccion);
      expect(admin.fotos.find((f) => f.id === foto.id)?.usos.map((u) => u.tipo)).toEqual(["cementerio", "recorrido"]);

      // Sin confirmar: avisa dónde se usa y no cambia nada.
      const sinConfirmar = await procesarSitio(sitio, direccion, { accion: "baja_foto", id: foto.id });
      expect(sinConfirmar).toMatchObject({ ok: false, codigo: "en_uso" });
      expect((sinConfirmar as { mensaje: string }).mensaje).toMatch(/Cementerio del Oeste.*Recorrido con foto \(it\)/);
      expect((await tx.sitioFoto.findUniqueOrThrow({ where: { id: foto.id } })).activa).toBe(true);

      // Confirmada: quedan sin foto, y después la baja; todo en la auditoría con el motivo.
      const hecha = await procesarSitio(sitio, direccion, { accion: "baja_foto", id: foto.id, confirmarUso: true, motivo: "Se reemplaza" });
      expect(hecha).toMatchObject({ ok: true, mensaje: expect.stringMatching(/Quedaron sin foto: Cementerio del Oeste, el recorrido «Recorrido con foto \(it\)»/) });
      expect((await tx.sitioCementerio.findUniqueOrThrow({ where: { cementerioId: oeste } })).fotoId).toBeNull();
      expect((await tx.sitioRecorrido.findUniqueOrThrow({ where: { id: r.id } })).fotoId).toBeNull();
      expect((await tx.sitioFoto.findUniqueOrThrow({ where: { id: foto.id } })).activa).toBe(false);
      const audit = await cambios(tx, "sitio_fotos", foto.id);
      expect(audit.at(-1)).toMatchObject({ operacion: "U", usuarioId: direccion.id, motivo: "Se reemplaza", antes: { activa: true }, despues: { activa: false } });
      expect((await cambios(tx, "sitio_cementerios", oeste)).at(-1)).toMatchObject({ motivo: "Se reemplaza", despues: { foto_id: null } });
      expect((await cambios(tx, "sitio_recorridos", r.id)).at(-1)).toMatchObject({ motivo: "Se reemplaza", despues: { foto_id: null } });
      // Otra vez: ya estaba.
      expect(await procesarSitio(sitio, direccion, { accion: "baja_foto", id: foto.id })).toMatchObject({ ok: true, repetido: true });

      // Ya no se ofrece, no se puede elegir y la página no la muestra.
      expect((await sitio.contenidoAdmin(direccion)).fotos.some((f) => f.id === foto.id)).toBe(false);
      await expect(sitio.guardarCementerio(direccion, { cementerioId: oeste, visible: true, fotoId: foto.id })).rejects.toMatchObject({
        codigo: "validacion",
        errores: [{ ruta: "foto" }],
      });
      expect((await contenidoSitioPublico(tx)).cementerios.find((c) => c.id === oeste)?.foto).toBeNull();
    });
  });

  it("la ruta pública: 200 con la activa (las dos versiones); 404 dada de baja, con otra versión o un id inválido", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const foto = await sitio.subirFoto(direccion, await fotoDePrueba(6), { alt: "Capilla (dato de prueba)" });
      const archivo = foto.src.split("/").at(-1)!;
      const ok = await responderFotoPublica(tx, almacen, foto.id, archivo);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("image/webp");
      expect(ok.headers.get("cache-control")).toMatch(/immutable/);
      expect((await sharp(Buffer.from(await ok.arrayBuffer())).metadata()).width).toBe(960);
      expect((await responderFotoPublica(tx, almacen, foto.id, archivo.replace("-960", "-1920"))).status).toBe(200);
      expect((await responderFotoPublica(tx, almacen, foto.id, `${"0".repeat(16)}-960.webp`)).status).toBe(404);
      expect((await responderFotoPublica(tx, almacen, "no-es-un-id", archivo)).status).toBe(404);
      await sitio.bajaFoto(direccion, { id: foto.id });
      expect((await responderFotoPublica(tx, almacen, foto.id, archivo)).status).toBe(404);
    });
  });
});

describe("permisos", () => {
  it("un operador (Mesa de Entradas) no puede subir, corregir ni dar de baja; la subida por HTTP responde 403", async () => {
    await conSitio(async ({ sitio, tx }) => {
      await expect(sitio.subirFoto(mesa, await fotoDePrueba(7), { alt: "No debería subir" })).rejects.toBeInstanceOf(PermisoDenegado);
      await expect(sitio.autorizarSubidaFoto(mesa, { alt: "No debería subir" }, 1000)).rejects.toBeInstanceOf(PermisoDenegado);
      const foto = await sitio.subirFoto(direccion, await fotoDePrueba(8), { alt: "Foto de la Dirección" });
      expect(await procesarSitio(sitio, mesa, { accion: "foto", datos: { id: foto.id, alt: "Cambiada por Mesa" } })).toMatchObject({ ok: false, codigo: "permiso" });
      expect(await procesarSitio(sitio, mesa, { accion: "baja_foto", id: foto.id, confirmarUso: true })).toMatchObject({ ok: false, codigo: "permiso" });
      expect(await tx.sitioFoto.findUniqueOrThrow({ where: { id: foto.id } })).toMatchObject({ alt: "Foto de la Dirección", activa: true });
      await expect(sitio.contenidoAdmin(mesa)).rejects.toBeInstanceOf(PermisoDenegado);

      const pedido = (u: UsuarioPermisos | null) =>
        responderSubidaFoto(
          sitio,
          u,
          new Request("http://localhost/api/sitio/fotos?alt=Foto%20por%20HTTP", {
            method: "POST",
            headers: { origin: "http://localhost", host: "localhost", "content-type": "image/jpeg" },
            body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
          }),
        );
      expect((await pedido(mesa)).status).toBe(403);
      expect((await pedido(null)).status).toBe(401);
    });
  });
});

describe("las reglas de la base, por fuera de la app", () => {
  const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
  const insertar = `INSERT INTO public.sitio_fotos (id, ruta, alt, ancho, alto, bytes, sha256, subida_por)
                    VALUES ('${ID}', 'fotos/${ID}', 'Foto por SQL', 1920, 1080, 1000, repeat('b', 64), 1)`;

  it.each([
    ["una ruta que no es fotos/<id>", insertar.replace(`'fotos/${ID}'`, "'otra/cosa'")],
    ["un texto alternativo corto", insertar.replace("'Foto por SQL'", "'Foto'")],
    ["una foto angosta", insertar.replace("1920, 1080", "500, 400")],
    ["una proporción absurda", insertar.replace("1920, 1080", "1920, 100")],
    ["más de 15 MB", insertar.replace("1080, 1000,", "1080, 15728641,")],
    ["un sha256 que no es hexadecimal", insertar.replace("repeat('b', 64)", "repeat('z', 64)")],
  ])("rechaza %s", async (_n, sql) => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "Prueba de CHECKs");
      expect(await intentar(c, sql)).toMatchObject({ ok: false });
    });
  });

  it("la app sube y da de baja, pero no borra, no reactiva, no cambia el archivo y no deja dos fotos ni una dada de baja", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "Prueba de reglas");
      expect(await intentar(c, insertar)).toMatchObject({ ok: true });
      expect(await intentar(c, `DELETE FROM public.sitio_fotos WHERE id = '${ID}'`)).toMatchObject({ ok: false, codigo: "42501" });
      expect(await intentar(c, `UPDATE public.sitio_fotos SET sha256 = repeat('c', 64) WHERE id = '${ID}'`)).toMatchObject({ ok: false });
      expect(await intentar(c, `UPDATE public.sitio_fotos SET alt = 'Foto por SQL, corregida' WHERE id = '${ID}'`)).toMatchObject({ ok: true });

      const cementerio = (await c.query<{ id: number }>("SELECT id FROM public.cementerios ORDER BY id LIMIT 1")).rows[0].id;
      await c.query("INSERT INTO public.sitio_cementerios (cementerio_id) VALUES ($1) ON CONFLICT (cementerio_id) DO NOTHING", [cementerio]);
      await c.query("UPDATE public.sitio_cementerios SET foto = NULL, foto_id = NULL WHERE cementerio_id = $1", [cementerio]);
      // Las dos fotos a la vez: CHECK.
      expect(await intentar(c, `UPDATE public.sitio_cementerios SET foto = 'panoramica', foto_id = '${ID}' WHERE cementerio_id = ${cementerio}`)).toMatchObject({ ok: false, codigo: "23514" });
      expect(await intentar(c, `UPDATE public.sitio_cementerios SET foto_id = '${ID}' WHERE cementerio_id = ${cementerio}`)).toMatchObject({ ok: true });
      // En uso: no se da de baja.
      expect(await intentar(c, `UPDATE public.sitio_fotos SET activa = false WHERE id = '${ID}'`)).toMatchObject({ ok: false, error: expect.stringMatching(/en uso/) });
      await c.query("UPDATE public.sitio_cementerios SET foto_id = NULL WHERE cementerio_id = $1", [cementerio]);
      expect(await intentar(c, `UPDATE public.sitio_fotos SET activa = false WHERE id = '${ID}'`)).toMatchObject({ ok: true });
      // Dada de baja: no se reactiva ni se elige.
      expect(await intentar(c, `UPDATE public.sitio_fotos SET activa = true WHERE id = '${ID}'`)).toMatchObject({ ok: false, error: expect.stringMatching(/no se reactiva/) });
      expect(await intentar(c, `UPDATE public.sitio_cementerios SET foto_id = '${ID}' WHERE cementerio_id = ${cementerio}`)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/dada de baja/),
      });
      const audit = await c.query<{ operacion: string }>(`SELECT operacion FROM auditoria.cambios WHERE tabla = 'sitio_fotos' AND registro_id = '${ID}' ORDER BY id`);
      expect(audit.rows.map((f) => f.operacion)).toEqual(["I", "U", "U"]);
    });
  });

  it("sin actor, la app no sube nada (auditar_cambio lo exige)", async () => {
    await enTransaccion("app", async (c) => {
      expect(await intentar(c, insertar)).toMatchObject({ ok: false });
    });
  });
});
