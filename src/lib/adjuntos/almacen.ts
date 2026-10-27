import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { diaEnTucuman } from "@/lib/fechas";
import { BYTES_CABECERA } from "./tipos";

/**
 * Dónde se guardan los adjuntos (docs/propuesta-mvp.md, sección 6,
 * "Adjuntos"), detrás de una interfaz: hoy el disco del servidor; si Sistemas
 * ofrece MinIO, cambia solo la implementación.
 *
 * El ciclo de un archivo:
 * 1. `recibir()`: el contenido llega en streaming y se escribe en `tmp/<uuid>`
 *    calculando el sha256 al vuelo, con fsync al final. Si pasa del máximo,
 *    corta y borra lo escrito.
 * 2. El dominio inserta el movimiento `adjunto` en `conActor()`.
 * 3. Hecho el commit, `confirmar()`: rename al destino `AAAA/MM/<uuid>`,
 *    permisos 0440. Si la transacción falló, `descartar()` borra el temporal.
 * 4. `barrerTemporales()`: lo que quedó en `tmp/` (un proceso que murió entre
 *    1 y 3) se borra pasadas 24 h. Lo corre `scripts/barrer-adjuntos-tmp.ts`.
 *
 * La app nunca borra un adjunto confirmado, salvo la purga del admin
 * (`borrar()`, semana 4).
 *
 * Hay dos implementaciones y se elige con ADJUNTOS_ALMACEN (./config.ts):
 * `disco` (esta, el servidor municipal) y `supabase` (./supabase.ts, Supabase
 * Storage, para Vercel). La de Storage suma la subida DIRECTA desde el
 * navegador (`prepararSubidaDirecta()` e `inspeccionarTemporal()`): en Vercel
 * el cuerpo de un request no puede pasar de 4,5 MB y un adjunto llega a 10 MB,
 * así que al subir el archivo no pasa por la app (docs/despliegue-vercel.md).
 */

export interface ArchivoRecibido {
  /** UUID: el nombre del temporal y del archivo definitivo. */
  id: string;
  bytes: number;
  /** Hexadecimal, 64 caracteres. */
  sha256: string;
  /** Los primeros bytes, para reconocer el tipo. */
  cabecera: Uint8Array;
}

export interface ArchivoAbierto {
  contenido: ReadableStream<Uint8Array>;
  /** El largo del archivo, o null si el almacén no lo informa (va sin Content-Length). */
  bytes: number | null;
}

/** Lo que necesita el navegador para subir el archivo directo al almacén. */
export interface SubidaDirecta {
  /** UUID del temporal (`tmp/<id>`) que el navegador va a escribir. */
  id: string;
  /** URL firmada para ese único destino: el navegador hace PUT del archivo ahí. */
  url: string;
}

export interface AlmacenAdjuntos {
  /** @throws ArchivoMuyGrande si supera `maxBytes` (y no deja nada escrito). */
  recibir(contenido: ReadableStream<Uint8Array>, maxBytes: number): Promise<ArchivoRecibido>;
  /** Mueve el temporal a `ruta` (relativa: `AAAA/MM/<uuid>`). Después del commit. */
  confirmar(archivo: ArchivoRecibido, ruta: string): Promise<void>;
  /** Borra el temporal. No falla si ya no está. */
  descartar(archivo: ArchivoRecibido): Promise<void>;
  /** @throws Error si el archivo no existe. */
  abrir(ruta: string): Promise<ArchivoAbierto>;
  /** Borra los temporales modificados antes de `antesDe`; devuelve cuántos. */
  barrerTemporales(antesDe: Date): Promise<number>;
  /**
   * Semana 4: borra un archivo confirmado. Solo para la purga del admin (Ley
   * 25.326, 2.13(b)). No falla si ya no está: una purga repetida no es un error.
   */
  borrar(ruta: string): Promise<void>;
  /**
   * Solo los almacenes que aceptan la subida directa del navegador (Supabase
   * Storage): reserva `tmp/<uuid>` y devuelve la URL firmada para escribirlo.
   */
  prepararSubidaDirecta?(): Promise<SubidaDirecta>;
  /**
   * Lee en streaming el temporal `tmp/<id>` que subió el navegador y lo mide
   * como `recibir()`: bytes, sha256 y cabecera. No lo mueve ni lo borra (eso
   * es `confirmar()` o `descartar()`), salvo que pase de `maxBytes`.
   *
   * @throws ArchivoMuyGrande si supera `maxBytes` (y lo borra)
   * @throws TemporalAusente si no existe (el navegador no llegó a subirlo)
   */
  inspeccionarTemporal?(id: string, maxBytes: number): Promise<ArchivoRecibido>;
}

export class ArchivoMuyGrande extends Error {
  constructor(readonly maximo: number) {
    super(`El archivo supera el máximo de ${maximo} bytes`);
    this.name = "ArchivoMuyGrande";
  }
}

/** El temporal de una subida directa no está en el almacén. */
export class TemporalAusente extends Error {
  constructor() {
    super("El archivo no llegó al almacenamiento");
    this.name = "TemporalAusente";
  }
}

/** El almacén configurado no acepta la subida directa desde el navegador (es el disco). */
export class SubidaDirectaNoDisponible extends Error {
  constructor() {
    super("Este almacenamiento recibe los adjuntos a través de la app, no directo desde el navegador");
    this.name = "SubidaDirectaNoDisponible";
  }
}

export interface Medidor {
  /** @throws ArchivoMuyGrande en cuanto se pasa del máximo. */
  agregar(parte: Uint8Array): void;
  resultado(id: string): ArchivoRecibido;
}

/**
 * Mide un archivo que pasa en pedazos, como `recibir()` del disco: bytes,
 * sha256 al vuelo y los primeros `BYTES_CABECERA` bytes, con un máximo.
 */
export function crearMedidor(maxBytes: number): Medidor {
  const hash = createHash("sha256");
  const cabecera = new Uint8Array(BYTES_CABECERA);
  let enCabecera = 0;
  let bytes = 0;
  return {
    agregar(parte) {
      bytes += parte.byteLength;
      if (bytes > maxBytes) throw new ArchivoMuyGrande(maxBytes);
      if (enCabecera < BYTES_CABECERA) {
        const inicio = parte.subarray(0, BYTES_CABECERA - enCabecera);
        cabecera.set(inicio, enCabecera);
        enCabecera += inicio.byteLength;
      }
      hash.update(parte);
    },
    resultado(id) {
      return { id, bytes, sha256: hash.digest("hex"), cabecera: cabecera.slice(0, enCabecera) };
    },
  };
}

/** `AAAA/MM/<uuid>`, con el año y el mes de Tucumán. */
export function rutaParaAdjunto(ahora: Date, id: string): string {
  const [anio, mes] = diaEnTucuman(ahora).split("-");
  return `${anio}/${mes}/${id}`;
}

/** La ruta de un adjunto confirmado: `AAAA/MM/<uuid>`. */
export const RE_RUTA = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;
/** El nombre de un temporal: un UUID. */
export const RE_ID = /^[0-9a-f-]{36}$/;

/**
 * La carpeta de los adjuntos: `ADJUNTOS_DIR` (en producción, obligatoria y
 * absoluta, por ejemplo `/var/lib/cementeria/adjuntos`, fuera del webroot) o,
 * en desarrollo, `./.data/adjuntos`.
 *
 * @throws Error en producción sin `ADJUNTOS_DIR` absoluta.
 */
export function raizAdjuntos(fuente: Readonly<Record<string, string | undefined>> = process.env): string {
  const valor = fuente.ADJUNTOS_DIR?.trim();
  if (valor) {
    if (fuente.NODE_ENV === "production" && !isAbsolute(valor)) throw new Error("ADJUNTOS_DIR: en producción tiene que ser una ruta absoluta");
    return resolve(valor);
  }
  if (fuente.NODE_ENV === "production") throw new Error("ADJUNTOS_DIR: falta (carpeta de los adjuntos, fuera del webroot)");
  return resolve(".data", "adjuntos");
}

function codigoDe(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function borrarSiExiste(ruta: string): Promise<void> {
  try {
    await unlink(ruta);
  } catch (error) {
    if (codigoDe(error) !== "ENOENT") throw error;
  }
}

/**
 * El almacenamiento en disco. No toca el disco al crearse (lo crea perezoso
 * el primer `recibir()`): `next build` importa el servidor sin la carpeta.
 */
export function crearAlmacenEnDisco(raiz: string): AlmacenAdjuntos {
  const carpetaTmp = join(raiz, "tmp");
  const temporal = (id: string): string => {
    if (!RE_ID.test(id)) throw new Error("Id de adjunto inválido");
    return join(carpetaTmp, id);
  };
  const definitivo = (ruta: string): string => {
    // La ruta sale de la base, pero igual se controla: nunca fuera de la raíz.
    if (!RE_RUTA.test(ruta)) throw new Error("Ruta de adjunto inválida");
    return join(raiz, ...ruta.split("/"));
  };

  return {
    async recibir(contenido, maxBytes) {
      await mkdir(carpetaTmp, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      const ruta = temporal(id);
      const archivo = await open(ruta, "wx", 0o600);
      const hash = createHash("sha256");
      const cabecera = new Uint8Array(BYTES_CABECERA);
      let enCabecera = 0;
      let bytes = 0;
      const lector = contenido.getReader();
      try {
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await lector.cancel().catch(() => undefined);
            throw new ArchivoMuyGrande(maxBytes);
          }
          if (enCabecera < BYTES_CABECERA) {
            const parte = value.subarray(0, BYTES_CABECERA - enCabecera);
            cabecera.set(parte, enCabecera);
            enCabecera += parte.byteLength;
          }
          hash.update(value);
          await archivo.write(value);
        }
        // Que esté en el disco antes de insertar el movimiento que lo nombra.
        await archivo.sync();
        await archivo.close();
      } catch (error) {
        await archivo.close().catch(() => undefined);
        await borrarSiExiste(ruta);
        throw error;
      } finally {
        lector.releaseLock();
      }
      return { id, bytes, sha256: hash.digest("hex"), cabecera: cabecera.slice(0, enCabecera) };
    },

    async confirmar(archivo, ruta) {
      const destino = definitivo(ruta);
      await mkdir(dirname(destino), { recursive: true, mode: 0o750 });
      await rename(temporal(archivo.id), destino);
      // En Windows (solo desarrollo) no hay permisos POSIX ni fsync de
      // carpetas, y un archivo de solo lectura no se deja borrar al limpiar.
      if (sep === "/") {
        // Solo lectura para el usuario del servicio.
        await chmod(destino, 0o440);
        // El rename queda firme cuando se sincroniza la carpeta.
        const carpeta = await open(dirname(destino), "r");
        try {
          await carpeta.sync();
        } finally {
          await carpeta.close();
        }
      }
    },

    async descartar(archivo) {
      await borrarSiExiste(temporal(archivo.id));
    },

    async abrir(ruta) {
      const archivo = definitivo(ruta);
      const datos = await stat(archivo);
      const flujo = createReadStream(archivo);
      // Los tipos de node:stream/web y los del DOM no coinciden en TypeScript,
      // pero son el mismo ReadableStream en tiempo de ejecución.
      return { contenido: Readable.toWeb(flujo) as unknown as ReadableStream<Uint8Array>, bytes: datos.size };
    },

    async borrar(ruta) {
      const archivo = definitivo(ruta);
      // En Linux el archivo es 0440: el unlink depende de la carpeta, no del archivo.
      if (sep !== "/") await chmod(archivo, 0o600).catch(() => undefined);
      await borrarSiExiste(archivo);
    },

    async barrerTemporales(antesDe) {
      let nombres: string[];
      try {
        nombres = await readdir(carpetaTmp);
      } catch (error) {
        if (codigoDe(error) === "ENOENT") return 0;
        throw error;
      }
      let borrados = 0;
      for (const nombre of nombres) {
        if (!RE_ID.test(nombre)) continue;
        const ruta = join(carpetaTmp, nombre);
        const datos = await stat(ruta).catch(() => null);
        if (datos && datos.isFile() && datos.mtime.getTime() < antesDe.getTime()) {
          await borrarSiExiste(ruta);
          borrados += 1;
        }
      }
      return borrados;
    },
  };
}

/** Horas que un temporal puede quedar en `tmp/` antes de que el barrido lo borre. */
export const HORAS_TEMPORALES = 24;

/**
 * El barrido diario de temporales (timer `cementeria-adjuntos-tmp`): borra lo
 * que quedó en `tmp/` con más de 24 h. Un temporal más nuevo puede ser una
 * subida en curso.
 */
export function barrerTemporales(almacen: AlmacenAdjuntos, ahora: Date = new Date(), horas: number = HORAS_TEMPORALES): Promise<number> {
  return almacen.barrerTemporales(new Date(ahora.getTime() - horas * 60 * 60 * 1000));
}
