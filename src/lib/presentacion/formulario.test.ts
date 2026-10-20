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
  marcarContacto,
  puedeAgregar,
  puedeQuitar,
  valoresDesdeEdicion,
  valoresInicialesAlta,
  type ValoresFormulario,
} from "./formulario";

const HOY = "2026-10-20";
const CAMPOS = CEMENTERIOS[0].camposUbicacion;
const CLAVES = CAMPOS.map((c) => c.clave);
const TODOS = { identificatorios: true, contacto: true, extras: true };

function contexto(definicion: DefinicionPlantilla): ContextoEsquema {
  return {
    plantilla: { id: 7, definicion },
    cementerio: { id: 3, camposUbicacion: CAMPOS },
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
