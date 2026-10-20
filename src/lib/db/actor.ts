import type { Prisma } from "@/generated/prisma/client";
import type { Cliente, Transaccion } from "./crear-cliente";

export type { Transaccion };

export interface OpcionesActor {
  /** Milisegundos que puede durar la transacción. Por defecto 15 s. */
  timeout?: number;
  /** Milisegundos que espera una conexión libre del pool. Por defecto 5 s. */
  maxWait?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Corre `fn` en una transacción interactiva con el actor fijado.
 *
 * Fija `app.usuario_id` y `app.motivo` con `set_config(…, true)`, o sea solo
 * para esta transacción: con el pool, un SET de sesión quedaría pegado a la
 * conexión y el próximo request escribiría con el actor de otro. Los triggers
 * lo leen con `f_actor()`: `movimientos_sellar` exige que el movimiento declare
 * el mismo usuario, y `auditar_cambio` lo registra como autor.
 *
 * Esta es la versión que recibe el cliente, para la semilla y los tests. La app
 * usa `conActor()` de ./transaccion.ts.
 *
 * @param motivo Por qué se hace el cambio. `null` o vacío = sin motivo; los
 *   CHECKs y triggers que lo exigen fallan si falta.
 */
export async function conActorEn<T>(
  cliente: Cliente,
  usuarioId: number,
  motivo: string | null,
  fn: (tx: Transaccion) => Promise<T>,
  opciones: OpcionesActor = {},
): Promise<T> {
  if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
    throw new Error(`conActor: usuarioId inválido (${String(usuarioId)})`);
  }
  return cliente.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.usuario_id', ${String(usuarioId)}, true),
                                  set_config('app.motivo', ${motivo?.trim() ?? ""}, true)`;
      return fn(tx);
    },
    { timeout: 15_000, maxWait: 5_000, ...opciones },
  );
}
