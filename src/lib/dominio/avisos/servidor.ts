import "server-only";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { crearServicioAvisos } from "./index";

/**
 * El servicio de avisos de la app: lecturas con el cliente global y
 * escrituras con `conActor()`. Lo importan el layout (la campana), /avisos,
 * sus Server Actions y el Route Handler del refresco.
 *
 * @example
 * import { avisos } from "@/lib/dominio/avisos/servidor";
 * const { noLeidos, ultimos } = await avisos.resumen(usuario);
 */
export const avisos = crearServicioAvisos({ leer: prisma, escribir: conActor });

export * from "./index";
