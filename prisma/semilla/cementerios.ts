// Cementerios (docs/propuesta-mvp.md, 2.2 y 2.13(d)).
//
// NOMENCLATURA, actualizada el 20/10/2026 según docs/fuentes:
// - Oeste: la sección es una letra de la A a la H (plano base del Cementerio
//   Oeste). El plano no tiene cuadros, así que no se pide cuadro.
// - Jardín Norte: la sección va en números romanos (los procedimientos cobran
//   el arrendamiento por sector según la sección: I a IV, V a X, XI en
//   adelante).
// - Norte: sigue la provisoria (Sección · Cuadro · Lote · Número, el ejemplo
//   de la propuesta), porque las fuentes no dicen cómo se ubica.
// Lo que sigue A CONFIRMAR con la Dirección de Cementerios (docs/fuentes,
// "Lo que todavía falta pedir"; taller, preguntas U-1 a U-5): cómo se numera
// dentro de cada sección. Lote y número quedan provisorios en los tres.
// Cambiarla después no requiere código: se edita en /admin/catalogos, y una
// clave ya usada no se borra, se pasa a `activo: false`.

/**
 * Un elemento de `cementerios.campos_ubicacion`. Es `type` y no `interface`
 * para que Prisma lo acepte como JSON. Lo valida `CampoUbicacion` de
 * src/lib/dominio/expedientes/ubicacion.ts.
 */
export type CampoUbicacion = {
  clave: string;
  etiqueta: string;
  /** `entero`: se guarda sin ceros a la izquierda ("012" = "12", pregunta U-1). */
  tipo: "texto" | "entero";
  obligatorio: boolean;
  /**
   * Expresión regular que tiene que cumplir el valor ya normalizado (sin
   * espacios de más y EN MAYÚSCULAS: "iv" se guarda "IV"), o null.
   */
  patron: string | null;
  activo: boolean;
  /** Cómo se escribe, para el formulario y el mensaje de error. */
  ayuda?: string;
};

export interface CementerioSemilla {
  codigo: string;
  nombre: string;
  /** Su área externa (areas.ts). */
  area: string;
  camposUbicacion: CampoUbicacion[];
  tiposMonumento: string[];
}

/** Una letra de la A a la H (plano del Cementerio Oeste). */
export const PATRON_SECCION_OESTE = "[A-H]";

/**
 * Números romanos del I al XL. [C] Hasta dónde llegan las secciones de Jardín
 * no está en las fuentes ("XI en adelante"): XL es un tope holgado y se cambia
 * en /admin/catalogos. Ya en mayúsculas: el valor se normaliza antes.
 */
export const PATRON_SECCION_ROMANA = "XL|X{0,3}(?:IX|IV|V?I{0,3})";

// [I] Lote obligatorio y número no, porque un mausoleo o una capilla pueden no
// tenerlo. Provisorios: falta saber cómo se numera dentro de cada sección.
const LOTE: CampoUbicacion = { clave: "lote", etiqueta: "Lote", tipo: "entero", obligatorio: true, patron: null, activo: true };
const NUMERO: CampoUbicacion = { clave: "numero", etiqueta: "N°", tipo: "entero", obligatorio: false, patron: null, activo: true };

const NOMENCLATURA_OESTE: readonly CampoUbicacion[] = [
  {
    clave: "seccion",
    etiqueta: "Sección",
    tipo: "texto",
    obligatorio: true,
    patron: PATRON_SECCION_OESTE,
    activo: true,
    ayuda: "una letra de la A a la H",
  },
  LOTE,
  NUMERO,
];

const NOMENCLATURA_JARDIN: readonly CampoUbicacion[] = [
  {
    clave: "seccion",
    etiqueta: "Sección",
    tipo: "texto",
    obligatorio: true,
    patron: PATRON_SECCION_ROMANA,
    activo: true,
    ayuda: "en números romanos, de I a XL",
  },
  LOTE,
  NUMERO,
];

// [C] La del Norte no cambió: las fuentes no dicen cómo se ubica.
const NOMENCLATURA_PROVISORIA: readonly CampoUbicacion[] = [
  { clave: "seccion", etiqueta: "Sección", tipo: "entero", obligatorio: true, patron: null, activo: true },
  { clave: "cuadro", etiqueta: "Cuadro", tipo: "texto", obligatorio: true, patron: null, activo: true },
  LOTE,
  NUMERO,
];

// Tipos de monumento de los procedimientos (docs/fuentes, página 1), en su orden.
const MONUMENTOS_OESTE_Y_NORTE = ["SEPULTURA", "SOTANITO", "CAPILLA", "MAUSOLEO", "PANTEON"];
const MONUMENTOS_JARDIN = ["SEPULTURA"];

export const CEMENTERIOS: readonly CementerioSemilla[] = [
  {
    codigo: "OESTE",
    nombre: "Cementerio del Oeste",
    area: "CEM_OESTE",
    camposUbicacion: [...NOMENCLATURA_OESTE],
    tiposMonumento: [...MONUMENTOS_OESTE_Y_NORTE],
  },
  {
    codigo: "NORTE",
    nombre: "Cementerio del Norte",
    area: "CEM_NORTE",
    camposUbicacion: [...NOMENCLATURA_PROVISORIA],
    tiposMonumento: [...MONUMENTOS_OESTE_Y_NORTE],
  },
  {
    codigo: "JARDIN_NORTE",
    nombre: "Cementerio Jardín Norte",
    area: "CEM_JARDIN_NORTE",
    camposUbicacion: [...NOMENCLATURA_JARDIN],
    tiposMonumento: [...MONUMENTOS_JARDIN],
  },
];
