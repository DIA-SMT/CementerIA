// d) NUEVA_CONC_CONTADO: Nueva concesión de un monumento caducado, contado
// (docs/propuesta-mvp.md, 4(d)).

import type { DefinicionPlantilla } from "../../../src/lib/dominio/plantillas/esquema";
import {
  CAMPOS_CONCESION,
  CONCEPTO,
  DOC,
  SOLICITANTE_OPCIONAL,
  SUB,
  conFecha,
  concepto,
  documento,
  obligatoria,
  paso,
  pasoComputoAlta,
  pasoComputoFinal,
  pasoEntrega,
  pasoLegal,
  pasoLiquidacion,
  pasoMesa,
  pasoResolucionYTitulo,
} from "./comun";

export const NUEVA_CONC_CONTADO: DefinicionPlantilla = {
  forma_pago: "contado",
  // [C] Todos los habilitados en el cementerio (pregunta D-2).
  tipos_monumento: [],
  ubicacion_obligatoria: true,
  requiere_contacto: true,
  personas: [
    { rol: "titular", etiqueta: "Titular (nuevo concesionario)", min: 1, max: 1, fallecido: "no", pide_vinculo: false },
    SOLICITANTE_OPCIONAL,
    // [I] Se deduce de la constancia para inhumar (pregunta D-3).
    { rol: "difunto", etiqueta: "Difunto a inhumar", min: 0, max: 5, fallecido: "si", pide_vinculo: false },
  ],
  campos_extra: [
    // [I] El pedido solo pide la fotocopia como documento (pregunta D-4).
    {
      clave: "resolucion_caducidad",
      etiqueta: "N° de resolución de caducidad",
      tipo: "texto",
      obligatorio: false,
      exigir_al_salir_de: null,
      buscable: true,
      opciones: null,
    },
    {
      clave: "expediente_caducidad",
      etiqueta: "N° de expediente de caducidad",
      tipo: "texto",
      obligatorio: false,
      exigir_al_salir_de: null,
      buscable: true,
      opciones: null,
    },
    ...CAMPOS_CONCESION,
  ],
  documentos: [
    // Provistos por la Dirección. [I] en qué paso (pregunta D-5).
    documento("FORM_INICIO_NUEVA", "Formulario de inicio de trámite de nueva concesión", "direccion", "MESA"),
    DOC.CONST_COMPUTOS,
    DOC.ESTADO_CUENTA,
    documento("COPIA_RES_CADUCIDAD", "Fotocopia de la resolución de caducidad", "direccion", "MESA"),
    documento("CONST_ANTECEDENTES", "Constancia de antecedentes y requisitos", "direccion", "MESA"),
    // Los trae el concesionario.
    DOC.DNI,
    // [I] en qué paso (pregunta D-8).
    documento("CONST_INHUMAR", "Constancia para inhumar", "concesionario", "LIQUIDACION"),
    DOC.BOLETA_SERVICIO,
    // [I] (pregunta D-7).
    DOC.COMPROBANTE_PAGO,
  ],
  // [C] Sin inspección técnica: el pedido no la menciona (pregunta D-9).
  conceptos: [
    CONCEPTO.DERECHO_OFICINA,
    CONCEPTO.ARRENDAMIENTO,
    concepto("APERTURA", "Apertura"),
    concepto("INHUMACION", "Inhumación"),
    concepto("CONDUCCION", "Conducción"),
  ],
  pasos: [
    pasoMesa(),
    // [I] El pedido no menciona este paso (pregunta D-6).
    pasoComputoAlta(),
    // La propuesta no marca dato en esta boleta, a diferencia de (a).
    pasoLiquidacion(obligatoria("LIQ_BOLETA", "Boleta emitida con los 5 conceptos")),
    // El cementerio del expediente. No usa la herramienta: lo sigue Mesa de
    // Entradas [C] (pregunta D-10).
    paso({
      clave: "CEMENTERIO",
      nombre: "Cementerio (afuera)",
      area: "$CEMENTERIO",
      custodia: "MESA_ENTRADAS",
      dias_alerta: 15,
      subtareas: [
        conFecha("CEM_CONOCIMIENTO", "El cementerio tomó conocimiento"),
        obligatoria("CEM_REGISTRADO", "Trámite registrado en el cementerio"),
        // [C] No obligatoria por ahora (pregunta D-12).
        conFecha("CEM_INHUMACION", "Inhumación informada", false),
      ],
    }),
    pasoLegal([SUB.LEG_DICTAMEN]),
    // [I] Igual que (a): resolución, firma, protocolización, título y firma (D-13).
    pasoResolucionYTitulo(),
    pasoComputoFinal(),
    // [I] El pedido dice solo "entrega" (pregunta D-14).
    pasoEntrega(),
  ],
};
