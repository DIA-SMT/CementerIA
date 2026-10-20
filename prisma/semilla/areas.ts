// Áreas (docs/propuesta-mvp.md, 2.1).
//
// Las internas tienen usuarios. Dirección no recibe pases: sus usuarios son de
// solo lectura y no opera expedientes. Las externas (la DIM y los cementerios)
// no tienen usuarios: el papel va ahí y lo sigue el área de custodia del paso.

export interface AreaSemilla {
  codigo: string;
  nombre: string;
  tipo: "interna" | "externa";
  recibePases: boolean;
  orden: number;
}

export const AREAS: readonly AreaSemilla[] = [
  { codigo: "MESA_ENTRADAS", nombre: "Mesa de Entradas", tipo: "interna", recibePases: true, orden: 1 },
  { codigo: "COMPUTO", nombre: "Cómputo", tipo: "interna", recibePases: true, orden: 2 },
  { codigo: "LIQUIDACION", nombre: "Liquidación", tipo: "interna", recibePases: true, orden: 3 },
  // "Devuelto por Asesoría Legal" es el ejemplo de bandeja de la sección 3.4.
  { codigo: "LEGAL", nombre: "Asesoría Legal", tipo: "interna", recibePases: true, orden: 4 },
  { codigo: "ADMINISTRATIVO", nombre: "Administrativo", tipo: "interna", recibePases: true, orden: 5 },
  { codigo: "TRIBUTARIO", nombre: "Departamento Tributario / Notificación", tipo: "interna", recibePases: true, orden: 6 },
  { codigo: "DIRECCION", nombre: "Dirección", tipo: "interna", recibePases: false, orden: 7 },
  { codigo: "DIM", nombre: "Dirección de Ingresos Municipales (DIM)", tipo: "externa", recibePases: true, orden: 8 },
  { codigo: "CEM_OESTE", nombre: "Cementerio del Oeste", tipo: "externa", recibePases: true, orden: 9 },
  { codigo: "CEM_NORTE", nombre: "Cementerio del Norte", tipo: "externa", recibePases: true, orden: 10 },
  { codigo: "CEM_JARDIN_NORTE", nombre: "Cementerio Jardín Norte", tipo: "externa", recibePases: true, orden: 11 },
];
