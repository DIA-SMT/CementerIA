import "server-only";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { crearServicioMetricas } from "./index";

/**
 * El servicio de métricas de la app: lecturas con el cliente global y el
 * registro de la exportación con `conActor()`. Lo importan `/panel/metricas`
 * y su Route Handler de CSV.
 */
export const metricas = crearServicioMetricas({ leer: prisma, escribir: conActor });

export * from "./index";
