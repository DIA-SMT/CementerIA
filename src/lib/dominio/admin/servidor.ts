import "server-only";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { entorno } from "@/lib/entorno";
import { crearServicioAdmin, crearServicioPerfilPrueba } from "./index";

/**
 * El servicio de administración de la app: lecturas con el cliente global y
 * escrituras con `conActor()`, como `expedientes` de
 * ../expedientes/servidor.ts. Lo importan las páginas de `/admin/*`, sus
 * Server Actions y el Route Handler del CSV de auditoría.
 */
export const admin = crearServicioAdmin({ leer: prisma, escribir: conActor });

/**
 * El modo prueba ("Ver como…", ./perfil-prueba.ts): los CUILs de
 * PERFILES_PRUEBA_CUILS, leídos recién al usarlos (`entorno()` es perezoso:
 * `next build` importa este módulo sin el entorno de producción). Lo usan el
 * layout autenticado y la Server Action del selector.
 */
export const perfilPrueba = crearServicioPerfilPrueba({ leer: prisma, escribir: conActor, cuils: () => entorno().perfilesPrueba });

export * from "./index";
