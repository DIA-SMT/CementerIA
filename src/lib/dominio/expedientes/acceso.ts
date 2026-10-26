import { isIP } from "node:net";
import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import type { EstadoExpediente, ExpedientePermisos } from "../permisos";
import { ESTADOS_EXPEDIENTE } from "../permisos";
import type { Lector } from "./dependencias";
import { ErrorDominio, noEncontrado } from "./errores";
import { canonizarNumeroInterno } from "./numero";

/**
 * Lo que los permisos necesitan saber de un expediente concreto (3.2): su
 * estado, el área responsable, las áreas por las que pasó y si ya tuvo un pase.
 */

export function comoEstado(valor: string): EstadoExpediente {
  if ((ESTADOS_EXPEDIENTE as readonly string[]).includes(valor)) return valor as EstadoExpediente;
  throw new ErrorDominio("configuracion_incompleta", `Estado de expediente desconocido: ${valor}`);
}

/** El número canónico, o `no_encontrado` si ni siquiera tiene forma de número. */
export function exigirNumero(numero: string): string {
  const canonico = canonizarNumeroInterno(numero);
  if (!canonico) throw noEncontrado(numero);
  return canonico;
}

/**
 * @param totalPasos los pasos de la plantilla del expediente: con él (y
 *   `pasoOrden`) se completan `pasoFinal` y `primerPaso`, que deciden el pase y
 *   la devolución. Sin él, quedan sin informar.
 */
export async function permisosDelExpediente(
  lector: Lector,
  expediente: { id: bigint; estado: string; areaResponsableId: number; cargaHistorica?: boolean; pasoOrden?: number },
  totalPasos?: number,
): Promise<ExpedientePermisos> {
  const movimientos = await lector.movimiento.findMany({
    where: { expedienteId: expediente.id },
    select: { tipo: true, areaDestinoId: true, areaUsuarioId: true },
  });
  const areas = new Set<number>();
  let tuvoPases = false;
  for (const m of movimientos) {
    if (m.areaDestinoId !== null) areas.add(m.areaDestinoId);
    if (m.areaUsuarioId !== null) areas.add(m.areaUsuarioId);
    if (m.tipo === "pase") tuvoPases = true;
  }
  return {
    estado: comoEstado(expediente.estado),
    areaResponsableId: expediente.areaResponsableId,
    areasRecorridas: [...areas],
    tuvoPases,
    cargaHistorica: expediente.cargaHistorica,
    pasoFinal: totalPasos !== undefined && expediente.pasoOrden !== undefined ? expediente.pasoOrden >= totalPasos : undefined,
    primerPaso: expediente.pasoOrden !== undefined ? expediente.pasoOrden <= 1 : undefined,
  };
}

/**
 * Semana 4: `exportar` (CSV del buscador), sin expediente. 26/10/2026:
 * `verificar_historial` (la cadena de hash de un expediente, o de todos sin expediente).
 */
export type AccionAcceso =
  | "ver_expediente"
  | "ver_datos_completos"
  | "imprimir"
  | "ver_adjunto"
  | "descargar_adjunto"
  | "exportar"
  | "verificar_historial";

export interface OpcionesAcceso {
  /** IP del cliente (`ipDeSolicitud()` de src/lib/auth/red.ts), para auditoria.accesos. */
  ip?: string | null;
}

/**
 * Deja constancia en `auditoria.accesos` (2.10). Va en la misma transacción que
 * la lectura: si no se puede registrar, no se muestra.
 */
export async function registrarAcceso(
  tx: Transaccion,
  datos: { usuarioId: number; accion: AccionAcceso; expedienteId: bigint | null; detalle?: Prisma.InputJsonObject; ip?: string | null },
): Promise<void> {
  // Una IP mal formada haría fallar el INSERT en la columna inet y se perdería el registro.
  const ip = datos.ip && isIP(datos.ip) !== 0 ? datos.ip : null;
  await tx.auditoriaAcceso.create({
    data: { usuarioId: datos.usuarioId, accion: datos.accion, expedienteId: datos.expedienteId, detalle: datos.detalle ?? {}, ip },
  });
}
