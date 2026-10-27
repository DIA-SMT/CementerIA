// e) y f) INHUMACION_DIRECCION e INHUMACION_EMPRESA: Inhumación en un monumento
// del concesionario (procedimiento de la Dirección del 27/10/2026,
// docs/fuentes/procedimiento-inhumacion.docx; resumen en docs/fuentes/README.md).
//
// El procedimiento tiene dos circuitos según quién paga:
// (A) el concesionario paga en la Dirección: Mesa de Entradas verifica y junta
//     la documentación, Liquidación emite la boleta y verifica el pago, el
//     expediente va al cementerio, que inhuma, lo informa y lo devuelve a la
//     Dirección "para conocimiento y archivo";
// (B) paga la empresa fúnebre (según el plan de sepelio): la Dirección solo
//     verifica la concesión y la Conservación e informa al cementerio el
//     horario; el concesionario presenta los comprobantes en el cementerio, que
//     inhuma y le informa a la Dirección.
//
// Son dos plantillas y no una con `forma_pago: a_elegir`, porque cambia el
// recorrido (B no pasa por Liquidación) y no solo quién paga.
//
// Marcas: [F] lo dice el procedimiento; [I] lo supusimos; [C] a confirmar con
// la Dirección (docs/taller-plantillas.md, plantillas E y F). Todos los
// dias_alerta son [I]: la inhumación se hace en uno o dos días (pregunta DA-2).
//
// Lo que el modelo de plantillas NO puede decir, y cómo quedó:
// - Una vía de pago "la paga la empresa fúnebre": `conceptos[].via` admite solo
//   `boleta` y `plan_dim`. En (B) los conceptos van en las instrucciones de los
//   pasos y la plantilla no lleva `conceptos` (pendiente; pregunta F-4).
// - La fecha de defunción obligatoria: el esquema no tiene cómo exigirla. El
//   alta la pide (el difunto es siempre fallecido) pero no la exige.
// - El "contacto por defecto": no es parte de la definición; el alta marca
//   sola a la única persona viva con teléfono o correo (el titular, si no hay
//   solicitante) y, si hay dos, pide elegir.

import type { DefinicionPlantilla, DocumentoPlantilla, PasoPlantilla, PersonaPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import {
  CONCEPTO,
  DOC,
  INSTRUCCIONES_BOLETA,
  JARDIN,
  SOLICITANTE_OPCIONAL,
  SUB,
  conFecha,
  conTextoOpcional,
  concepto,
  documento,
  exceptoEn,
  obligatoria,
  paso,
  soloEn,
} from "./comun";

/** Notas de la v1 de las dos plantillas de inhumación. */
export const NOTAS_INHUMACION =
  "Carga inicial, a validar. Según el procedimiento de inhumación de la Dirección (docs/fuentes/procedimiento-inhumacion.docx, 27/10/2026).";

/**
 * [F] "sotanito, capilla, mausoleo o sepultura" (el orden del procedimiento).
 * Cada cementerio habilita los suyos: en Jardín queda solo la sepultura.
 * [C] El panteón no está en el procedimiento (pregunta E-3): si se agrega, el
 * titular tiene que admitir persona jurídica (las asociaciones con panteón) y
 * pedir la personería y la designación de asamblea, como en la renovación.
 */
export const MONUMENTOS_INHUMACION = ["SOTANITO", "CAPILLA", "MAUSOLEO", "SEPULTURA"];

/**
 * Las personas de las dos: el concesionario, el difunto y, si lo hay, quien
 * hace el trámite.
 */
const PERSONAS_INHUMACION: PersonaPlantilla[] = [
  // Vivo y persona física: sin panteón no hay asociaciones (ver arriba), como
  // en la nueva concesión. Si no hay solicitante, el alta lo marca como
  // contacto. [C] ¿Puede ser el propio difunto? (pregunta E-2). Hoy no: para
  // eso el titular tendría que ser `fallecido: "opcional"` y el solicitante,
  // el contacto.
  {
    rol: "titular",
    etiqueta: "Titular de la concesión (concesionario)",
    min: 1,
    max: 1,
    fallecido: "no",
    pide_vinculo: false,
    admite_juridica: false,
  },
  // [F] Uno por trámite. [I] La fecha de defunción se carga en el alta.
  { rol: "difunto", etiqueta: "Difunto a inhumar", min: 1, max: 1, fallecido: "si", pide_vinculo: false, admite_juridica: false },
  // Un familiar o la empresa fúnebre en nombre del concesionario, con su vínculo.
  SOLICITANTE_OPCIONAL,
];

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

// [F] Las dos verificaciones de Mesa de Entradas: "verificar que la concesión
// no esté vencida" (constancia de Cómputos) y "saber si tiene abonados los
// últimos 5 años" (estado de cuenta). En los tres cementerios: el procedimiento
// de inhumación no distingue (a diferencia de la renovación, donde la
// Conservación se pide en el Oeste y en Jardín). [C] El Norte (pregunta E-5).
const MESA_CONCESION_VIGENTE = obligatoria("MESA_CONCESION_VIGENTE", "Concesión vigente verificada en Cómputos");
const MESA_CONSERVACION = obligatoria("MESA_CONSERVACION", "Conservación de los últimos 5 años verificada en el estado de cuenta");

/**
 * Mesa de Entradas. [I] La carátula, como en las otras plantillas (pregunta
 * A-2). [I] 1 día de alerta: la inhumación no espera.
 */
const pasoMesaInhumacion = (extra: PasoPlantilla["subtareas"] = [], instrucciones?: string): PasoPlantilla =>
  paso({
    clave: "MESA",
    nombre: "Mesa de Entradas",
    area: "MESA_ENTRADAS",
    dias_alerta: 1,
    instrucciones,
    subtareas: [SUB.MESA_CARATULA, MESA_CONCESION_VIGENTE, MESA_CONSERVACION, ...extra],
  });

/**
 * El cementerio del expediente (Oeste, Norte o Jardín). No usa la herramienta:
 * lo sigue Mesa de Entradas [C] (pregunta E-8), como en la nueva concesión.
 * [I] 2 días de alerta.
 */
const pasoCementerio = (subtareas: PasoPlantilla["subtareas"], instrucciones: string): PasoPlantilla =>
  paso({
    clave: "CEMENTERIO",
    nombre: "Cementerio (afuera)",
    area: "$CEMENTERIO",
    custodia: "MESA_ENTRADAS",
    dias_alerta: 2,
    instrucciones,
    subtareas,
  });

// [F] "Una vez realizada la inhumación". Con la fecha en que se hizo.
const CEM_REALIZADA = conFecha("CEM_REALIZADA", "Inhumación realizada");

/**
 * [F] "a la Dirección para conocimiento y archivo". Dirección no recibe pases
 * (sus usuarios son de solo lectura), así que el paso es de Mesa de Entradas
 * [C] (pregunta E-9). Después Mesa concluye y archiva con las acciones de
 * siempre. [I] 5 días de alerta.
 */
const pasoConocimiento = (): PasoPlantilla =>
  paso({
    clave: "CONOCIMIENTO",
    nombre: "Conocimiento y archivo",
    area: "MESA_ENTRADAS",
    dias_alerta: 5,
    instrucciones: "Después de tildar el conocimiento, concluir el expediente y archivarlo con su caja.",
    subtareas: [obligatoria("DIR_CONOCIMIENTO", "La Dirección tomó conocimiento de la inhumación")],
  });

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

/**
 * [F] Lo que provee la Dirección y lo que trae el concesionario, todo en Mesa
 * de Entradas (el punto 1 del procedimiento). Por eso la constancia de Cómputos
 * y el estado de cuenta se exigen al salir de Mesa y no de Cómputo y
 * Liquidación, como en la renovación. Las mismas claves que en las demás
 * plantillas. [I] En qué paso y si se escanean (pregunta E-4).
 */
const DOCUMENTOS_MESA: DocumentoPlantilla[] = [
  { ...DOC.CONST_COMPUTOS, nombre: "Constancia de Cómputos (datos personales y catastrales, concesión vigente)", exigir_al_salir_de: "MESA" },
  { ...DOC.ESTADO_CUENTA, nombre: "Estado de cuenta (Conservación de los últimos 5 años)", exigir_al_salir_de: "MESA" },
  DOC.DNI,
  documento("CONST_INHUMAR", "Constancia para inhumar", "concesionario", "MESA"),
];

// ---------------------------------------------------------------------------
// (A) INHUMACION_DIRECCION: el concesionario paga en la Dirección
// ---------------------------------------------------------------------------

/**
 * [F] La boleta de Liquidación: derecho de oficina, apertura "(cuando inhuma
 * Cterio. Jardín)", inhumación y conducción. Dos subtareas con su filtro, como
 * la boleta de la renovación, para que el texto diga lo que lleva en cada
 * cementerio. [t?: N° de boleta, I]. [C] La apertura, solo en Jardín (pregunta E-7).
 */
const BOLETAS_INHUMACION = [
  exceptoEn(conTextoOpcional("LIQ_BOLETA", "Boleta emitida: oficina, inhumación y conducción"), JARDIN),
  soloEn(conTextoOpcional("LIQ_BOLETA_JARDIN", "Boleta emitida: oficina, apertura, inhumación y conducción"), JARDIN),
];

export const INHUMACION_DIRECCION: DefinicionPlantilla = {
  // [C] "no_aplica" porque no hay plan de pagos que elegir (pregunta E-1): se
  // paga de contado con la boleta.
  forma_pago: "no_aplica",
  tipos_monumento: MONUMENTOS_INHUMACION,
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: PERSONAS_INHUMACION,
  campos_extra: [],
  documentos: [
    ...DOCUMENTOS_MESA,
    // [F] "trae una copia del pago para ser adjuntado al expediente".
    { ...DOC.COMPROBANTE_PAGO, nombre: "Copia del comprobante de pago de la boleta" },
  ],
  // [F] Las claves de concepto de la nueva concesión. La apertura, solo en Jardín.
  conceptos: [
    CONCEPTO.DERECHO_OFICINA,
    soloEn(concepto("APERTURA", "Apertura"), JARDIN),
    concepto("INHUMACION", "Inhumación"),
    concepto("CONDUCCION", "Conducción"),
  ],
  pasos: [
    pasoMesaInhumacion(),
    // [F] Liquidación y Tasas. [I] 1 día de alerta.
    paso({
      clave: "LIQUIDACION",
      nombre: "Liquidación y boleta",
      area: "LIQUIDACION",
      dias_alerta: 1,
      instrucciones: `${INSTRUCCIONES_BOLETA} La apertura se cobra solo cuando se inhuma en el Cementerio Jardín.`,
      subtareas: [SUB.LIQ_DEBITOS, ...BOLETAS_INHUMACION, SUB.LIQ_PAGO],
    }),
    pasoCementerio(
      [
        CEM_REALIZADA,
        // [I] Sin fecha: la del pase a Conocimiento es la del regreso del papel.
        obligatoria("CEM_DEVUELTO", "Expediente devuelto a la Dirección"),
      ],
      "El cementerio realiza la inhumación, la informa y devuelve el expediente a la Dirección. Al tildar la inhumación se anota la fecha en que se hizo.",
    ),
    pasoConocimiento(),
  ],
};

// ---------------------------------------------------------------------------
// (B) INHUMACION_EMPRESA: paga la empresa fúnebre
// ---------------------------------------------------------------------------

/**
 * [F] "depende el plan de sepelio … la empresa Fúnebre abona todos los
 * conceptos indicados en el punto 2". No hay una vía de concepto para eso
 * (pendiente, pregunta F-4): quedan dichos acá, en las instrucciones.
 */
const CONCEPTOS_EMPRESA =
  "La empresa fúnebre abona, según el plan de sepelio, el derecho de oficina, la apertura (solo en el Cementerio Jardín), la inhumación y la conducción: la Dirección no emite boleta.";

export const INHUMACION_EMPRESA: DefinicionPlantilla = {
  // [C] Ver (A); acá la Dirección no cobra nada (pregunta E-1).
  forma_pago: "no_aplica",
  tipos_monumento: MONUMENTOS_INHUMACION,
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: PERSONAS_INHUMACION,
  campos_extra: [],
  documentos: [
    ...DOCUMENTOS_MESA,
    // [F] "se tiene que presentar en el cementerio con todos los comprobantes".
    // [I] No obligatorio: los ve el cementerio; si llega una copia, se adjunta (pregunta F-3).
    {
      ...documento("COMPROBANTES_EMPRESA", "Comprobantes de pago de la empresa fúnebre", "concesionario", "CEMENTERIO", "sugerido"),
      obligatorio: false,
    },
  ],
  // Sin conceptos: ver CONCEPTOS_EMPRESA.
  conceptos: [],
  pasos: [
    pasoMesaInhumacion(
      // [F] "se informa al cementerio que corresponda del horario de la
      // inhumación". [I] El texto (día y hora) es obligatorio: es lo que se informa (pregunta F-1).
      [{ ...conTextoOpcional("MESA_HORARIO", "Horario de la inhumación informado al cementerio"), dato_obligatorio: true }],
      `Al tildar el horario se anota el día y la hora informados al cementerio. ${CONCEPTOS_EMPRESA}`,
    ),
    pasoCementerio(
      [
        obligatoria("CEM_COMPROBANTES", "Comprobantes de la empresa fúnebre presentados en el cementerio"),
        CEM_REALIZADA,
        // [F] "una vez realizada la inhumación el cementerio informa a la Dirección".
        obligatoria("CEM_INFORMADO", "Informado a la Dirección"),
      ],
      `El concesionario se presenta en el cementerio con los comprobantes. ${CONCEPTOS_EMPRESA} Al tildar la inhumación se anota la fecha en que se hizo.`,
    ),
    pasoConocimiento(),
  ],
};
