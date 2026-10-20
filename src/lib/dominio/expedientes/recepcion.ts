import { exigirPermiso, PermisoDenegado, type UsuarioPermisos } from "../permisos";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, estadoNoAdmite } from "./errores";
import { interpretarFechaEfectiva, validarFechaEfectiva, type EntradaFechaEfectiva } from "./flujo";
import { ejecutarAccion, fechaInicioDe, ultimoMovimientoDeUbicacion } from "./operacion";

/**
 * Confirmar la recepción (decisión 8, 3.2 y 5: "Confirmar recepción, de a uno
 * o en lote"). El pase deja el expediente "sin confirmar" en el área de
 * destino (`recibido_en` nulo); el área lo confirma con un clic. No bloquea:
 * si el área actúa sin confirmar, la acción inserta antes una recepción
 * implícita (operacion.ts, `recepcionImplicita`).
 *
 * La confirma el área responsable, que en un paso interno es donde está el
 * papel. En un paso externo `recibido_en` ya viene puesto (nadie confirma
 * afuera), así que no hay nada que confirmar.
 *
 * Inserta una `recepcion` con `{implicita: false}`, `recibido_en` = su fecha
 * efectiva (por defecto, ahora; se admite una anterior, hasta 30 días, no
 * anterior a la llegada) y `version + 1`.
 */

export interface OpcionesRecepcion {
  /** Cuándo llegó el papel, si no fue ahora (ver `EntradaFechaEfectiva`). */
  fechaEfectiva?: EntradaFechaEfectiva;
}

export interface ResultadoRecepcion {
  numero: string;
  /** La versión nueva, para la próxima acción. */
  version: number;
  repetido: boolean;
  movimientoId: string;
  recibidoEn: Date;
}

/**
 * Confirma la recepción de un expediente.
 *
 * @throws PermisoDenegado (no es el área responsable, o el estado no lo admite)
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `ya_recibido`, `validacion` (fecha)
 */
export async function confirmarRecepcion(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesRecepcion = {},
): Promise<ResultadoRecepcion> {
  return ejecutarAccion<ResultadoRecepcion>(
    deps,
    usuario,
    {
      numero,
      comandoId,
      tipo: "recepcion",
      motivo: null,
      versionVista,
      repetido: async (tx, expedienteId, movimientoId) => {
        const e = await tx.expediente.findUniqueOrThrow({ where: { id: expedienteId }, select: { numeroInterno: true, version: true } });
        const m = await tx.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { fechaEfectiva: true } });
        return { numero: e.numeroInterno, version: e.version, repetido: true, movimientoId: movimientoId.toString(), recibidoEn: m.fechaEfectiva };
      },
    },
    async (ctx) => {
      const { tx, exp } = ctx;
      if (exp.estado !== "en_tramite" && exp.estado !== "espera_pago_dim") throw estadoNoAdmite(exp.estado, "confirmar la recepción");
      exigirPermiso("confirmar_recepcion", ctx.permisos, usuario);
      if (exp.recibidoEn !== null) throw new ErrorDominio("ya_recibido", `${exp.numeroInterno} ya estaba recibido`);

      const fecha = interpretarFechaEfectiva(opciones.fechaEfectiva, ctx.ahora);
      validarFechaEfectiva(fecha, {
        ahora: ctx.ahora,
        fechaInicio: fechaInicioDe(exp),
        ultimoDeUbicacion: await ultimoMovimientoDeUbicacion(tx, exp.id),
      });

      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "recepcion",
          fechaEfectiva: fecha.instante,
          precisionFecha: fecha.precision,
          usuarioId: usuario.id,
          pasoDestino: exp.pasoClave,
          areaDestinoId: exp.areaActualId,
          datos: { implicita: false },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });
      const actualizado = await tx.expediente.update({
        where: { id: exp.id },
        data: { recibidoEn: fecha.instante, version: { increment: 1 } },
        select: { version: true },
      });
      return { numero: exp.numeroInterno, version: actualizado.version, repetido: false, movimientoId: m.id.toString(), recibidoEn: fecha.instante };
    },
  );
}

/** Un expediente de la selección de la bandeja, con la versión que mostraba. */
export interface ItemLoteRecepcion {
  numero: string;
  version: number;
}

export type ResultadoItemLote =
  | ({ ok: true } & ResultadoRecepcion)
  | { ok: false; numero: string; codigo: string; mensaje: string };

/**
 * Confirma varios expedientes ("Confirmar recepción en lote" de la pestaña
 * Por confirmar). Cada uno va en su propia transacción: si uno falla (otro
 * usuario lo movió, ya estaba recibido), los demás se confirman igual y el
 * resultado dice qué pasó con cada uno. Un mismo `comandoId` sirve para todo
 * el lote: la idempotencia es por expediente, así que reintentar el lote no
 * repite ninguna recepción.
 *
 * Los errores de dominio y de permiso quedan en el resultado del expediente;
 * cualquier otro error es un defecto y se deja subir.
 */
export async function confirmarRecepciones(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  seleccion: readonly ItemLoteRecepcion[],
  comandoId: string,
  opciones: OpcionesRecepcion = {},
): Promise<ResultadoItemLote[]> {
  const resultados: ResultadoItemLote[] = [];
  for (const item of seleccion) {
    try {
      const r = await confirmarRecepcion(deps, usuario, item.numero, item.version, comandoId, opciones);
      resultados.push({ ok: true, ...r });
    } catch (error) {
      if (error instanceof ErrorDominio) {
        resultados.push({ ok: false, numero: item.numero, codigo: error.codigo, mensaje: error.message });
      } else if (error instanceof PermisoDenegado) {
        resultados.push({ ok: false, numero: item.numero, codigo: "permiso", mensaje: "Tu área no puede confirmar este expediente" });
      } else {
        throw error;
      }
    }
  }
  return resultados;
}
