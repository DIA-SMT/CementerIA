// Usuarios de desarrollo (docs/propuesta-mvp.md, 2.4 y 6).
//
// TODOS FICTICIOS: un operador por área interna (Dirección con rol lectura,
// como dice 2.4) para entrar por /dev/login o por el formulario de /login con
// CLAVE_DESARROLLO (abajo). Los CUIL son de DNI 00000002 a
// 00000008, que no corresponden a nadie, con el dígito verificador correcto
// (sembrar.ts lo controla). Las áreas externas no tienen usuarios: el trigger
// usuarios_area_interna los rechaza.
//
// El admin no está acá: sale de ADMIN_INICIAL_CUIL (sección 6, punto 8).

export interface UsuarioSemilla {
  cuil: string;
  nombre: string;
  apellido: string;
  /** Código de área interna (areas.ts). */
  area: string;
  rol: "operador" | "lectura";
}

export const USUARIOS_FICTICIOS: readonly UsuarioSemilla[] = [
  { cuil: "27000000022", nombre: "Prueba", apellido: "Mesa de Entradas", area: "MESA_ENTRADAS", rol: "operador" },
  { cuil: "20000000036", nombre: "Prueba", apellido: "Cómputo", area: "COMPUTO", rol: "operador" },
  { cuil: "27000000049", nombre: "Prueba", apellido: "Liquidación", area: "LIQUIDACION", rol: "operador" },
  { cuil: "20000000052", nombre: "Prueba", apellido: "Asesoría Legal", area: "LEGAL", rol: "operador" },
  { cuil: "27000000065", nombre: "Prueba", apellido: "Administrativo", area: "ADMINISTRATIVO", rol: "operador" },
  { cuil: "20000000079", nombre: "Prueba", apellido: "Tributario", area: "TRIBUTARIO", rol: "operador" },
  { cuil: "27000000081", nombre: "Prueba", apellido: "Dirección", area: "DIRECCION", rol: "lectura" },
];

/** CUIL del admin en desarrollo si .env.local no trae ADMIN_INICIAL_CUIL. Ficticio. */
export const ADMIN_CUIL_DESARROLLO = "20000000001";

export const ADMIN_NOMBRE = { nombre: "Administración", apellido: "Inicial" } as const;

/**
 * La contraseña de TODOS los usuarios de la semilla de desarrollo (los
 * ficticios y el admin de desarrollo), para probar el formulario real de
 * /login además del login simulado. Documentada en el README: es pública y
 * solo local. En producción no existe (la semilla de producción no crea
 * ficticios, y al admin inicial le genera una temporal), y la política de
 * contraseñas la rechaza (src/lib/auth/clave.ts, CLAVES_COMUNES).
 */
export const CLAVE_DESARROLLO = "cementeria-local-2026";
