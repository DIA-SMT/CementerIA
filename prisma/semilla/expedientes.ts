// Los 30 expedientes ficticios de desarrollo (docs/propuesta-mvp.md, sección 6,
// "Desarrollo local").
//
// TODOS FICTICIOS: apellidos que dicen que lo son (FICTICIO, DE PRUEBA,
// EJEMPLO…), DNI 99.999.0NN, teléfonos 0381 000-0NNN, correos @ejemplo.test
// (dominio reservado) y domicilios en "Calle Ficticia". Las personas
// jurídicas (asociaciones con panteón, semana 4) se llaman "… Ficticia …" y
// tienen CUIT 30-99999NNN-D: el dígito verificador es válido (lo exige la
// base) y el rango 30-99… no está asignado hoy a ninguna sociedad.
//
// La ubicación sigue la nomenclatura de cada cementerio (cementerios.ts): en
// el Oeste, sección A a H; en Jardín, en romanos; en el Norte, la provisoria.
// Algunas van en minúsculas o con ceros a la izquierda a propósito: el alta
// las normaliza ("iv" = "IV", "012" = "12").
//
// Se crean con la función de alta del dominio, como Mesa de Entradas (el
// usuario ficticio de la semilla), no con SQL suelto: así pasan por las mismas
// validaciones, numeración, movimiento `alta`, personas versionadas y columna
// `busqueda` que un alta real. Quedan todos en el primer paso (los pases son
// de la semana 3).
//
// IDEMPOTENTE como el resto de la semilla: cada expediente tiene un
// `comando_id` fijo y el alta, si el comando ya se usó, devuelve el expediente
// de entonces sin crear nada. Cada alta es su propia transacción (la numeración
// toma un lock por año): si la corrida se corta a la mitad, la siguiente
// completa lo que falte. Las fechas de inicio de las altas normales son
// relativas a hoy; en una segunda corrida no importan, porque la idempotencia
// se mira antes de validar.

import { conActorEn } from "../../src/lib/db/actor";
import type { Cliente } from "../../src/lib/db/crear-cliente";
import { crearServicioExpedientes, ErrorDominio } from "../../src/lib/dominio/expedientes";
import type { DatosAlta, PersonaEntrada } from "../../src/lib/dominio/expedientes/esquemas";
import { digitoVerificadorCuil } from "../../src/lib/dominio/cuil";
import { esRol, type UsuarioPermisos } from "../../src/lib/dominio/permisos";
import { hoyEnTucuman, sumarDias } from "../../src/lib/fechas";
import { USUARIOS_FICTICIOS } from "./usuarios";

/** El operador de Mesa de Entradas de la semilla: es quien da las altas. */
const CUIL_MESA = USUARIOS_FICTICIOS.find((u) => u.area === "MESA_ENTRADAS")?.cuil ?? "";

export const CANTIDAD_EXPEDIENTES_FICTICIOS = 30;

/** `comando_id` fijo del expediente ficticio n (1 a 30): es lo que hace idempotente la semilla. */
export function comandoFicticio(n: number): string {
  return `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const APELLIDOS = ["FICTICIO", "DE PRUEBA", "EJEMPLO", "SIMULADO", "INVENTADO", "IMAGINARIO", "DEMOSTRACIÓN", "ENSAYO", "MUESTRA", "PROTOTIPO"];
const NOMBRES = ["Ana", "Bruno", "Carla", "Diego", "Elena", "Fabián", "Gabriela", "Hernán", "Inés", "Julián", "Lucía", "Martín"];
const CUADROS = ["A", "B", "C", "D", "E", "F"];
const CEMENTERIOS = ["OESTE", "NORTE", "JARDIN_NORTE"] as const;
const SECCIONES_OESTE = ["A", "B", "C", "D", "E", "F", "G", "H"];
const SECCIONES_JARDIN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XIV"];
/** Los de los procedimientos (cementerios.ts); Jardín habilita solo la sepultura. */
const MONUMENTOS_OESTE_Y_NORTE = ["SEPULTURA", "SOTANITO", "CAPILLA", "MAUSOLEO", "PANTEON"];
/**
 * Los que tienen de titular una asociación con panteón (persona jurídica): una
 * renovación de contado y una con plan, los dos en el Oeste.
 */
const CON_ASOCIACION: ReadonlySet<number> = new Set([13, 22]);
const VINCULOS = ["hijo", "hija", "cónyuge", "apoderado", "nieta"];

/**
 * Plantilla de cada uno de los 30: 9 + 8 + 7 + 6, intercalados para que el
 * listado no quede agrupado.
 */
const PLANTILLAS: readonly string[] = Array.from({ length: CANTIDAD_EXPEDIENTES_FICTICIOS }, (_, i) =>
  i < 24 ? ["RENOV_CONTADO", "RENOV_PLAN", "RENOV_SPT_CONTADO", "NUEVA_CONC_CONTADO"][i % 4] : ["RENOV_CONTADO", "RENOV_PLAN", "RENOV_SPT_CONTADO", "RENOV_CONTADO", "RENOV_PLAN", "RENOV_CONTADO"][i - 24],
);

/** Los históricos: "Expediente iniciado antes del sistema", con fecha y fuente. */
const HISTORICOS: ReadonlyMap<number, string> = new Map([
  [5, "2019-03-15"],
  [14, "2015-07-01"],
  [23, "2022-11-30"],
]);

function persona(n: number, k: number, extra: Partial<PersonaEntrada> & { rol: string }): PersonaEntrada {
  const i = n * 3 + k;
  return {
    apellido: APELLIDOS[i % APELLIDOS.length],
    nombres: `${NOMBRES[i % NOMBRES.length]} Prueba`,
    dni: `99.999.${String(i).padStart(3, "0")}`,
    ...extra,
  };
}

/** CUIT ficticio de persona jurídica, 30-99999NNN-D, con dígito verificador válido. */
export function cuitFicticio(n: number): string {
  for (let k = n; ; k += 100) {
    const base = `3099999${String(k % 1000).padStart(3, "0")}`;
    const digito = digitoVerificadorCuil(base);
    if (digito !== null) return `${base}${digito}`;
  }
}

/** La ubicación según la nomenclatura del cementerio (cementerios.ts). */
function ubicacionFicticia(n: number, cementerio: string): Record<string, string> {
  // Con ceros a la izquierda a propósito: el alta los normaliza.
  const lote = String((n * 7) % 40 + 1).padStart(n % 2 === 0 ? 3 : 1, "0");
  const numero = n % 4 === 0 ? "" : String(n + 10);
  if (cementerio === "OESTE") {
    const seccion = SECCIONES_OESTE[n % SECCIONES_OESTE.length];
    return { seccion: n % 2 === 0 ? seccion.toLowerCase() : seccion, lote, numero };
  }
  if (cementerio === "JARDIN_NORTE") {
    const seccion = SECCIONES_JARDIN[n % SECCIONES_JARDIN.length];
    return { seccion: n % 2 === 0 ? seccion.toLowerCase() : seccion, lote, numero };
  }
  return { seccion: String((n % 9) + 1), cuadro: CUADROS[n % CUADROS.length], lote, numero };
}

function contacto(n: number, k: number): Partial<PersonaEntrada> {
  const i = n * 3 + k;
  return {
    telefono: `0381 000-${String(i).padStart(4, "0")}`,
    telefonoWhatsapp: i % 2 === 0,
    email: i % 3 === 0 ? `persona${i}@ejemplo.test` : null,
    domicilio: `Calle Ficticia ${100 + i}`,
  };
}

/** Los datos del expediente ficticio n (1 a 30), sin plantilla ni cementerio resueltos. */
export function datosFicticios(n: number, hoy: string): { plantilla: string; cementerio: string; datos: Omit<DatosAlta, "plantillaId" | "cementerioId"> } {
  const plantilla = PLANTILLAS[n - 1];
  const cementerio = CEMENTERIOS[(n - 1) % CEMENTERIOS.length];
  const historica = HISTORICOS.get(n);

  let personas: PersonaEntrada[];
  const jardin = cementerio === "JARDIN_NORTE";
  let tipoMonumento = jardin ? "SEPULTURA" : MONUMENTOS_OESTE_Y_NORTE[n % MONUMENTOS_OESTE_Y_NORTE.length];
  if (CON_ASOCIACION.has(n)) {
    // Una asociación con panteón; la representa (y es el contacto) quien preside.
    tipoMonumento = "PANTEON";
    personas = [
      {
        rol: "titular",
        tipo: "juridica",
        razonSocial: `Asociación Ficticia de Socorros Mutuos N° ${n}`,
        cuit: cuitFicticio(n),
        ...contacto(n, 0),
      },
      persona(n, 1, { rol: "solicitante", vinculo: "presidente de la comisión directiva", ...contacto(n, 1), esContacto: true }),
    ];
  } else if (plantilla === "RENOV_SPT_CONTADO") {
    // El titular falleció; pide un familiar, que es el contacto.
    personas = [
      persona(n, 0, { rol: "titular", fallecido: true, fechaDefuncion: n % 2 === 0 ? "2018-06-10" : null }),
      persona(n, 1, { rol: "solicitante", vinculo: VINCULOS[n % VINCULOS.length], ...contacto(n, 1), esContacto: true }),
    ];
  } else if (plantilla === "NUEVA_CONC_CONTADO") {
    tipoMonumento = jardin ? "SEPULTURA" : ["SEPULTURA", "SOTANITO", "CAPILLA"][n % 3];
    personas = [persona(n, 0, { rol: "titular", ...contacto(n, 0), esContacto: true })];
    // Algunos con difuntos a inhumar.
    for (let d = 1; d <= n % 3; d++) personas.push(persona(n, d, { rol: "difunto", fallecido: true, fechaDefuncion: "2026-09-01" }));
  } else if (n % 3 === 0) {
    // Lo pide alguien distinto del titular.
    personas = [
      persona(n, 0, { rol: "titular", ...contacto(n, 0) }),
      persona(n, 1, { rol: "solicitante", vinculo: VINCULOS[n % VINCULOS.length], ...contacto(n, 1), esContacto: true }),
    ];
  } else {
    personas = [persona(n, 0, { rol: "titular", ...contacto(n, 0), esContacto: true })];
  }

  const documentos =
    plantilla === "NUEVA_CONC_CONTADO"
      ? ["FORM_INICIO_NUEVA", "DNI", "BOLETA_SERVICIO"]
      : plantilla === "RENOV_SPT_CONTADO"
        ? ["FORM_INICIO_RENOV_SPT", "DNI", "ACTA_DEFUNCION"]
        : CON_ASOCIACION.has(n)
          ? ["FORM_INICIO_RENOV", "PERSONERIA", "DNI"]
          : ["FORM_INICIO_RENOV", "DNI", "BOLETA_SERVICIO"];

  return {
    plantilla,
    cementerio,
    datos: {
      tipoMonumento,
      ubicacion: ubicacionFicticia(n, cementerio),
      padron: `PF-${String(n).padStart(4, "0")}`,
      numeroMunicipal: n % 2 === 0 ? `${1000 + n}/${historica ? historica.slice(0, 4) : "2026"}` : null,
      personas,
      datosExtra:
        plantilla === "NUEVA_CONC_CONTADO" ? { resolucion_caducidad: `Res. ficticia ${n}/2025`, expediente_caducidad: `EF-${n}/2024` } : {},
      // Los documentos recibidos varían: uno sí, otro no.
      documentosRecibidos: n % 2 === 0 ? documentos : documentos.slice(0, 1),
      observaciones: n % 5 === 0 ? "Expediente ficticio de desarrollo." : null,
      fechaInicio: historica ?? sumarDias(hoy, -(n % 25)),
      cargaHistorica: historica !== undefined,
      fuente: historica !== undefined ? "Ficha papel (ficticia)" : null,
    },
  };
}

export interface ResumenExpedientesFicticios {
  creados: number;
  /** Ya estaban (comando ya usado). */
  existentes: number;
  numeros: string[];
}

/**
 * Crea los 30 expedientes ficticios que falten. Necesita la semilla base
 * (catálogos, plantillas y el usuario de Mesa de Entradas).
 */
export async function sembrarExpedientes(cliente: Cliente, opciones: { ahora?: Date } = {}): Promise<ResumenExpedientesFicticios> {
  const fila = await cliente.usuario.findUnique({
    where: { cuil: CUIL_MESA },
    select: { id: true, rol: true, activo: true, area: { select: { id: true, codigo: true } } },
  });
  if (!fila || !esRol(fila.rol)) {
    throw new Error("Falta el usuario ficticio de Mesa de Entradas: los expedientes ficticios van después de la semilla con usuarios ficticios");
  }
  const mesa: UsuarioPermisos = { id: fila.id, rol: fila.rol, activo: fila.activo, area: fila.area };
  const ahora = opciones.ahora ?? new Date();
  const servicio = crearServicioExpedientes({
    leer: cliente,
    escribir: (usuarioId, motivo, fn) => conActorEn(cliente, usuarioId, motivo, fn),
    ahora: () => ahora,
  });

  const [plantillas, cementerios] = await Promise.all([
    cliente.plantilla.findMany({ where: { estado: "publicada" }, select: { id: true, codigo: true } }),
    cliente.cementerio.findMany({ select: { id: true, codigo: true } }),
  ]);
  const idPlantilla = new Map(plantillas.map((p) => [p.codigo, p.id]));
  const idCementerio = new Map(cementerios.map((c) => [c.codigo, c.id]));
  const hoy = hoyEnTucuman(ahora);

  const resumen: ResumenExpedientesFicticios = { creados: 0, existentes: 0, numeros: [] };
  for (let n = 1; n <= CANTIDAD_EXPEDIENTES_FICTICIOS; n++) {
    const { plantilla, cementerio, datos } = datosFicticios(n, hoy);
    const plantillaId = idPlantilla.get(plantilla);
    const cementerioId = idCementerio.get(cementerio);
    if (plantillaId === undefined || cementerioId === undefined) {
      throw new Error(`Falta la plantilla ${plantilla} publicada o el cementerio ${cementerio}: corré primero la semilla base`);
    }
    let r;
    try {
      r = await servicio.alta(mesa, { ...datos, plantillaId, cementerioId }, comandoFicticio(n));
    } catch (e) {
      // Con el detalle por campo: sin él, "Revisá los datos marcados" no dice qué.
      const detalle = e instanceof ErrorDominio ? e.errores.map((x) => `
  - ${x.ruta}: ${x.mensaje}`).join("") : "";
      throw new Error(`Expediente ficticio ${n} (${plantilla}): ${e instanceof Error ? e.message : String(e)}${detalle}`, { cause: e });
    }
    if (r.repetido) resumen.existentes += 1;
    else resumen.creados += 1;
    resumen.numeros.push(r.numero);
  }
  return resumen;
}
