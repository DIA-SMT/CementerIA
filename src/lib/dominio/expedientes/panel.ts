import { Prisma } from "@/generated/prisma/client";
import { anioEnTucuman, hoyEnTucuman, inicioDelDiaEnTucuman, type FechaISO } from "@/lib/fechas";
import type { FiltrosBusqueda } from "../busqueda";
import { ESTADOS_EXPEDIENTE, exigirPermiso, type EstadoExpediente, type UsuarioPermisos } from "../permisos";
import type { DependenciasExpedientes } from "./dependencias";
import { DIAS_PLAZO_POR_VENCER } from "./flujo";
import { numeroCorto } from "./numero";
import { aniosSinCerrarDe, completarPlazo, sqlPlazo, type PlazoCalculado } from "./plazos";

/**
 * El panel general (docs/propuesta-mvp.md, sección 5, `/panel`): la vista de
 * Dirección y del admin, y de cualquiera que quiera mirar.
 *
 * - Conteos por estado y la matriz área × tipo de trámite (estados activos).
 * - Demorados: días hábiles en el área de su paso >= `dias_alerta`.
 * - Plazos DIM por vencer (5 días hábiles o menos) y vencidos.
 * - Enviados sin confirmar hace más de 2 días hábiles (decisión 8).
 * - Pases diferidos (más de 48 h entre la fecha efectiva y el registro) y
 *   correcciones del mes en curso.
 * - Cargas históricas abiertas.
 * - Avisos: feriados del año en curso o del próximo sin cerrar (3.6).
 *
 * Todo excluye los expedientes con la carga histórica abierta (sus fechas son
 * de la ficha de papel, no del trabajo de hoy), salvo el bloque que los
 * cuenta. Cada conteo trae `busqueda`: los filtros del buscador que llevan a
 * esa lista (`rutaBusqueda()` de `@/lib/presentacion/busqueda` arma la URL).
 * Las listas traen 50 filas como máximo y el total.
 *
 * Leer el panel no registra accesos (no muestra datos de contacto).
 */

export const MAXIMO_FILAS_PANEL = 50;
/** Decisión 8: el panel alerta los envíos sin confirmar con más de 2 días hábiles. */
export const DIAS_SIN_CONFIRMAR = 2;
const MS_48_HORAS = 48 * 60 * 60 * 1000;

export interface FiltrosPanel {
  tipoTramiteId?: number;
  cementerioId?: number;
}

export interface FilaPanel {
  numero: string;
  numeroCorto: string;
  titular: string | null;
  tramite: string;
  paso: string;
  areaActual: { codigo: string; nombre: string };
  enAreaDesde: Date;
  /** Días hábiles en el área (`f_dias_habiles_entre`). */
  diasEnArea: number;
  diasAlerta: number | null;
}

export interface FilaPlazoPanel extends FilaPanel {
  plazo: PlazoCalculado;
}

export interface MovimientoPanel {
  numero: string;
  movimientoId: string;
  tipo: string;
  fechaEfectiva: Date;
  precisionFecha: "dia" | "minuto";
  registradoEn: Date;
  usuario: string;
  motivo: string | null;
}

export interface Lista<T> {
  cantidad: number;
  filas: T[];
  busqueda: FiltrosBusqueda | null;
}

export interface Panel {
  hoy: FechaISO;
  filtros: FiltrosPanel;
  conteos: Array<{ estado: EstadoExpediente; cantidad: number; busqueda: FiltrosBusqueda }>;
  matriz: {
    areas: Array<{ id: number; codigo: string; nombre: string }>;
    tipos: Array<{ id: number; codigo: string; nombre: string }>;
    celdas: Array<{ areaId: number; tipoTramiteId: number; cantidad: number; busqueda: FiltrosBusqueda }>;
  };
  demorados: Lista<FilaPanel>;
  plazos: { porVencer: Lista<FilaPlazoPanel>; vencidos: Lista<FilaPlazoPanel> };
  sinConfirmar: Lista<FilaPanel>;
  /** Del mes en curso (hora de Tucumán): `mes` es "2026-10". */
  diferidos: Lista<MovimientoPanel> & { mes: string };
  correcciones: Lista<MovimientoPanel> & { mes: string };
  cargasHistoricas: Lista<FilaPanel>;
  avisos: Array<{ tipo: "feriados_sin_cerrar"; anio: number; mensaje: string }>;
}

interface FilaSql {
  numero_interno: string;
  anio: number;
  secuencia: number;
  titular: string | null;
  tramite: string;
  paso: string | null;
  paso_clave: string;
  area_codigo: string;
  area_nombre: string;
  en_area_desde: Date;
  dias_en_area: number | null;
  dias_alerta: number | null;
  plazo_desde: string | null;
  plazo_dias_habiles: number | null;
  plazo_cumplido_en: string | null;
  vence: string | null;
  faltan: number | null;
  anios_sin_cerrar: number[] | null;
}

function fila(f: FilaSql): FilaPanel {
  return {
    numero: f.numero_interno,
    numeroCorto: numeroCorto(f.anio, f.secuencia),
    titular: f.titular,
    tramite: f.tramite,
    paso: f.paso ?? f.paso_clave,
    areaActual: { codigo: f.area_codigo, nombre: f.area_nombre },
    enAreaDesde: f.en_area_desde,
    diasEnArea: f.dias_en_area ?? 0,
    diasAlerta: f.dias_alerta,
  };
}

function filaPlazo(f: FilaSql): FilaPlazoPanel {
  return {
    ...fila(f),
    plazo: completarPlazo({
      desde: f.plazo_desde,
      diasHabiles: f.plazo_dias_habiles ?? 0,
      cumplidoEn: f.plazo_cumplido_en,
      vence: f.vence,
      faltan: f.faltan,
      aniosSinCerrar: f.anios_sin_cerrar ?? [],
    }),
  };
}

/** El primer instante del mes en curso y del siguiente, en hora de Tucumán. */
function rangoDelMes(hoy: FechaISO): { mes: string; desde: Date; hasta: Date } {
  const [a, m] = hoy.split("-").map(Number);
  const siguiente = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  return { mes: hoy.slice(0, 7), desde: inicioDelDiaEnTucuman(`${hoy.slice(0, 7)}-01`), hasta: inicioDelDiaEnTucuman(siguiente) };
}

/**
 * El panel. Ver el comentario del módulo.
 *
 * @throws PermisoDenegado (usuario inactivo)
 */
export async function panel(deps: DependenciasExpedientes, usuario: UsuarioPermisos, filtros: FiltrosPanel = {}): Promise<Panel> {
  exigirPermiso("ver_panel", null, usuario);
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnTucuman(ahora);
  const lector = deps.leer;

  const condiciones: Prisma.Sql[] = [];
  if (filtros.tipoTramiteId !== undefined) condiciones.push(Prisma.sql`e.tipo_tramite_id = ${filtros.tipoTramiteId}`);
  if (filtros.cementerioId !== undefined) condiciones.push(Prisma.sql`e.cementerio_id = ${filtros.cementerioId}`);
  const deFiltros = condiciones.length > 0 ? Prisma.sql`AND ${Prisma.join(condiciones, " AND ")}` : Prisma.empty;
  const filtrosBusqueda: FiltrosBusqueda = {
    ...(filtros.tipoTramiteId !== undefined ? { tipoTramiteId: filtros.tipoTramiteId } : {}),
    ...(filtros.cementerioId !== undefined ? { cementerioId: filtros.cementerioId } : {}),
  };
  const activos: EstadoExpediente[] = ["en_tramite", "espera_pago_dim"];

  // --- Conteos por estado (sin las cargas históricas abiertas) ---------------
  const porEstado = await lector.$queryRaw<Array<{ estado: string; cantidad: number }>>`
    SELECT e.estado, count(*)::int AS cantidad
      FROM public.expedientes e
     WHERE NOT e.carga_historica ${deFiltros}
     GROUP BY e.estado`;
  const conteos = ESTADOS_EXPEDIENTE.map((estado) => ({
    estado,
    cantidad: porEstado.find((c) => c.estado === estado)?.cantidad ?? 0,
    busqueda: { ...filtrosBusqueda, estados: [estado], cargaHistorica: false, ...(estado === "anulado" ? { incluirAnulados: true } : {}) },
  }));

  // --- Matriz área × tipo de trámite (activos) ------------------------------
  const celdasSql = await lector.$queryRaw<Array<{ area_id: number; tipo_tramite_id: number; cantidad: number }>>`
    SELECT e.area_actual_id::int AS area_id, e.tipo_tramite_id::int AS tipo_tramite_id, count(*)::int AS cantidad
      FROM public.expedientes e
     WHERE e.estado IN ('en_tramite', 'espera_pago_dim') AND NOT e.carga_historica ${deFiltros}
     GROUP BY e.area_actual_id, e.tipo_tramite_id`;
  const areas = await lector.area.findMany({ select: { id: true, codigo: true, nombre: true }, orderBy: [{ orden: "asc" }, { id: "asc" }] });
  const tipos = await lector.tipoTramite.findMany({ select: { id: true, codigo: true, nombre: true }, orderBy: { id: "asc" } });
  const conCeldas = new Set(celdasSql.map((c) => c.area_id));
  const tiposConCeldas = new Set(celdasSql.map((c) => c.tipo_tramite_id));

  // --- Listas por expediente -----------------------------------------------
  const listar = async (condicion: Prisma.Sql, orden: Prisma.Sql) => {
    const filas = await lector.$queryRaw<FilaSql[]>`
      WITH base AS (
        SELECT e.*,
               -- Solo lo que se trabaja: un expediente de 2019 no cuenta días (y el cálculo recorre cada día).
               CASE WHEN e.estado IN ('en_tramite', 'espera_pago_dim') AND NOT e.carga_historica
                    THEN public.f_dias_habiles_entre((e.en_area_desde AT TIME ZONE 'America/Argentina/Tucuman')::date, ${hoy}::date) END AS dias_en_area,
               (SELECT (x ->> 'dias_alerta')::int FROM jsonb_array_elements(pl.definicion -> 'pasos') AS x
                 WHERE x ->> 'clave' = e.paso_clave LIMIT 1) AS dias_alerta,
               (SELECT x ->> 'nombre' FROM jsonb_array_elements(pl.definicion -> 'pasos') AS x
                 WHERE x ->> 'clave' = e.paso_clave LIMIT 1) AS paso,
               pl.nombre AS tramite
          FROM public.expedientes e
          JOIN public.plantillas pl ON pl.id = e.plantilla_id
         WHERE e.estado <> 'anulado' ${deFiltros}
      )
      SELECT e.numero_interno, e.anio, e.secuencia, e.tramite, e.paso, e.paso_clave,
             a.codigo AS area_codigo, a.nombre AS area_nombre, e.en_area_desde, e.dias_en_area, e.dias_alerta,
             e.plazo_desde::text AS plazo_desde, e.plazo_dias_habiles::int AS plazo_dias_habiles,
             e.plazo_cumplido_en::text AS plazo_cumplido_en, pz.vence, pz.faltan, pz.anios_sin_cerrar,
             (SELECT nullif(coalesce(t.razon_social, concat_ws(', ', t.apellido, t.nombres)), '') FROM public.expediente_personas t
               WHERE t.expediente_id = e.id AND t.vigente AND t.rol = 'titular' ORDER BY t.orden LIMIT 1) AS titular,
             count(*) OVER ()::int AS total
        FROM base e
        JOIN public.areas a ON a.id = e.area_actual_id
        ${sqlPlazo(hoy)}
       WHERE ${condicion}
       ORDER BY ${orden}
       LIMIT ${MAXIMO_FILAS_PANEL}`;
    const total = (filas[0] as (FilaSql & { total?: number }) | undefined)?.total ?? 0;
    return { filas, total };
  };
  const enTrabajo = Prisma.sql`e.estado IN ('en_tramite', 'espera_pago_dim') AND NOT e.carga_historica`;

  const demorados = await listar(
    Prisma.sql`${enTrabajo} AND e.dias_alerta IS NOT NULL AND e.dias_en_area >= e.dias_alerta`,
    Prisma.sql`e.dias_en_area - e.dias_alerta DESC, e.en_area_desde ASC`,
  );
  const plazoAbierto = Prisma.sql`${enTrabajo} AND e.plazo_dias_habiles IS NOT NULL AND e.plazo_cumplido_en IS NULL AND pz.faltan IS NOT NULL`;
  const porVencer = await listar(
    Prisma.sql`${plazoAbierto} AND pz.faltan BETWEEN 0 AND ${DIAS_PLAZO_POR_VENCER}`,
    Prisma.sql`pz.faltan ASC, e.en_area_desde ASC`,
  );
  const vencidos = await listar(Prisma.sql`${plazoAbierto} AND pz.faltan < 0`, Prisma.sql`pz.faltan ASC, e.en_area_desde ASC`);
  const sinConfirmar = await listar(
    Prisma.sql`${enTrabajo} AND e.recibido_en IS NULL AND e.dias_en_area > ${DIAS_SIN_CONFIRMAR}`,
    Prisma.sql`e.dias_en_area DESC, e.en_area_desde ASC`,
  );
  const cargas = await listar(Prisma.sql`e.carga_historica`, Prisma.sql`e.creado_en ASC`);

  // --- Movimientos del mes --------------------------------------------------
  const rango = rangoDelMes(hoy);
  const movimientosDelMes = async (condicion: Prisma.Sql) => {
    const filas = await lector.$queryRaw<
      Array<{
        numero_interno: string;
        id: bigint;
        tipo: string;
        fecha_efectiva: Date;
        precision_fecha: string;
        registrado_en: Date;
        nombre: string;
        apellido: string;
        motivo: string | null;
        total: number;
      }>
    >`
      SELECT e.numero_interno, m.id, m.tipo, m.fecha_efectiva, m.precision_fecha, m.registrado_en,
             u.nombre, u.apellido, m.motivo, count(*) OVER ()::int AS total
        FROM public.movimientos m
        JOIN public.expedientes e ON e.id = m.expediente_id
        JOIN public.usuarios u ON u.id = m.usuario_id
       WHERE m.registrado_en >= ${rango.desde} AND m.registrado_en < ${rango.hasta} ${deFiltros} AND ${condicion}
       ORDER BY m.registrado_en DESC
       LIMIT ${MAXIMO_FILAS_PANEL}`;
    return {
      cantidad: filas[0]?.total ?? 0,
      busqueda: null,
      mes: rango.mes,
      filas: filas.map(
        (m): MovimientoPanel => ({
          numero: m.numero_interno,
          movimientoId: m.id.toString(),
          tipo: m.tipo,
          fechaEfectiva: m.fecha_efectiva,
          precisionFecha: m.precision_fecha === "dia" ? "dia" : "minuto",
          registradoEn: m.registrado_en,
          usuario: `${m.nombre.trim().charAt(0)}. ${m.apellido}`,
          motivo: m.motivo,
        }),
      ),
    };
  };
  const diferidos = await movimientosDelMes(
    Prisma.sql`m.tipo IN ('pase', 'devolucion') AND NOT m.carga_historica AND m.registrado_en - m.fecha_efectiva > ${`${MS_48_HORAS / 1000} seconds`}::interval`,
  );
  const correcciones = await movimientosDelMes(Prisma.sql`m.tipo = 'correccion'`);

  // --- Avisos ---------------------------------------------------------------
  const anio = anioEnTucuman(ahora);
  const sinCerrar = await aniosSinCerrarDe(lector, [anio, anio + 1]);

  return {
    hoy,
    filtros,
    conteos,
    matriz: {
      areas: areas.filter((a) => conCeldas.has(a.id)),
      tipos: tipos.filter((t) => tiposConCeldas.has(t.id)),
      celdas: celdasSql.map((c) => ({
        areaId: c.area_id,
        tipoTramiteId: c.tipo_tramite_id,
        cantidad: c.cantidad,
        busqueda: { ...filtrosBusqueda, areaActualId: c.area_id, tipoTramiteId: c.tipo_tramite_id, estados: activos, cargaHistorica: false },
      })),
    },
    demorados: { cantidad: demorados.total, filas: demorados.filas.map(fila), busqueda: null },
    plazos: {
      porVencer: { cantidad: porVencer.total, filas: porVencer.filas.map(filaPlazo), busqueda: null },
      vencidos: { cantidad: vencidos.total, filas: vencidos.filas.map(filaPlazo), busqueda: null },
    },
    sinConfirmar: { cantidad: sinConfirmar.total, filas: sinConfirmar.filas.map(fila), busqueda: null },
    diferidos,
    correcciones,
    cargasHistoricas: { cantidad: cargas.total, filas: cargas.filas.map(fila), busqueda: { ...filtrosBusqueda, cargaHistorica: true } },
    avisos: sinCerrar.map((a) => ({ tipo: "feriados_sin_cerrar" as const, anio: a, mensaje: `Feriados de ${a} sin cerrar` })),
  };
}
