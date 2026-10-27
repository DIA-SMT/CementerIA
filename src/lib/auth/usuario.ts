import type { Prisma } from "@/generated/prisma/client";
import { esRol, type UsuarioPermisos } from "@/lib/dominio/permisos";
import { SISTEMA_ID } from "./ingreso";
import type { Sesion } from "./sesion-token";

/**
 * El usuario de la sesión, tal como lo ven las páginas y las acciones. Puro:
 * la carga desde la base está en ./sesion.ts.
 */

export interface UsuarioActual extends UsuarioPermisos {
  cuil: string;
  nombre: string;
  apellido: string;
  email: string | null;
  sesionVersion: number;
  area: { id: number; codigo: string; nombre: string } | null;
  /**
   * La contraseña es temporal (alta, blanqueo, admin inicial): hasta cambiarla
   * solo puede usar /cambiar-clave y Salir. getUsuarioActual() no devuelve a
   * este usuario; getSesionActual() sí (./sesion.ts).
   */
  debeCambiarClave: boolean;
}

export const SELECCION_USUARIO = {
  id: true,
  cuil: true,
  nombre: true,
  apellido: true,
  email: true,
  rol: true,
  activo: true,
  sesionVersion: true,
  debeCambiarClave: true,
  area: { select: { id: true, codigo: true, nombre: true } },
} as const satisfies Prisma.UsuarioSelect;

export type FilaUsuario = Prisma.UsuarioGetPayload<{ select: typeof SELECCION_USUARIO }>;

/**
 * ¿La fila de la base respalda esta sesión? Falla cerrado ante cualquier duda:
 * - el usuario no existe, está inactivo o es SISTEMA;
 * - `sesion_version` cambió: salió, o el admin lo desactivó o le cambió el
 *   acceso (sección 6: desactivar corta el acceso en el request siguiente);
 * - el rol no es uno de los conocidos.
 */
export function usuarioDeSesion(fila: FilaUsuario | null, sesion: Sesion): UsuarioActual | null {
  if (!fila || fila.id !== sesion.usuarioId || fila.id === SISTEMA_ID) return null;
  if (!fila.activo || fila.sesionVersion !== sesion.sesionVersion) return null;
  if (!esRol(fila.rol)) return null;
  return {
    id: fila.id,
    cuil: fila.cuil,
    nombre: fila.nombre,
    apellido: fila.apellido,
    email: fila.email,
    rol: fila.rol,
    activo: fila.activo,
    sesionVersion: fila.sesionVersion,
    area: fila.area,
    debeCambiarClave: fila.debeCambiarClave,
  };
}
