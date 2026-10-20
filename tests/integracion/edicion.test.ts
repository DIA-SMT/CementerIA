// Edición de expedientes (src/lib/dominio/expedientes/editar.ts) contra la base
// real: docs/propuesta-mvp.md, 2.7, 2.8 (`edicion`), 2.13(b) y 3.2.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio, MENSAJE_CONFLICTO_VERSION, type PersonaEntrada } from "@/lib/dominio/expedientes";
import { PermisoDenegado, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { asegurarSemilla, comando, datosAlta, forzarEstado, servicio, simularPase, titular, unicoLetras, usuario } from "./dominio";
import { clientePrisma } from "./helper";
import { hoyEnTucuman, inicioDelDiaEnTucuman, sumarDias } from "@/lib/fechas";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let admin: UsuarioPermisos;
let computo: UsuarioPermisos;
let liquidacion: UsuarioPermisos;
let direccion: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, admin, computo, liquidacion, direccion] = await Promise.all([
    usuario(prisma, "MESA_ENTRADAS"),
    usuario(prisma, "ADMIN"),
    usuario(prisma, "COMPUTO"),
    usuario(prisma, "LIQUIDACION"),
    usuario(prisma, "DIRECCION"),
  ]);
});

afterAll(async () => prisma.$disconnect());

async function error(promesa: Promise<unknown>): Promise<ErrorDominio | PermisoDenegado> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof ErrorDominio || e instanceof PermisoDenegado) return e;
    throw e;
  }
  throw new Error("Se esperaba un error");
}

/** Un expediente nuevo y las personas vigentes como las manda el formulario de edición. */
async function nuevo(personas?: PersonaEntrada[]) {
  const alta = await exp.alta(mesa, await datosAlta(prisma, personas ? { personas } : {}), comando());
  const form = await exp.formularioEdicion(mesa, alta.numero);
  return { numero: alta.numero, form };
}

describe("datos del expediente", () => {
  it("un movimiento edicion con el antes y el después; ubicación, clave (trigger), texto y búsqueda recalculados", async () => {
    const { numero, form } = await nuevo();
    const padronNuevo = unicoLetras("PN-");
    const r = await exp.editar(
      mesa,
      numero,
      { padron: padronNuevo, ubicacion: { seccion: "9", cuadro: "q", lote: "0031" }, observaciones: "Corrige la ficha" },
      form.version,
      null,
      comando(),
    );
    expect(r).toMatchObject({ numero, version: 1, repetido: false, campos: ["ubicacion", "padron", "observaciones"] });

    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: numero } });
    expect(e).toMatchObject({
      padron: padronNuevo,
      padronNorm: padronNuevo.replace("-", ""),
      ubicacion: { seccion: "9", cuadro: "Q", lote: "31" },
      ubicacionClave: "cuadro=Q;lote=31;seccion=9",
      ubicacionTexto: "Sección 9 · Cuadro Q · Lote 31",
      observaciones: "Corrige la ficha",
      version: 1,
    });
    expect(e.busqueda).toContain(padronNuevo.toLowerCase().replace("-", " "));
    expect(e.busqueda).not.toContain(form.valores.padron?.toLowerCase().replace("-", " ") ?? "x");

    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(r.movimientoId) } });
    expect(m).toMatchObject({ tipo: "edicion", usuarioId: mesa.id, secuencia: 2, motivo: null, precisionFecha: "minuto" });
    expect(m.datos).toEqual({
      cambios: {
        padron: [form.valores.padron, padronNuevo],
        ubicacion: [form.valores.ubicacion, { seccion: "9", cuadro: "Q", lote: "31" }],
        observaciones: [null, "Corrige la ficha"],
      },
      personas: { baja: [], reemplazadas: [] },
    });
  });

  it("campos extra: se completan y se borran", async () => {
    const { numero, form } = await nuevo();
    const r1 = await exp.editar(mesa, numero, { datosExtra: { concesion_hasta: "2031-01-01" } }, form.version, null, comando());
    const r2 = await exp.editar(mesa, numero, { datosExtra: { concesion_hasta: null } }, r1.version, null, comando());
    expect(r2.campos).toEqual(["datos_extra.concesion_hasta"]);
    const e = await prisma.expediente.findUniqueOrThrow({ where: { numeroInterno: numero } });
    expect(e.datosExtra).toEqual({});
  });

  it("sin cambios no inserta nada", async () => {
    const { numero, form } = await nuevo();
    const e = await error(exp.editar(mesa, numero, { padron: form.valores.padron }, form.version, null, comando()));
    expect(e).toMatchObject({ codigo: "sin_cambios" });
  });
});

describe("personas versionadas (2.7)", () => {
  it("cambiar el teléfono: baja de la vieja, versión nueva con el mismo orden y el enlace", async () => {
    const { numero, form } = await nuevo();
    const [t] = form.valores.personas;
    const r = await exp.editar(
      mesa,
      numero,
      { personas: [{ ...t, telefono: "0381 000-9999" }] },
      form.version,
      null,
      comando(),
    );
    expect(r.campos).toEqual(["personas"]);
    const personas = await prisma.expedientePersona.findMany({
      where: { expediente: { numeroInterno: numero } },
      orderBy: { id: "asc" },
    });
    expect(personas).toHaveLength(2);
    const [vieja, nueva] = personas;
    expect(vieja).toMatchObject({ id: BigInt(t.id ?? "0"), vigente: false, reemplazadaPorId: nueva.id, telefono: "0381 000-1234" });
    expect(nueva).toMatchObject({ vigente: true, reemplazadaPorId: null, orden: vieja.orden, telefono: "0381 000-9999", esContacto: true });
    expect(nueva.creadaMovId.toString()).toBe(r.movimientoId);
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(r.movimientoId) } });
    expect(m.datos).toEqual({ cambios: {}, personas: { baja: [], reemplazadas: [Number(vieja.id)] } });
    // Los datos personales no van al historial.
    expect(JSON.stringify(m.datos)).not.toContain("9999");
  });

  it("agregar un solicitante, pasarle el contacto y después quitarlo", async () => {
    const { numero, form } = await nuevo();
    const [t] = form.valores.personas;
    const solicitante: PersonaEntrada = { rol: "solicitante", apellido: unicoLetras("FICTICIA "), nombres: "Hija", vinculo: "hija", email: "hija@ejemplo.test", esContacto: true };
    const r1 = await exp.editar(mesa, numero, { personas: [{ ...t, esContacto: false }, solicitante] }, form.version, null, comando());

    const vigentes1 = await prisma.expedientePersona.findMany({ where: { expediente: { numeroInterno: numero }, vigente: true }, orderBy: { id: "asc" } });
    expect(vigentes1.map((p) => [p.rol, p.orden, p.esContacto])).toEqual([
      ["titular", 1, false],
      ["solicitante", 1, true],
    ]);

    const form2 = await exp.formularioEdicion(mesa, numero);
    expect(form2.version).toBe(r1.version);
    const titular2 = form2.valores.personas.find((p) => p.rol === "titular");
    if (!titular2) throw new Error("Falta el titular");
    const r2 = await exp.editar(mesa, numero, { personas: [{ ...titular2, esContacto: true }] }, form2.version, null, comando());
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(r2.movimientoId) } });
    const solicitanteId = vigentes1[1].id;
    expect(m.datos).toMatchObject({ personas: { baja: [Number(solicitanteId)], reemplazadas: [Number(titular2.id)] } });
    const quitado = await prisma.expedientePersona.findUniqueOrThrow({ where: { id: solicitanteId } });
    expect(quitado).toMatchObject({ vigente: false, reemplazadaPorId: null });
  });

  it("una persona que ya no está vigente (otro la editó) es un conflicto", async () => {
    const { numero, form } = await nuevo();
    const [t] = form.valores.personas;
    const r = await exp.editar(mesa, numero, { personas: [{ ...t, nombres: "Otro Nombre" }] }, form.version, null, comando());
    const e = await error(exp.editar(mesa, numero, { personas: [{ ...t, nombres: "Tercer Nombre" }] }, r.version, null, comando()));
    expect(e).toMatchObject({ codigo: "conflicto_version" });
  });

  it("valida las personas como el alta (mínimos)", async () => {
    const { numero, form } = await nuevo();
    const e = await error(exp.editar(mesa, numero, { personas: [] }, form.version, null, comando()));
    expect(e).toMatchObject({ codigo: "validacion" });
  });
});

describe("bloqueo optimista e idempotencia", () => {
  it("con una versión vieja: 'Otro usuario modificó el expediente; recargá'", async () => {
    const { numero, form } = await nuevo();
    await exp.editar(mesa, numero, { observaciones: "Primera" }, form.version, null, comando());
    const e = await error(exp.editar(mesa, numero, { observaciones: "Segunda" }, form.version, null, comando()));
    expect(e).toBeInstanceOf(ErrorDominio);
    expect(e).toMatchObject({ codigo: "conflicto_version", message: MENSAJE_CONFLICTO_VERSION });
  });

  it("el mismo comando devuelve lo de antes sin validar ni cambiar nada", async () => {
    const { numero, form } = await nuevo();
    const c = comando();
    const r1 = await exp.editar(mesa, numero, { observaciones: "Una vez" }, form.version, null, c);
    // Reintento con la versión vieja: no es conflicto, es el mismo comando.
    const r2 = await exp.editar(mesa, numero, { observaciones: "Una vez" }, form.version, null, c);
    expect(r2).toMatchObject({ repetido: true, movimientoId: r1.movimientoId, version: r1.version });
    expect(await prisma.movimiento.count({ where: { expediente: { numeroInterno: numero }, tipo: "edicion" } })).toBe(1);
  });
});

describe("motivo después del primer pase (3.2)", () => {
  it("datos identificatorios: sin pases no hace falta; después sí (10 caracteres o más); el contacto no lo pide", async () => {
    const { numero, form } = await nuevo();
    const r1 = await exp.editar(mesa, numero, { numeroMunicipal: "1/2026" }, form.version, null, comando());
    await simularPase(prisma, numero, mesa, { clave: "COMPUTO_ALTA", orden: 2, area: "COMPUTO" });
    const version = r1.version + 1;

    const sinMotivo = await error(exp.editar(mesa, numero, { numeroMunicipal: "2/2026" }, version, null, comando()));
    expect(sinMotivo).toMatchObject({ codigo: "motivo_requerido" });
    const corto = await error(exp.editar(mesa, numero, { numeroMunicipal: "2/2026" }, version, "corto", comando()));
    expect(corto).toMatchObject({ codigo: "motivo_requerido" });

    const r2 = await exp.editar(mesa, numero, { numeroMunicipal: "2/2026" }, version, "  Error de tipeo en el número  ", comando());
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(r2.movimientoId) } });
    expect(m.motivo).toBe("Error de tipeo en el número");

    // Contacto y observaciones: sin motivo.
    await expect(exp.editar(mesa, numero, { observaciones: "Llamó" }, r2.version, null, comando())).resolves.toMatchObject({ repetido: false });
  });
});

describe("permisos (3.2)", () => {
  it("identificatorios: Mesa, admin y Cómputo cuando es la responsable; Liquidación no; Dirección no edita", async () => {
    const { numero, form } = await nuevo();
    expect(await error(exp.editar(computo, numero, { padron: "X-1" }, form.version, null, comando()))).toMatchObject({ motivo: "no_es_responsable" });
    expect(await error(exp.editar(direccion, numero, { padron: "X-1" }, form.version, null, comando()))).toMatchObject({ motivo: "solo_lectura" });
    const r = await exp.editar(admin, numero, { padron: unicoLetras("AD-") }, form.version, null, comando());

    await simularPase(prisma, numero, mesa, { clave: "COMPUTO_ALTA", orden: 2, area: "COMPUTO" });
    const enComputo = r.version + 1;
    await expect(exp.editar(computo, numero, { padron: unicoLetras("CO-") }, enComputo, "Corrige el padrón según Cómputo", comando())).resolves.toMatchObject({
      version: enComputo + 1,
    });

    await simularPase(prisma, numero, computo, { clave: "LIQUIDACION", orden: 3, area: "LIQUIDACION" });
    const enLiquidacion = enComputo + 2;
    expect(await error(exp.editar(liquidacion, numero, { padron: "X-2" }, enLiquidacion, "Liquidación corrige", comando()))).toMatchObject({
      motivo: "area_no_habilitada",
    });
    // Pero el contacto y los campos extra sí, por ser la responsable.
    const form2 = await exp.formularioEdicion(liquidacion, numero);
    expect(form2.acciones.editarIdentificatorios).toEqual({ permitido: false, motivo: "area_no_habilitada" });
    const [t] = form2.valores.personas;
    await expect(
      exp.editar(liquidacion, numero, { personas: [{ ...t, email: "nuevo@ejemplo.test" }], datosExtra: { concesion_desde: "2026-01-01" } }, form2.version, null, comando()),
    ).resolves.toMatchObject({ campos: ["datos_extra.concesion_desde", "personas"] });
    // Cambiar el nombre es identificatorio, aunque venga junto con el contacto.
    const form3 = await exp.formularioEdicion(liquidacion, numero);
    const [t3] = form3.valores.personas;
    expect(await error(exp.editar(liquidacion, numero, { personas: [{ ...t3, nombres: "Otro" }] }, form3.version, "Liquidación corrige", comando()))).toMatchObject({
      motivo: "area_no_habilitada",
    });
  });

  it("un área que no es responsable no abre el formulario de edición", async () => {
    const { numero } = await nuevo();
    expect(await error(exp.formularioEdicion(liquidacion, numero))).toBeInstanceOf(PermisoDenegado);
  });

  it("archivado o anulado: no se edita", async () => {
    for (const estado of ["archivado", "anulado"] as const) {
      const { numero, form } = await nuevo([titular()]);
      await forzarEstado(prisma, numero, estado);
      expect(await error(exp.editar(mesa, numero, { observaciones: "x" }, form.version, null, comando()))).toMatchObject({ codigo: "estado_no_admite" });
      expect(await error(exp.formularioEdicion(mesa, numero))).toMatchObject({ codigo: "estado_no_admite" });
    }
  });

  it("número inexistente", async () => {
    expect(await error(exp.editar(mesa, "CEM-1999-99999", { observaciones: "x" }, 0, null, comando()))).toMatchObject({ codigo: "no_encontrado" });
  });
});

describe("fecha de inicio", () => {
  it("se corrige dentro del rango, pero no puede quedar después del primer pase", async () => {
    const hoy = hoyEnTucuman();
    const alta = await exp.alta(mesa, await datosAlta(prisma, { fechaInicio: sumarDias(hoy, -10) }), comando());
    await simularPase(prisma, alta.numero, mesa, { clave: "COMPUTO_ALTA", orden: 2, area: "COMPUTO" }, inicioDelDiaEnTucuman(sumarDias(hoy, -5)));
    const motivo = "Corrige la fecha según el papel";
    const despues = await error(exp.editar(mesa, alta.numero, { fechaInicio: sumarDias(hoy, -2) }, 1, motivo, comando()));
    expect(despues).toMatchObject({ codigo: "validacion", errores: [{ ruta: "fechaInicio", mensaje: expect.stringMatching(/posterior al primer pase/) }] });
    const r = await exp.editar(mesa, alta.numero, { fechaInicio: sumarDias(hoy, -7) }, 1, motivo, comando());
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id: BigInt(r.movimientoId) } });
    expect(m.datos).toMatchObject({ cambios: { fecha_inicio: [sumarDias(hoy, -10), sumarDias(hoy, -7)] } });
  });
});
