import { Prisma } from "@/generated/prisma/client";
import { hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { AREA_MESA_ENTRADAS, evaluarPermiso, exigirPermiso, type ExpedientePermisos, type UsuarioPermisos } from "../permisos";
import { analizarDefinicion } from "../plantillas/esquema";
import { comoEstado } from "./acceso";
import type { DependenciasExpedientes } from "./dependencias";
import { destinosPosibles, type RefPaso } from "./flujo";
import { leerItems } from "./items";
import { numeroCorto } from "./numero";

/**
 * Las bandejas de `/bandeja` (docs/propuesta-mvp.md, sección 5) y el contador
 * "Por confirmar" del encabezado. Semana 3: Por confirmar, En mi área y
 * Afuera; Plazos y Carga histórica son de la semana 4.
 *
 * - **Por confirmar**: el papel está en el área del usuario (`area_actual_id`)
 *   y nadie confirmó la recepción (`recibido_en` nulo).
 * - **En mi área**: el área del usuario es la responsable y el papel está en
 *   ella (los que custodia afuera van en "Afuera", no acá). Incluye los sin
 *   confirmar, con la etiqueta.
 * - **Afuera**: pasos externos (la DIM, un cementerio) cuya custodia es el
 *   área del usuario. Mesa de Entradas ve todo lo que está afuera, como
 *   consulta (`soloConsulta` en los que no custodia).
 *
 * Siempre en estados activos (en trámite o en espera de pago en la DIM), del
 * que lleva más tiempo en el área al más nuevo. Leer la bandeja no registra
 * accesos: abrir la ficha sí.
 */

export const PESTANAS_BANDEJA = ["por_confirmar", "en_mi_area", "afuera"] as const;
export type PestanaBandeja = (typeof PESTANAS_BANDEJA)[number];

/** Filas por pestaña como máximo; con más, `hayMas` (y la búsqueda para encontrar el resto). */
export const MAXIMO_FILAS_BANDEJA = 200;

export type EtiquetaBandeja =
  | { tipo: "sin_confirmar" }
  /** "Devuelto por Asesoría Legal: <motivo>" (3.4): en rojo. */
  | { tipo: "devuelto"; porArea: string | null; desdePaso: string | null; motivo: string | null }
  /** El paso tiene plazo (3.6). El vencimiento y el semáforo son de la semana 4. */
  | { tipo: "plazo"; desde: FechaISO | null; diasHabiles: number; cumplidoEn: FechaISO | null };

export interface FilaBandeja {
  numero: string;
  numeroCorto: string;
  numeroMunicipal: string | null;
  /** "APELLIDO, Nombres" del titular vigente, o null. */
  titular: string | null;
  tramite: { tipo: string; plantilla: string; codigo: string; version: number };
  paso: { clave: string; nombre: string; orden: number; total: number };
  estado: string;
  /** Para el bloqueo optimista de la confirmación en lote. */
  version: number;
  areaActual: { codigo: string; nombre: string; externa: boolean };
  areaResponsable: { codigo: string; nombre: string };
  enAreaDesde: Date;
  /** Con `dia` (carga histórica, pase con solo el día) se muestra sin hora. */
  enAreaDesdePrecision: "dia" | "minuto";
  recibidoEn: Date | null;
  /** Días hábiles desde que llegó al área (`f_dias_habiles_entre`). */
  diasEnArea: number;
  /** `dias_alerta` del paso. */
  diasAlerta: number;
  /** `diasEnArea >= diasAlerta`: la bandeja lo pinta demorado. */
  demorado: boolean;
  etiquetas: EtiquetaBandeja[];
  /** En "Afuera", Mesa de Entradas ve también lo que no custodia: solo para consultar. */
  soloConsulta: boolean;
  /** El usuario puede confirmar la recepción: sin confirmar y con permiso `confirmar_recepcion`. */
  puedeConfirmar: boolean;
  /**
   * "Dar pase rápido" (sección 5): el paso siguiente, si el usuario puede dar
   * el pase, no falta nada y es el ÚNICO destino posible (sin reenvío directo
   * ni pasos omitibles, que piden elegir en la ficha). Si no, null.
   */
  paseRapido: RefPaso | null;
}

export interface Bandeja {
  pestana: PestanaBandeja;
  area: { id: number; codigo: string };
  filas: FilaBandeja[];
  hayMas: boolean;
}

interface FilaSql {
  numero_interno: string;
  anio: number;
  secuencia: number;
  numero_municipal: string | null;
  estado: string;
  version: number;
  paso_clave: string;
  paso_orden: number;
  paso_retorno_clave: string | null;
  plantilla_id: number;
  items: unknown;
  datos_extra: unknown;
  carga_historica: boolean;
  plantilla_codigo: string;
  plantilla_nombre: string;
  plantilla_version: number;
  definicion: unknown;
  tipo_tramite: string;
  area_actual_codigo: string;
  area_actual_nombre: string;
  area_actual_tipo: string;
  area_responsable_id: number;
  area_responsable_codigo: string;
  area_responsable_nombre: string;
  en_area_desde: Date;
  en_area_precision: string | null;
  recibido_en: Date | null;
  plazo_desde: string | null;
  plazo_dias_habiles: number | null;
  plazo_cumplido_en: string | null;
  dias_en_area: number | null;
  titular: string | null;
  devolucion_motivo: string | null;
  devolucion_area: string | null;
  devolucion_paso: string | null;
}

function condicion(pestana: PestanaBandeja, area: { id: number; codigo: string }): Prisma.Sql {
  switch (pestana) {
    case "por_confirmar":
      return Prisma.sql`e.area_actual_id = ${area.id} AND e.recibido_en IS NULL`;
    case "en_mi_area":
      return Prisma.sql`e.area_responsable_id = ${area.id} AND e.area_actual_id = e.area_responsable_id`;
    case "afuera":
      return area.codigo === AREA_MESA_ENTRADAS
        ? Prisma.sql`aa.tipo = 'externa'`
        : Prisma.sql`aa.tipo = 'externa' AND e.area_responsable_id = ${area.id}`;
  }
}

/**
 * Una pestaña de la bandeja del usuario.
 *
 * @throws PermisoDenegado si no es un operador con área (Dirección y el admin van al panel).
 */
export async function bandeja(deps: DependenciasExpedientes, usuario: UsuarioPermisos, pestana: PestanaBandeja): Promise<Bandeja> {
  exigirPermiso("ver_bandeja", null, usuario);
  const area = usuario.area;
  if (!area || !PESTANAS_BANDEJA.includes(pestana)) return { pestana, area: area ?? { id: 0, codigo: "" }, filas: [], hayMas: false };
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());

  const filas = await deps.leer.$queryRaw<FilaSql[]>`
    SELECT e.numero_interno, e.anio, e.secuencia, e.numero_municipal, e.estado, e.version,
           e.paso_clave, e.paso_orden, e.paso_retorno_clave, e.items, e.datos_extra, e.carga_historica,
           p.id AS plantilla_id, p.codigo AS plantilla_codigo, p.nombre AS plantilla_nombre,
           p.version::int AS plantilla_version, p.definicion, tt.nombre AS tipo_tramite,
           aa.codigo AS area_actual_codigo, aa.nombre AS area_actual_nombre, aa.tipo AS area_actual_tipo,
           e.area_responsable_id::int AS area_responsable_id,
           ar.codigo AS area_responsable_codigo, ar.nombre AS area_responsable_nombre,
           e.en_area_desde, e.recibido_en,
           -- La precisión es del movimiento que fijó en_area_desde (el mismo criterio que la ficha).
           (SELECT m.precision_fecha FROM public.movimientos m
             WHERE m.expediente_id = e.id AND m.fecha_efectiva = e.en_area_desde
               AND m.tipo IN ('alta', 'pase', 'devolucion', 'estado')
             ORDER BY m.secuencia DESC LIMIT 1) AS en_area_precision,
           e.plazo_desde::text AS plazo_desde, e.plazo_dias_habiles::int AS plazo_dias_habiles,
           e.plazo_cumplido_en::text AS plazo_cumplido_en,
           public.f_dias_habiles_entre((e.en_area_desde AT TIME ZONE 'America/Argentina/Tucuman')::date, ${hoy}::date) AS dias_en_area,
           (SELECT nullif(concat_ws(', ', t.apellido, t.nombres), '') FROM public.expediente_personas t
             WHERE t.expediente_id = e.id AND t.vigente AND t.rol = 'titular' ORDER BY t.orden LIMIT 1) AS titular,
           d.motivo AS devolucion_motivo, d.area AS devolucion_area, d.paso AS devolucion_paso
      FROM public.expedientes e
      JOIN public.plantillas p ON p.id = e.plantilla_id
      JOIN public.tipos_tramite tt ON tt.id = e.tipo_tramite_id
      JOIN public.areas aa ON aa.id = e.area_actual_id
      JOIN public.areas ar ON ar.id = e.area_responsable_id
      LEFT JOIN LATERAL (
        SELECT m.motivo, au.nombre AS area, m.paso_origen AS paso
          FROM public.movimientos m
          LEFT JOIN public.areas au ON au.id = m.area_usuario_id
         WHERE m.expediente_id = e.id AND m.tipo = 'devolucion'
         ORDER BY m.secuencia DESC
         LIMIT 1
      ) d ON e.paso_retorno_clave IS NOT NULL
     WHERE e.estado IN ('en_tramite', 'espera_pago_dim') AND ${condicion(pestana, area)}
     ORDER BY e.en_area_desde ASC, e.id ASC
     LIMIT ${MAXIMO_FILAS_BANDEJA + 1}`;

  // La definición es la misma para todos los expedientes de una versión: se lee una vez.
  const definiciones = new Map<number, ReturnType<typeof analizarDefinicion>>();
  const definicionDe = (f: FilaSql) => {
    let r = definiciones.get(f.plantilla_id);
    if (!r) {
      r = analizarDefinicion(f.definicion);
      definiciones.set(f.plantilla_id, r);
    }
    return r.ok ? r.definicion : null;
  };

  return {
    pestana,
    area,
    hayMas: filas.length > MAXIMO_FILAS_BANDEJA,
    filas: filas.slice(0, MAXIMO_FILAS_BANDEJA).map((f): FilaBandeja => {
      const def = definicionDe(f);
      const paso = def?.pasos[f.paso_orden - 1];
      const nombrePaso = (clave: string | null) => (clave === null ? null : (def?.pasos.find((p) => p.clave === clave)?.nombre ?? clave));
      const diasEnArea = f.dias_en_area ?? 0;
      const diasAlerta = paso?.dias_alerta ?? Number.MAX_SAFE_INTEGER;
      const etiquetas: EtiquetaBandeja[] = [];
      if (f.paso_retorno_clave !== null) {
        etiquetas.push({ tipo: "devuelto", porArea: f.devolucion_area, desdePaso: nombrePaso(f.devolucion_paso), motivo: f.devolucion_motivo });
      }
      if (f.recibido_en === null) etiquetas.push({ tipo: "sin_confirmar" });
      if (f.plazo_dias_habiles !== null) {
        etiquetas.push({ tipo: "plazo", desde: f.plazo_desde, diasHabiles: f.plazo_dias_habiles, cumplidoEn: f.plazo_cumplido_en });
      }
      const total = def?.pasos.length ?? f.paso_orden;
      // Las mismas reglas que exigen confirmarRecepcion y darPase (las áreas
      // recorridas y los pases previos no cuentan para estas dos acciones).
      const permisos: ExpedientePermisos = {
        estado: comoEstado(f.estado),
        areaResponsableId: f.area_responsable_id,
        areasRecorridas: [],
        tuvoPases: false,
        cargaHistorica: f.carga_historica,
        pasoFinal: f.paso_orden >= total,
        primerPaso: f.paso_orden <= 1,
      };
      const soloConsulta = pestana === "afuera" && f.area_responsable_id !== area.id;
      let paseRapido: RefPaso | null = null;
      if (def && !soloConsulta && evaluarPermiso("dar_pase", permisos, usuario).permitido) {
        const datosExtra = (f.datos_extra ?? {}) as Record<string, unknown>;
        const destinos = destinosPosibles(def, leerItems(f.items), datosExtra, f.paso_orden, f.paso_retorno_clave);
        const [unico] = destinos;
        if (destinos.length === 1 && unico.tipo === "siguiente" && unico.faltan.length === 0) {
          paseRapido = { clave: unico.clave, nombre: unico.nombre, orden: unico.orden };
        }
      }
      return {
        numero: f.numero_interno,
        numeroCorto: numeroCorto(f.anio, f.secuencia),
        numeroMunicipal: f.numero_municipal,
        titular: f.titular,
        tramite: { tipo: f.tipo_tramite, plantilla: f.plantilla_nombre, codigo: f.plantilla_codigo, version: f.plantilla_version },
        paso: { clave: f.paso_clave, nombre: paso?.nombre ?? f.paso_clave, orden: f.paso_orden, total },
        estado: f.estado,
        version: f.version,
        areaActual: { codigo: f.area_actual_codigo, nombre: f.area_actual_nombre, externa: f.area_actual_tipo === "externa" },
        areaResponsable: { codigo: f.area_responsable_codigo, nombre: f.area_responsable_nombre },
        enAreaDesde: f.en_area_desde,
        enAreaDesdePrecision: f.en_area_precision === "dia" ? "dia" : "minuto",
        recibidoEn: f.recibido_en,
        diasEnArea,
        diasAlerta: paso?.dias_alerta ?? 0,
        demorado: diasEnArea >= diasAlerta,
        etiquetas,
        soloConsulta,
        puedeConfirmar: f.recibido_en === null && !soloConsulta && evaluarPermiso("confirmar_recepcion", permisos, usuario).permitido,
        paseRapido,
      };
    }),
  };
}

/**
 * El contador "Por confirmar" del encabezado (sección 5): expedientes en el
 * área del usuario sin la recepción confirmada. 0 para quien no tiene bandeja.
 */
export async function contadorPorConfirmar(deps: DependenciasExpedientes, usuario: UsuarioPermisos): Promise<number> {
  if (!usuario.activo || usuario.rol !== "operador" || !usuario.area) return 0;
  return deps.leer.expediente.count({
    where: { areaActualId: usuario.area.id, recibidoEn: null, estado: { in: ["en_tramite", "espera_pago_dim"] } },
  });
}

/** Cuántos expedientes hay en cada pestaña (para las pestañas y para elegir la que se abre). */
export interface ContadoresBandeja {
  por_confirmar: number;
  en_mi_area: number;
  /** Todo lo que muestra "Afuera" (para Mesa de Entradas, también lo que solo consulta). */
  afuera: number;
  /** Lo de "Afuera" que custodia el área del usuario: el trabajo de esa pestaña. */
  afueraCustodia: number;
}

const SIN_CONTADORES: ContadoresBandeja = { por_confirmar: 0, en_mi_area: 0, afuera: 0, afueraCustodia: 0 };

/**
 * Los contadores de las pestañas de `/bandeja`, con las mismas condiciones que
 * `bandeja()`. Todo en 0 para quien no tiene bandeja (Dirección, el admin).
 */
export async function contadoresBandeja(deps: DependenciasExpedientes, usuario: UsuarioPermisos): Promise<ContadoresBandeja> {
  const area = usuario.area;
  if (!area || !evaluarPermiso("ver_bandeja", null, usuario).permitido) return SIN_CONTADORES;
  const [c] = await deps.leer.$queryRaw<Array<{ por_confirmar: number; en_mi_area: number; afuera: number; afuera_custodia: number }>>`
    SELECT count(*) FILTER (WHERE ${condicion("por_confirmar", area)})::int AS por_confirmar,
           count(*) FILTER (WHERE ${condicion("en_mi_area", area)})::int AS en_mi_area,
           count(*) FILTER (WHERE ${condicion("afuera", area)})::int AS afuera,
           count(*) FILTER (WHERE aa.tipo = 'externa' AND e.area_responsable_id = ${area.id})::int AS afuera_custodia
      FROM public.expedientes e
      JOIN public.areas aa ON aa.id = e.area_actual_id
     WHERE e.estado IN ('en_tramite', 'espera_pago_dim')`;
  return c ? { por_confirmar: c.por_confirmar, en_mi_area: c.en_mi_area, afuera: c.afuera, afueraCustodia: c.afuera_custodia } : SIN_CONTADORES;
}
