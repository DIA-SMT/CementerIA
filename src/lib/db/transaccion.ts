import "server-only";
import { conActorEn, type OpcionesActor, type Transaccion } from "./actor";
import { prisma } from "./cliente";

export type { OpcionesActor, Transaccion };

/**
 * La única puerta de escritura de la app (docs/propuesta-mvp.md, sección 2,
 * "Convenciones").
 *
 * Abre un `$transaction` interactivo, fija el actor y el motivo para esa
 * transacción y le pasa a `fn` el cliente transaccional: todo lo que `fn`
 * escriba con `tx` queda firmado por `usuarioId`, y si algo falla se deshace
 * entero (el movimiento y la proyección del expediente van juntos o no van).
 *
 * @example
 * await conActor(usuario.id, "Falta firma del Director", async (tx) => {
 *   await tx.movimiento.create({ data: { … , usuarioId: usuario.id } });
 *   await tx.expediente.update({ … });
 * });
 */
export function conActor<T>(
  usuarioId: number,
  motivo: string | null,
  fn: (tx: Transaccion) => Promise<T>,
  opciones?: OpcionesActor,
): Promise<T> {
  return conActorEn(prisma, usuarioId, motivo, fn, opciones);
}
