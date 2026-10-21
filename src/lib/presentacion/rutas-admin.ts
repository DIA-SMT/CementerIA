/**
 * Las rutas de Administración (semana 5). Aparte de ./acciones-admin.ts para
 * que los componentes de cliente las usen sin arrastrar la lógica del servidor.
 */

export const RUTA_PLANTILLAS = "/admin/plantillas";

/** `/admin/plantillas/RENOV_CONTADO/v/2`. */
export function rutaVersionPlantilla(codigo: string, version: number): string {
  return `${RUTA_PLANTILLAS}/${encodeURIComponent(codigo)}/v/${version}`;
}
