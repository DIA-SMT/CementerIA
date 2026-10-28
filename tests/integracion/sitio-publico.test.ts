// Sitio público (28/10/2026; docs/api-dominio.md, sección 25) contra la base
// real: lo que carga la Dirección desde /admin/sitio-publico (alta,
// modificación, quitar, sin cambios) con su constancia en auditoria.cambios,
// el permiso (los operadores no pueden), los CHECKs de la migración
// *_sitio_publico aunque se escriba por fuera de la app, y lo que devuelve la
// página pública: solo lo activo, lo visible y lo vigente.
//
// Todo corre en una transacción que se deshace (./admin.ts): la página pública
// la leen otros tests y la semilla de producción ya trae las preguntas frecuentes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PREGUNTAS_FRECUENTES } from "../../prisma/semilla/sitio-publico";
import { descripcionRegistro } from "@/lib/dominio/admin";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { contenidoSitioPublico } from "@/lib/dominio/sitio/lectura";
import { crearServicioSitio, type ServicioSitio } from "@/lib/dominio/sitio";
import { procesarSitio } from "@/lib/presentacion/acciones-sitio";
import { fechaParaDb } from "@/lib/fechas";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { conServiciosQueSeDeshacen, type ServiciosEnTransaccion } from "./admin";
import { asegurarSemilla, usuario } from "./dominio";
import { clientePrisma, enTransaccion, fijarActor, intentar, SISTEMA } from "./helper";

const prisma = clientePrisma();
let direccion: UsuarioPermisos;
let adminSistema: UsuarioPermisos;
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [direccion, adminSistema, mesa, computo] = await Promise.all([
    usuario(prisma, "DIRECCION"),
    usuario(prisma, "ADMIN"),
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "COMPUTO"),
  ]);
});
afterAll(() => prisma.$disconnect());

/** El servicio del sitio sobre la transacción que se deshace, con un reloj fijo si hace falta. */
function conSitio<T>(fn: (s: ServiciosEnTransaccion & { sitio: ServicioSitio }) => Promise<T>, ahora?: () => Date): Promise<T> {
  return conServiciosQueSeDeshacen(prisma, (s) => fn({ ...s, sitio: crearServicioSitio({ leer: s.tx, escribir: s.escribir, ahora }) }));
}

async function cambios(tx: Transaccion, tabla: string, registroId: string | number) {
  return tx.auditoriaCambio.findMany({ where: { tabla, registroId: String(registroId) }, orderBy: { id: "asc" } });
}

async function idCementerio(tx: Transaccion, codigo: string): Promise<number> {
  return (await tx.cementerio.findUniqueOrThrow({ where: { codigo }, select: { id: true } })).id;
}

/** Un `datetime-local` a `dias` de `desde` (hora de Tucumán). */
function datetimeLocal(desde: Date, dias: number, hora = "10:00"): string {
  const d = new Date(desde.getTime() + dias * 86_400_000);
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${dia}T${hora}`;
}

describe("la administración del sitio público, auditada", () => {
  it("cementerio: alta la primera vez, después modificación; sin cambios no escribe; todo en auditoria.cambios con autor y motivo", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const oeste = await idCementerio(tx, "OESTE");
      const datos = { cementerioId: oeste, visible: true, domicilio: " Av. Ficticia 1  (dato de prueba) ", horarioSemana: "De 7 a 18", foto: "avenida-azul" };
      expect(await sitio.guardarCementerio(direccion, datos, "Datos del Oeste")).toEqual({ id: oeste, creado: true, repetido: false });
      expect(await sitio.guardarCementerio(direccion, datos)).toEqual({ id: oeste, creado: false, repetido: true });
      expect(await sitio.guardarCementerio(adminSistema, { ...datos, horarioSemana: "De 8 a 18" }, "Cambio de horario")).toEqual({ id: oeste, creado: false, repetido: false });

      const fila = await tx.sitioCementerio.findUniqueOrThrow({ where: { cementerioId: oeste } });
      expect(fila).toMatchObject({ domicilio: "Av. Ficticia 1 (dato de prueba)", horarioSemana: "De 8 a 18", mapaUrl: null, foto: "avenida-azul", visible: true });

      const audit = await cambios(tx, "sitio_cementerios", oeste);
      expect(audit.map((a) => [a.operacion, a.usuarioId, a.motivo])).toEqual([
        ["I", direccion.id, "Datos del Oeste"],
        ["U", adminSistema.id, "Cambio de horario"],
      ]);
      expect(audit[1].antes).toMatchObject({ horario_semana: "De 7 a 18" });
      expect(audit[1].despues).toMatchObject({ horario_semana: "De 8 a 18" });
      expect(descripcionRegistro("sitio_cementerios", String(oeste), null, audit[0].despues)).toBe(`Cementerio #${oeste}`);
    });
  });

  it("recorrido y sus fechas: alta, modificación, fecha futura (no pasada ni repetida) y quitar la fecha, auditado", async () => {
    const ahora = new Date();
    await conSitio(async ({ sitio, tx }) => {
      const r = await sitio.guardarRecorrido(direccion, { nombre: "Recorrido de prueba (it)", activo: true, orden: 5, cementerioId: await idCementerio(tx, "NORTE") }, "Nuevo recorrido");
      expect(r).toMatchObject({ creado: true, repetido: false });
      expect((await sitio.guardarRecorrido(direccion, { id: r.id, nombre: "Recorrido de prueba (it)", activo: true, orden: 5, cementerioId: await idCementerio(tx, "NORTE") })).repetido).toBe(true);
      await sitio.guardarRecorrido(direccion, { id: r.id, nombre: "Recorrido de prueba (it)", activo: true, orden: 5, cementerioId: null, cupo: "20 personas" });

      const f = await sitio.agregarFecha(direccion, { recorridoId: r.id, fecha: datetimeLocal(ahora, 7), nota: "Con reserva" }, "Fecha nueva");
      expect(f.creado).toBe(true);
      await expect(sitio.agregarFecha(direccion, { recorridoId: r.id, fecha: datetimeLocal(ahora, 7) })).rejects.toMatchObject({ codigo: "ya_existe" });
      await expect(sitio.agregarFecha(direccion, { recorridoId: r.id, fecha: datetimeLocal(ahora, -2) })).rejects.toMatchObject({ codigo: "validacion", errores: [{ ruta: "fecha" }] });
      await expect(sitio.agregarFecha(direccion, { recorridoId: r.id, fecha: "no es una fecha" })).rejects.toMatchObject({ errores: [{ ruta: "fecha" }] });
      await expect(sitio.agregarFecha(direccion, { recorridoId: 999_999, fecha: datetimeLocal(ahora, 3) })).rejects.toMatchObject({ codigo: "no_encontrado" });

      expect(await sitio.quitarFecha(direccion, f.id, "Se suspende")).toMatchObject({ repetido: false });
      expect(await sitio.quitarFecha(direccion, f.id)).toMatchObject({ repetido: true });
      expect((await cambios(tx, "sitio_recorrido_fechas", f.id)).map((a) => [a.operacion, a.motivo])).toEqual([
        ["I", "Fecha nueva"],
        ["D", "Se suspende"],
      ]);
      expect((await cambios(tx, "sitio_recorridos", r.id)).map((a) => a.operacion)).toEqual(["I", "U"]);
      const admin = await sitio.contenidoAdmin(direccion);
      expect(admin.recorridos.find((x) => x.id === r.id)).toMatchObject({ cementerio: null, cupo: "20 personas", fechas: [] });
    });
  });

  it("novedad, contacto y pregunta: alta, modificación y quitar (solo la novedad); el contacto es una sola fila", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const n = await sitio.guardarNovedad(direccion, { titulo: "Corte de agua", texto: "Ficticio.", desde: "2026-11-01", hasta: "2026-11-02", activa: true });
      await sitio.guardarNovedad(direccion, { id: n.id, titulo: "Corte de agua", texto: "Ficticio, corregido.", desde: "2026-11-01", hasta: "2026-11-03", activa: true });
      expect(await tx.sitioNovedad.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ texto: "Ficticio, corregido.", hasta: fechaParaDb("2026-11-03") });
      await sitio.quitarNovedad(direccion, n.id, "Ya no corresponde");
      expect(await tx.sitioNovedad.findUnique({ where: { id: n.id } })).toBeNull();
      expect((await cambios(tx, "sitio_novedades", n.id)).map((a) => a.operacion)).toEqual(["I", "U", "D"]);

      expect(await sitio.guardarContacto(direccion, { telefono: "0381 000-0000 (dato de prueba)", correo: "mesa@ejemplo.invalid" })).toMatchObject({ id: 1, creado: true });
      expect(await sitio.guardarContacto(direccion, { telefono: "0381 000-0000 (dato de prueba)", correo: "mesa@ejemplo.invalid" })).toMatchObject({ repetido: true });
      await sitio.guardarContacto(direccion, { telefono: "0381 000-0000 (dato de prueba)" });
      expect(await tx.sitioContacto.findMany()).toMatchObject([{ id: 1, correo: null, domicilio: null }]);
      expect((await cambios(tx, "sitio_contacto", 1)).map((a) => a.operacion)).toEqual(["I", "U"]);

      const p = await sitio.guardarPregunta(direccion, { pregunta: "¿Pregunta de prueba?", respuesta: "Sí.\n\nDos párrafos.", orden: 99, activa: true });
      await sitio.guardarPregunta(direccion, { id: p.id, pregunta: "¿Pregunta de prueba?", respuesta: "Sí.", orden: 99, activa: false });
      expect((await cambios(tx, "sitio_preguntas", p.id)).map((a) => a.operacion)).toEqual(["I", "U"]);
    });
  });

  it("los errores de validación llegan por campo; nada se escribe", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const oeste = await idCementerio(tx, "OESTE");
      const antes = await tx.auditoriaCambio.count({ where: { tabla: { startsWith: "sitio_" } } });
      await expect(sitio.guardarCementerio(direccion, { cementerioId: oeste, visible: true, mapaUrl: "https://example.com/mapa", foto: "subida.jpg" })).rejects.toMatchObject({
        codigo: "validacion",
        errores: [{ ruta: "mapaUrl" }, { ruta: "foto" }],
      });
      await expect(sitio.guardarRecorrido(direccion, { nombre: "x", activo: true, orden: 0, inscripcionUrl: "javascript:alert(1)" })).rejects.toMatchObject({ errores: [{ ruta: "inscripcionUrl" }] });
      await expect(sitio.guardarNovedad(direccion, { titulo: "x", texto: "y", desde: "2026-11-05", hasta: "2026-11-01", activa: true })).rejects.toMatchObject({ errores: [{ ruta: "hasta" }] });
      await expect(sitio.guardarCementerio(direccion, { cementerioId: 30_000, visible: true })).rejects.toMatchObject({ codigo: "no_encontrado" });
      expect(await tx.auditoriaCambio.count({ where: { tabla: { startsWith: "sitio_" } } })).toBe(antes);
    });
  });
});

describe("permisos: Dirección y el admin sí; los operadores, no", () => {
  it("un operador (Mesa de Entradas o Cómputo) no lee la administración ni escribe nada", async () => {
    await conSitio(async ({ sitio, tx }) => {
      const oeste = await idCementerio(tx, "OESTE");
      for (const operador of [mesa, computo]) {
        await expect(sitio.contenidoAdmin(operador)).rejects.toBeInstanceOf(PermisoDenegado);
        await expect(sitio.guardarCementerio(operador, { cementerioId: oeste, visible: false })).rejects.toBeInstanceOf(PermisoDenegado);
        await expect(sitio.guardarContacto(operador, { telefono: "1" })).rejects.toBeInstanceOf(PermisoDenegado);
        await expect(sitio.guardarPregunta(operador, { pregunta: "x", respuesta: "y", orden: 0, activa: true })).rejects.toBeInstanceOf(PermisoDenegado);
        await expect(sitio.quitarNovedad(operador, 1)).rejects.toBeInstanceOf(PermisoDenegado);
        // La Server Action devuelve el error legible, sin escribir.
        const r = await procesarSitio(sitio, operador, { accion: "contacto", datos: { telefono: "1" }, motivo: null });
        expect(r).toMatchObject({ ok: false, codigo: "permiso", mensaje: expect.stringContaining("Tu área no puede hacer esto") });
      }
      expect(await tx.sitioContacto.count()).toBe(0);
      expect((await sitio.contenidoAdmin(direccion)).cementerios.length).toBeGreaterThanOrEqual(3);
      expect((await sitio.contenidoAdmin(adminSistema)).preguntas.length).toBeGreaterThanOrEqual(PREGUNTAS_FRECUENTES.length);
    });
  });

  it("la Server Action: el mensaje de lo hecho, y una entrada con otra forma no llega al dominio", async () => {
    await conSitio(async ({ sitio }) => {
      expect(await procesarSitio(sitio, direccion, { accion: "contacto", datos: { horario: "Lunes a viernes de 7 a 13" }, motivo: "" })).toEqual({
        ok: true,
        repetido: false,
        mensaje: "Contacto guardado: ya se ve en la página pública.",
      });
      expect(await procesarSitio(sitio, direccion, { accion: "borrar_todo", motivo: null })).toMatchObject({ ok: false, codigo: "validacion" });
      expect(await procesarSitio(sitio, direccion, { accion: "contacto", datos: { correo: "no-es-correo" } })).toMatchObject({ ok: false, errores: [{ ruta: "correo" }] });
    });
  });
});

describe("la base: los CHECKs valen aunque se escriba por fuera de la app", () => {
  it.each([
    ["un mapa de otro host", "INSERT INTO public.sitio_contacto (id, mapa_url) VALUES (1, 'https://evil.example/maps')"],
    ["un mapa javascript:", "INSERT INTO public.sitio_contacto (id, mapa_url) VALUES (1, 'javascript:alert(1)')"],
    ["un correo sin arroba", "INSERT INTO public.sitio_contacto (id, correo) VALUES (1, 'mesa.smt.gob.ar')"],
    ["una segunda fila de contacto", "INSERT INTO public.sitio_contacto (id) VALUES (2)"],
    ["un texto vacío", "INSERT INTO public.sitio_preguntas (pregunta, respuesta) VALUES ('', 'x')"],
    ["un texto con espacios en los bordes", "INSERT INTO public.sitio_preguntas (pregunta, respuesta) VALUES (' x', 'y')"],
    ["un control en una línea", "INSERT INTO public.sitio_novedades (titulo, texto, desde, hasta) VALUES (E'a\\nb', 'y', '2026-11-01', '2026-11-01')"],
    ["una novedad que termina antes de empezar", "INSERT INTO public.sitio_novedades (titulo, texto, desde, hasta) VALUES ('a', 'b', '2026-11-02', '2026-11-01')"],
    ["una foto que no es de la lista", "INSERT INTO public.sitio_recorridos (nombre, foto) VALUES ('a', '../../etc/passwd')"],
    ["un enlace de inscripción http", "INSERT INTO public.sitio_recorridos (nombre, inscripcion_url) VALUES ('a', 'http://example.com')"],
    ["un texto más largo que el máximo", `INSERT INTO public.sitio_preguntas (pregunta, respuesta) VALUES ('${"x".repeat(161)}', 'y')`],
  ])("rechaza %s", async (_caso, sql) => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "Prueba de los CHECKs del sitio público");
      expect(await intentar(c, sql)).toMatchObject({ ok: false, codigo: "23514" });
    });
  });

  it("acepta los párrafos con saltos de línea y los enlaces válidos", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "Prueba de los CHECKs del sitio público");
      expect(await intentar(c, "INSERT INTO public.sitio_preguntas (pregunta, respuesta) VALUES ('¿Sí?', E'Uno.\\n\\nDos.')")).toMatchObject({ ok: true });
      expect(await intentar(c, "INSERT INTO public.sitio_contacto (id, mapa_url, correo) VALUES (1, 'https://www.google.com/maps/place/x/@-26.8,-65.2,17z', 'mesa@ejemplo.invalid')")).toMatchObject({ ok: true });
    });
  });

  it("sin actor no se escribe (auditar_cambio lo exige)", async () => {
    await enTransaccion("app", async (c) => {
      expect(await intentar(c, "INSERT INTO public.sitio_preguntas (pregunta, respuesta) VALUES ('¿Sin actor?', 'No.')")).toMatchObject({ ok: false });
    });
  });
});

describe("lo que ve la página pública: solo lo activo, lo visible y lo vigente", () => {
  it("cementerios del catálogo (menos los no visibles), recorridos activos, fechas futuras (hasta 6), novedades vigentes, contacto y preguntas activas", async () => {
    const ahora = new Date();
    await conSitio(async ({ sitio, tx }) => {
      const [oeste, norte, jardin] = await Promise.all(["OESTE", "NORTE", "JARDIN_NORTE"].map((c) => idCementerio(tx, c)));
      // Sin nada cargado (salvo las preguntas de la semilla de producción): todo vacío, los cementerios con su nombre.
      const vacio = await contenidoSitioPublico(tx, ahora);
      expect(vacio).toMatchObject({ hayHorarios: false, recorridos: [], fechas: [], novedades: [], contacto: null });
      expect(vacio.cementerios.map((c) => c.id)).toEqual(expect.arrayContaining([oeste, norte, jardin]));
      expect(vacio.cementerios.find((c) => c.id === oeste)).toMatchObject({ domicilio: null, foto: null, horarioSemana: null });
      expect(vacio.preguntas.map((p) => p.pregunta)).toEqual(expect.arrayContaining(PREGUNTAS_FRECUENTES.map((p) => p.pregunta)));

      await sitio.guardarCementerio(direccion, { cementerioId: oeste, visible: true, horarioFinDeSemana: "De 8 a 13", foto: "panoramica" });
      await sitio.guardarCementerio(direccion, { cementerioId: jardin, visible: false, domicilio: "No se ve (dato de prueba)" });
      const activo = await sitio.guardarRecorrido(direccion, { nombre: "Activo (it)", activo: true, orden: 1 });
      const inactivo = await sitio.guardarRecorrido(direccion, { nombre: "Inactivo (it)", activo: false, orden: 0 });
      for (let i = 1; i <= 8; i++) await sitio.agregarFecha(direccion, { recorridoId: activo.id, fecha: datetimeLocal(ahora, i) });
      await sitio.agregarFecha(direccion, { recorridoId: inactivo.id, fecha: datetimeLocal(ahora, 1, "08:00") });
      // Una fecha que ya pasó (cargada antes de que pasara): por la base, con actor.
      await tx.$executeRaw`SELECT set_config('app.usuario_id', ${String(direccion.id)}, true)`;
      await tx.sitioRecorridoFecha.create({ data: { recorridoId: activo.id, fecha: new Date(ahora.getTime() - 3_600_000) } });

      const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
      const dia = (d: number) => datetimeLocal(new Date(`${hoy}T12:00:00-03:00`), d).slice(0, 10);
      await sitio.guardarNovedad(direccion, { titulo: "Vigente (it)", texto: "Sí", desde: dia(-1), hasta: dia(0), activa: true });
      await sitio.guardarNovedad(direccion, { titulo: "Empieza hoy (it)", texto: "Sí", desde: dia(0), hasta: dia(0), activa: true });
      await sitio.guardarNovedad(direccion, { titulo: "Futura (it)", texto: "No", desde: dia(1), hasta: dia(5), activa: true });
      await sitio.guardarNovedad(direccion, { titulo: "Vencida (it)", texto: "No", desde: dia(-5), hasta: dia(-1), activa: true });
      await sitio.guardarNovedad(direccion, { titulo: "Inactiva (it)", texto: "No", desde: dia(-1), hasta: dia(1), activa: false });
      const oculta = await sitio.guardarPregunta(direccion, { pregunta: "¿Oculta (it)?", respuesta: "No se ve.", orden: 1, activa: false });
      await sitio.guardarContacto(direccion, { horario: "Lunes a viernes (dato de prueba)" });

      const r = await contenidoSitioPublico(tx, ahora);
      expect(r.cementerios.map((c) => c.id)).not.toContain(jardin);
      expect(r.cementerios.map((c) => c.id)).toEqual(expect.arrayContaining([oeste, norte]));
      expect(r.cementerios.find((c) => c.id === oeste)).toMatchObject({ horarioFinDeSemana: "De 8 a 13", foto: { clave: "panoramica" } });
      expect(r.hayHorarios).toBe(true);
      expect(r.recorridos.map((x) => x.nombre)).toEqual(["Activo (it)"]);
      expect(r.fechas).toHaveLength(6);
      expect(r.fechas.every((f) => f.recorrido === "Activo (it)" && f.fecha.getTime() > ahora.getTime())).toBe(true);
      expect(r.fechas.map((f) => f.fecha.getTime())).toEqual([...r.fechas.map((f) => f.fecha.getTime())].sort((a, b) => a - b));
      expect(r.novedades.map((n) => n.titulo).sort()).toEqual(["Empieza hoy (it)", "Vigente (it)"]);
      expect(r.contacto).toEqual({ domicilio: null, horario: "Lunes a viernes (dato de prueba)", telefono: null, correo: null, mapaUrl: null });
      expect(r.preguntas.map((p) => p.id)).not.toContain(oculta.id);

      // Y la administración ve todo, con el estado de cada novedad.
      const admin = await sitio.contenidoAdmin(direccion);
      const estados = Object.fromEntries(admin.novedades.filter((n) => n.titulo.endsWith("(it)")).map((n) => [n.titulo, n.estado]));
      expect(estados).toEqual({
        "Vigente (it)": "vigente",
        "Empieza hoy (it)": "vigente",
        "Futura (it)": "programada",
        "Vencida (it)": "terminada",
        "Inactiva (it)": "inactiva",
      });
      expect(admin.cementerios.find((c) => c.cementerioId === jardin)).toMatchObject({ cargado: true, visible: false });
    });
  });
});
