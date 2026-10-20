import "server-only";
import { crearAlmacenEnDisco, raizAdjuntos, type AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
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
 * DATABASE_URL). El almacenamiento de adjuntos también: la carpeta
 * (`ADJUNTOS_DIR`, o `./.data/adjuntos` en desarrollo) se resuelve en el primer
 * uso, no al importar.
 */

let almacen: AlmacenAdjuntos | undefined;

function obtenerAlmacen(): AlmacenAdjuntos {
  almacen ??= crearAlmacenEnDisco(raizAdjuntos());
  return almacen;
}

const almacenPerezoso: AlmacenAdjuntos = {
  recibir: (contenido, maxBytes) => obtenerAlmacen().recibir(contenido, maxBytes),
  confirmar: (archivo, ruta) => obtenerAlmacen().confirmar(archivo, ruta),
  descartar: (archivo) => obtenerAlmacen().descartar(archivo),
  abrir: (ruta) => obtenerAlmacen().abrir(ruta),
  barrerTemporales: (antesDe) => obtenerAlmacen().barrerTemporales(antesDe),
};

export const expedientes = crearServicioExpedientes({ leer: prisma, escribir: conActor, almacen: almacenPerezoso });

export * from "./index";
