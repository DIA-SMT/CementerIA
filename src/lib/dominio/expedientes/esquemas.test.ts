import { describe, expect, it } from "vitest";
import { CEMENTERIOS } from "../../../../prisma/semilla/cementerios";
import { NUEVA_CONC_CONTADO } from "../../../../prisma/semilla/plantillas/nueva-conc-contado";
import { RENOV_CONTADO } from "../../../../prisma/semilla/plantillas/renov-contado";
import { RENOV_SPT_CONTADO } from "../../../../prisma/semilla/plantillas/renov-spt-contado";
import type { DefinicionPlantilla } from "../plantillas/esquema";
import { ErrorDominio, type ErrorCampo } from "./errores";
import {
  construirEsquemaAlta,
  construirEsquemaEdicion,
  erroresDe,
  validarCon,
  type ContextoEsquema,
  type DatosAlta,
  type PersonaEntrada,
} from "./esquemas";

const HOY = "2026-10-20";
// El Norte: conserva la nomenclatura provisoria (sección, cuadro, lote y número).
const CAMPOS = CEMENTERIOS.find((c) => c.codigo === "NORTE")?.camposUbicacion ?? [];
const OESTE = CEMENTERIOS.find((c) => c.codigo === "OESTE")?.camposUbicacion ?? [];
const JARDIN = CEMENTERIOS.find((c) => c.codigo === "JARDIN_NORTE")?.camposUbicacion ?? [];

function contexto(definicion: DefinicionPlantilla = RENOV_CONTADO): ContextoEsquema {
  return {
    plantilla: { id: 7, definicion },
    cementerio: { id: 3, codigo: "NORTE", camposUbicacion: CAMPOS },
    tiposMonumento: definicion.tipos_monumento.length > 0 ? definicion.tipos_monumento : ["SOTANITO", "NICHO"],
    cementerios: ["OESTE", "NORTE", "JARDIN_NORTE"],
    hoy: HOY,
  };
}

const TITULAR: PersonaEntrada = {
  rol: "titular",
  apellido: "  PRUEBA  ",
  nombres: "Ficticia   Uno",
  dni: "90.000.001",
  telefono: "0381 000-0001",
  telefonoWhatsapp: true,
};

function datos(cambios: Partial<DatosAlta> = {}): DatosAlta {
  return {
    plantillaId: 7,
    cementerioId: 3,
    tipoMonumento: "SEPULTURA",
    ubicacion: { seccion: "03", cuadro: "b", lote: "012", numero: "" },
    personas: [TITULAR],
    fechaInicio: HOY,
    ...cambios,
  };
}

/** Los errores de validación como `ruta: mensaje`. */
function errores(fn: () => unknown): ErrorCampo[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDominio && e.codigo === "validacion") return [...e.errores];
    throw e;
  }
  throw new Error("Se esperaba un error de validación");
}

const alta = (d: unknown, ctx = contexto()) => validarCon(construirEsquemaAlta(ctx), d);

describe("alta: lo básico", () => {
  it("normaliza todo y marca solo al contacto posible", () => {
    const v = alta(datos({ padron: " P-0099 ", numeroMunicipal: "", observaciones: "  nada   raro " }));
    expect(v).toEqual({
      plantillaId: 7,
      cementerioId: 3,
      tipoMonumento: "SEPULTURA",
      ubicacion: { seccion: "3", cuadro: "B", lote: "12" },
      padron: "P-0099",
      numeroMunicipal: null,
      formaPago: "contado",
      personas: [
        {
          id: null,
          rol: "titular",
          orden: 1,
          tipo: "fisica",
          apellido: "PRUEBA",
          nombres: "Ficticia Uno",
          dni: "90000001",
          razonSocial: null,
          cuit: null,
          fallecido: false,
          fechaDefuncion: null,
          vinculo: null,
          telefono: "0381 000-0001",
          telefonoWhatsapp: true,
          email: null,
          domicilio: null,
          esContacto: true,
        },
      ],
      datosExtra: {},
      documentosRecibidos: [],
      observaciones: "nada raro",
      fechaInicio: HOY,
      cargaHistorica: false,
      fuente: null,
      expedienteAnteriorId: null,
    });
  });

  it("rechaza claves que no son del formulario", () => {
    expect(errores(() => alta({ ...datos(), otra: 1 })).map((e) => e.ruta)).toEqual([""]);
  });

  it("plantilla y cementerio tienen que ser los del contexto", () => {
    expect(errores(() => alta(datos({ plantillaId: 8, cementerioId: 4 }))).map((e) => e.ruta).sort()).toEqual(["cementerioId", "plantillaId"]);
  });
});

describe("alta: personas (2.7)", () => {
  it("fuera de min/max", () => {
    expect(errores(() => alta(datos({ personas: [] })))).toContainEqual({
      ruta: "personas",
      mensaje: "Titular de la concesión: tiene que haber 1 (hay 0)",
    });
    expect(errores(() => alta(datos({ personas: [TITULAR, { ...TITULAR, dni: null }] })))).toContainEqual({
      ruta: "personas",
      mensaje: "Titular de la concesión: tiene que haber 1 (hay 2)",
    });
    const solicitante = { rol: "solicitante", apellido: "PRUEBA", nombres: "Dos", vinculo: "hijo" };
    expect(errores(() => alta(datos({ personas: [TITULAR, solicitante, solicitante] })))).toContainEqual({
      ruta: "personas",
      mensaje: "Solicitante: tiene que haber como máximo 1 (hay 2)",
    });
  });

  it("rol que la plantilla no tiene", () => {
    expect(errores(() => alta(datos({ personas: [TITULAR, { rol: "cesionario", apellido: "X", nombres: "Y" }] })))).toContainEqual({
      ruta: "personas[1].rol",
      mensaje: 'Este trámite no tiene personas con el rol "cesionario"',
    });
  });

  it("solicitante distinto del titular: pide vínculo (pide_vinculo)", () => {
    const solicitante = { rol: "solicitante", apellido: "PRUEBA", nombres: "Dos", email: "dos@ejemplo.test" };
    expect(errores(() => alta(datos({ personas: [TITULAR, solicitante] })))).toContainEqual({
      ruta: "personas[1].vinculo",
      mensaje: "Solicitante: indicá el vínculo con el titular",
    });
  });

  it("con dos personas que pueden ser contacto, hay que elegir una; y una sola", () => {
    const solicitante = { rol: "solicitante", apellido: "PRUEBA", nombres: "Dos", vinculo: "hija", email: "dos@ejemplo.test" };
    expect(errores(() => alta(datos({ personas: [TITULAR, solicitante] })))).toContainEqual({
      ruta: "personas",
      mensaje: "Marcá qué persona es el contacto (tiene que tener teléfono o correo)",
    });
    expect(
      errores(() => alta(datos({ personas: [{ ...TITULAR, esContacto: true }, { ...solicitante, esContacto: true }] }))),
    ).toContainEqual({ ruta: "personas", mensaje: "Solo una persona puede ser el contacto" });
    const v = alta(datos({ personas: [TITULAR, { ...solicitante, esContacto: true }] }));
    expect(v.personas.map((p) => [p.rol, p.esContacto, p.vinculo])).toEqual([
      ["titular", false, null],
      ["solicitante", true, "hija"],
    ]);
  });

  it("el contacto tiene que tener teléfono o correo", () => {
    expect(errores(() => alta(datos({ personas: [{ ...TITULAR, telefono: null, esContacto: true }] })))).toContainEqual({
      ruta: "personas[0].telefono",
      mensaje: "El contacto tiene que tener teléfono o correo",
    });
  });

  it("DNI, teléfono y correo con formato", () => {
    const e = errores(() => alta(datos({ personas: [{ ...TITULAR, dni: "12.345", telefono: "llamar", email: "no-es-correo" }] })));
    expect(e.map((x) => x.ruta)).toEqual(expect.arrayContaining(["personas[0].dni", "personas[0].telefono", "personas[0].email"]));
  });

  it("SPT: el titular figura fallecido sin decirlo y el solicitante es el contacto", () => {
    const ctx = contexto(RENOV_SPT_CONTADO);
    const solicitante = { rol: "solicitante", apellido: "PRUEBA", nombres: "Hija", vinculo: "hija", telefono: "381 400 0000" };
    const v = alta(datos({ personas: [{ rol: "titular", apellido: "PRUEBA", nombres: "Fallecido", fechaDefuncion: "2020-05-01" }, solicitante] }), ctx);
    expect(v.personas.map((p) => [p.rol, p.fallecido, p.fechaDefuncion, p.esContacto])).toEqual([
      ["titular", true, "2020-05-01", false],
      ["solicitante", false, null, true],
    ]);
    expect(
      errores(() => alta(datos({ personas: [{ rol: "titular", apellido: "P", nombres: "F", fallecido: false }, solicitante] }), ctx)),
    ).toContainEqual({ ruta: "personas[0].fallecido", mensaje: "Titular de la concesión (fallecido): tiene que figurar como fallecido" });
  });

  it("un fallecido no puede ser contacto ni tener fecha de defunción futura; un vivo no tiene fecha de defunción", () => {
    const ctx = contexto(NUEVA_CONC_CONTADO);
    const difunto = { rol: "difunto", apellido: "PRUEBA", nombres: "Difunto", fechaDefuncion: "2026-12-01", esContacto: true, telefono: "381 400 0000" };
    const e = errores(() => alta(datos({ tipoMonumento: "NICHO", personas: [{ ...TITULAR, fechaDefuncion: "2020-01-01" }, difunto] }), ctx));
    expect(e).toEqual(
      expect.arrayContaining([
        { ruta: "personas[0].fechaDefuncion", mensaje: "Fecha de defunción: solo si la persona falleció" },
        { ruta: "personas[1].fechaDefuncion", mensaje: "Fecha de defunción: no puede ser posterior a hoy" },
        { ruta: "personas[1].esContacto", mensaje: "Una persona fallecida no puede ser el contacto" },
      ]),
    );
  });

  it("numera dentro de cada rol", () => {
    const ctx = contexto(NUEVA_CONC_CONTADO);
    const difunto = (n: string) => ({ rol: "difunto", apellido: "PRUEBA", nombres: n });
    const v = alta(datos({ tipoMonumento: "NICHO", personas: [difunto("A"), TITULAR, difunto("B")] }), ctx);
    expect(v.personas.map((p) => `${p.rol}${p.orden}`)).toEqual(["difunto1", "titular1", "difunto2"]);
  });
});

describe("alta: ubicación, monumento, forma de pago, campos extra y documentos", () => {
  it("ubicación inválida", () => {
    expect(errores(() => alta(datos({ ubicacion: { seccion: "x", cuadro: "B" } }))).map((e) => e.ruta).sort()).toEqual([
      "ubicacion.lote",
      "ubicacion.seccion",
    ]);
  });

  it("tipo de monumento que la plantilla o el cementerio no admiten", () => {
    expect(errores(() => alta(datos({ tipoMonumento: "NICHO" }))).map((e) => e.ruta)).toEqual(["tipoMonumento"]);
    expect(errores(() => alta(datos(), { ...contexto(), tiposMonumento: [] }))[0].mensaje).toMatch(/Falta configurar el cementerio/);
  });

  it("forma de pago fija, a elegir o que no aplica", () => {
    expect(alta(datos({ formaPago: "contado" })).formaPago).toBe("contado");
    expect(errores(() => alta(datos({ formaPago: "plan_pagos" }))).map((e) => e.ruta)).toEqual(["formaPago"]);
    const aElegir = contexto({ ...RENOV_CONTADO, forma_pago: "a_elegir" });
    expect(errores(() => alta(datos(), aElegir)).map((e) => e.ruta)).toEqual(["formaPago"]);
    expect(alta(datos({ formaPago: "plan_pagos" }), aElegir).formaPago).toBe("plan_pagos");
    const noAplica = contexto({ ...RENOV_CONTADO, forma_pago: "no_aplica" });
    expect(alta(datos(), noAplica).formaPago).toBeNull();
    expect(errores(() => alta(datos({ formaPago: "contado" }), noAplica)).map((e) => e.ruta)).toEqual(["formaPago"]);
  });

  it("campos extra: tipos, vacíos fuera y claves desconocidas", () => {
    const v = alta(datos({ datosExtra: { concesion_desde: "2026-01-01", concesion_hasta: "" } }));
    expect(v.datosExtra).toEqual({ concesion_desde: "2026-01-01" });
    expect(errores(() => alta(datos({ datosExtra: { concesion_hasta: "31/12/2030", otra: "x" } }))).map((e) => e.ruta).sort()).toEqual([
      "datosExtra",
      "datosExtra.concesion_hasta",
    ]);
    const conOpciones = contexto({
      ...RENOV_CONTADO,
      campos_extra: [
        { clave: "operacion", etiqueta: "Operación", tipo: "opcion", obligatorio: false, exigir_al_salir_de: null, buscable: false, opciones: ["Inhumación", "Exhumación"] },
        { clave: "destino", etiqueta: "Destino", tipo: "cementerio", obligatorio: false, exigir_al_salir_de: null, buscable: true, opciones: null },
        { clave: "urnas", etiqueta: "Urnas", tipo: "numero", obligatorio: false, exigir_al_salir_de: null, buscable: false, opciones: null },
      ],
    });
    expect(alta(datos({ datosExtra: { operacion: "Exhumación", destino: "NORTE", urnas: "2,5" } }), conOpciones).datosExtra).toEqual({
      operacion: "Exhumación",
      destino: "NORTE",
      urnas: 2.5,
    });
    expect(
      errores(() => alta(datos({ datosExtra: { operacion: "Otra", destino: "SUR", urnas: "dos" } }), conOpciones)).map((e) => e.ruta).sort(),
    ).toEqual(["datosExtra.destino", "datosExtra.operacion", "datosExtra.urnas"]);
  });

  it("documentos recibidos: solo los de la plantilla, sin repetir", () => {
    expect(alta(datos({ documentosRecibidos: ["DNI", "DNI", "FORM_INICIO_RENOV"] })).documentosRecibidos).toEqual(["DNI", "FORM_INICIO_RENOV"]);
    expect(errores(() => alta(datos({ documentosRecibidos: ["ACTA_DEFUNCION"] }))).map((e) => e.ruta)).toEqual(["documentosRecibidos[0]"]);
  });

  it("documentos recibidos: solo los que corresponden al cementerio (Conservación: Oeste y Jardín)", () => {
    // En el Norte la Conservación pagada no se pide (a confirmar con la Dirección).
    expect(errores(() => alta(datos({ documentosRecibidos: ["CONSERVACION"] }))).map((e) => e.ruta)).toEqual(["documentosRecibidos[0]"]);
    const oeste = { ...contexto(), cementerio: { id: 3, codigo: "OESTE", camposUbicacion: OESTE } };
    expect(alta(datos({ ubicacion: { seccion: "b", lote: "7" }, documentosRecibidos: ["CONSERVACION"] }), oeste).documentosRecibidos).toEqual([
      "CONSERVACION",
    ]);
  });
});

describe("alta: nomenclatura por cementerio (docs/fuentes)", () => {
  const conCampos = (codigo: string, campos: typeof CAMPOS) => ({ ...contexto(), cementerio: { id: 3, codigo, camposUbicacion: campos } });

  it("Oeste: sección de la A a la H, en mayúsculas", () => {
    const ctx = conCampos("OESTE", OESTE);
    expect(alta(datos({ ubicacion: { seccion: " h ", lote: "012", numero: "" } }), ctx).ubicacion).toEqual({ seccion: "H", lote: "12" });
    expect(errores(() => alta(datos({ ubicacion: { seccion: "I", lote: "1" } }), ctx))).toEqual([
      { ruta: "ubicacion.seccion", mensaje: "Sección: el formato no es válido (una letra de la A a la H)" },
    ]);
    expect(errores(() => alta(datos({ ubicacion: { seccion: "3", lote: "1" } }), ctx)).map((e) => e.ruta)).toEqual(["ubicacion.seccion"]);
  });

  it("Jardín: sección en números romanos; \"iv\" y \"IV\" son la misma", () => {
    const ctx = conCampos("JARDIN_NORTE", JARDIN);
    const iv = alta(datos({ ubicacion: { seccion: "iv", lote: "3" } }), ctx).ubicacion;
    expect(iv).toEqual({ seccion: "IV", lote: "3" });
    expect(alta(datos({ ubicacion: { seccion: "IV", lote: "03" } }), ctx).ubicacion).toEqual(iv);
    for (const valida of ["I", "IX", "XI", "XIV", "XXXIX", "XL"]) {
      expect(alta(datos({ ubicacion: { seccion: valida, lote: "1" } }), ctx).ubicacion.seccion).toBe(valida);
    }
    for (const invalida of ["IIII", "VV", "XLI", "4", "A"]) {
      expect(errores(() => alta(datos({ ubicacion: { seccion: invalida, lote: "1" } }), ctx)).map((e) => e.ruta)).toEqual(["ubicacion.seccion"]);
    }
  });
});

describe("alta: persona jurídica (docs/fuentes, asociaciones con panteón)", () => {
  // CUIT ficticio de la semilla (30-99999013-0): dígito verificador válido.
  const ASOCIACION: PersonaEntrada = {
    rol: "titular",
    tipo: "juridica",
    razonSocial: "  Asociación Ficticia   de Socorros Mutuos ",
    cuit: "30-99999013-0",
    email: "asociacion@ejemplo.test",
  };

  it("razón social y CUIT, sin apellido ni DNI; puede ser el contacto", () => {
    const v = alta(datos({ personas: [ASOCIACION] }));
    expect(v.personas[0]).toMatchObject({
      tipo: "juridica",
      razonSocial: "Asociación Ficticia de Socorros Mutuos",
      cuit: "30999990130",
      apellido: null,
      nombres: null,
      dni: null,
      fallecido: false,
      esContacto: true,
    });
  });

  it("CUIT obligatorio, de 11 dígitos, con dígito verificador y prefijo de persona jurídica", () => {
    const mensaje = "CUIT: no es válido (11 dígitos, empieza con 30, 33 o 34 y el último es el verificador)";
    expect(errores(() => alta(datos({ personas: [{ ...ASOCIACION, cuit: null }] })))).toContainEqual({ ruta: "personas[0].cuit", mensaje: "CUIT: es obligatorio" });
    expect(errores(() => alta(datos({ personas: [{ ...ASOCIACION, cuit: "30-99999013-1" }] })))).toContainEqual({ ruta: "personas[0].cuit", mensaje });
    expect(errores(() => alta(datos({ personas: [{ ...ASOCIACION, cuit: "3099999013" }] })))).toContainEqual({ ruta: "personas[0].cuit", mensaje });
    // El CUIL de una persona (20-…) no es el de una asociación, aunque sea válido.
    expect(errores(() => alta(datos({ personas: [{ ...ASOCIACION, cuit: "20-30111222-3" }] })))).toContainEqual({ ruta: "personas[0].cuit", mensaje });
    expect(errores(() => alta(datos({ personas: [{ ...ASOCIACION, razonSocial: " " }] })))).toContainEqual({
      ruta: "personas[0].razonSocial",
      mensaje: "Razón social: es obligatoria",
    });
  });

  it("una jurídica no lleva apellido, DNI ni fallecimiento; una física no lleva razón social ni CUIT", () => {
    const e = errores(() => alta(datos({ personas: [{ ...ASOCIACION, apellido: "X", dni: "30111222", fallecido: true }] })));
    expect(e.map((x) => x.ruta)).toEqual(expect.arrayContaining(["personas[0].apellido", "personas[0].dni", "personas[0].fallecido"]));
    const f = errores(() => alta(datos({ personas: [{ ...TITULAR, razonSocial: "Algo", cuit: "30999990130" }] })));
    expect(f.map((x) => x.ruta)).toEqual(expect.arrayContaining(["personas[0].razonSocial", "personas[0].cuit"]));
  });

  it("solo en los roles que la admiten: no el solicitante, ni el titular fallecido de la SPT", () => {
    const solicitante: PersonaEntrada = { ...ASOCIACION, rol: "solicitante", vinculo: "apoderada", email: null };
    expect(errores(() => alta(datos({ personas: [{ ...TITULAR, esContacto: true }, solicitante] })))).toContainEqual({
      ruta: "personas[1].tipo",
      mensaje: "Solicitante: tiene que ser una persona física",
    });
    const spt = contexto(RENOV_SPT_CONTADO);
    const solicitanteSpt = { rol: "solicitante", apellido: "PRUEBA", nombres: "Dos", vinculo: "hija", email: "dos@ejemplo.test" };
    expect(errores(() => alta(datos({ personas: [{ ...ASOCIACION, email: null }, solicitanteSpt] }), spt))).toContainEqual({
      ruta: "personas[0].tipo",
      mensaje: "Titular de la concesión (fallecido): tiene que ser una persona física",
    });
  });

  it("la personería y la designación de asamblea se reciben solo si el titular es persona jurídica", () => {
    expect(alta(datos({ personas: [ASOCIACION], documentosRecibidos: ["PERSONERIA", "DESIGNACION_ASAMBLEA"] })).documentosRecibidos).toEqual([
      "PERSONERIA",
      "DESIGNACION_ASAMBLEA",
    ]);
    expect(errores(() => alta(datos({ documentosRecibidos: ["PERSONERIA"] })))).toEqual([
      {
        ruta: "documentosRecibidos",
        mensaje: "Personería jurídica de la asociación o sociedad: corresponde solo si Titular de la concesión es una persona jurídica",
      },
    ]);
  });

  it("en la edición, una persona física pasa a jurídica como versión nueva (el esquema la acepta)", () => {
    const edicion = construirEsquemaEdicion({ ...contexto(), ubicacionAnterior: {}, cargaHistorica: false });
    const v = validarCon(edicion, { personas: [{ ...ASOCIACION, id: "5" }] });
    expect(v.personas?.[0]).toMatchObject({ id: "5", tipo: "juridica", cuit: "30999990130" });
  });
});

describe("alta: fecha de inicio y carga histórica (2.13(c))", () => {
  it("normal: hasta 30 días atrás y nunca futura", () => {
    expect(alta(datos({ fechaInicio: "2026-09-20" })).fechaInicio).toBe("2026-09-20");
    expect(errores(() => alta(datos({ fechaInicio: "2026-09-19" })))[0]).toMatchObject({ ruta: "fechaInicio", mensaje: expect.stringMatching(/30 días/) });
    expect(errores(() => alta(datos({ fechaInicio: "2026-10-21" })))[0]).toMatchObject({ ruta: "fechaInicio" });
    expect(errores(() => alta(datos({ fechaInicio: "2026-02-30" })))[0]).toMatchObject({ ruta: "fechaInicio" });
  });

  it("histórica: de 1950 a hoy, con fuente", () => {
    const v = alta(datos({ fechaInicio: "2019-03-15", cargaHistorica: true, fuente: " Ficha papel " }));
    expect(v).toMatchObject({ fechaInicio: "2019-03-15", cargaHistorica: true, fuente: "Ficha papel" });
    expect(errores(() => alta(datos({ fechaInicio: "2019-03-15", cargaHistorica: true }))).map((e) => e.ruta)).toEqual(["fuente"]);
    expect(errores(() => alta(datos({ fechaInicio: "1949-12-31", cargaHistorica: true, fuente: "Ficha" }))).map((e) => e.ruta)).toEqual(["fechaInicio"]);
  });

  it("sin carga histórica la fuente no se guarda", () => {
    expect(alta(datos({ fuente: "Ficha papel" })).fuente).toBeNull();
  });
});

describe("edición", () => {
  const edicion = (d: unknown) =>
    validarCon(construirEsquemaEdicion({ ...contexto(), ubicacionAnterior: { seccion: "3", cuadro: "B", lote: "12" }, cargaHistorica: false }), d);

  it("lo que no viene no cambia; null borra", () => {
    expect(edicion({})).toEqual({});
    expect(edicion({ padron: null, observaciones: "  " })).toEqual({ padron: null, observaciones: null });
    expect(edicion({ datosExtra: { concesion_hasta: null } })).toEqual({ datosExtra: { concesion_hasta: null } });
  });

  it("personas con id; la misma persona dos veces no", () => {
    const v = edicion({ personas: [{ ...TITULAR, id: "15" }] });
    expect(v.personas?.[0]).toMatchObject({ id: "15", rol: "titular", esContacto: true });
    expect(errores(() => edicion({ personas: [{ ...TITULAR, id: "15" }, { ...TITULAR, id: "15", rol: "solicitante", vinculo: "x" }] }))).toContainEqual({
      ruta: "personas[1].id",
      mensaje: "La misma persona está dos veces",
    });
  });

  it("valida igual que el alta: fecha, ubicación, monumento", () => {
    expect(errores(() => edicion({ fechaInicio: "2019-01-01" })).map((e) => e.ruta)).toEqual(["fechaInicio"]);
    expect(errores(() => edicion({ ubicacion: { seccion: "3" }, tipoMonumento: "X" })).map((e) => e.ruta).sort()).toEqual([
      "tipoMonumento",
      "ubicacion.cuadro",
      "ubicacion.lote",
    ]);
  });

  it("en el alta no se aceptan ids de persona", () => {
    expect(errores(() => alta(datos({ personas: [{ ...TITULAR, id: "3" }] }))).map((e) => e.ruta)).toEqual(["personas[0].id"]);
  });
});

describe("erroresDe (validación en el navegador)", () => {
  it("da los mismos errores por campo que validarCon, sin tirar", () => {
    const esquema = construirEsquemaAlta(contexto());
    const malos = datos({ personas: [{ ...TITULAR, dni: "12" }], fechaInicio: "2026-13-01" });
    expect(erroresDe(esquema, malos)).toEqual(errores(() => validarCon(esquema, malos)));
    expect(erroresDe(esquema, malos).map((e) => e.ruta)).toEqual(expect.arrayContaining(["personas[0].dni", "fechaInicio"]));
  });

  it("vacío si los datos pasan", () => {
    expect(erroresDe(construirEsquemaAlta(contexto()), datos())).toEqual([]);
  });
});
