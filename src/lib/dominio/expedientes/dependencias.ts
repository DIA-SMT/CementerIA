import type { AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
import type { Transaccion } from "@/lib/db/crear-cliente";

/**
 * Lo que el dominio de expedientes necesita de afuera. Lo recibe en vez de
 * importarlo (como src/lib/auth/ingreso.ts): así este código no arrastra
 * `server-only` y lo usan igual la app (./servidor.ts, con el cliente global y
 * `conActor()`), la semilla y los tests (con `crearCliente()` y `conActorEn()`).
 */

type MetodosDeLectura = "findUnique" | "findUniqueOrThrow" | "findFirst" | "findFirstOrThrow" | "findMany" | "count";
type SoloLectura<D> = Pick<D, Extract<keyof D, MetodosDeLectura>>;

/**
 * Un cliente que solo lee. Tanto el cliente global como el `tx` de una
 * transacción lo cumplen; tiparlo así hace que por acá no se pueda escribir
 * fuera de `conActor()`. `$queryRaw` queda porque la búsqueda lo necesita: se
 * usa solo con SELECT.
 */
export interface Lector {
  $queryRaw: Transaccion["$queryRaw"];
  area: SoloLectura<Transaccion["area"]>;
  cementerio: SoloLectura<Transaccion["cementerio"]>;
  tipoMonumento: SoloLectura<Transaccion["tipoMonumento"]>;
  tipoTramite: SoloLectura<Transaccion["tipoTramite"]>;
  plantilla: SoloLectura<Transaccion["plantilla"]>;
  expediente: SoloLectura<Transaccion["expediente"]>;
  expedientePersona: SoloLectura<Transaccion["expedientePersona"]>;
  movimiento: SoloLectura<Transaccion["movimiento"]>;
  usuario: SoloLectura<Transaccion["usuario"]>;
}

/** La firma de `conActor()` (src/lib/db/transaccion.ts). */
export type Escritor = <T>(usuarioId: number, motivo: string | null, fn: (tx: Transaccion) => Promise<T>) => Promise<T>;

export interface DependenciasExpedientes {
  /** Lecturas fuera de una transacción (búsqueda, opciones del formulario, avisos). */
  leer: Lector;
  /** Toda escritura, y las lecturas que tienen que ser consistentes con ella. */
  escribir: Escritor;
  /** El reloj. Por defecto `new Date()`; los tests lo fijan. */
  ahora?: () => Date;
  /**
   * Dónde se guardan los adjuntos (src/lib/adjuntos/almacen.ts). Solo lo usan
   * `subirAdjunto` y `leerAdjunto`; la app lo arma con `ADJUNTOS_DIR`.
   */
  almacen?: AlmacenAdjuntos;
}
