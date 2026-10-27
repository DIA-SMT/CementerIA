import { CLAVE_PERFIL_ADMIN, type PerfilPrueba } from "@/lib/dominio/admin/perfil-prueba";
import type { Rol } from "@/lib/dominio/permisos";

/**
 * Los textos del selector "Ver como…" y de la franja del modo prueba
 * (docs/diseno.md, "Modo prueba"). Puro y sin nada del servidor: lo importan
 * los Client Components del encabezado. La lógica de la Server Action está en
 * ./acciones-perfil-prueba.ts.
 */

export { CLAVE_PERFIL_ADMIN };

/** Lo mínimo de un perfil que necesita la pantalla (serializable). */
export type PerfilVista = Pick<PerfilPrueba, "clave" | "etiqueta" | "rol">;

const NOMBRE_ROL: Record<Rol, string> = { operador: "Operador", lectura: "Solo lectura", admin: "Administrador del sistema" };

/** Lo que va debajo del nombre del perfil en el menú: "Operador", "Solo lectura"… */
export function descripcionPerfil(perfil: Pick<PerfilPrueba, "rol">): string {
  return NOMBRE_ROL[perfil.rol];
}

/** El perfil a la vista, en la franja: "Liquidación", "Dirección (solo lectura)". */
export function nombrePerfilEnFranja(perfil: Pick<PerfilPrueba, "etiqueta" | "rol"> | null): string {
  if (!perfil) return "un perfil que no es de la lista";
  return perfil.rol === "lectura" ? `${perfil.etiqueta} (solo lectura)` : perfil.etiqueta;
}

/** La franja va mientras el perfil no sea Administrador (también si no coincide con ninguno). */
export function mostrarFranja(actual: string | null): boolean {
  return actual !== CLAVE_PERFIL_ADMIN;
}

/** El nombre accesible del botón del encabezado: dice también el perfil de ahora. */
export function nombreSelector(perfil: Pick<PerfilPrueba, "etiqueta"> | null): string {
  return perfil ? `Ver como… (modo prueba, ahora ${perfil.etiqueta})` : "Ver como… (modo prueba)";
}
