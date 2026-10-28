import "server-only";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { crearServicioSitio } from "./index";

/**
 * El servicio del sitio público de la app (28/10/2026): lecturas con el
 * cliente global y escrituras con `conActor()`. Lo usan la página pública
 * (`/`), /admin/sitio-publico y sus Server Actions.
 */
export const sitio = crearServicioSitio({ leer: prisma, escribir: conActor });

export * from "./index";
