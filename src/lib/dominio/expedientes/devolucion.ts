import { avisarLlegada } from "../avisos/eventos";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { definicionDelExpediente } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, estadoNoAdmite, exigirMotivo, limpiarMotivo } from "./errores";
import {
  interpretarFechaEfectiva,
  ordenDePaso,
  plazoAlEntrar,
  subtareasReiniciables,
  validarFechaEfectiva,
  type EntradaFechaEfectiva,
  type RefPaso,
} from "./flujo";
import type { ItemsExpediente } from "./items";
import { areasDePaso, ejecutarAccion, fechaInicioDe, idItem, recepcionImplicita, ultimoMovimientoDeUbicacion } from "./operacion";
import { plazoParaDb } from "./pase";

/**
 * Devolución (docs/propuesta-mvp.md, 3.4).
 *
 * - A cualquier paso con `orden` menor al actual; la hace el área responsable
 *   (no en la carga histórica abierta ni en el primer paso).
 * - Motivo obligatorio de 10 caracteres o más (también lo exige un CHECK). La
 *   pantalla ofrece atajos: "Falta firma", "Error en boleta", "Falta
 *   documentación" (son el comienzo del motivo; el resto lo completa quien
 *   devuelve).
 * - No valida subtareas ni documentación.
 * - `subtareasARehacer`: las que quien devuelve marca para rehacer, de los
 *   pasos desde el destino hasta el anterior al actual y que estén tildadas
 *   (`ficha.devolucion.subtareasReiniciables`). Pasan a `hecha: false` con
 *   `reiniciada_por_mov` (sin motivo de destildado: el motivo es el de la
 *   devolución). Lo demás sigue tildado: la firma en papel sigue existiendo.
 * - `paso_retorno_clave` apunta al paso que devolvió; si se encadenan
 *   devoluciones, se conserva el más avanzado. Habilita el reenvío directo.
 * - El estado pasa a ser el del paso destino (sale de `espera_pago_dim` si el
 *   destino está en trámite) y el plazo se limpia al salir del paso que lo
 *   tiene (se carga si el destino tiene plazo).
 * - La fecha efectiva sigue las reglas del pase (3.3, punto 7).
 *
 * Efectos sobre el expediente: los mismos que un pase (área, custodia,
 * `en_area_desde`, `recibido_en`, `version + 1`). Antes, la recepción
 * implícita si el área no había confirmado.
 */

export interface OpcionesDevolucion {
  fechaEfectiva?: EntradaFechaEfectiva;
  observacion?: string | null;
}

export interface ResultadoDevolucion {
  numero: string;
  version: number;
  repetido: boolean;
  movimientoId: string;
  recepcionImplicitaId: string | null;
  paso: RefPaso;
  /** El paso al que se puede reenviar directo cuando se rehaga lo pedido. */
  pasoRetorno: string | null;
  subtareasReiniciadas: string[];
  sinConfirmar: boolean;
  estado: string;
}

/**
 * Devuelve el expediente a `pasoDestino`. Ver el comentario del módulo.
 *
 * @param subtareasARehacer claves de subtareas tildadas de los pasos que el papel vuelve a recorrer.
 * @throws PermisoDenegado (no es el responsable, carga histórica abierta, primer paso)
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`,
 *   `destino_invalido`, `validacion` (subtareas, fecha)
 */
export async function devolver(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  pasoDestino: string,
  motivo: string | null,
  subtareasARehacer: readonly string[],
  versionVista: number,
  comandoId: string,
  opciones: OpcionesDevolucion = {},
): Promise<ResultadoDevolucion> {
  const motivoFinal = exigirMotivo(motivo, "Devolver un expediente");
  return ejecutarAccion<ResultadoDevolucion>(
    deps,
    usuario,
    {
      numero,
      comandoId,
      tipo: "devolucion",
      motivo: motivoFinal,
      versionVista,
      repetido: async (tx, expedienteId, movimientoId) => {
        const e = await tx.expediente.findUniqueOrThrow({
          where: { id: expedienteId },
          include: { plantilla: { select: { codigo: true, version: true, definicion: true } } },
        });
        const def = await definicionDelExpediente(tx, e, e.plantilla);
        const m = await tx.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { pasoDestino: true, datos: true, comandoId: true } });
        const recepcion = await tx.movimiento.findFirst({ where: { expedienteId, tipo: "recepcion", comandoId: m.comandoId }, select: { id: true } });
        const datos = (m.datos ?? {}) as { subtareas_reiniciadas?: string[] };
        return {
          numero: e.numeroInterno,
          version: e.version,
          repetido: true,
          movimientoId: movimientoId.toString(),
          recepcionImplicitaId: recepcion?.id.toString() ?? null,
          // El estado de AHORA (como en la edición): si el expediente siguió, es otro paso.
          paso: { clave: e.pasoClave, nombre: def.pasos[e.pasoOrden - 1]?.nombre ?? e.pasoClave, orden: e.pasoOrden },
          pasoRetorno: e.pasoRetornoClave,
          subtareasReiniciadas: datos.subtareas_reiniciadas ?? [],
          sinConfirmar: e.recibidoEn === null,
          estado: e.estado,
        };
      },
    },
    async (ctx) => {
      const { tx, exp, def, items } = ctx;
      if (exp.estado !== "en_tramite" && exp.estado !== "espera_pago_dim") throw estadoNoAdmite(exp.estado, "devolver");
      exigirPermiso("devolver", ctx.permisos, usuario);

      const ordenDestino = ordenDePaso(def, pasoDestino);
      if (ordenDestino === null || ordenDestino >= exp.pasoOrden) {
        throw new ErrorDominio("destino_invalido", "Se devuelve a un paso anterior al actual", [
          { ruta: "pasoDestino", mensaje: "Elegí un paso anterior" },
        ]);
      }

      const reiniciables = new Map(subtareasReiniciables(def, items, exp.pasoOrden).map((s) => [s.clave, s]));
      const claves = [...new Set(subtareasARehacer)];
      const invalidas = claves.filter((c) => {
        const s = reiniciables.get(c);
        return !s || s.paso.orden < ordenDestino;
      });
      if (invalidas.length > 0) {
        throw errorValidacion(
          invalidas.map((c) => ({ ruta: `subtareas.${c}`, mensaje: "Solo se rehacen subtareas tildadas de los pasos que el papel vuelve a recorrer" })),
          "Revisá las subtareas a rehacer",
        );
      }

      const fecha = interpretarFechaEfectiva(opciones.fechaEfectiva, ctx.ahora);
      validarFechaEfectiva(fecha, {
        ahora: ctx.ahora,
        fechaInicio: fechaInicioDe(exp),
        ultimoDeUbicacion: await ultimoMovimientoDeUbicacion(tx, exp.id),
      });

      const recepcion = await recepcionImplicita(ctx, usuario);
      const ordenRetornoAnterior = exp.pasoRetornoClave === null ? null : ordenDePaso(def, exp.pasoRetornoClave);
      // Se conserva el más avanzado: si Legal devolvió a Liquidación y
      // Liquidación devuelve a Cómputo, el reenvío directo sigue siendo a Legal.
      const pasoRetorno = ordenRetornoAnterior !== null && ordenRetornoAnterior > exp.pasoOrden ? exp.pasoRetornoClave : exp.pasoClave;

      const destinoPaso = def.pasos[ordenDestino - 1];
      const areasDestino = await areasDePaso(ctx, destinoPaso);
      const estadoNuevo = destinoPaso.estado;
      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "devolucion",
          fechaEfectiva: fecha.instante,
          precisionFecha: fecha.precision,
          usuarioId: usuario.id,
          pasoOrigen: exp.pasoClave,
          pasoDestino: destinoPaso.clave,
          areaOrigenId: exp.areaActualId,
          areaDestinoId: areasDestino.areaActualId,
          estadoAnterior: estadoNuevo !== exp.estado ? exp.estado : null,
          estadoNuevo: estadoNuevo !== exp.estado ? estadoNuevo : null,
          motivo: motivoFinal,
          observacion: limpiarMotivo(opciones.observacion),
          datos: { subtareas_reiniciadas: claves },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });

      const mov = idItem(m.id);
      const subtareas = { ...items.subtareas };
      for (const clave of claves) subtareas[clave] = { hecha: false, dato: null, mov, reiniciada_por_mov: mov, historica: false };
      const itemsNuevos: ItemsExpediente = { ...items, subtareas };
      // El plazo del destino, con las subtareas ya reiniciadas.
      const plazo = plazoAlEntrar(destinoPaso, itemsNuevos);

      const recibido = areasDestino.externa || usuario.area?.id === areasDestino.areaActualId;
      const actualizado = await tx.expediente.update({
        where: { id: exp.id },
        data: {
          pasoClave: destinoPaso.clave,
          pasoOrden: ordenDestino,
          areaActualId: areasDestino.areaActualId,
          areaResponsableId: areasDestino.areaResponsableId,
          estado: estadoNuevo,
          enAreaDesde: fecha.instante,
          recibidoEn: recibido ? fecha.instante : null,
          ...plazoParaDb(plazo),
          pasoRetornoClave: pasoRetorno,
          items: itemsNuevos,
          version: { increment: 1 },
        },
        select: { version: true, estado: true },
      });
      // "Te devolvieron un expediente", con el motivo, al área de destino (o a
      // la custodia), en esta misma transacción. Reemplaza al aviso "llegó".
      await avisarLlegada(tx, {
        tipo: "devolucion",
        expedienteId: exp.id,
        movimientoId: m.id,
        actorId: usuario.id,
        actorAreaId: usuario.area?.id ?? null,
        paso: destinoPaso.nombre,
        areaOrigenId: exp.areaActualId,
        areaActualId: areasDestino.areaActualId,
        areaResponsableId: areasDestino.areaResponsableId,
        motivo: motivoFinal,
        ahora: ctx.ahora,
      });
      return {
        numero: exp.numeroInterno,
        version: actualizado.version,
        repetido: false,
        movimientoId: m.id.toString(),
        recepcionImplicitaId: recepcion?.movimientoId.toString() ?? null,
        paso: { clave: destinoPaso.clave, nombre: destinoPaso.nombre, orden: ordenDestino },
        pasoRetorno,
        subtareasReiniciadas: claves,
        sinConfirmar: !recibido,
        estado: actualizado.estado,
      };
    },
  );
}
