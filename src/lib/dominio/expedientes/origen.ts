import { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";

/**
 * "Del papel": el expediente se dio de alta como iniciado antes del sistema
 * (2.13(c)), para transcribir su ficha. Es su origen y no cambia nunca.
 *
 * No es lo mismo que `expedientes.carga_historica`: esa columna dice si la
 * transcripción sigue ABIERTA, y "Terminar carga histórica" la apaga. Para
 * saber de dónde vino, se mira el alta (`movimientos.carga_historica` del
 * movimiento `alta`), que es inmutable. Es el mismo criterio que usan las
 * métricas para separar la línea de base de antes del sistema (metricas/), y
 * lo usan el buscador (filtro `historica`, la marca "Del papel" y el CSV), la
 * ficha, la carátula y la edición (el contacto no es obligatorio).
 *
 * No hace falta una columna: el alta es la primera fila del historial de cada
 * expediente, y leerla es una búsqueda por `(expediente_id, secuencia)`.
 */

/** ¿El expediente `e` vino del papel? (boolean; supone el expediente como `e` en la consulta). */
export const SQL_DEL_PAPEL = Prisma.sql`coalesce((SELECT al.carga_historica FROM public.movimientos al
   WHERE al.expediente_id = e.id AND al.tipo = 'alta' ORDER BY al.secuencia LIMIT 1), false)`;

/** Lo mismo para un expediente, con una lectura del alta (la carátula, la edición). */
export async function delPapelDe(lector: Pick<Transaccion, "movimiento">, expedienteId: bigint): Promise<boolean> {
  const alta = await lector.movimiento.findFirst({ where: { expedienteId, tipo: "alta" }, select: { cargaHistorica: true } });
  return alta?.cargaHistorica ?? false;
}

/** Lo mismo con los movimientos ya leídos (la ficha). */
export function esDelPapel(movimientos: ReadonlyArray<{ tipo: string; cargaHistorica: boolean }>): boolean {
  return movimientos.find((m) => m.tipo === "alta")?.cargaHistorica ?? false;
}
