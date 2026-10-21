import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import type { DependenciasExpedientes } from "./dependencias";
import { errorValidacion, limpiarMotivo } from "./errores";
import { interpretarFechaEfectiva, validarFechaEfectiva, type EntradaFechaEfectiva } from "./flujo";
import { ejecutarAccion, fechaInicioDe } from "./operacion";

/**
 * Nota libre (3.2: Mesa de Entradas, el responsable, otro operador y el admin;
 * no Dirección). Es un movimiento `nota` con el texto en `observacion`: no
 * cambia la proyección y se admite en cualquier estado (3.1: en archivado y
 * anulado "solo se admiten notas…"). No es un acto del área sobre el papel,
 * así que no dispara la recepción implícita. Suma 1 a `version` como toda
 * acción que inserta un movimiento (2.6).
 */

export const LARGO_MAXIMO_NOTA = 2000;

export interface ResultadoNota {
  numero: string;
  version: number;
  repetido: boolean;
  movimientoId: string;
}

/**
 * @throws PermisoDenegado (solo lectura)
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `validacion`
 */
export async function agregarNota(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  texto: string | null,
  versionVista: number,
  comandoId: string,
  opciones: { fechaEfectiva?: EntradaFechaEfectiva } = {},
): Promise<ResultadoNota> {
  exigirPermiso("nota", null, usuario);
  const nota = limpiarMotivo(texto);
  if (nota === null) throw errorValidacion([{ ruta: "texto", mensaje: "Escribí la nota" }]);
  if (nota.length > LARGO_MAXIMO_NOTA) throw errorValidacion([{ ruta: "texto", mensaje: `Hasta ${LARGO_MAXIMO_NOTA} caracteres` }]);
  return ejecutarAccion<ResultadoNota>(
    deps,
    usuario,
    {
      numero,
      comandoId,
      tipo: "nota",
      motivo: null,
      versionVista,
      repetido: async (tx, id, mov) => {
        const e = await tx.expediente.findUniqueOrThrow({ where: { id }, select: { numeroInterno: true, version: true } });
        return { numero: e.numeroInterno, version: e.version, repetido: true, movimientoId: mov.toString() };
      },
    },
    async (ctx) => {
      exigirPermiso("nota", ctx.permisos, usuario);
      const fecha = interpretarFechaEfectiva(opciones.fechaEfectiva, ctx.ahora);
      validarFechaEfectiva(fecha, { ahora: ctx.ahora, fechaInicio: fechaInicioDe(ctx.exp) });
      const m = await ctx.tx.movimiento.create({
        data: {
          expedienteId: ctx.exp.id,
          tipo: "nota",
          fechaEfectiva: fecha.instante,
          precisionFecha: fecha.precision,
          usuarioId: usuario.id,
          observacion: nota,
          comandoId: ctx.comando,
        },
        select: { id: true },
      });
      const r = await ctx.tx.expediente.update({ where: { id: ctx.exp.id }, data: { version: { increment: 1 } }, select: { version: true } });
      return { numero: ctx.exp.numeroInterno, version: r.version, repetido: false, movimientoId: m.id.toString() };
    },
  );
}
