import { Prisma } from "@/generated/prisma/client";
import { hoyEnTucuman } from "@/lib/fechas";
import { AREA_MESA_ENTRADAS, evaluarPermiso, exigirPermiso, type ExpedientePermisos, type UsuarioPermisos } from "../permisos";
import { analizarDefinicion } from "../plantillas/esquema";
import { resolverDefinicion } from "../plantillas/resolver";
import { comoEstado } from "./acceso";
import type { DependenciasExpedientes } from "./dependencias";
import { DIAS_PLAZO_POR_VENCER, destinosPosibles, type RefPaso } from "./flujo";
import { leerItems } from "./items";
import { numeroCorto } from "./numero";
import { completarPlazo, sqlPlazo, type PlazoCalculado } from "./plazos";

/**
 * Las bandejas de `/bandeja` (docs/propuesta-mvp.md, sección 5) y el contador
 * "Por confirmar" del encabezado. Semana 3: Por confirmar, En mi área y
 * Afuera. Semana 4: Plazos y Carga histórica.
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
 * - **Plazos** (semana 4, 3.6): los que están en un paso con plazo (la DIM)
 *   cuya custodia es el área del usuario (Tributario), con el vencimiento, los
 *   días hábiles que faltan y el semáforo; del que vence antes al último.
 *   Mesa de Entradas ve todos, como en Afuera.
 * - **Carga histórica** (semana 4, 2.13(c)): solo Mesa de Entradas; los
 *   expedientes con la transcripción abierta, en cualquier estado salvo
 *   anulado.
 *
 * Mientras la carga histórica está abierta, el expediente NO aparece en las
 * otras pestañas ni en el contador, y no cuenta como demorado: sus pases se
 * transcriben, no se trabajan.
 *
 * Salvo Carga histórica, siempre en estados activos (en trámite o en espera de
 * pago en la DIM), del que lleva más tiempo en el área al más nuevo. Leer la
 * bandeja no registra accesos: abrir la ficha sí.
 */

export const PESTANAS_BANDEJA = ["por_confirmar", "en_mi_area", "afuera", "plazos", "carga_historica"] as const;
export type PestanaBandeja = (typeof PESTANAS_BANDEJA)[number];

/** Filas por pestaña como máximo; con más, `hayMas` (y la búsqueda para encontrar el resto). */
export const MAXIMO_FILAS_BANDEJA = 200;

export type EtiquetaBandeja =
  | { tipo: "sin_confirmar" }
  /** "Devuelto por Asesoría Legal: <motivo>" (3.4): en rojo. */
  | { tipo: "devuelto"; porArea: string | null; desdePaso: string | null; motivo: string | null }
  /** El paso tiene plazo (3.6): vencimiento, "faltan N", semáforo y si es provisorio (semana 4). */
  | ({ tipo: "plazo" } & PlazoCalculado);

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
  cementerio_codigo: string;
  /** Roles con una persona jurídica vigente (para los documentos que dependen de eso). */
  roles_juridicos: string[] | null;
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
  vence: string | null;
  faltan: number | null;
  anios_sin_cerrar: number[] | null;
  dias_en_area: number | null;
  titular: string | null;
  devolucion_motivo: string | null;
  devolucion_area: string | null;
  devolucion_paso: string | null;
}

/** Estados activos y sin la carga histórica abierta: lo que se trabaja. */
const EN_TRABAJO = Prisma.sql`e.estado IN ('en_tramite', 'espera_pago_dim') AND NOT e.carga_historica`;

function condicion(pestana: PestanaBandeja, area: { id: number; codigo: string }): Prisma.Sql {
  const mesa = area.codigo === AREA_MESA_ENTRADAS;
  switch (pestana) {
    case "por_confirmar":
      return Prisma.sql`${EN_TRABAJO} AND e.area_actual_id = ${area.id} AND e.recibido_en IS NULL`;
    case "en_mi_area":
      return Prisma.sql`${EN_TRABAJO} AND e.area_responsable_id = ${area.id} AND e.area_actual_id = e.area_responsable_id`;
    case "afuera":
      return mesa
        ? Prisma.sql`${EN_TRABAJO} AND aa.tipo = 'externa'`
        : Prisma.sql`${EN_TRABAJO} AND aa.tipo = 'externa' AND e.area_responsable_id = ${area.id}`;
    case "plazos":
      return mesa
        ? Prisma.sql`${EN_TRABAJO} AND e.plazo_dias_habiles IS NOT NULL`
        : Prisma.sql`${EN_TRABAJO} AND e.plazo_dias_habiles IS NOT NULL AND e.area_responsable_id = ${area.id}`;
    case "carga_historica":
      return mesa ? Prisma.sql`e.carga_historica AND e.estado <> 'anulado'` : Prisma.sql`false`;
  }
}

function ordenDe(pestana: PestanaBandeja): Prisma.Sql {
  // Plazos: primero lo que vence antes; los que todavía no empezaron, al final.
  if (pestana === "plazos") return Prisma.sql`e.plazo_cumplido_en IS NOT NULL, pz.vence ASC NULLS LAST, e.en_area_desde ASC, e.id ASC`;
  return Prisma.sql`e.en_area_desde ASC, e.id ASC`;
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
           c.codigo AS cementerio_codigo,
           (SELECT array_agg(DISTINCT j.rol) FROM public.expediente_personas j
             WHERE j.expediente_id = e.id AND j.vigente AND j.tipo_persona = 'juridica') AS roles_juridicos,
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
           pz.vence, pz.faltan, pz.anios_sin_cerrar,
           public.f_dias_habiles_entre((e.en_area_desde AT TIME ZONE 'America/Argentina/Tucuman')::date, ${hoy}::date) AS dias_en_area,
           (SELECT nullif(coalesce(t.razon_social, concat_ws(', ', t.apellido, t.nombres)), '') FROM public.expediente_personas t
             WHERE t.expediente_id = e.id AND t.vigente AND t.rol = 'titular' ORDER BY t.orden LIMIT 1) AS titular,
           d.motivo AS devolucion_motivo, d.area AS devolucion_area, d.paso AS devolucion_paso
      FROM public.expedientes e
      JOIN public.plantillas p ON p.id = e.plantilla_id
      JOIN public.cementerios c ON c.id = e.cementerio_id
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
      ${sqlPlazo(hoy)}
     WHERE ${condicion(pestana, area)}
     ORDER BY ${ordenDe(pestana)}
     LIMIT ${MAXIMO_FILAS_BANDEJA + 1}`;

  // La definición es la misma para todos los expedientes de una versión: se lee
  // una vez. Después se resuelve para cada expediente (su cementerio y sus
  // personas), como en la ficha: el pase rápido no puede ofrecer lo que el
  // pase después rechace.
  const definiciones = new Map<number, ReturnType<typeof analizarDefinicion>>();
  const definicionDe = (f: FilaSql) => {
    let r = definiciones.get(f.plantilla_id);
    if (!r) {
      r = analizarDefinicion(f.definicion);
      definiciones.set(f.plantilla_id, r);
    }
    return r.ok ? resolverDefinicion(r.definicion, { cementerio: f.cementerio_codigo, rolesJuridicos: f.roles_juridicos ?? [] }) : null;
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
        etiquetas.push({
          tipo: "plazo",
          ...completarPlazo({
            desde: f.plazo_desde,
            diasHabiles: f.plazo_dias_habiles,
            cumplidoEn: f.plazo_cumplido_en,
            vence: f.vence,
            faltan: f.faltan,
            aniosSinCerrar: f.anios_sin_cerrar ?? [],
          }),
        });
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
      const soloConsulta = (pestana === "afuera" || pestana === "plazos") && f.area_responsable_id !== area.id;
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
        // Con la carga histórica abierta no hay demora: los pases se transcriben.
        demorado: !f.carga_historica && diasEnArea >= diasAlerta,
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
    where: { areaActualId: usuario.area.id, recibidoEn: null, estado: { in: ["en_tramite", "espera_pago_dim"] }, cargaHistorica: false },
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
  /** Semana 4: lo de "Plazos" (para Mesa de Entradas, todos). */
  plazos: number;
  /** De esos, los que custodia el área y están por vencer o vencidos (ámbar o rojo). */
  plazosAlerta: number;
  /** Semana 4: cargas históricas abiertas (solo Mesa de Entradas). */
  carga_historica: number;
}

const SIN_CONTADORES: ContadoresBandeja = { por_confirmar: 0, en_mi_area: 0, afuera: 0, afueraCustodia: 0, plazos: 0, plazosAlerta: 0, carga_historica: 0 };

/**
 * Los contadores de las pestañas de `/bandeja`, con las mismas condiciones que
 * `bandeja()`. Todo en 0 para quien no tiene bandeja (Dirección, el admin).
 */
export async function contadoresBandeja(deps: DependenciasExpedientes, usuario: UsuarioPermisos): Promise<ContadoresBandeja> {
  const area = usuario.area;
  if (!area || !evaluarPermiso("ver_bandeja", null, usuario).permitido) return SIN_CONTADORES;
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());
  const [c] = await deps.leer.$queryRaw<
    Array<{ por_confirmar: number; en_mi_area: number; afuera: number; afuera_custodia: number; plazos: number; plazos_alerta: number; carga_historica: number }>
  >`
    SELECT count(*) FILTER (WHERE ${condicion("por_confirmar", area)})::int AS por_confirmar,
           count(*) FILTER (WHERE ${condicion("en_mi_area", area)})::int AS en_mi_area,
           count(*) FILTER (WHERE ${condicion("afuera", area)})::int AS afuera,
           count(*) FILTER (WHERE ${EN_TRABAJO} AND aa.tipo = 'externa' AND e.area_responsable_id = ${area.id})::int AS afuera_custodia,
           count(*) FILTER (WHERE ${condicion("plazos", area)})::int AS plazos,
           count(*) FILTER (WHERE ${EN_TRABAJO} AND e.plazo_dias_habiles IS NOT NULL AND e.area_responsable_id = ${area.id}
                              AND e.plazo_cumplido_en IS NULL AND pz.faltan <= ${DIAS_PLAZO_POR_VENCER})::int AS plazos_alerta,
           count(*) FILTER (WHERE ${condicion("carga_historica", area)})::int AS carga_historica
      FROM public.expedientes e
      JOIN public.areas aa ON aa.id = e.area_actual_id
      ${sqlPlazo(hoy)}
     WHERE e.estado <> 'anulado'`;
  return c
    ? {
        por_confirmar: c.por_confirmar,
        en_mi_area: c.en_mi_area,
        afuera: c.afuera,
        afueraCustodia: c.afuera_custodia,
        plazos: c.plazos,
        plazosAlerta: c.plazos_alerta,
        carga_historica: c.carga_historica,
      }
    : SIN_CONTADORES;
}
