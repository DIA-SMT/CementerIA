import "server-only";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { crearServicioExpedientes } from "./index";

/**
 * El servicio de expedientes de la app: lecturas con el cliente global y
 * escrituras con `conActor()`. Es lo que importan las páginas, las Server
 * Actions y los Route Handlers:
 *
 * @example
 * import { expedientes } from "@/lib/dominio/expedientes/servidor";
 * const usuario = await exigirUsuario();
 * const ficha = await expedientes.obtenerFicha(usuario, numero, { ip });
 *
 * `prisma` es perezoso: importar esto no abre conexiones (next build no tiene
 * DATABASE_URL).
 */
export const expedientes = crearServicioExpedientes({ leer: prisma, escribir: conActor });

export * from "./index";
