import { AREA_MESA_ENTRADAS, puede, type UsuarioPermisos } from "./permisos";

/**
 * Navegación por rol (sección 5, "Navegación por rol") y a qué pantallas entra
 * cada uno. Pura, para probarla y para que el menú y las páginas digan lo mismo.
 */

export type Pantalla = "bandeja" | "expedientes" | "expedientes_nuevo" | "panel" | "admin";

export interface ItemNavegacion {
  pantalla: Pantalla;
  href: string;
  etiqueta: string;
}

const ITEMS: Record<Pantalla, ItemNavegacion> = {
  bandeja: { pantalla: "bandeja", href: "/bandeja", etiqueta: "Bandeja" },
  expedientes_nuevo: { pantalla: "expedientes_nuevo", href: "/expedientes/nuevo", etiqueta: "Nuevo expediente" },
  expedientes: { pantalla: "expedientes", href: "/expedientes", etiqueta: "Buscar" },
  panel: { pantalla: "panel", href: "/panel", etiqueta: "Panel" },
  admin: { pantalla: "admin", href: "/admin", etiqueta: "Administración" },
};

/**
 * - Mesa de Entradas: Bandeja · Nuevo expediente · Buscar · Panel.
 * - Los demás operadores: Bandeja · Buscar · Panel.
 * - Dirección (y cualquier usuario de lectura): Panel · Buscar.
 * - Admin: Panel · Buscar · Administración.
 *
 * El admin puede dar altas (3.2) pero el menú de la sección 5 no le pone el
 * atajo: lo tiene en Buscar.
 */
export function navegacionPara(usuario: UsuarioPermisos): ItemNavegacion[] {
  if (usuario.rol === "admin") return [ITEMS.panel, ITEMS.expedientes, ITEMS.admin];
  if (usuario.rol === "lectura") return [ITEMS.panel, ITEMS.expedientes];
  if (usuario.area?.codigo === AREA_MESA_ENTRADAS) {
    return [ITEMS.bandeja, ITEMS.expedientes_nuevo, ITEMS.expedientes, ITEMS.panel];
  }
  return [ITEMS.bandeja, ITEMS.expedientes, ITEMS.panel];
}

/** A dónde va `/`: operadores a su bandeja; Dirección y admin al panel. */
export function inicioPara(usuario: { rol: string }): "/bandeja" | "/panel" {
  return usuario.rol === "operador" ? "/bandeja" : "/panel";
}

/** Columna "Roles" del mapa de pantallas (sección 5). */
export function puedeVerPantalla(usuario: UsuarioPermisos, pantalla: Pantalla): boolean {
  if (!usuario.activo) return false;
  switch (pantalla) {
    case "bandeja":
      return usuario.rol === "operador";
    case "expedientes":
      return puede("ver_expediente", null, usuario);
    case "expedientes_nuevo":
      return puede("alta", null, usuario);
    case "panel":
      return puede("ver_panel", null, usuario);
    case "admin":
      return puede("administrar", null, usuario);
  }
}
