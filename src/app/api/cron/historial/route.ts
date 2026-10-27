import { prisma } from "@/lib/db/cliente";
import { correrCron } from "@/lib/cron/autorizacion";
import { tareaHistorial } from "@/lib/tareas/programadas";

/**
 * GET /api/cron/historial: la verificación nocturna de la cadena de hash de
 * todo el historial, con la constancia en auditoria.accesos (en el servidor
 * municipal, el timer `cementeria-historial`). Vercel Cron la llama a las
 * 06:30 UTC (03:30 de Tucumán). Si algún expediente tiene la cadena rota
 * responde 500 (queda marcada en Vercel) con la cantidad; los números van al log.
 */

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return correrCron(request, "historial", async () => {
    const r = await tareaHistorial(prisma);
    const datos = { expedientes: r.expedientes, integros: r.integros, rotos: r.rotos, movimientos: r.movimientos, duracion_ms: r.duracionMs };
    if (r.rotos === 0) return { ok: true, datos };
    return { ok: false, datos: { ...datos, numeros_rotos: r.detalleRotos.map((x) => x.numero).join(",") } };
  });
}
