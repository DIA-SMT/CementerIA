// Las dos plantillas de inhumación (procedimiento de la Dirección del
// 27/10/2026, docs/fuentes/procedimiento-inhumacion.docx) contra la base real y
// con la semilla: una inhumación de cada tipo en el Jardín y en el Oeste, del
// alta al archivo, solo con las funciones del dominio y cada paso hecho por el
// área responsable. La apertura se cobra solo en el Jardín.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorDominio, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { hoyEnTucuman, sumarDias } from "@/lib/fechas";
import { asegurarSemilla, avanzar, comando, cuitUnico, datosAlta, dniUnico, proyeccion, responsable, servicio, titular, unicoLetras, usuario } from "./dominio";
import { clientePrisma } from "./helper";

const prisma = clientePrisma();
const exp: ServicioExpedientes = servicio(prisma);
let mesa: UsuarioPermisos;

beforeAll(async () => {
  await asegurarSemilla(prisma);
  mesa = await usuario(prisma, "MESA_ENTRADAS");
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

/** El difunto a inhumar, ficticio: falleció ayer. */
function difunto() {
  return {
    rol: "difunto",
    apellido: unicoLetras("FICTICIO "),
    nombres: "Difunto Prueba",
    dni: dniUnico(),
    fallecido: true,
    fechaDefuncion: sumarDias(hoyEnTucuman(), -1),
  };
}

const MESA_COMUN = ["MESA_CARATULA", "MESA_CONCESION_VIGENTE", "MESA_CONSERVACION"];
const DOCUMENTOS_MESA = ["CONST_COMPUTOS", "ESTADO_CUENTA", "DNI", "CONST_INHUMAR"];

interface Caso {
  plantilla: "INHUMACION_DIRECCION" | "INHUMACION_EMPRESA";
  cementerio: "JARDIN_NORTE" | "OESTE";
  area: string;
  conceptos: string[];
  /** Los pasos, en orden, con lo que falta para salir de cada uno. */
  pasos: Array<{ clave: string; faltan: string[] }>;
}

const CASOS: Caso[] = [
  {
    plantilla: "INHUMACION_DIRECCION",
    cementerio: "JARDIN_NORTE",
    area: "CEM_JARDIN_NORTE",
    conceptos: ["DERECHO_OFICINA", "APERTURA", "INHUMACION", "CONDUCCION"],
    pasos: [
      { clave: "MESA", faltan: [...MESA_COMUN, ...DOCUMENTOS_MESA] },
      { clave: "LIQUIDACION", faltan: ["LIQ_DEBITOS", "LIQ_BOLETA_JARDIN", "LIQ_PAGO", "COMPROBANTE_PAGO"] },
      { clave: "CEMENTERIO", faltan: ["CEM_REALIZADA", "CEM_DEVUELTO"] },
      { clave: "CONOCIMIENTO", faltan: ["DIR_CONOCIMIENTO"] },
    ],
  },
  {
    plantilla: "INHUMACION_DIRECCION",
    cementerio: "OESTE",
    area: "CEM_OESTE",
    conceptos: ["DERECHO_OFICINA", "INHUMACION", "CONDUCCION"],
    pasos: [
      { clave: "MESA", faltan: [...MESA_COMUN, ...DOCUMENTOS_MESA] },
      { clave: "LIQUIDACION", faltan: ["LIQ_DEBITOS", "LIQ_BOLETA", "LIQ_PAGO", "COMPROBANTE_PAGO"] },
      { clave: "CEMENTERIO", faltan: ["CEM_REALIZADA", "CEM_DEVUELTO"] },
      { clave: "CONOCIMIENTO", faltan: ["DIR_CONOCIMIENTO"] },
    ],
  },
  // La empresa fúnebre paga todo: sin conceptos ni Liquidación, en los dos cementerios.
  ...(["JARDIN_NORTE", "OESTE"] as const).map(
    (cementerio): Caso => ({
      plantilla: "INHUMACION_EMPRESA",
      cementerio,
      area: cementerio === "OESTE" ? "CEM_OESTE" : "CEM_JARDIN_NORTE",
      conceptos: [],
      pasos: [
        { clave: "MESA", faltan: [...MESA_COMUN, "MESA_HORARIO", ...DOCUMENTOS_MESA] },
        // Los comprobantes de la empresa no son obligatorios: no frenan el pase.
        { clave: "CEMENTERIO", faltan: ["CEM_COMPROBANTES", "CEM_REALIZADA", "CEM_INFORMADO"] },
        { clave: "CONOCIMIENTO", faltan: ["DIR_CONOCIMIENTO"] },
      ],
    }),
  ),
];

describe("inhumación: del alta al archivo con el dominio", () => {
  it.each(CASOS.map((c) => [c.plantilla, c.cementerio, c] as const))("%s en %s", async (_, __, caso) => {
    const alta = await exp.alta(
      mesa,
      await datosAlta(prisma, { plantilla: caso.plantilla, cementerio: caso.cementerio, tipoMonumento: "SEPULTURA", personas: [titular(), difunto()] }),
      comando(),
    );

    // El titular es el único vivo: queda como contacto sin marcarlo.
    const personas = await prisma.expedientePersona.findMany({ where: { expediente: { numeroInterno: alta.numero } }, orderBy: { rol: "asc" } });
    expect(personas.map((p) => [p.rol, p.fallecido, p.esContacto])).toEqual([
      ["difunto", true, false],
      ["titular", false, true],
    ]);

    const ficha = await exp.obtenerFicha(mesa, alta.numero);
    expect(ficha.conceptos.map((c) => c.clave)).toEqual(caso.conceptos);
    expect(ficha.recorrido.map((p) => p.clave)).toEqual(caso.pasos.map((p) => p.clave));

    for (const [i, paso] of caso.pasos.entries()) {
      const e = await proyeccion(prisma, alta.numero);
      expect(e.pasoClave).toBe(paso.clave);
      const quien = await responsable(prisma, alta.numero);
      if (paso.clave === "CEMENTERIO") {
        // Afuera, en el cementerio del expediente, y lo sigue Mesa de Entradas (custodia).
        expect([e.areaActual.codigo, e.areaResponsable.codigo, e.recibidoEn !== null]).toEqual([caso.area, "MESA_ENTRADAS", true]);
      }
      // En el último paso no hay pase: lo que falta es lo de concluir.
      const ultimo = i === caso.pasos.length - 1;
      const faltan = ultimo ? (await exp.obtenerFicha(quien, alta.numero)).concluir.faltan : (await exp.validarPase(quien, alta.numero)).faltan;
      expect({ paso: paso.clave, faltan: faltan.map((f) => f.clave) }).toEqual({ paso: paso.clave, faltan: paso.faltan });
      if (!ultimo) await avanzar(exp, prisma, alta.numero);
    }

    // Conocimiento y archivo: lo da Mesa de Entradas desde el cementerio, así
    // que llega recibido. Mesa tilda el conocimiento, concluye y archiva.
    const final = await proyeccion(prisma, alta.numero);
    expect([final.areaActual.codigo, final.recibidoEn !== null]).toEqual(["MESA_ENTRADAS", true]);
    const sinTildar = await errorDe(exp.concluir(mesa, alta.numero, final.version, comando()));
    expect(sinTildar.codigo).toBe("faltan_requisitos");
    const { version } = await exp.tildarSubtarea(mesa, alta.numero, "DIR_CONOCIMIENTO", null, final.version, comando());
    const c = await exp.concluir(mesa, alta.numero, version, comando());
    expect(c.estado).toBe("concluido");
    const a = await exp.archivar(mesa, alta.numero, "Archivo de la Dirección · Caja de inhumaciones (prueba)", c.version, comando());
    expect(a).toMatchObject({ estado: "archivado", estadoPrevio: "concluido" });
  });

  it("el difunto es obligatorio, y la plantilla no admite panteón ni persona jurídica", async () => {
    const sinDifunto = await errorDe(
      exp.alta(mesa, await datosAlta(prisma, { plantilla: "INHUMACION_DIRECCION", cementerio: "OESTE", personas: [titular()] }), comando()),
    );
    expect(sinDifunto.codigo).toBe("validacion");
    const panteon = await errorDe(
      exp.alta(
        mesa,
        await datosAlta(prisma, { plantilla: "INHUMACION_EMPRESA", cementerio: "OESTE", tipoMonumento: "PANTEON", personas: [titular(), difunto()] }),
        comando(),
      ),
    );
    expect(panteon.errores.map((e) => e.ruta)).toContain("tipoMonumento");
    const juridica = await errorDe(
      exp.alta(
        mesa,
        await datosAlta(prisma, {
          plantilla: "INHUMACION_DIRECCION",
          cementerio: "OESTE",
          personas: [{ rol: "titular", tipo: "juridica", razonSocial: "Asociación Ficticia de Prueba", cuit: cuitUnico(), telefono: "0381 000-7777" }, difunto()],
        }),
        comando(),
      ),
    );
    expect(juridica.errores.map((e) => e.ruta)).toContain("personas[0].tipo");
  });

  it("en Jardín solo se puede elegir la sepultura (lo habilita el cementerio)", async () => {
    const opciones = await exp.opcionesAlta();
    const plantilla = opciones.plantillas.find((p) => p.codigo === "INHUMACION_DIRECCION");
    const jardin = opciones.cementerios.find((c) => c.codigo === "JARDIN_NORTE");
    const oeste = opciones.cementerios.find((c) => c.codigo === "OESTE");
    expect(plantilla).toMatchObject({ tipoTramite: { codigo: "INHUMACION" }, formaPago: "no_aplica" });
    if (!plantilla || !jardin || !oeste) throw new Error("falta la plantilla o un cementerio");
    expect((await exp.contextoAlta(mesa, plantilla.id, jardin.id)).tiposMonumento.map((t) => t.codigo)).toEqual(["SEPULTURA"]);
    expect((await exp.contextoAlta(mesa, plantilla.id, oeste.id)).tiposMonumento.map((t) => t.codigo).sort()).toEqual(
      ["CAPILLA", "MAUSOLEO", "SEPULTURA", "SOTANITO"],
    );
  });
});
