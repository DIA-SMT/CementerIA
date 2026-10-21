import { describe, expect, it } from "vitest";
import { CEMENTERIOS } from "../../../prisma/semilla/cementerios";
import { NUEVA_CONC_CONTADO } from "../../../prisma/semilla/plantillas/nueva-conc-contado";
import { RENOV_CONTADO } from "../../../prisma/semilla/plantillas/renov-contado";
import { construirEsquemaAlta, construirEsquemaEdicion, erroresDe, type ContextoEsquema } from "@/lib/dominio/expedientes/esquemas";
import type { DefinicionPlantilla } from "@/lib/dominio/plantillas/esquema";
import {
  agregarPersona,
  cambiaIdentificatorios,
  cambiosEdicionDesde,
  datosAltaDesde,
  datosAltaVinculado,
  documentosDelAlta,
  marcarContacto,
  puedeAgregar,
  puedeQuitar,
  valoresDesdeEdicion,
  valoresDesdePrecarga,
  valoresInicialesAlta,
  type DatosPrecarga,
  type ValoresFormulario,
} from "./formulario";

const HOY = "2026-10-20";
// El Norte: conserva la nomenclatura provisoria (sección, cuadro, lote y número).
const CAMPOS = CEMENTERIOS.find((c) => c.codigo === "NORTE")?.camposUbicacion ?? [];
const CLAVES = CAMPOS.map((c) => c.clave);
const TODOS = { identificatorios: true, contacto: true, extras: true };

function contexto(definicion: DefinicionPlantilla): ContextoEsquema {
  return {
    plantilla: { id: 7, definicion },
    cementerio: { id: 3, codigo: "NORTE", camposUbicacion: CAMPOS },
    tiposMonumento: ["SOTANITO", "SEPULTURA", "NICHO"],
    cementerios: ["OESTE", "NORTE"],
    hoy: HOY,
  };
}

function conversion(definicion: DefinicionPlantilla) {
  return { plantillaId: 7, cementerioId: 3, definicion, clavesUbicacion: CLAVES };
}

/** Un alta de RENOV_CONTADO como la cargaría alguien en el mostrador. */
function altaCargada(): ValoresFormulario {
  const v = valoresInicialesAlta(RENOV_CONTADO, { hoy: HOY, tiposMonumento: ["SEPULTURA", "NICHO"] });
  v.tipoMonumento = "SEPULTURA";
  v.ubicacion = { seccion: "03", cuadro: "b", lote: "12", numero: "" };
  v.padron = "  ";
  v.numeroMunicipal = "12.345/2026";
  v.personas[0] = { ...v.personas[0], apellido: "FICTICIO", nombres: "Uno", dni: "90.000.001", telefono: "0381 000-0001", telefonoWhatsapp: true, email: "", domicilio: "Calle Ficticia 1", esContacto: true };
  v.datosExtra = { concesion_hasta: "2031-10-20", concesion_desde: "" };
  v.documentosRecibidos = ["DNI", "NO_EXISTE"];
  return v;
}

describe("valores iniciales del alta", () => {
  it("cada rol con su mínimo de personas, hoy como fecha y el monumento si hay uno solo", () => {
    const v = valoresInicialesAlta(NUEVA_CONC_CONTADO, { hoy: HOY, tiposMonumento: ["NICHO"] });
    expect(v.personas.map((p) => p.rol)).toEqual(["titular"]);
    expect(v.fechaInicio).toBe(HOY);
    expect(v.tipoMonumento).toBe("NICHO");
    expect(valoresInicialesAlta(RENOV_CONTADO, { hoy: HOY, tiposMonumento: ["NICHO", "SEPULTURA"] }).tipoMonumento).toBe("");
  });
});

describe("personas", () => {
  it("agregar respeta el orden de los roles de la plantilla y el máximo", () => {
    const def = NUEVA_CONC_CONTADO;
    const [titular, solicitante, difunto] = def.personas;
    let personas = valoresInicialesAlta(def, { hoy: HOY, tiposMonumento: [] }).personas;
    personas = agregarPersona(def, personas, difunto, "d1");
    personas = agregarPersona(def, personas, solicitante, "s1");
    personas = agregarPersona(def, personas, difunto, "d2");
    expect(personas.map((p) => p.rol)).toEqual(["titular", "solicitante", "difunto", "difunto"]);
    expect(personas.find((p) => p.clave === "d1")?.fallecido).toBe(true);
    expect(puedeAgregar(solicitante, personas)).toBe(false);
    expect(puedeQuitar(titular, personas)).toBe(false);
    expect(puedeQuitar(difunto, personas)).toBe(true);
  });

  it("solo una persona es el contacto", () => {
    const def = RENOV_CONTADO;
    let personas = agregarPersona(def, valoresInicialesAlta(def, { hoy: HOY, tiposMonumento: [] }).personas, def.personas[1], "s");
    personas = marcarContacto(personas, personas[0].clave, true);
    personas = marcarContacto(personas, "s", true);
    expect(personas.map((p) => p.esContacto)).toEqual([false, true]);
    expect(marcarContacto(personas, "s", false).map((p) => p.esContacto)).toEqual([false, false]);
  });
});

describe("persona jurídica (docs/fuentes)", () => {
  it("viaja con razón social y CUIT, sin lo que quedó cargado como persona física", () => {
    const v = altaCargada();
    v.personas[0] = { ...v.personas[0], tipo: "juridica", razonSocial: "Asociación Ficticia", cuit: "30-99999013-0", email: "a@ejemplo.test" };
    const datos = datosAltaDesde(v, conversion(RENOV_CONTADO));
    expect(datos.personas[0]).toMatchObject({ tipo: "juridica", razonSocial: "Asociación Ficticia", cuit: "30-99999013-0", fallecido: false });
    expect(datos.personas[0]).not.toHaveProperty("apellido");
    expect(datos.personas[0]).not.toHaveProperty("dni");
    expect(erroresDe(construirEsquemaAlta(contexto(RENOV_CONTADO)), datos)).toEqual([]);
  });

  it("en un rol que no la admite va como física", () => {
    const v = altaCargada();
    v.personas.push({ ...v.personas[0], clave: "s", rol: "solicitante", tipo: "juridica", razonSocial: "X", esContacto: false, vinculo: "hijo" });
    expect(datosAltaDesde(v, conversion(RENOV_CONTADO)).personas[1]).toMatchObject({ tipo: "fisica", apellido: "FICTICIO" });
  });

  it("la personería y la designación de asamblea aparecen al elegir persona jurídica, y si se vuelve a física no viajan", () => {
    const v = altaCargada();
    const claves = () => documentosDelAlta(RENOV_CONTADO, v.personas).map((d) => d.clave);
    expect(claves()).not.toContain("PERSONERIA");
    v.personas[0] = { ...v.personas[0], tipo: "juridica" };
    expect(claves()).toEqual(expect.arrayContaining(["PERSONERIA", "DESIGNACION_ASAMBLEA"]));
    v.documentosRecibidos = ["DNI", "PERSONERIA"];
    v.personas[0] = { ...v.personas[0], tipo: "fisica" };
    expect(datosAltaDesde(v, conversion(RENOV_CONTADO)).documentosRecibidos).toEqual(["DNI"]);
  });

  it("pasar de física a jurídica en la edición es un cambio identificatorio", () => {
    const original = valoresDesdeEdicion({
      tipoMonumento: "PANTEON",
      ubicacion: { seccion: "3", cuadro: "B", lote: "12" },
      padron: null,
      numeroMunicipal: null,
      fechaInicio: "2026-10-15",
      observaciones: null,
      datosExtra: {},
      personas: [{ id: "10", rol: "titular", apellido: "FICTICIO", nombres: "Uno", email: "a@ejemplo.test", esContacto: true }],
    });
    const actual = structuredClone(original);
    actual.personas[0] = { ...actual.personas[0], tipo: "juridica", razonSocial: "Asociación Ficticia", cuit: "30999990130" };
    expect(cambiaIdentificatorios(original, actual, RENOV_CONTADO, CLAVES)).toBe(true);
    expect(cambiosEdicionDesde(original, actual, RENOV_CONTADO, CLAVES, TODOS).personas?.[0]).toMatchObject({ id: "10", tipo: "juridica" });
  });
});

describe("alta: valores → DatosAlta", () => {
  it("vacío pasa a null, se descarta lo que la plantilla no pide y pasa el esquema del dominio", () => {
    const datos = datosAltaDesde(altaCargada(), conversion(RENOV_CONTADO));
    expect(datos).toMatchObject({
      plantillaId: 7,
      cementerioId: 3,
      ubicacion: { seccion: "03", cuadro: "b", lote: "12", numero: null },
      padron: null,
      numeroMunicipal: "12.345/2026",
      formaPago: null,
      datosExtra: { concesion_hasta: "2031-10-20" },
      documentosRecibidos: ["DNI"],
      fuente: null,
    });
    expect(datos.personas[0]).toMatchObject({ rol: "titular", fallecido: false, vinculo: null, email: null, telefonoWhatsapp: true, esContacto: true });
    expect(datos.personas[0]).not.toHaveProperty("id");
    expect(erroresDe(construirEsquemaAlta(contexto(RENOV_CONTADO)), datos)).toEqual([]);
  });

  it("WhatsApp sin teléfono no viaja; la fuente solo con carga histórica", () => {
    const v = altaCargada();
    v.personas[0].telefono = "";
    v.personas[0].email = "uno@ejemplo.test";
    v.fuente = "Ficha papel";
    const datos = datosAltaDesde(v, conversion(RENOV_CONTADO));
    expect(datos.personas[0].telefonoWhatsapp).toBe(false);
    expect(datos.fuente).toBeNull();
    expect(datosAltaDesde({ ...v, cargaHistorica: true }, conversion(RENOV_CONTADO)).fuente).toBe("Ficha papel");
  });

  it("forma de pago solo si la plantilla dice a_elegir", () => {
    const aElegir: DefinicionPlantilla = { ...RENOV_CONTADO, forma_pago: "a_elegir" };
    expect(datosAltaDesde({ ...altaCargada(), formaPago: "plan_pagos" }, conversion(aElegir)).formaPago).toBe("plan_pagos");
    expect(datosAltaDesde({ ...altaCargada(), formaPago: "" }, conversion(aElegir)).formaPago).toBeNull();
    expect(datosAltaDesde({ ...altaCargada(), formaPago: "plan_pagos" }, conversion(RENOV_CONTADO)).formaPago).toBeNull();
  });

  it("los errores del esquema llevan la ruta del campo del formulario", () => {
    const v = altaCargada();
    v.personas[0].dni = "12";
    v.ubicacion.lote = "";
    const rutas = erroresDe(construirEsquemaAlta(contexto(RENOV_CONTADO)), datosAltaDesde(v, conversion(RENOV_CONTADO))).map((e) => e.ruta);
    expect(rutas).toEqual(expect.arrayContaining(["personas[0].dni", "ubicacion.lote"]));
  });
});

describe("edición: solo viaja lo que cambió", () => {
  const actuales = {
    tipoMonumento: "SEPULTURA",
    ubicacion: { seccion: "3", cuadro: "B", lote: "12", viejo: "X" },
    padron: "PAD-1",
    numeroMunicipal: null,
    fechaInicio: "2026-10-15",
    observaciones: "Nada",
    datosExtra: { concesion_hasta: "2031-10-20" },
    personas: [
      { id: "10", rol: "titular", apellido: "FICTICIO", nombres: "Uno", dni: "90000001", fallecido: false, fechaDefuncion: null, vinculo: null, telefono: "0381 000-0001", telefonoWhatsapp: true, email: null, domicilio: null, esContacto: true },
    ],
  };
  const original = valoresDesdeEdicion(actuales);
  const ctxEdicion = { ...contexto(RENOV_CONTADO), ubicacionAnterior: actuales.ubicacion, cargaHistorica: false };

  it("sin tocar nada no hay cambios", () => {
    expect(cambiosEdicionDesde(original, valoresDesdeEdicion(actuales), RENOV_CONTADO, CLAVES, TODOS)).toEqual({});
    expect(cambiaIdentificatorios(original, valoresDesdeEdicion(actuales), RENOV_CONTADO, CLAVES)).toBe(false);
  });

  it("contacto: van las personas completas, con su id; no es identificatorio", () => {
    const actual = valoresDesdeEdicion(actuales);
    actual.personas[0].telefono = "0381 000-9999";
    actual.observaciones = "Llamar a la tarde";
    const c = cambiosEdicionDesde(original, actual, RENOV_CONTADO, CLAVES, TODOS);
    expect(c).toEqual({
      observaciones: "Llamar a la tarde",
      personas: [expect.objectContaining({ id: "10", telefono: "0381 000-9999", apellido: "FICTICIO" })],
    });
    expect(cambiaIdentificatorios(original, actual, RENOV_CONTADO, CLAVES)).toBe(false);
    expect(erroresDe(construirEsquemaEdicion(ctxEdicion), c)).toEqual([]);
  });

  it("identificatorios: ubicación completa (solo campos activos), padrón borrado, persona nueva", () => {
    const actual = valoresDesdeEdicion(actuales);
    actual.ubicacion.lote = "13";
    actual.padron = "";
    actual.personas.push({ ...actual.personas[0], clave: "nueva", id: null, rol: "solicitante", apellido: "OTRA", vinculo: "hija", esContacto: false });
    const c = cambiosEdicionDesde(original, actual, RENOV_CONTADO, CLAVES, TODOS);
    expect(c.ubicacion).toEqual({ seccion: "3", cuadro: "B", lote: "13", numero: null });
    expect(c.padron).toBeNull();
    expect(c.personas?.map((p) => p.id)).toEqual(["10", null]);
    expect(cambiaIdentificatorios(original, actual, RENOV_CONTADO, CLAVES)).toBe(true);
  });

  it("campos extra: solo las claves que cambian; vacío borra", () => {
    const actual = valoresDesdeEdicion(actuales);
    actual.datosExtra = { concesion_hasta: "", concesion_desde: "2026-10-20" };
    expect(cambiosEdicionDesde(original, actual, RENOV_CONTADO, CLAVES, TODOS).datosExtra).toEqual({ concesion_hasta: null, concesion_desde: "2026-10-20" });
  });

  it("lo que el usuario no puede editar no viaja", () => {
    const actual = valoresDesdeEdicion(actuales);
    actual.padron = "OTRO";
    actual.personas[0].apellido = "CAMBIADO";
    actual.datosExtra = { concesion_hasta: "" };
    actual.observaciones = "Otra cosa";
    expect(cambiosEdicionDesde(original, actual, RENOV_CONTADO, CLAVES, { identificatorios: false, contacto: true, extras: false })).toEqual({
      observaciones: "Otra cosa",
    });
  });
});

describe("semana 4: alta precargada desde otro expediente (?desde=, archivar y abrir vinculado)", () => {
  const PRECARGA: DatosPrecarga = {
    cementerioId: 3,
    tipoMonumento: "SOTANITO",
    ubicacion: { seccion: "3", cuadro: "B", lote: "12", numero: null, viejo: "x" },
    padron: "P-1",
    numeroMunicipal: "12.345/2026",
    formaPago: "contado",
    personas: [
      { rol: "titular", tipo: "fisica", apellido: "FICTICIO", nombres: "Uno", dni: "90000001", fallecido: false, telefono: "0381 000-0001", esContacto: true },
      { rol: "solicitante", tipo: "fisica", apellido: "OTRA", nombres: "Dos", dni: "90000002", fallecido: false, vinculo: "hija", esContacto: false },
      { rol: "difunto", tipo: "fisica", apellido: "DIFUNTO", nombres: "Tres", dni: null, fallecido: true, fechaDefuncion: "2020-01-01" },
    ],
    datosExtra: { concesion_hasta: "2036-10-20", no_existe: "x" },
    observaciones: "Del expediente anterior",
  };
  const opciones = { hoy: HOY, tiposMonumento: ["SEPULTURA", "NICHO"], clavesUbicacion: CLAVES, etiquetasRoles: { difunto: "Difunto a inhumar" } };

  it("acomoda las personas a la plantilla nueva: los roles que no tiene no pasan", () => {
    const r = valoresDesdePrecarga(PRECARGA, RENOV_CONTADO, opciones);
    expect(r.valores.personas.map((p) => [p.rol, p.apellido, p.esContacto])).toEqual([
      ["titular", "FICTICIO", true],
      ["solicitante", "OTRA", false],
    ]);
    expect(r.rolesQueNoPasan).toEqual(["Difunto a inhumar"]);
    expect(r.personasDeMas).toBe(0);
    expect(r.valores.personas.every((p) => p.id === null)).toBe(true);
  });

  it("deja afuera lo que la plantilla o el cementerio no piden; hoy como fecha, sin documentos recibidos", () => {
    const { valores } = valoresDesdePrecarga(PRECARGA, RENOV_CONTADO, opciones);
    expect(valores.tipoMonumento).toBe("");
    expect(valores.ubicacion).toEqual({ seccion: "3", cuadro: "B", lote: "12" });
    expect(valores.datosExtra).toEqual({ concesion_hasta: "2036-10-20" });
    expect(valores.formaPago).toBe("");
    expect(valores).toMatchObject({ padron: "P-1", numeroMunicipal: "12.345/2026", observaciones: "Del expediente anterior", fechaInicio: HOY, documentosRecibidos: [], cargaHistorica: false });
  });

  it("cada rol completa su mínimo y respeta su máximo", () => {
    const dosTitulares: DatosPrecarga = { ...PRECARGA, personas: [PRECARGA.personas[1]] };
    const r = valoresDesdePrecarga(dosTitulares, RENOV_CONTADO, opciones);
    expect(r.valores.personas.map((p) => [p.rol, p.apellido])).toEqual([
      ["titular", ""],
      ["solicitante", "OTRA"],
    ]);
    const deMas: DatosPrecarga = { ...PRECARGA, personas: [PRECARGA.personas[0], { ...PRECARGA.personas[0], dni: "90000009", esContacto: false }] };
    expect(valoresDesdePrecarga(deMas, RENOV_CONTADO, opciones).personasDeMas).toBe(RENOV_CONTADO.personas[0].max === 1 ? 1 : 0);
  });

  it("el alta del vinculado pasa la validación del alta (con un tipo de monumento que la plantilla nueva tiene)", () => {
    const datos = datosAltaVinculado({ ...PRECARGA, tipoMonumento: "SEPULTURA" }, { plantillaId: 7, definicion: RENOV_CONTADO, ...opciones });
    expect(datos).toMatchObject({ plantillaId: 7, cementerioId: 3, tipoMonumento: "SEPULTURA", fechaInicio: HOY });
    expect(datos).not.toHaveProperty("expedienteAnteriorId");
    expect(datos.personas.map((p) => p.rol)).toEqual(["titular", "solicitante"]);
    expect(erroresDe(construirEsquemaAlta(contexto(RENOV_CONTADO)), datos)).toEqual([]);
  });
});
