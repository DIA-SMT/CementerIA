import "server-only";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { crearServicioAdmin } from "./index";

/**
 * El servicio de administración de la app: lecturas con el cliente global y
 * escrituras con `conActor()`, como `expedientes` de
 * ../expedientes/servidor.ts. Lo importan las páginas de `/admin/*`, sus
 * Server Actions y el Route Handler del CSV de auditoría.
 */
export const admin = crearServicioAdmin({ leer: prisma, escribir: conActor });

export * from "./index";
