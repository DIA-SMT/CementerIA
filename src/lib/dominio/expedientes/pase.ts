import type { Expediente } from "@/generated/prisma/client";
import { fechaParaDb } from "@/lib/fechas";
import { evaluarPermiso, exigirPermiso, type Decision, type UsuarioPermisos } from "../permisos";
import type { DefinicionPlantilla, PasoPlantilla } from "../plantillas/esquema";
import { exigirNumero, permisosDelExpediente } from "./acceso";
import { definicionDelExpediente } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, estadoNoAdmite, exigirMotivo, limpiarMotivo, noEncontrado } from "./errores";
import {
  destinosPosibles,
  erroresDeFaltantes,
  faltantesDelPaso,
  interpretarFechaEfectiva,
  plazoAlEntrar,
  validarFechaEfectiva,
  type CamposPlazo,
  type DestinoPase,
  type EntradaFechaEfectiva,
  type Faltante,
  type RefPaso,
} from "./flujo";
import { leerItems, type ItemsExpediente } from "./items";
import { areasDePaso, ejecutarAccion, fechaInicioDe, recepcionImplicita, ultimoMovimientoDeUbicacion, type ContextoAccion } from "./operacion";

/**
 * El pase (docs/propuesta-mvp.md, 3.3) y su validación previa ("Faltan N").
 *
 * `validarPase()` es de solo lectura: dice qué falta para salir del paso
 * actual y a qué pasos se puede ir, con lo que falta para cada uno. La ficha
 * lo trae ya calculado (`ficha.pase`); esta función sirve para refrescarlo sin
 * volver a cargar la ficha.
 *
 * `darPase()` hace todo en una transacción de `conActor()` (operacion.ts:
 * idempotencia, FOR UPDATE, versión) y después, en este orden:
 *
 * 1. Estado `en_tramite` o `espera_pago_dim`; permiso `dar_pase`: operador del
 *    área responsable, sin carga histórica abierta, fuera del último paso.
 * 2. El destino tiene que ser uno de `destinosPosibles()`: el siguiente, el
 *    reenvío directo al paso que devolvió (con los intermedios completos) o un
 *    posterior salteando solo omitibles (con motivo).
 * 3. Lo que falta para ese destino (subtareas, datos, documentos acumulativos,
 *    campos extra): si falta algo, `faltan_requisitos` con la lista.
 * 4. La fecha efectiva: no futura, hasta 30 días atrás, no anterior al inicio
 *    ni al último movimiento de ubicación (por día si alguno tiene precisión
 *    de día).
 *
 * Efectos: recepción implícita si el área no había confirmado; el `pase` (con
 * `pasos_omitidos` o `pasos_salteados`); y en el expediente `paso_*`,
 * `area_actual_id` (el área concreta: `$CEMENTERIO` resuelto con el cementerio
 * del expediente), `area_responsable_id` (la custodia en un paso externo),
 * `estado` (el del paso destino: la DIM es `espera_pago_dim`), `en_area_desde`
 * = fecha efectiva, `recibido_en` (= fecha si el destino es externo o si el
 * usuario es del área de destino; si no, null: queda "sin confirmar"),
 * `plazo_*` (se cargan al entrar a un paso con plazo y se limpian al salir),
 * `paso_retorno_clave` (null al llegar a él) y `version + 1`.
 */

export interface ValidacionPase {
  numero: string;
  version: number;
  paso: RefPaso;
  /** Lo que falta para pasar al paso siguiente: es el "Faltan N" del botón. */
  faltan: Faltante[];
  /** Los destinos posibles, cada uno con lo que le falta (vacío = disponible). Vacío en el último paso. */
  destinos: DestinoPase[];
  /** Si el usuario puede dar el pase (permiso, estado, carga histórica, paso final). */
  permiso: Decision;
}

export interface OpcionesPase {
  /** Cuándo salió el papel, si no fue ahora (ver `EntradaFechaEfectiva`). */
  fechaEfectiva?: EntradaFechaEfectiva;
  /** Obligatorio (10 caracteres o más) si el destino saltea pasos omitibles. */
  motivo?: string | null;
  observacion?: string | null;
}

export interface ResultadoPase {
  numero: string;
  version: number;
  repetido: boolean;
  movimientoId: string;
  /** El movimiento de la recepción implícita que se insertó antes, si hizo falta. */
  recepcionImplicitaId: string | null;
  paso: RefPaso;
  areaActual: { id: number; codigo: string; nombre: string };
  areaResponsable: { id: number; codigo: string; nombre: string };
  /** El destino tiene que confirmar la recepción. */
  sinConfirmar: boolean;
  estado: string;
}

/** Lo que el pase escribe en el expediente al llegar a `destino` (también lo usa la devolución). */
export interface Llegada {
  paso: PasoPlantilla;
  orden: number;
  areaActualId: number;
  areaResponsableId: number;
  externa: boolean;
  plazo: CamposPlazo;
}

export async function llegadaA(ctx: ContextoAccion, orden: number, items: ItemsExpediente): Promise<Llegada> {
  const paso = ctx.def.pasos[orden - 1];
  const areas = await areasDePaso(ctx, paso);
  return { paso, orden, ...areas, plazo: plazoAlEntrar(paso, items) };
}

/** Los `plazo_*` para Prisma (columnas `date`). */
export function plazoParaDb(p: CamposPlazo) {
  return {
    plazoDesde: fechaParaDb(p.plazoDesde),
    plazoDiasHabiles: p.plazoDiasHabiles,
    plazoCumplidoEn: fechaParaDb(p.plazoCumplidoEn),
  };
}

function refDe(def: DefinicionPlantilla, exp: Pick<Expediente, "pasoOrden" | "pasoClave">): RefPaso {
  return { clave: exp.pasoClave, nombre: def.pasos[exp.pasoOrden - 1]?.nombre ?? exp.pasoClave, orden: exp.pasoOrden };
}

/**
 * Qué falta para dar el pase y a dónde se puede ir. No escribe ni registra
 * accesos.
 *
 * @throws ErrorDominio `no_encontrado`
 */
export async function validarPase(deps: DependenciasExpedientes, usuario: UsuarioPermisos, numero: string): Promise<ValidacionPase> {
  const numeroInterno = exigirNumero(numero);
  const exp = await deps.leer.expediente.findUnique({
    where: { numeroInterno },
    include: { plantilla: { select: { codigo: true, version: true, definicion: true } } },
  });
  if (!exp) throw noEncontrado(numeroInterno);
  const def = await definicionDelExpediente(deps.leer, exp, exp.plantilla);
  const items = leerItems(exp.items);
  const datosExtra = exp.datosExtra as Record<string, unknown>;
  const permisos = await permisosDelExpediente(deps.leer, exp, def.pasos.length);
  return {
    numero: exp.numeroInterno,
    version: exp.version,
    paso: refDe(def, exp),
    faltan: exp.pasoOrden < def.pasos.length ? faltantesDelPaso(def, items, datosExtra, exp.pasoOrden) : [],
    destinos: destinosPosibles(def, items, datosExtra, exp.pasoOrden, exp.pasoRetornoClave),
    permiso: evaluarPermiso("dar_pase", permisos, usuario),
  };
}

async function resultadoRepetido(ctx: Pick<ContextoAccion, "tx">, expedienteId: bigint, movimientoId: bigint): Promise<ResultadoPase> {
  const { tx } = ctx;
  const e = await tx.expediente.findUniqueOrThrow({
    where: { id: expedienteId },
    include: {
      plantilla: { select: { codigo: true, version: true, definicion: true } },
      areaActual: { select: { id: true, codigo: true, nombre: true } },
      areaResponsable: { select: { id: true, codigo: true, nombre: true } },
    },
  });
  const def = await definicionDelExpediente(tx, e, e.plantilla);
  const pase = await tx.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { comandoId: true } });
  // La recepción implícita, si la hubo, va con el mismo comando que el pase.
  const recepcion = await tx.movimiento.findFirst({
    where: { expedienteId, tipo: "recepcion", comandoId: pase.comandoId },
    select: { id: true },
  });
  return {
    numero: e.numeroInterno,
    version: e.version,
    repetido: true,
    movimientoId: movimientoId.toString(),
    recepcionImplicitaId: recepcion?.id.toString() ?? null,
    paso: refDe(def, e),
    areaActual: e.areaActual,
    areaResponsable: e.areaResponsable,
    sinConfirmar: e.recibidoEn === null,
    estado: e.estado,
  };
}

/**
 * Da el pase al paso `pasoDestino`. Ver el comentario del módulo.
 *
 * @param pasoDestino clave del paso (uno de `validarPase().destinos`).
 * @param versionVista la `version` que el usuario tenía en pantalla.
 * @param comandoId UUID generado por el formulario al abrirse.
 * @throws PermisoDenegado (no es el responsable, carga histórica abierta, último paso)
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `destino_invalido`,
 *   `faltan_requisitos`, `motivo_requerido`, `validacion` (fecha), `configuracion_incompleta`
 */
export async function darPase(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  pasoDestino: string,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesPase = {},
): Promise<ResultadoPase> {
  const motivoLimpio = limpiarMotivo(opciones.motivo);
  return ejecutarAccion<ResultadoPase>(
    deps,
    usuario,
    { numero, comandoId, tipo: "pase", motivo: motivoLimpio, versionVista, repetido: (tx, id, mov) => resultadoRepetido({ tx }, id, mov) },
    async (ctx) => {
      const { tx, exp, def, items } = ctx;
      if (exp.estado !== "en_tramite" && exp.estado !== "espera_pago_dim") throw estadoNoAdmite(exp.estado, "dar el pase");
      exigirPermiso("dar_pase", ctx.permisos, usuario);

      const datosExtra = exp.datosExtra as Record<string, unknown>;
      const destinos = destinosPosibles(def, items, datosExtra, exp.pasoOrden, exp.pasoRetornoClave);
      const destino = destinos.find((d) => d.clave === pasoDestino);
      if (!destino) {
        const posibles = destinos.map((d) => d.nombre).join(", ");
        throw new ErrorDominio("destino_invalido", `No se puede dar el pase a ese paso. Destinos posibles: ${posibles || "ninguno"}`, [
          { ruta: "pasoDestino", mensaje: "Elegí uno de los destinos posibles" },
        ]);
      }
      const motivo = destino.requiereMotivo ? exigirMotivo(opciones.motivo, "Saltear pasos omitibles") : motivoLimpio;
      if (destino.faltan.length > 0) {
        throw new ErrorDominio(
          "faltan_requisitos",
          `Faltan ${destino.faltan.length}: ${destino.faltan.map((f) => f.mensaje).join("; ")}`,
          erroresDeFaltantes(destino.faltan),
        );
      }

      const fecha = interpretarFechaEfectiva(opciones.fechaEfectiva, ctx.ahora);
      validarFechaEfectiva(fecha, {
        ahora: ctx.ahora,
        fechaInicio: fechaInicioDe(exp),
        ultimoDeUbicacion: await ultimoMovimientoDeUbicacion(tx, exp.id),
      });

      const llegada = await llegadaA(ctx, destino.orden, items);
      const recepcion = await recepcionImplicita(ctx, usuario);
      const estadoNuevo = llegada.paso.estado;
      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "pase",
          fechaEfectiva: fecha.instante,
          precisionFecha: fecha.precision,
          usuarioId: usuario.id,
          pasoOrigen: exp.pasoClave,
          pasoDestino: destino.clave,
          areaOrigenId: exp.areaActualId,
          areaDestinoId: llegada.areaActualId,
          // Solo cuando cambia: en el historial, "pasó a espera de pago DIM".
          estadoAnterior: estadoNuevo !== exp.estado ? exp.estado : null,
          estadoNuevo: estadoNuevo !== exp.estado ? estadoNuevo : null,
          motivo,
          observacion: limpiarMotivo(opciones.observacion),
          datos: { pasos_omitidos: destino.pasosOmitidos, pasos_salteados: destino.pasosSalteados },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });

      const recibido = llegada.externa || usuario.area?.id === llegada.areaActualId;
      const actualizado = await tx.expediente.update({
        where: { id: exp.id },
        data: {
          pasoClave: destino.clave,
          pasoOrden: destino.orden,
          areaActualId: llegada.areaActualId,
          areaResponsableId: llegada.areaResponsableId,
          estado: estadoNuevo,
          enAreaDesde: fecha.instante,
          recibidoEn: recibido ? fecha.instante : null,
          ...plazoParaDb(llegada.plazo),
          // Llegar al paso que devolvió (o pasarlo) cierra el reenvío directo.
          pasoRetornoClave: destino.esRetorno || pasoRetornoSuperado(def, exp.pasoRetornoClave, destino.orden) ? null : exp.pasoRetornoClave,
          version: { increment: 1 },
        },
        select: {
          version: true,
          estado: true,
          areaActual: { select: { id: true, codigo: true, nombre: true } },
          areaResponsable: { select: { id: true, codigo: true, nombre: true } },
        },
      });
      return {
        numero: exp.numeroInterno,
        version: actualizado.version,
        repetido: false,
        movimientoId: m.id.toString(),
        recepcionImplicitaId: recepcion?.movimientoId.toString() ?? null,
        paso: { clave: destino.clave, nombre: destino.nombre, orden: destino.orden },
        areaActual: actualizado.areaActual,
        areaResponsable: actualizado.areaResponsable,
        sinConfirmar: !recibido,
        estado: actualizado.estado,
      };
    },
  );
}

function pasoRetornoSuperado(def: DefinicionPlantilla, retorno: string | null, ordenDestino: number): boolean {
  if (retorno === null) return false;
  const i = def.pasos.findIndex((p) => p.clave === retorno);
  return i < 0 || ordenDestino >= i + 1;
}
