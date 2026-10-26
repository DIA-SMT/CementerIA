import type { Transaccion } from "@/lib/db/crear-cliente";
import type { Escritor } from "../expedientes/dependencias";

/**
 * Lo que el dominio de avisos necesita de afuera, como el de expedientes
 * (../expedientes/dependencias.ts): la app le pasa el cliente global y
 * `conActor()` (./servidor.ts); la semilla, los scripts y los tests, un cliente
 * propio y `conActorEn()`.
 */

type MetodosDeLectura = "findUnique" | "findUniqueOrThrow" | "findFirst" | "findFirstOrThrow" | "findMany" | "count";
type SoloLectura<D> = Pick<D, Extract<keyof D, MetodosDeLectura>>;

/** Un cliente que solo lee (el global o el `tx` de una transacción). `$queryRaw`, solo con SELECT. */
export interface LectorAvisos {
  $queryRaw: Transaccion["$queryRaw"];
  aviso: SoloLectura<Transaccion["aviso"]>;
  avisoPreferencia: SoloLectura<Transaccion["avisoPreferencia"]>;
  avisoCorrida: SoloLectura<Transaccion["avisoCorrida"]>;
}

export interface DependenciasAvisos {
  leer: LectorAvisos;
  /** Toda escritura (marcar leído, preferencias, la generación por tiempo). */
  escribir: Escritor;
  /** El reloj. Por defecto `new Date()`; los tests lo fijan. */
  ahora?: () => Date;
}
