// Cementerios (docs/propuesta-mvp.md, 2.2 y 2.13(d)).
//
// NOMENCLATURA PROVISORIA, A CONFIRMAR con la Dirección de Cementerios
// (taller de plantillas, preguntas U-1 a U-5): no sabemos cómo ubica cada
// cementerio un monumento, en especial Jardín Norte. Mientras tanto los tres
// usan Sección · Cuadro · Lote · Número, el ejemplo de la propuesta
// ("Secc. 3 · Cuadro B · Lote 12 · N° 45"). Cambiarla después no requiere
// código: se edita en /admin/catalogos, y una clave ya usada no se borra, se
// pasa a `activo: false`.

/**
 * Un elemento de `cementerios.campos_ubicacion`. Es `type` y no `interface`
 * para que Prisma lo acepte como JSON. El esquema zod que lo valide es parte
 * del alta (semana 2).
 */
export type CampoUbicacion = {
  clave: string;
  etiqueta: string;
  /** `entero`: se guarda sin ceros a la izquierda ("012" = "12", pregunta U-1). */
  tipo: "texto" | "entero";
  obligatorio: boolean;
  /** Expresión regular que tiene que cumplir el valor ya normalizado, o null. */
  patron: string | null;
  activo: boolean;
};

export interface CementerioSemilla {
  codigo: string;
  nombre: string;
  /** Su área externa (areas.ts). */
  area: string;
  camposUbicacion: CampoUbicacion[];
  tiposMonumento: string[];
}

// [I] Sección, cuadro y lote obligatorios; el número no, porque un mausoleo o
// una capilla pueden no tenerlo. A confirmar.
const NOMENCLATURA_PROVISORIA: readonly CampoUbicacion[] = [
  { clave: "seccion", etiqueta: "Sección", tipo: "entero", obligatorio: true, patron: null, activo: true },
  { clave: "cuadro", etiqueta: "Cuadro", tipo: "texto", obligatorio: true, patron: null, activo: true },
  { clave: "lote", etiqueta: "Lote", tipo: "entero", obligatorio: true, patron: null, activo: true },
  { clave: "numero", etiqueta: "N°", tipo: "entero", obligatorio: false, patron: null, activo: true },
];

// [C] Qué tipos hay en cada cementerio es la pregunta U-2 del taller. Se
// habilitan todos en los tres para que el alta funcione con cualquier plantilla
// hasta tener la respuesta.
const TODOS_LOS_MONUMENTOS = ["SOTANITO", "CAPILLA", "MAUSOLEO", "SEPULTURA", "NICHO", "CINERARIO_COMUN"];

export const CEMENTERIOS: readonly CementerioSemilla[] = [
  {
    codigo: "OESTE",
    nombre: "Cementerio del Oeste",
    area: "CEM_OESTE",
    camposUbicacion: [...NOMENCLATURA_PROVISORIA],
    tiposMonumento: [...TODOS_LOS_MONUMENTOS],
  },
  {
    codigo: "NORTE",
    nombre: "Cementerio del Norte",
    area: "CEM_NORTE",
    camposUbicacion: [...NOMENCLATURA_PROVISORIA],
    tiposMonumento: [...TODOS_LOS_MONUMENTOS],
  },
  {
    codigo: "JARDIN_NORTE",
    nombre: "Cementerio Jardín Norte",
    area: "CEM_JARDIN_NORTE",
    camposUbicacion: [...NOMENCLATURA_PROVISORIA],
    tiposMonumento: [...TODOS_LOS_MONUMENTOS],
  },
];
