import { AREA_MESA_ENTRADAS, puede, type UsuarioPermisos } from "./permisos";

/**
 * Navegación por rol (sección 5, "Navegación por rol") y a qué pantallas entra
 * cada uno. Pura, para probarla y para que el menú y las páginas digan lo mismo.
 */

export type Pantalla = "bandeja" | "expedientes" | "expedientes_nuevo" | "panel" | "metricas" | "admin" | "sitio_publico";

/** /admin/sitio-publico (28/10/2026): el contenido de la página pública. */
export const RUTA_SITIO_PUBLICO = "/admin/sitio-publico";

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
  metricas: { pantalla: "metricas", href: "/panel/metricas", etiqueta: "Métricas" },
  admin: { pantalla: "admin", href: "/admin", etiqueta: "Administración" },
  sitio_publico: { pantalla: "sitio_publico", href: RUTA_SITIO_PUBLICO, etiqueta: "Sitio público" },
};

/**
 * - Mesa de Entradas: Bandeja · Nuevo expediente · Buscar · Panel.
 * - Los demás operadores: Bandeja · Buscar · Panel.
 * - Dirección: Panel · Métricas · Buscar · Sitio público (otro usuario de lectura: Panel · Buscar).
 * - Admin: Panel · Métricas · Buscar · Administración (el Sitio público está adentro).
 *
 * Métricas (las de gestión, /panel/metricas) es de Dirección y del admin
 * (permiso `ver_metricas`). Sitio público (28/10/2026, /admin/sitio-publico)
 * también (permiso `editar_sitio_publico`): Dirección lo tiene en el menú; el
 * admin, entre las secciones de Administración.
 *
 * El admin puede dar altas (3.2) pero el menú de la sección 5 no le pone el
 * atajo: lo tiene en Buscar.
 */
export function navegacionPara(usuario: UsuarioPermisos): ItemNavegacion[] {
  const metricas = puede("ver_metricas", null, usuario) ? [ITEMS.metricas] : [];
  if (usuario.rol === "admin") return [ITEMS.panel, ...metricas, ITEMS.expedientes, ITEMS.admin];
  // Fuera del admin, quien edita el sitio público (Dirección) lo tiene en el menú.
  const sitio = puede("editar_sitio_publico", null, usuario) ? [ITEMS.sitio_publico] : [];
  if (usuario.rol === "lectura") return [ITEMS.panel, ...metricas, ITEMS.expedientes, ...sitio];
  if (usuario.area?.codigo === AREA_MESA_ENTRADAS) {
    return [ITEMS.bandeja, ITEMS.expedientes_nuevo, ITEMS.expedientes, ITEMS.panel];
  }
  return [ITEMS.bandeja, ITEMS.expedientes, ITEMS.panel, ...sitio];
}

/**
 * Las secciones de Administración (sección 5: Plantillas, Usuarios,
 * Catálogos, Auditoría). Son de la pantalla `admin`: solo el admin (3.2).
 * Sitio público (28/10/2026) es la excepción: también la ve Dirección (pantalla
 * `sitio_publico`), que entra a Administración solo por ella.
 */
export const SECCIONES_ADMIN: ReadonlyArray<{ href: string; etiqueta: string; descripcion: string }> = [
  { href: "/admin/plantillas", etiqueta: "Plantillas", descripcion: "Trámites: versiones, borradores, publicar y retirar" },
  { href: "/admin/usuarios", etiqueta: "Usuarios", descripcion: "Alta por CUIL, área y rol, desactivar y reactivar" },
  { href: "/admin/catalogos", etiqueta: "Catálogos", descripcion: "Áreas, cementerios y su nomenclatura, monumentos, trámites y feriados" },
  { href: "/admin/auditoria", etiqueta: "Auditoría", descripcion: "Accesos, datos completos vistos y cambios de configuración" },
  { href: RUTA_SITIO_PUBLICO, etiqueta: "Sitio público", descripcion: "Cementerios, horarios, recorridos, novedades, contacto y preguntas de la página pública" },
];

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
    case "metricas":
      return puede("ver_metricas", null, usuario);
    case "admin":
      return puede("administrar", null, usuario);
    case "sitio_publico":
      return puede("editar_sitio_publico", null, usuario);
  }
}
