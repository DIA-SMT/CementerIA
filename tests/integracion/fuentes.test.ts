// Lo que cambió con las fuentes de la Dirección (docs/fuentes/README.md,
// "Cambios que esto implica", puntos 1 a 5), contra la base real y con la
// semilla: titulares que son personas jurídicas (asociaciones con panteón),
// conceptos, documentos y subtareas según el cementerio, y la Conservación
// pagada. El punto 6 (DIM omitible) está en pases.test.ts; la nomenclatura,
// en alta.test.ts, busqueda.test.ts y semilla.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman } from "@/lib/fechas";
import { asegurarSemilla, avanzar, comando, cuitUnico, datosAlta, movimientos, proyeccion, responsable, servicio, titular, unicoLetras, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp = servicio(prisma);
let mesa: UsuarioPermisos;
let legal: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  [mesa, legal] = await Promise.all([usuario(prisma, "MESA_ENTRADAS"), usuario(prisma, "LEGAL")]);
});

afterAll(async () => prisma.$disconnect());

async function errorDe(p: Promise<unknown>): Promise<ErrorDominio> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorDominio) return e;
    throw e;
  }
  throw new Error("se esperaba ErrorDominio");
}

describe("titular persona jurídica: una asociación con panteón en el Oeste (punto 3)", () => {
  it("alta, Faltan con personería y designación de asamblea, ficha y carátula", async () => {
    const cuit = cuitUnico();
    const razon = `Asociación Ficticia ${unicoLetras("")} de Socorros Mutuos`;
    const alta = await exp.alta(
      mesa,
      await datosAlta(prisma, {
        tipoMonumento: "PANTEON",
        personas: [
          { rol: "titular", tipo: "juridica", razonSocial: razon, cuit: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`, telefono: "0381 000-7777" },
          titular({ rol: "solicitante", vinculo: "presidente de la comisión directiva", esContacto: true }),
        ],
        documentosRecibidos: ["FORM_INICIO_RENOV", "DNI", "BOLETA_SERVICIO", "PERSONERIA"],
      }),
      comando(),
    );

    const fila = await prisma.expedientePersona.findFirstOrThrow({ where: { expediente: { numeroInterno: alta.numero }, rol: "titular" } });
    expect(fila).toMatchObject({ tipoPersona: "juridica", razonSocial: razon, cuit, apellido: null, nombres: null, dni: null, fallecido: false });

    // Faltan en Mesa: la designación de asamblea (la personería vino con el alta).
    const v = await exp.validarPase(mesa, alta.numero);
    expect(v.faltan.map((f) => f.clave)).toEqual(["MESA_CARATULA", "DESIGNACION_ASAMBLEA"]);

    const f = await exp.obtenerFicha(mesa, alta.numero);
    expect(f.tipoMonumento).toEqual({ codigo: "PANTEON", nombre: "Panteón" });
    expect(f.personas[0]).toMatchObject({ rol: "titular", tipo: "juridica", razonSocial: razon, cuit, apellido: null, dni: null });
    expect(f.documentacion.concesionario.map((d) => [d.clave, d.estado])).toEqual([
      ["DNI", "presentado"],
      ["BOLETA_SERVICIO", "presentado"],
      ["PERSONERIA", "presentado"],
      ["DESIGNACION_ASAMBLEA", "pendiente"],
      ["COMPROBANTE_PAGO", "pendiente"],
    ]);

    // Para quien no trabaja el expediente: la razón social y el CUIT se ven
    // (como el nombre y el DNI); el contacto de la asociación, enmascarado.
    const deLegal = await exp.obtenerFicha(legal, alta.numero);
    expect(deLegal.personas[0]).toMatchObject({ razonSocial: razon, cuit, contacto: { telefono: "•••• •••-••77", enmascarado: true } });

    // La carátula lleva la razón social y el CUIT, sin teléfono.
    const c = await exp.datosCaratula(mesa, alta.numero);
    expect(c.titulares).toEqual([
      { tipo: "juridica", apellido: null, nombres: null, dni: null, razonSocial: razon, cuit, fallecido: false, vinculo: null },
    ]);
    expect(JSON.stringify(c)).not.toContain("0381");

    // La búsqueda la encuentra por CUIT y la muestra con la razón social.
    const b = await exp.buscar(mesa, { q: cuit });
    expect(b.abrir).toBe(alta.numero);
    expect(b.resultados[0].titular).toBe(razon);
  });

  it("en la edición, el titular pasa de persona física a jurídica como una versión nueva, y aparecen sus documentos", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { tipoMonumento: "PANTEON" }), comando());
    const antes = await exp.validarPase(mesa, alta.numero);
    expect(antes.faltan.map((f) => f.clave)).not.toContain("PERSONERIA");

    const form = await exp.formularioEdicion(mesa, alta.numero);
    const vieja = form.valores.personas[0];
    expect(vieja).toMatchObject({ tipo: "fisica", razonSocial: null, cuit: null });
    const cuit = cuitUnico();
    const r = await exp.editar(
      mesa,
      alta.numero,
      { personas: [{ id: vieja.id, rol: "titular", tipo: "juridica", razonSocial: "Sociedad Ficticia de Prueba", cuit, email: "sociedad@ejemplo.test", esContacto: true }] },
      form.version,
      null,
      comando(),
    );
    expect(r.campos).toEqual(["personas"]);
    const personas = await prisma.expedientePersona.findMany({ where: { expediente: { numeroInterno: alta.numero } }, orderBy: { id: "asc" } });
    expect(personas.map((p) => [p.tipoPersona, p.vigente])).toEqual([
      ["fisica", false],
      ["juridica", true],
    ]);
    expect(personas[0].reemplazadaPorId).toBe(personas[1].id);
    const despues = await exp.validarPase(mesa, alta.numero);
    expect(despues.faltan.map((f) => f.clave)).toEqual(expect.arrayContaining(["PERSONERIA", "DESIGNACION_ASAMBLEA"]));
    const e = await proyeccion(prisma, alta.numero);
    expect(e.busqueda).toContain("sociedad ficticia de prueba");
    expect(e.busqueda).toContain(cuit);
  });

  it("un rol que no la admite (el solicitante) rechaza la persona jurídica", async () => {
    const err = await errorDe(
      exp.alta(
        mesa,
        await datosAlta(prisma, {
          personas: [
            titular({ esContacto: true }),
            { rol: "solicitante", tipo: "juridica", razonSocial: "Otra Ficticia", cuit: cuitUnico(), vinculo: "apoderada" },
          ],
        }),
        comando(),
      ),
    );
    expect(err.codigo).toBe("validacion");
    expect(err.errores).toContainEqual({ ruta: "personas[1].tipo", mensaje: "Solicitante: tiene que ser una persona física" });
  });
});

describe("conceptos, boleta y Conservación según el cementerio (puntos 2 y 5)", () => {
  it("Jardín: sin inspección técnica en los conceptos ni en la boleta; pide la Conservación", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { cementerio: "JARDIN_NORTE" }), comando());
    const f = await exp.obtenerFicha(mesa, alta.numero);
    expect(f.conceptos.map((c) => c.clave)).toEqual(["DERECHO_OFICINA", "ARRENDAMIENTO"]);
    const liquidacion = f.recorrido.find((p) => p.clave === "LIQUIDACION");
    expect(liquidacion?.subtareas.map((s) => [s.clave, s.nombre])).toEqual([
      ["LIQ_DEBITOS", "Liquidación practicada y débitos generados"],
      ["LIQ_BOLETA_JARDIN", "Boleta emitida: oficina y arrendamiento"],
      ["LIQ_PAGO", "Pago verificado: Rapipago, Pago Fácil o Banco Macro"],
    ]);
    expect(JSON.stringify(f.recorrido)).not.toMatch(/inspección técnica/);
    expect(f.documentacion.direccion.map((d) => d.clave)).toContain("CONSERVACION");
    // Lo que no corresponde al expediente no aparece en la ficha: tampoco la personería.
    expect(f.documentacion.concesionario.map((d) => d.clave)).not.toContain("PERSONERIA");

    const c = await exp.datosCaratula(mesa, alta.numero);
    expect(c.recorrido.find((p) => p.clave === "LIQUIDACION")?.subtareas.map((s) => s.nombre)).toContain("Boleta emitida: oficina y arrendamiento");
    expect(JSON.stringify(c.recorrido)).not.toMatch(/inspección técnica/);

    // En Liquidación se exige lo de Jardín, y la boleta del Oeste no existe para este expediente.
    for (let i = 0; i < 2; i++) await avanzar(exp, prisma, alta.numero);
    const v = await exp.validarPase(await responsable(prisma, alta.numero), alta.numero);
    expect(v.faltan.map((x) => x.clave)).toEqual([
      "LIQ_DEBITOS",
      "LIQ_BOLETA_JARDIN",
      "LIQ_PAGO",
      "ESTADO_CUENTA",
      "CONST_PERIODOS",
      "CONSERVACION",
      "INFORME_TECNICO",
      "COMPROBANTE_PAGO",
    ]);
    const liq = await responsable(prisma, alta.numero);
    const err = await errorDe(exp.tildarSubtarea(liq, alta.numero, "LIQ_BOLETA", null, v.version, comando()));
    expect(err.errores).toEqual([{ ruta: "subtarea", mensaje: "No existe esa subtarea en la plantilla" }]);
    // Y avanza tildando la de Jardín.
    const r = await avanzar(exp, prisma, alta.numero, {});
    expect(r.paso.clave).toBe("LEGAL");
    const tildadas = (await movimientos(prisma, alta.numero)).filter((m) => m.tipo === "subtarea").map((m) => (m.datos as { subtarea: string }).subtarea);
    expect(tildadas).toContain("LIQ_BOLETA_JARDIN");
    expect(tildadas).not.toContain("LIQ_BOLETA");
  });

  it("Oeste: con inspección técnica y Conservación; Norte: con inspección técnica, sin Conservación (a confirmar)", async () => {
    const oeste = await exp.obtenerFicha(mesa, (await exp.alta(mesa, await datosAlta(prisma), comando())).numero);
    expect(oeste.conceptos.map((c) => c.clave)).toEqual(["DERECHO_OFICINA", "INSPECCION_TECNICA", "ARRENDAMIENTO"]);
    expect(oeste.recorrido.find((p) => p.clave === "LIQUIDACION")?.subtareas.map((s) => s.clave)).toEqual(["LIQ_DEBITOS", "LIQ_BOLETA", "LIQ_PAGO"]);
    expect(oeste.documentacion.direccion.map((d) => d.clave)).toContain("CONSERVACION");

    const altaNorte = await exp.alta(mesa, await datosAlta(prisma, { cementerio: "NORTE" }), comando());
    const norte = await exp.obtenerFicha(mesa, altaNorte.numero);
    expect(norte.conceptos.map((c) => c.clave)).toContain("INSPECCION_TECNICA");
    expect(norte.documentacion.direccion.map((d) => d.clave)).not.toContain("CONSERVACION");
    // No se puede marcar ni recibir un documento que no corresponde al expediente.
    const err = await errorDe(exp.marcarDocumento(mesa, altaNorte.numero, "CONSERVACION", "presentado", null, norte.version, comando()));
    expect(err.codigo).toBe("validacion");
    const alta = await errorDe(exp.alta(mesa, await datosAlta(prisma, { cementerio: "NORTE", documentosRecibidos: ["CONSERVACION"] }), comando()));
    expect(alta.errores.map((e) => e.ruta)).toEqual(["documentosRecibidos[0]"]);
  });

  it("la nueva concesión no cobra inspección técnica en ningún cementerio", async () => {
    for (const cementerio of ["OESTE", "NORTE", "JARDIN_NORTE"]) {
      const a = await exp.alta(mesa, await datosAlta(prisma, { plantilla: "NUEVA_CONC_CONTADO", cementerio }), comando());
      const f = await exp.obtenerFicha(legal, a.numero);
      expect(f.conceptos.map((c) => c.clave), cementerio).not.toContain("INSPECCION_TECNICA");
    }
  });

  it("la bandeja ofrece el pase rápido con lo que corresponde al cementerio", async () => {
    const alta = await exp.alta(mesa, await datosAlta(prisma, { cementerio: "JARDIN_NORTE" }), comando());
    for (let i = 0; i < 2; i++) await avanzar(exp, prisma, alta.numero);
    const liq = await responsable(prisma, alta.numero);
    let v = await exp.validarPase(liq, alta.numero);
    let version = v.version;
    for (const s of ["LIQ_DEBITOS", "LIQ_BOLETA_JARDIN", "LIQ_PAGO"]) {
      version = (await exp.tildarSubtarea(liq, alta.numero, s, s === "LIQ_PAGO" ? hoyEnTucuman() : null, version, comando())).version;
    }
    for (const d of ["ESTADO_CUENTA", "CONST_PERIODOS", "CONSERVACION", "INFORME_TECNICO", "COMPROBANTE_PAGO"]) {
      version = (await exp.marcarDocumento(liq, alta.numero, d, "presentado", null, version, comando())).version;
    }
    v = await exp.validarPase(liq, alta.numero);
    expect(v.faltan).toEqual([]);
    const fila = (await exp.bandeja(liq, "en_mi_area")).filas.find((x) => x.numero === alta.numero);
    expect(fila?.paseRapido).toMatchObject({ clave: "LEGAL" });
  });
});
