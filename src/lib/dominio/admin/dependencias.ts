import type { Transaccion } from "@/lib/db/crear-cliente";
import type { Escritor, Lector } from "../expedientes/dependencias";

/**
 * Lo que la administración (semana 5) necesita de afuera: lo mismo que el
 * dominio de expedientes (./expedientes/dependencias.ts) más la lectura de
 * `auditoria.*`. El cliente global y el `tx` de una transacción lo cumplen; la
 * app usa `admin` de ./servidor.ts, y los tests arman el servicio con su
 * cliente.
 */

type MetodosDeLectura = "findUnique" | "findUniqueOrThrow" | "findFirst" | "findFirstOrThrow" | "findMany" | "count";
type SoloLectura<D> = Pick<D, Extract<keyof D, MetodosDeLectura>>;

export interface LectorAdmin extends Lector {
  auditoriaCambio: SoloLectura<Transaccion["auditoriaCambio"]>;
  auditoriaAcceso: SoloLectura<Transaccion["auditoriaAcceso"]>;
}

/**
 * Varias lecturas, de a una y en orden (como `Promise.all`, pero en serie): el
 * lector puede ser el `tx` de una transacción, que tiene una sola conexión, y
 * pg no admite consultas superpuestas en un mismo cliente (ver
 * expedientes/contexto.ts, `cargarContexto`).
 */
export async function enSerie<T extends readonly unknown[]>(...lecturas: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const r: unknown[] = [];
  for (const leer of lecturas) r.push(await leer());
  return r as unknown as T;
}

export interface DependenciasAdmin {
  leer: LectorAdmin;
  /** `conActor()`: el trigger `auditar_cambio` toma de ahí el autor y el motivo. */
  escribir: Escritor;
  ahora?: () => Date;
}
