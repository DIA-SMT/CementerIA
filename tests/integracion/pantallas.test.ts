// Pantallas de la semana 2 contra la base real: la lógica de las Server
// Actions (src/lib/presentacion/acciones.ts) con FormData como el que arma el
// formulario, y lo que el dominio sumó para las pantallas (hoja del historial y
// opciones del buscador). Las acciones de src/app/(app)/expedientes/acciones.ts
// solo agregan la sesión y el redirect() de Next sobre esto.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MENSAJE_CONFLICTO_VERSION, type DatosAlta } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { procesarAlta, procesarDuplicados, procesarEdicion, procesarVerDatos } from "@/lib/presentacion/acciones";
import { asegurarSemilla, comando, datosAlta, servicio, titular, unicoLetras, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let legal: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let direccion: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, legal, liquidacion, direccion] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "LEGAL"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "DIRECCION"),
  ]);
});

afterAll(async () => prisma.$disconnect());

function formulario(campos: Record<string, string | object>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, typeof v === "string" ? v : JSON.stringify(v));
  return f;
}

async function altaPorFormulario(datos: DatosAlta, destino = "caratula") {
  return procesarAlta(exp, mesa, formulario({ datos, comandoId: comando(), destino }));
}

describe("alta desde el formulario", () => {
  it('"Guardar e imprimir carátula" (predeterminado) va a la carátula; "Guardar", a la ficha', async () => {
    const r = await altaPorFormulario(await datosAlta(prisma));
    expect(r).toMatchObject({ ok: true, destino: expect.stringMatching(/^\/expedientes\/CEM-\d{4}-\d{5}\/imprimir\?hoja=caratula$/) });

    const sinDestino = await procesarAlta(exp, mesa, formulario({ datos: await datosAlta(prisma), comandoId: comando() }));
    expect(sinDestino).toMatchObject({ ok: true, destino: expect.stringContaining("hoja=caratula") });

    const ficha = await altaPorFormulario(await datosAlta(prisma), "ficha");
    expect(ficha).toMatchObject({ ok: true, destino: expect.stringMatching(/^\/expedientes\/CEM-\d{4}-\d{5}$/) });
  });

  it("el doble clic (mismo comandoId) no duplica: el segundo envío va al mismo expediente", async () => {
    const campos = { datos: await datosAlta(prisma), comandoId: comando(), destino: "ficha" };
    const [a, b] = [await procesarAlta(exp, mesa, formulario(campos)), await procesarAlta(exp, mesa, formulario(campos))];
    expect(a.ok && b.ok).toBe(true);
    expect(b).toEqual(a);
  });

  it("los errores vuelven por campo, con la ruta del formulario", async () => {
    const datos = await datosAlta(prisma, { personas: [titular({ dni: "12" })], fechaInicio: "2001-01-01" });
    const r = await altaPorFormulario(datos);
    expect(r).toMatchObject({ ok: false, codigo: "validacion", mensaje: "Revisá los datos marcados" });
    expect(!r.ok && r.errores.map((e) => e.ruta)).toEqual(expect.arrayContaining(["personas[0].dni", "fechaInicio"]));
  });

  it("un formulario roto o sin permiso no es un error 500: vuelve como estado", async () => {
    const roto = new FormData();
    roto.set("datos", "{no es json");
    roto.set("comandoId", comando());
    expect(await procesarAlta(exp, mesa, roto)).toMatchObject({ ok: false, codigo: "validacion" });
    expect(await procesarAlta(exp, legal, formulario({ datos: await datosAlta(prisma), comandoId: comando() }))).toMatchObject({
      ok: false,
      codigo: "permiso",
    });
  });

  it("aviso de duplicados antes de guardar: por padrón, sin bloquear", async () => {
    const datos = await datosAlta(prisma);
    const r = await altaPorFormulario(datos, "ficha");
    expect(r.ok).toBe(true);
    const avisos = await procesarDuplicados(exp, mesa, { cementerioId: datos.cementerioId, padron: datos.padron });
    expect(avisos).toEqual([expect.objectContaining({ coincidencias: ["padron"] })]);
    expect(await procesarDuplicados(exp, mesa, { cementerioId: "uno" })).toEqual([]);
  });
});

describe("edición desde el formulario", () => {
  it("guarda y vuelve a la ficha con el aviso; con la versión vieja, el mensaje de conflicto", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const ok = await procesarEdicion(exp, mesa, alta.numero, formulario({ datos: { padron: unicoLetras("PAD-") }, versionVista: "0", motivo: "", comandoId: comando() }));
    expect(ok).toEqual({ ok: true, destino: `/expedientes/${alta.numero}?aviso=editado` });

    const viejo = await procesarEdicion(exp, mesa, alta.numero, formulario({ datos: { padron: "OTRO" }, versionVista: "0", motivo: "", comandoId: comando() }));
    expect(viejo).toMatchObject({ ok: false, codigo: "conflicto_version", mensaje: MENSAJE_CONFLICTO_VERSION });
  });

  it("sin cambios, o un área que no puede editar: estado, no excepción", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma), comando());
    const f = await exp.formularioEdicion(mesa, alta.numero);
    expect(await procesarEdicion(exp, mesa, alta.numero, formulario({ datos: { padron: f.valores.padron }, versionVista: String(f.version), comandoId: comando() }))).toMatchObject({
      ok: false,
      codigo: "sin_cambios",
    });
    expect(await procesarEdicion(exp, liquidacion, alta.numero, formulario({ datos: { padron: "X" }, versionVista: "0", comandoId: comando() }))).toMatchObject({
      ok: false,
      codigo: "permiso",
    });
    expect(await procesarEdicion(exp, mesa, alta.numero, formulario({ datos: {}, versionVista: "abc", comandoId: comando() }))).toMatchObject({
      ok: false,
      codigo: "validacion",
    });
  });
});

describe("ver datos completos", () => {
  it("con motivo corto vuelve el error del campo; con motivo, el contacto", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { personas: [titular({ telefono: "0381 000-5555" })] }), comando());
    const corto = await procesarVerDatos(exp, legal, alta.numero, "porque", null);
    expect(corto).toMatchObject({ ok: false, codigo: "motivo_requerido", errores: [{ ruta: "motivo" }] });
    const r = await procesarVerDatos(exp, legal, alta.numero, "Llamada del titular al mostrador", "10.0.0.9");
    expect(r.ok && r.datos.personas[0].telefono).toBe("0381 000-5555");
  });
});

describe("hoja del historial", () => {
  it("todos los movimientos, sin contacto, y registra imprimir con hoja historial", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { personas: [titular({ telefono: "0381 000-4444", domicilio: "Calle Ficticia 4444" })] }), comando());
    await exp.editar(mesa, alta.numero, { padron: unicoLetras("PAD-") }, 0, null, comando());
    const h = await exp.datosHistorial(direccion, alta.numero, { ip: "10.0.0.8" });
    expect(h).toMatchObject({ numero: alta.numero, numeroCorto: alta.numeroCorto, estado: "en_tramite", paso: { orden: 1 } });
    expect(h.historial.map((m) => m.tipo)).toEqual(["alta", "edicion"]);
    expect(h.personas).toEqual([expect.objectContaining({ etiquetaRol: "Titular de la concesión", vigente: true })]);
    const texto = JSON.stringify(h.personas);
    for (const dato of ["0381", "Calle Ficticia", "ejemplo.test"]) expect(texto).not.toContain(dato);
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: alta.numero }, select: { id: true } });
    const accesos = await prisma.auditoriaAcceso.findMany({ where: { usuarioId: direccion.id, accion: "imprimir", expedienteId: e.id } });
    expect(accesos.map((a) => a.detalle)).toEqual([{ hoja: "historial" }]);
  });
});

describe("opciones del buscador", () => {
  it("tipos de trámite, una plantilla por código, cementerios con sus campos activos y áreas que reciben pases", async () => {
    const o = await exp.opcionesBusqueda();
    expect(o.tiposTramite.map((t) => t.codigo)).toEqual(expect.arrayContaining(["RENOVACION", "RENOVACION_SPT", "NUEVA_CONCESION"]));
    const codigos = o.plantillas.map((p) => p.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["RENOV_CONTADO", "RENOV_PLAN", "RENOV_SPT_CONTADO", "NUEVA_CONC_CONTADO"]));
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(o.cementerios.find((c) => c.codigo === "OESTE")?.camposUbicacion.map((c) => c.clave)).toEqual(["seccion", "cuadro", "lote", "numero"]);
    expect(o.areas.map((a) => a.codigo)).toContain("MESA_ENTRADAS");
    expect(o.areas.map((a) => a.codigo)).not.toContain("DIRECCION");
  });
});
