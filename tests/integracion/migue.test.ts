// Migue contra la base real (02/11/2026; docs/api-dominio.md, sección 26):
// las herramientas del sistema llaman al dominio con el usuario de la sesión y
// respetan sus reglas; el registro (auditoria.consultas_migue) es solo
// inserción y se purga a los 90 días; el tope (public.consumo_migue) es
// atómico. Sin OpenRouter: acá no hay modelo, solo lo que hace el servidor.

import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conActorEn } from "@/lib/db/actor";
import type { Escritor } from "@/lib/dominio/expedientes/dependencias";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { resumenPlantillasPublicadas } from "@/lib/dominio/plantillas/resumen";
import { ejecutarHerramienta, interpretarLlamada, type ContextoHerramienta, type NombreHerramienta } from "@/lib/migue/herramientas";
import { registrarConsulta } from "@/lib/migue/registro";
import { contarConsulta } from "@/lib/migue/tope";
import type { Perfil } from "@/lib/presentacion/recorridos/motor";
import { tareaPurgarMigue } from "@/lib/tareas/programadas";
import { asegurarSemilla, comando, datosAlta, servicio, titular, usuario } from "./dominio";
import { clientePrisma, conPg, enTransaccion, fijarActor, intentar, SISTEMA } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
const escribir: Escritor = (usuarioId, motivo, fn) => conActorEn(prisma, usuarioId, motivo, fn);
const SECRETO = "secreto-de-prueba-que-tiene-mas-de-32-caracteres";
let mesa: UsuarioPermisos;
let computo: UsuarioPermisos;
let direccion: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, computo, direccion] = await Promise.all([usuario(prisma, "MESA_ENTRADAS"), usuario(prisma, "COMPUTO"), usuario(prisma, "DIRECCION")]);
});

afterAll(async () => prisma.$disconnect());

function contexto(u: UsuarioPermisos, perfil: Perfil): ContextoHerramienta {
  return {
    usuario: u,
    perfil,
    servicios: {
      obtenerFicha: (x, numero) => exp.obtenerFicha(x, numero),
      bandeja: (x, pestana) => exp.bandeja(x, pestana),
      contadoresBandeja: (x) => exp.contadoresBandeja(x),
      panel: (x) => exp.panel(x),
      plantillas: () => resumenPlantillasPublicadas(prisma),
    },
  };
}

function correr(nombre: NombreHerramienta, args: Record<string, unknown>, ctx: ContextoHerramienta) {
  return ejecutarHerramienta(interpretarLlamada({ id: "1", type: "function", function: { name: nombre, arguments: JSON.stringify(args) } }), ctx);
}

describe("las herramientas respetan el dominio", () => {
  it("la bandeja es la de cada área: el expediente recién dado de alta está en la de Mesa de Entradas y no en la de Cómputo", async () => {
    const persona = titular();
    const alta = await exp.alta(mesa, await datosAlta(prisma, { personas: [persona] }), comando());
    const deMesa = await correr("mi_bandeja", { filtro: "todas" }, contexto(mesa, "mesa"));
    const numerosMesa = (deMesa.datos.expedientes as Array<{ numero: string }>).map((e) => e.numero);
    // La lista trae los 10 primeros (los más viejos): si no entra, alcanza con que esté en los conteos y no en otra área.
    expect((deMesa.datos.conteos as { porConfirmar: number; enMiArea: number }).enMiArea).toBeGreaterThan(0);
    const deComputo = await correr("mi_bandeja", { filtro: "todas" }, contexto(computo, "operador"));
    expect((deComputo.datos.expedientes as Array<{ numero: string }>).map((e) => e.numero)).not.toContain(alta.numero);
    expect(deComputo.numeros).not.toContain(alta.numero);
    for (const salida of [deMesa, deComputo]) {
      const texto = JSON.stringify(salida.datos);
      expect(texto).not.toContain(persona.apellido);
      expect(texto).not.toContain(persona.dni);
    }
    // Si entra en los 10 de Mesa, va sin el titular.
    if (numerosMesa.includes(alta.numero)) expect(JSON.stringify(deMesa.datos)).not.toContain("Titular Prueba");
  });

  it("estado_expediente pasa por obtenerFicha con ese usuario: deja el acceso a su nombre, dice lo que ese usuario puede hacer y no trae personas", async () => {
    const persona = titular();
    const alta = await exp.alta(mesa, await datosAlta(prisma, { personas: [persona] }), comando());
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: alta.numero }, select: { id: true } });

    const deComputo = await correr("estado_expediente", { numero: alta.numero }, contexto(computo, "operador"));
    expect(deComputo.datos).toMatchObject({ numero: alta.numero, areaActual: "Mesa de Entradas", puedeDarPase: false, puedeConfirmarRecepcion: false });
    const acceso = await prisma.auditoriaAcceso.findFirstOrThrow({ where: { expedienteId: e.id, accion: "ver_expediente", usuarioId: computo.id }, orderBy: { id: "desc" } });
    expect(acceso.detalle).toEqual({ enmascarado: true });

    const deMesa = await correr("estado_expediente", { numero: alta.numero }, contexto(mesa, "mesa"));
    expect(deMesa.datos.paso).toMatchObject({ orden: 1 });
    for (const salida of [deComputo, deMesa]) {
      const texto = JSON.stringify(salida.datos);
      for (const dato of [persona.apellido, persona.dni, persona.telefono, persona.email, persona.domicilio, "Titular Prueba"]) expect(texto).not.toContain(String(dato));
    }
  });

  it("un usuario inactivo no ve nada, y un número que no existe se dice así", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const inactivo = await correr("estado_expediente", { numero: alta.numero }, contexto({ ...computo, activo: false }, "operador"));
    expect(inactivo.datos).toEqual({ error: "Con tu usuario no podés ver eso." });
    const noExiste = await correr("estado_expediente", { numero: "CEM-2099-99999" }, contexto(mesa, "mesa"));
    expect(noExiste.datos).toEqual({ error: "No encontré el expediente CEM-2099-99999." });
  });

  it("Dirección no tiene bandeja: mi_bandeja lo dice, y vencidos_y_demorados mira el panel general", async () => {
    expect((await correr("mi_bandeja", { filtro: "todas" }, contexto(direccion, "direccion"))).datos.error).toMatch(/no tiene bandeja/);
    const v = await correr("vencidos_y_demorados", {}, contexto(direccion, "direccion"));
    expect(String(v.datos.alcance)).toMatch(/panel general/);
    expect(JSON.stringify(v.datos)).not.toMatch(/FICTICIO|titular/i);
  });

  it("plantilla_tramite lee las plantillas publicadas (pasos con su área, documentos)", async () => {
    const r = await correr("plantilla_tramite", { tipo: "inhumación" }, contexto(computo, "operador"));
    const tramites = r.datos.tramites as Array<{ nombre: string; pasos: Array<{ area: string }>; documentos: unknown[] }>;
    expect(tramites.length).toBeGreaterThan(0);
    expect(tramites[0].nombre).toMatch(/Inhumaci/);
    expect(tramites[0].pasos[0].area).toBeTruthy();
  });
});

describe("el registro (auditoria.consultas_migue)", () => {
  it("se anota lo público sin nadie y lo interno con el usuario; la pregunta se guarda recortada", async () => {
    const marca = `prueba-registro-${randomInt(1e9)}`;
    await registrarConsulta(escribir, { canal: "publico", resultado: "respondida", duracionMs: 15, pregunta: `${marca} ${"x".repeat(700)}`, respuesta: "De 8 a 18 h", usuarioId: mesa.id });
    await registrarConsulta(escribir, { canal: "interno", resultado: "respondida", herramientas: ["estado_expediente"], duracionMs: 20, pantalla: "bandeja", pregunta: `${marca} interno`, respuesta: "Está en Cómputo", usuarioId: computo.id, modelo: "openai/gpt-4o-mini", tokensEntrada: 900, tokensSalida: 40 });
    const filas = await prisma.consultaMigue.findMany({ where: { pregunta: { startsWith: marca } }, orderBy: { id: "asc" } });
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ canal: "publico", usuarioId: null, pantalla: null, herramientas: [] });
    expect(filas[0].pregunta.length).toBe(500);
    expect(filas[1]).toMatchObject({ canal: "interno", usuarioId: computo.id, pantalla: "bandeja", herramientas: ["estado_expediente"], tokensEntrada: 900 });
  });

  it("es solo inserción: los CHECKs y el trigger frenan a la app y al dueño", async () => {
    for (const rol of ["app", "owner"] as const) {
      await enTransaccion(rol, async (c) => {
        await fijarActor(c, SISTEMA, "Prueba del registro de Migue");
        const nuevo = await c.query<{ id: string }>("INSERT INTO auditoria.consultas_migue (canal, resultado, duracion_ms, pregunta, respuesta) VALUES ('publico', 'respondida', 1, 'p', 'r') RETURNING id");
        expect(await intentar(c, "UPDATE auditoria.consultas_migue SET respuesta = 'otra' WHERE id = $1", [nuevo.rows[0].id])).toMatchObject({ ok: false });
        expect(await intentar(c, "DELETE FROM auditoria.consultas_migue WHERE id = $1", [nuevo.rows[0].id])).toMatchObject({ ok: false });
        // Lo público con usuario, lo interno sin usuario, una herramienta desconocida, un resultado inventado.
        expect(await intentar(c, "INSERT INTO auditoria.consultas_migue (canal, resultado, duracion_ms, pregunta, respuesta, usuario_id) VALUES ('publico', 'respondida', 1, 'p', 'r', 1)")).toMatchObject({ ok: false });
        expect(await intentar(c, "INSERT INTO auditoria.consultas_migue (canal, resultado, duracion_ms, pregunta, respuesta) VALUES ('interno', 'respondida', 1, 'p', 'r')")).toMatchObject({ ok: false });
        expect(
          await intentar(c, "INSERT INTO auditoria.consultas_migue (canal, resultado, duracion_ms, pregunta, respuesta, usuario_id, herramientas) VALUES ('interno', 'respondida', 1, 'p', 'r', 1, ARRAY['borrar_todo'])"),
        ).toMatchObject({ ok: false });
        expect(await intentar(c, "INSERT INTO auditoria.consultas_migue (canal, resultado, duracion_ms, pregunta, respuesta) VALUES ('publico', 'otro', 1, 'p', 'r')")).toMatchObject({ ok: false });
        expect(await intentar(c, `INSERT INTO auditoria.consultas_migue (canal, resultado, duracion_ms, pregunta, respuesta) VALUES ('publico', 'respondida', 1, repeat('x', 501), 'r')`)).toMatchObject({ ok: false });
        expect(await intentar(c, "TRUNCATE auditoria.consultas_migue")).toMatchObject({ ok: false });
      });
    }
  });

  it("la retención: f_purgar_migue (la tarea de cada mañana) borra lo de más de 90 días y nada más nuevo", async () => {
    const marca = `prueba-retencion-${randomInt(1e9)}`;
    const [vieja, nueva] = await conActorEn(prisma, SISTEMA, "Prueba de la retención de Migue", async (tx) => [
      await tx.consultaMigue.create({ data: { canal: "publico", resultado: "respondida", duracionMs: 1, pregunta: `${marca} vieja`, respuesta: "r", en: new Date(Date.now() - 91 * 86_400_000) } }),
      await tx.consultaMigue.create({ data: { canal: "publico", resultado: "respondida", duracionMs: 1, pregunta: `${marca} de hace 89 días`, respuesta: "r", en: new Date(Date.now() - 89 * 86_400_000) } }),
    ]);
    const ventanaVieja = new Date(Date.now() - 2 * 86_400_000);
    ventanaVieja.setUTCMinutes(0, 0, 0);
    await conActorEn(prisma, SISTEMA, "Prueba de la retención de Migue", (tx) => tx.consumoMigue.create({ data: { clave: "A".repeat(32), ventana: ventanaVieja, consultas: 3 } }));

    const r = await tareaPurgarMigue(prisma);
    expect(r.consultas).toBeGreaterThanOrEqual(1);
    expect(r.consumo).toBeGreaterThanOrEqual(1);
    expect(await prisma.consultaMigue.findUnique({ where: { id: vieja.id } })).toBeNull();
    expect(await prisma.consultaMigue.findUnique({ where: { id: nueva.id } })).not.toBeNull();
    expect(await prisma.consumoMigue.count({ where: { clave: "A".repeat(32), ventana: ventanaVieja } })).toBe(0);
  });
});

describe("el tope (public.consumo_migue)", () => {
  /** Una hora propia, lejos de las demás pruebas: el global suma la hora entera. */
  function horaPropia(): Date {
    return new Date(Date.UTC(2090 + randomInt(9), randomInt(12), 1 + randomInt(27), randomInt(24), 17));
  }

  it("es atómico: 25 pedidos a la vez con tope 20 dejan pasar exactamente 20, y el contador queda en 25", async () => {
    const ahora = horaPropia();
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const deps = { escribir, secreto: SECRETO, topes: { persona: 20, global: 1000 }, ahora: () => ahora };
    const resultados = await Promise.all(Array.from({ length: 25 }, () => contarConsulta(deps, { tipo: "ip", ip })));
    expect(resultados.filter((r) => r.permitido)).toHaveLength(20);
    expect(resultados.filter((r) => !r.permitido).every((r) => r.motivo === "persona")).toBe(true);
    const ventana = new Date(ahora);
    ventana.setUTCMinutes(0, 0, 0);
    const filas = await prisma.consumoMigue.findMany({ where: { ventana } });
    expect(filas).toHaveLength(1);
    expect(filas[0].consultas).toBe(25);
    // Sin la IP en claro: la clave es el HMAC.
    expect(filas[0].clave).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(filas[0].clave).not.toContain(ip);
  });

  it("el global suma a todos en la hora (las IP y los usuarios)", async () => {
    const ahora = horaPropia();
    const deps = { escribir, secreto: SECRETO, topes: { persona: 20, global: 3 }, ahora: () => ahora };
    const r = [];
    for (const persona of [{ tipo: "ip" as const, ip: "10.0.0.1" }, { tipo: "usuario" as const, id: mesa.id }, { tipo: "ip" as const, ip: "10.0.0.2" }, { tipo: "usuario" as const, id: computo.id }]) {
      r.push(await contarConsulta(deps, persona));
    }
    expect(r).toEqual([{ permitido: true }, { permitido: true }, { permitido: true }, { permitido: false, motivo: "global" }]);
  });

  it("el contador solo sube y la hora en curso no se borra (ni la app ni el dueño)", async () => {
    for (const rol of ["app", "owner"] as const) {
      await enTransaccion(rol, async (c) => {
        await fijarActor(c, SISTEMA, "Prueba del tope de Migue");
        await c.query("INSERT INTO public.consumo_migue (clave, ventana, consultas) VALUES (repeat('b', 32), date_trunc('hour', now()), 5)");
        expect(await intentar(c, "UPDATE public.consumo_migue SET consultas = 0 WHERE clave = repeat('b', 32)")).toMatchObject({ ok: false });
        expect(await intentar(c, "UPDATE public.consumo_migue SET ventana = ventana - interval '3 days' WHERE clave = repeat('b', 32)")).toMatchObject({ ok: false });
        expect(await intentar(c, "DELETE FROM public.consumo_migue WHERE clave = repeat('b', 32)")).toMatchObject({ ok: false });
        expect(await intentar(c, "INSERT INTO public.consumo_migue (clave, ventana) VALUES ('10.0.0.1', now())")).toMatchObject({ ok: false });
        expect(await intentar(c, "TRUNCATE public.consumo_migue")).toMatchObject({ ok: false });
      });
    }
    // Y la app no tiene privilegios de más.
    const privilegios = await conPg("superusuario", async (c) =>
      (
        await c.query<{ tabla: string; truncate: boolean; update: boolean }>(
          `SELECT t AS tabla, has_table_privilege('cementeria_app', t, 'TRUNCATE') AS truncate, has_table_privilege('cementeria_app', t, 'UPDATE') AS update
             FROM unnest(ARRAY['auditoria.consultas_migue', 'public.consumo_migue']) t`,
        )
      ).rows,
    );
    expect(privilegios).toEqual([
      { tabla: "auditoria.consultas_migue", truncate: false, update: false },
      { tabla: "public.consumo_migue", truncate: false, update: true },
    ]);
  });
});
