import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import type { DocumentoPlantilla } from "../plantillas/esquema";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, estadoNoAdmite, limpiarMotivo } from "./errores";
import { interpretarFechaEfectiva, validarFechaEfectiva, type EntradaFechaEfectiva } from "./flujo";
import type { EstadoDocumento, ItemsExpediente } from "./items";
import { ejecutarAccion, fechaInicioDe, idItem, recepcionImplicita } from "./operacion";

/**
 * Marcar la documentación (3.2 y 3.3 punto 5): `presentado`, `no_corresponde`
 * (exige observación) o volver a `pendiente`.
 *
 * Quién (3.2, "Marcar documentación y adjuntar"): el área responsable y Mesa
 * de Entradas (esta, solo en estados activos), nunca en archivado ni anulado.
 * Cualquier documento de la plantilla, no solo los del paso actual: los
 * papeles llegan cuando llegan. `historico` no se marca a mano: lo pone
 * "Terminar carga histórica" (semana 4).
 *
 * Inserta un movimiento `documento` con `{documento, estado}` y la
 * observación en `observacion`, actualiza `items.documentos` (los adjuntos del
 * documento se conservan) y suma 1 a `version`. Si el área donde está el
 * papel no había confirmado la recepción, primero la recepción implícita.
 */

export type EstadoMarcable = Exclude<EstadoDocumento, "historico">;
export const ESTADOS_MARCABLES: readonly EstadoMarcable[] = ["pendiente", "presentado", "no_corresponde"];

export interface OpcionesDocumento {
  fechaEfectiva?: EntradaFechaEfectiva;
}

export interface ResultadoDocumento {
  numero: string;
  version: number;
  repetido: boolean;
  movimientoId: string;
  clave: string;
  estado: EstadoMarcable;
  observacion: string | null;
  recepcionImplicita: boolean;
}

function documentoDe(documentos: readonly DocumentoPlantilla[], clave: string): DocumentoPlantilla {
  const d = documentos.find((x) => x.clave === clave);
  if (!d) throw errorValidacion([{ ruta: "documento", mensaje: "No existe ese documento en la plantilla" }], "Documento desconocido");
  return d;
}

/**
 * Marca el estado de un documento.
 *
 * @param observacion obligatoria con `no_corresponde` (por qué no corresponde).
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`, `sin_cambios`
 */
export async function marcarDocumento(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  clave: string,
  estado: EstadoMarcable,
  observacion: string | null,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesDocumento = {},
): Promise<ResultadoDocumento> {
  if (!ESTADOS_MARCABLES.includes(estado)) {
    throw errorValidacion([{ ruta: "estado", mensaje: "Elegí presentado, no corresponde o pendiente" }]);
  }
  const obs = limpiarMotivo(observacion);
  if (estado === "no_corresponde" && obs === null) {
    throw errorValidacion([{ ruta: "observacion", mensaje: "Explicá por qué no corresponde" }]);
  }

  return ejecutarAccion<ResultadoDocumento>(
    deps,
    usuario,
    {
      numero,
      comandoId,
      tipo: "documento",
      motivo: null,
      versionVista,
      repetido: async (tx, expedienteId, movimientoId) => {
        const e = await tx.expediente.findUniqueOrThrow({ where: { id: expedienteId }, select: { numeroInterno: true, version: true } });
        const m = await tx.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { datos: true, observacion: true } });
        const datos = (m.datos ?? {}) as { documento?: string; estado?: EstadoMarcable };
        return {
          numero: e.numeroInterno,
          version: e.version,
          repetido: true,
          movimientoId: movimientoId.toString(),
          clave: datos.documento ?? clave,
          estado: datos.estado ?? estado,
          observacion: m.observacion,
          recepcionImplicita: false,
        };
      },
    },
    async (ctx) => {
      const { tx, exp } = ctx;
      if (exp.estado === "archivado" || exp.estado === "anulado") throw estadoNoAdmite(exp.estado, "marcar documentación");
      exigirPermiso("marcar_documento", ctx.permisos, usuario);
      const d = documentoDe(ctx.def.documentos, clave);
      const anterior = ctx.items.documentos[d.clave];
      const obsFinal = estado === "pendiente" ? null : obs;
      if ((anterior?.estado ?? "pendiente") === estado && (anterior?.obs ?? null) === obsFinal) {
        throw new ErrorDominio("sin_cambios", `"${d.nombre}" ya está así`);
      }

      const fecha = interpretarFechaEfectiva(opciones.fechaEfectiva, ctx.ahora);
      validarFechaEfectiva(fecha, { ahora: ctx.ahora, fechaInicio: fechaInicioDe(exp) });
      const recepcion = await recepcionImplicita(ctx, usuario);
      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "documento",
          fechaEfectiva: fecha.instante,
          precisionFecha: fecha.precision,
          usuarioId: usuario.id,
          observacion: obsFinal,
          datos: { documento: d.clave, estado },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });
      const items: ItemsExpediente = {
        ...ctx.items,
        documentos: {
          ...ctx.items.documentos,
          [d.clave]: { estado, obs: obsFinal, mov: idItem(m.id), adjuntos: anterior?.adjuntos ?? [] },
        },
      };
      const actualizado = await tx.expediente.update({
        where: { id: exp.id },
        data: { items, ...(recepcion ? { recibidoEn: recepcion.recibidoEn } : {}), version: { increment: 1 } },
        select: { version: true },
      });
      return {
        numero: exp.numeroInterno,
        version: actualizado.version,
        repetido: false,
        movimientoId: m.id.toString(),
        clave: d.clave,
        estado,
        observacion: obsFinal,
        recepcionImplicita: recepcion !== null,
      };
    },
  );
}
