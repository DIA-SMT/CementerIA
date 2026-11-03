import "server-only";
import type { AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
import { crearAlmacenFotosDesdeEntorno } from "@/lib/adjuntos/fabrica";
import { prisma } from "@/lib/db/cliente";
import { conActor } from "@/lib/db/transaccion";
import { procesarFoto } from "@/lib/imagenes/procesar";
import { crearServicioSitio } from "./index";

/**
 * El servicio del sitio público de la app (28/10/2026): lecturas con el
 * cliente global y escrituras con `conActor()`. Lo usan la página pública
 * (`/`), /admin/sitio-publico y sus Server Actions, y desde el 30/10/2026 los
 * Route Handlers de las fotos (/api/sitio/fotos y /sitio/fotos/…).
 *
 * El almacén de las fotos (src/lib/adjuntos/fabrica.ts: el disco o el bucket
 * `sitio-publico` de Supabase Storage) se resuelve en el primer uso, no al
 * importar: `next build` importa esto sin configuración.
 */

let almacen: AlmacenAdjuntos | undefined;

/** El almacén de las fotos del sitio, perezoso. */
export function almacenFotos(): AlmacenAdjuntos {
  almacen ??= crearAlmacenFotosDesdeEntorno();
  return almacen;
}

const almacenPerezoso: AlmacenAdjuntos = {
  recibir: (contenido, maxBytes) => almacenFotos().recibir(contenido, maxBytes),
  confirmar: (archivo, ruta) => almacenFotos().confirmar(archivo, ruta),
  descartar: (archivo) => almacenFotos().descartar(archivo),
  abrir: (ruta) => almacenFotos().abrir(ruta),
  barrerTemporales: (antesDe) => almacenFotos().barrerTemporales(antesDe),
  borrar: (ruta) => almacenFotos().borrar(ruta),
  get prepararSubidaDirecta() {
    const a = almacenFotos();
    return a.prepararSubidaDirecta ? () => a.prepararSubidaDirecta!() : undefined;
  },
  get leerTemporal() {
    const a = almacenFotos();
    return a.leerTemporal ? (id: string, maxBytes: number) => a.leerTemporal!(id, maxBytes) : undefined;
  },
};

export const sitio = crearServicioSitio({ leer: prisma, escribir: conActor, fotos: { almacen: almacenPerezoso, procesar: procesarFoto } });

export * from "./index";
