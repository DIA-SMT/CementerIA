import { barrerTemporales, HORAS_TEMPORALES, type AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
import { SISTEMA_ID } from "@/lib/auth/ingreso";
import { conActorEn } from "@/lib/db/actor";
import type { Cliente } from "@/lib/db/crear-cliente";
import { generarYAnotar } from "@/lib/dominio/avisos";
import { verificarIntegridadNocturna, type DependenciasExpedientes } from "@/lib/dominio/expedientes";

/**
 * Las tareas programadas, en un solo lugar para los dos despliegues: los
 * scripts que disparan los timers de systemd en el servidor municipal
 * (scripts/generar-avisos.ts, scripts/verificar-historial.ts,
 * scripts/barrer-adjuntos-tmp.ts) y los Route Handlers que dispara Vercel Cron
 * (src/app/api/cron/*). Hacen exactamente lo mismo; cambia quién las llama.
 *
 * Todas son idempotentes (Vercel puede no llamar una vez o llamar dos veces la
 * misma: vercel.com/docs/cron-jobs/manage-cron-jobs, "Cron job delivery and
 * idempotency"): los avisos no se repiten (la clave es por expediente y
 * situación), la verificación solo deja una constancia más y el barrido borra
 * lo que ya no está como si nada.
 *
 * Los resúmenes no llevan datos personales: cantidades y, si la cadena está
 * rota, los números internos de los expedientes (no identifican a nadie).
 */

export interface ResumenAvisos {
  dia: string;
  expedientes: number;
  creados: number;
  porTipo: Record<string, number>;
  duracionMs: number;
}

/** Los avisos por tiempo del día (lo que hacía el timer `cementeria-avisos` a las 6:00). */
export async function tareaAvisos(cliente: Cliente, ahora: Date = new Date()): Promise<ResumenAvisos> {
  const inicio = Date.now();
  // Como SISTEMA, con más tiempo que una acción de la app: recorre todos los expedientes en trabajo.
  const r = await conActorEn(cliente, SISTEMA_ID, "Avisos por tiempo (tarea programada)", (tx) => generarYAnotar(tx, ahora), { timeout: 120_000 });
  return {
    dia: r.dia,
    expedientes: r.expedientes,
    creados: r.creados,
    porTipo: Object.fromEntries(Object.entries(r.porTipo).filter(([, n]) => n > 0)),
    duracionMs: Date.now() - inicio,
  };
}

export interface ResumenHistorial {
  expedientes: number;
  integros: number;
  rotos: number;
  movimientos: number;
  duracionMs: number;
  /** Los expedientes con la cadena rota (número interno, secuencia y motivo). */
  detalleRotos: Array<{ numero: string; secuenciaRota: number | null; motivo: string | null }>;
}

/**
 * La verificación nocturna de la cadena de hash de TODO el historial, con la
 * constancia en auditoria.accesos (lo que hacía el timer `cementeria-historial`).
 */
export async function tareaHistorial(cliente: Cliente): Promise<ResumenHistorial> {
  const inicio = Date.now();
  const deps: DependenciasExpedientes = { leer: cliente, escribir: (usuarioId, motivo, fn) => conActorEn(cliente, usuarioId, motivo, fn) };
  const r = await verificarIntegridadNocturna(deps);
  return {
    expedientes: r.expedientes,
    integros: r.integros,
    rotos: r.rotos.length,
    movimientos: r.movimientos,
    duracionMs: Date.now() - inicio,
    detalleRotos: r.rotos.map((x) => ({ numero: x.numero, secuenciaRota: x.secuenciaRota ?? null, motivo: x.motivo ?? null })),
  };
}

export interface ResumenBarrido {
  horas: number;
  borrados: number;
  duracionMs: number;
}

/** El barrido de temporales de adjuntos de más de 24 h (timer `cementeria-adjuntos-tmp`). */
export async function tareaBarrerAdjuntos(almacen: AlmacenAdjuntos, ahora: Date = new Date(), horas: number = HORAS_TEMPORALES): Promise<ResumenBarrido> {
  const inicio = Date.now();
  const borrados = await barrerTemporales(almacen, ahora, horas);
  return { horas, borrados, duracionMs: Date.now() - inicio };
}

export interface ResumenIntentosConsulta {
  borrados: number;
  duracionMs: number;
}

/**
 * La limpieza de los intentos fallidos de la consulta pública (28/10/2026):
 * borra los de más de 7 días (`f_purgar_intentos_consulta()`: la retención está
 * en la base, y el trigger intentos_consulta_proteger no deja borrar uno más nuevo). Corre con los avisos
 * de cada mañana, la tarea diaria que ya va contra la base (timer
 * `cementeria-avisos` y GET /api/cron/avisos): el barrido de temporales, en el
 * servidor municipal, no tiene a propósito las credenciales de la base. Idempotente.
 */
export async function tareaPurgarIntentosConsulta(cliente: Cliente): Promise<ResumenIntentosConsulta> {
  const inicio = Date.now();
  // Como SISTEMA, como las demás escrituras (la función no pide actor, pero así queda dicho quién la corre).
  const [fila] = await conActorEn(cliente, SISTEMA_ID, "Limpieza de intentos de la consulta pública", (tx) =>
    tx.$queryRaw<Array<{ borrados: number }>>`SELECT public.f_purgar_intentos_consulta() AS borrados`,
  );
  return { borrados: Number(fila?.borrados ?? 0), duracionMs: Date.now() - inicio };
}
