// Tipos de monumento y tipos de trámite (docs/propuesta-mvp.md, 2.3).

export interface CodigoNombre {
  codigo: string;
  nombre: string;
}

// Los de los procedimientos de la Dirección (docs/fuentes, página 1):
// "Sepultura/bóveda", sotanito, capilla, mausoleo y panteón en el Oeste y el
// Norte; en Jardín Norte, solo sepultura (cementerios.ts dice cuáles habilita
// cada uno). SEPULTURA se llama "Sepultura o bóveda" porque los procedimientos
// la nombran así: en el Oeste y el Norte son el mismo tipo, y en Jardín, donde
// no hay bóvedas, igual es la sepultura. El código no cambia: es la clave de
// los expedientes y de las plantillas.
export const TIPOS_MONUMENTO: readonly CodigoNombre[] = [
  { codigo: "SOTANITO", nombre: "Sotanito" },
  { codigo: "CAPILLA", nombre: "Capilla" },
  { codigo: "MAUSOLEO", nombre: "Mausoleo" },
  { codigo: "SEPULTURA", nombre: "Sepultura o bóveda" },
  // [I] No están en el pedido ni en los procedimientos: los agregó la
  // propuesta (taller, pregunta U-2). Quedan en el catálogo porque la
  // propuesta los usa (CINERARIO_COMUN, en la plantilla de cinerario común de
  // la sección 9) y los tests de validación los nombran, pero ningún
  // cementerio los habilita hasta que la Dirección diga dónde van.
  { codigo: "NICHO", nombre: "Nicho" },
  { codigo: "CINERARIO_COMUN", nombre: "Cinerario común" },
  // Va al final para no correr los ids de los demás en una base ya sembrada.
  { codigo: "PANTEON", nombre: "Panteón" },
];

// El tipo es la categoría de negocio; la plantilla lo combina con la forma de
// pago (decisión 3): RENOV_CONTADO y RENOV_PLAN suman juntas como RENOVACION.
// Los demás tipos los agrega el admin desde /admin/catalogos.
export const TIPOS_TRAMITE: readonly CodigoNombre[] = [
  { codigo: "RENOVACION", nombre: "Renovación de concesión" },
  { codigo: "RENOVACION_SPT", nombre: "Renovación sin perjuicio de tercero" },
  { codigo: "NUEVA_CONCESION", nombre: "Nueva concesión" },
  // Procedimiento de inhumación de la Dirección (docs/fuentes, 27/10/2026): sus
  // dos plantillas (pago en la Dirección o en la empresa fúnebre) suman juntas.
  // Va al final para no correr los ids de los demás en una base ya sembrada.
  { codigo: "INHUMACION", nombre: "Inhumación" },
];
