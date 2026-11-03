import { prisma } from "@/lib/db/cliente";
import { correrCron } from "@/lib/cron/autorizacion";
import { tareaAvisos, tareaPurgarIntentosConsulta, tareaPurgarMigue } from "@/lib/tareas/programadas";

/**
 * GET /api/cron/avisos: los avisos por tiempo del día (en el servidor
 * municipal, el timer `cementeria-avisos` con scripts/generar-avisos.ts).
 * Vercel Cron la llama a las 09:00 UTC (06:00 de Tucumán; vercel.json) con
 * `Authorization: Bearer <CRON_SECRET>`. Idempotente.
 *
 * 28/10/2026: después, la limpieza de los intentos fallidos de la consulta
 * pública de más de 7 días (tareaPurgarIntentosConsulta). 02/11/2026: y la
 * retención de Migue: el registro de más de 90 días y los topes de más de un
 * día (tareaPurgarMigue).
 */

// La transacción tiene 120 s; el máximo de Vercel Hobby es 300 s.
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return correrCron(request, "avisos", async () => {
    const r = await tareaAvisos(prisma);
    const intentos = await tareaPurgarIntentosConsulta(prisma);
    const migue = await tareaPurgarMigue(prisma);
    const porTipo = Object.fromEntries(Object.entries(r.porTipo).map(([t, n]) => [`creados_${t}`, n]));
    return {
      ok: true,
      datos: {
        dia: r.dia,
        expedientes: r.expedientes,
        creados: r.creados,
        ...porTipo,
        intentos_consulta_borrados: intentos.borrados,
        migue_consultas_borradas: migue.consultas,
        migue_consumo_borrado: migue.consumo,
        duracion_ms: r.duracionMs + intentos.duracionMs + migue.duracionMs,
      },
    };
  });
}
