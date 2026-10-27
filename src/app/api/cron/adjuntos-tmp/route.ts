import { crearAlmacenDesdeEntorno, descripcionAlmacen } from "@/lib/adjuntos/fabrica";
import { correrCron } from "@/lib/cron/autorizacion";
import { tareaBarrerAdjuntos } from "@/lib/tareas/programadas";

/**
 * GET /api/cron/adjuntos-tmp: borra los temporales de adjuntos de más de 24 h
 * (`tmp/` del almacén: subidas que no se confirmaron). En el servidor
 * municipal, el timer `cementeria-adjuntos-tmp`. Vercel Cron la llama a las
 * 07:30 UTC (04:30 de Tucumán). Idempotente.
 */

export const maxDuration = 120;

export async function GET(request: Request): Promise<Response> {
  return correrCron(request, "adjuntos_tmp", async () => {
    const r = await tareaBarrerAdjuntos(crearAlmacenDesdeEntorno());
    return { ok: true, datos: { almacen: descripcionAlmacen(), horas: r.horas, borrados: r.borrados, duracion_ms: r.duracionMs } };
  });
}
