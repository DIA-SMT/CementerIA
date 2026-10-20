import type { Prisma } from "@/generated/prisma/client";
import { diaEnTucuman, esFechaValida, fechaParaDb, formatearFecha, inicioDelDiaEnTucuman, type FechaISO } from "@/lib/fechas";
import { colapsarEspacios } from "../normalizar";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import type { SubtareaPlantilla } from "../plantillas/esquema";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, estadoNoAdmite, exigirMotivo, limpiarMotivo } from "./errores";
import { interpretarFechaEfectiva, validarFechaEfectiva, type EntradaFechaEfectiva, type FechaEfectiva } from "./flujo";
import type { ItemsExpediente } from "./items";
import { busquedaActual, ejecutarAccion, fechaInicioDe, idItem, recepcionImplicita, type ContextoAccion } from "./operacion";

/**
 * Tildar y destildar subtareas del paso actual (3.2, 3.3 punto 4 y 3.5).
 *
 * - Solo las del paso en que está el expediente, y solo el área responsable
 *   (en un paso externo, la custodia).
 * - El dato: `fecha` (`YYYY-MM-DD`, no futura ni anterior al inicio) o `texto`
 *   (hasta 200 caracteres). Si `dato_obligatorio`, tildar sin él es un error.
 *   Una subtarea sin `dato` no lleva ninguno.
 * - Destildar exige motivo (10 caracteres o más; lo exige también el CHECK de
 *   movimientos).
 * - En un paso externo, una subtarea con `dato: fecha` toma esa fecha como
 *   `fecha_efectiva`, con precisión de día: la custodia tilda "con la fecha
 *   que consta en el papel" (3.5). Esa fecha no tiene el límite de 30 días,
 *   porque es un dato del papel que vuelve (la DIM puede tenerlo dos meses), no
 *   un registro demorado; no puede ser futura ni anterior al inicio.
 * - Fuera de eso, la fecha efectiva es ahora o la que se indique (hasta 30
 *   días atrás). Las subtareas no entran en la regla de no retroceso
 *   (decisión 6).
 * - Plazo (3.6): tildar la subtarea de inicio del plazo del paso actual carga
 *   `plazo_desde`; la de cierre, `plazo_cumplido_en`. Destildarlas los vacía.
 *
 * Inserta un movimiento `subtarea` con `{subtarea, hecha, dato, paso}`,
 * actualiza `items` y `busqueda` y suma 1 a `version`. Si el área no había
 * confirmado la recepción, primero la recepción implícita.
 */

export const LARGO_MAXIMO_DATO_TEXTO = 200;

export interface OpcionesSubtarea {
  /** Cuándo se hizo, si no fue ahora (no aplica a la fecha de una subtarea de un paso externo). */
  fechaEfectiva?: EntradaFechaEfectiva;
  observacion?: string | null;
}

export interface ResultadoSubtarea {
  numero: string;
  version: number;
  repetido: boolean;
  movimientoId: string;
  clave: string;
  hecha: boolean;
  dato: string | null;
  /** Si se insertó una recepción implícita antes. */
  recepcionImplicita: boolean;
}

function subtareaDelPaso(ctx: ContextoAccion, clave: string): SubtareaPlantilla {
  const s = ctx.pasoActual.subtareas.find((x) => x.clave === clave);
  if (!s) {
    const enOtro = ctx.def.pasos.some((p) => p.subtareas.some((x) => x.clave === clave));
    throw errorValidacion(
      [{ ruta: "subtarea", mensaje: enOtro ? "Esa subtarea no es del paso actual" : "No existe esa subtarea en la plantilla" }],
      enOtro ? `Solo se tildan las subtareas del paso actual (${ctx.pasoActual.nombre})` : "Subtarea desconocida",
    );
  }
  return s;
}

/** Valida y normaliza el dato de una subtarea al tildarla. */
export function validarDato(s: SubtareaPlantilla, dato: string | null | undefined, limites: { hoy: FechaISO; fechaInicio: FechaISO }): string | null {
  const valor = dato === null || dato === undefined ? "" : colapsarEspacios(dato);
  if (s.dato === null) {
    if (valor !== "") throw errorValidacion([{ ruta: "dato", mensaje: "Esta subtarea no lleva dato" }]);
    return null;
  }
  if (valor === "") {
    if (s.dato_obligatorio) {
      throw errorValidacion([{ ruta: "dato", mensaje: s.dato === "fecha" ? "Indicá la fecha" : "Completá el dato" }]);
    }
    return null;
  }
  if (s.dato === "fecha") {
    if (!esFechaValida(valor)) throw errorValidacion([{ ruta: "dato", mensaje: "Fecha inválida (AAAA-MM-DD)" }]);
    if (valor > limites.hoy) throw errorValidacion([{ ruta: "dato", mensaje: "La fecha no puede ser futura" }]);
    if (valor < limites.fechaInicio) {
      throw errorValidacion([{ ruta: "dato", mensaje: `La fecha no puede ser anterior al inicio del expediente (${formatearFecha(limites.fechaInicio)})` }]);
    }
    return valor;
  }
  if (valor.length > LARGO_MAXIMO_DATO_TEXTO) {
    throw errorValidacion([{ ruta: "dato", mensaje: `Hasta ${LARGO_MAXIMO_DATO_TEXTO} caracteres` }]);
  }
  return valor;
}

/** La fecha efectiva del movimiento según 3.5 (ver el comentario del módulo). */
function fechaDelMovimiento(ctx: ContextoAccion, s: SubtareaPlantilla, dato: string | null, entrada: EntradaFechaEfectiva): FechaEfectiva {
  const fechaInicio = fechaInicioDe(ctx.exp);
  // Un paso con custodia es un paso externo (o con comodín): el papel está afuera.
  if (ctx.pasoActual.custodia !== null && s.dato === "fecha" && dato !== null) {
    const f: FechaEfectiva = { instante: inicioDelDiaEnTucuman(dato), precision: "dia" };
    validarFechaEfectiva(f, { ahora: ctx.ahora, fechaInicio, diasAtras: null });
    return f;
  }
  const f = interpretarFechaEfectiva(entrada, ctx.ahora);
  validarFechaEfectiva(f, { ahora: ctx.ahora, fechaInicio });
  return f;
}

/** Los `plazo_*` que cambian al tildar o destildar una subtarea del paso del plazo (3.6). */
function cambiosDePlazo(
  ctx: ContextoAccion,
  clave: string,
  hecha: boolean,
  dato: string | null,
  fecha: FechaEfectiva,
): Pick<Prisma.ExpedienteUpdateInput, "plazoDesde" | "plazoCumplidoEn"> {
  const plazo = ctx.pasoActual.plazo;
  if (plazo === null) return {};
  const cambios: Pick<Prisma.ExpedienteUpdateInput, "plazoDesde" | "plazoCumplidoEn"> = {};
  if (clave === plazo.desde_subtarea) cambios.plazoDesde = hecha && esFechaValida(dato) ? fechaParaDb(dato) : null;
  if (clave === plazo.hasta_subtarea) {
    cambios.plazoCumplidoEn = hecha ? fechaParaDb(esFechaValida(dato) ? dato : diaEnTucuman(fecha.instante)) : null;
  }
  return cambios;
}

interface Marca {
  clave: string;
  hecha: boolean;
  dato: string | null | undefined;
  motivo: string | null;
  opciones: OpcionesSubtarea;
}

async function marcar(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  marca: Marca,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoSubtarea> {
  const motivo = marca.hecha ? limpiarMotivo(marca.motivo) : exigirMotivo(marca.motivo, "Destildar una subtarea");
  return ejecutarAccion<ResultadoSubtarea>(
    deps,
    usuario,
    {
      numero,
      comandoId,
      tipo: "subtarea",
      motivo,
      versionVista,
      repetido: async (tx, expedienteId, movimientoId) => {
        const e = await tx.expediente.findUniqueOrThrow({ where: { id: expedienteId }, select: { numeroInterno: true, version: true } });
        const m = await tx.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { datos: true } });
        const datos = (m.datos ?? {}) as { subtarea?: string; hecha?: boolean; dato?: string | null };
        return {
          numero: e.numeroInterno,
          version: e.version,
          repetido: true,
          movimientoId: movimientoId.toString(),
          clave: datos.subtarea ?? marca.clave,
          hecha: datos.hecha ?? marca.hecha,
          dato: datos.dato ?? null,
          recepcionImplicita: false,
        };
      },
    },
    async (ctx) => {
      const { tx, exp } = ctx;
      if (exp.estado !== "en_tramite" && exp.estado !== "espera_pago_dim") {
        throw estadoNoAdmite(exp.estado, marca.hecha ? "tildar subtareas" : "destildar subtareas");
      }
      exigirPermiso("tildar_subtarea", ctx.permisos, usuario);
      const s = subtareaDelPaso(ctx, marca.clave);
      const anterior = ctx.items.subtareas[s.clave];

      const dato = marca.hecha ? validarDato(s, marca.dato, { hoy: ctx.hoy, fechaInicio: fechaInicioDe(exp) }) : null;
      if (marca.hecha && anterior?.hecha && (anterior.dato ?? null) === dato) {
        throw new ErrorDominio("sin_cambios", `"${s.nombre}" ya está tildada${dato ? ` con ${dato}` : ""}`);
      }
      if (!marca.hecha && !anterior?.hecha) throw new ErrorDominio("sin_cambios", `"${s.nombre}" no está tildada`);

      const fecha = fechaDelMovimiento(ctx, s, dato, marca.opciones.fechaEfectiva);
      const recepcion = await recepcionImplicita(ctx, usuario);
      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "subtarea",
          fechaEfectiva: fecha.instante,
          precisionFecha: fecha.precision,
          usuarioId: usuario.id,
          motivo,
          observacion: limpiarMotivo(marca.opciones.observacion),
          datos: { subtarea: s.clave, hecha: marca.hecha, dato, paso: exp.pasoClave },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });

      const items: ItemsExpediente = {
        ...ctx.items,
        subtareas: {
          ...ctx.items.subtareas,
          // Tildarla otra vez la saca de "reiniciada": ya se rehízo.
          [s.clave]: { hecha: marca.hecha, dato, mov: idItem(m.id), reiniciada_por_mov: null, historica: false },
        },
      };
      const busqueda = await busquedaActual(ctx);
      const actualizado = await tx.expediente.update({
        where: { id: exp.id },
        data: {
          items,
          busqueda,
          ...(recepcion ? { recibidoEn: recepcion.recibidoEn } : {}),
          ...cambiosDePlazo(ctx, s.clave, marca.hecha, dato, fecha),
          version: { increment: 1 },
        },
        select: { version: true },
      });
      return {
        numero: exp.numeroInterno,
        version: actualizado.version,
        repetido: false,
        movimientoId: m.id.toString(),
        clave: s.clave,
        hecha: marca.hecha,
        dato,
        recepcionImplicita: recepcion !== null,
      };
    },
  );
}

/**
 * Tilda una subtarea del paso actual, con su dato (o cambia el dato de una ya
 * tildada).
 *
 * @param dato fecha `YYYY-MM-DD` o texto, según `subtareas[].dato`; null si no lleva.
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion` (subtarea, dato, fecha), `sin_cambios`
 */
export function tildarSubtarea(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  clave: string,
  dato: string | null,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesSubtarea = {},
): Promise<ResultadoSubtarea> {
  return marcar(deps, usuario, numero, { clave, hecha: true, dato, motivo: null, opciones }, versionVista, comandoId);
}

/**
 * Destilda una subtarea del paso actual. Exige motivo.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion`, `sin_cambios`
 */
export function destildarSubtarea(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  clave: string,
  motivo: string | null,
  versionVista: number,
  comandoId: string,
  opciones: OpcionesSubtarea = {},
): Promise<ResultadoSubtarea> {
  return marcar(deps, usuario, numero, { clave, hecha: false, dato: null, motivo, opciones }, versionVista, comandoId);
}
