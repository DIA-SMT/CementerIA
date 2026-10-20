// Tipos de monumento y tipos de trámite (docs/propuesta-mvp.md, 2.3).

export interface CodigoNombre {
  codigo: string;
  nombre: string;
}

export const TIPOS_MONUMENTO: readonly CodigoNombre[] = [
  { codigo: "SOTANITO", nombre: "Sotanito" },
  { codigo: "CAPILLA", nombre: "Capilla" },
  { codigo: "MAUSOLEO", nombre: "Mausoleo" },
  { codigo: "SEPULTURA", nombre: "Sepultura" },
  // [I] No están en el pedido: los agregó la propuesta (taller, pregunta U-2).
  { codigo: "NICHO", nombre: "Nicho" },
  { codigo: "CINERARIO_COMUN", nombre: "Cinerario común" },
];

// El tipo es la categoría de negocio; la plantilla lo combina con la forma de
// pago (decisión 3): RENOV_CONTADO y RENOV_PLAN suman juntas como RENOVACION.
// Los demás tipos los agrega el admin desde /admin/catalogos.
export const TIPOS_TRAMITE: readonly CodigoNombre[] = [
  { codigo: "RENOVACION", nombre: "Renovación de concesión" },
  { codigo: "RENOVACION_SPT", nombre: "Renovación sin perjuicio de tercero" },
  { codigo: "NUEVA_CONCESION", nombre: "Nueva concesión" },
];
