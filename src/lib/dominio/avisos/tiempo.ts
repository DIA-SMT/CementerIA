import { SISTEMA_ID } from "@/lib/auth/ingreso";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { fechaParaDb, hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { DIAS_PLAZO_POR_VENCER } from "../expedientes/flujo";
import { DIAS_SIN_CONFIRMAR } from "../expedientes/panel";
import { sqlPlazo } from "../expedientes/plazos";
import type { DependenciasAvisos } from "./dependencias";
import { datosDeFila, type FilaAviso } from "./eventos";
import {
  avisoDemorado,
  avisoPlazo,
  avisoSinConfirmar,
  claveDemorado,
  claveDePlazo,
  claveSinConfirmar,
  TIPOS_AVISO,
  type ContenidoAviso,
  type TipoAviso,
} from "./tipos";

/**
 * Los avisos por el paso del tiempo (docs/api-dominio.md, 21.3): plazo DIM por
 * vencer y vencido, enviado sin confirmar y demorado. No hay un evento que los
 * dispare: un expediente "se vence" solo. Los arma `generarAvisosPorTiempo()`,
 * que mira los expedientes en trabajo (estados activos y sin la carga
 * histórica abierta) con las mismas reglas que el panel y la bandeja, y
 * calcula los días hábiles en la base (`f_dias_habiles_entre`,
 * `f_sumar_dias_habiles`): los feriados cuentan.
 *
 * **Idempotente**: la clave de cada aviso es por expediente y situación (el
 * plazo por su inicio, el envío por su movimiento, la demora por la estadía en
 * el paso), no por día. Correrla dos veces, o todos los días, no repite nada:
 * un expediente demorado avisa una vez por paso, no una por día.
 *
 * **Cuándo corre** (decisión del 26/10/2026):
 *
 * 1. Por la tarea programada, todos los días a las 6:00 (`npm run
 *    avisos:generar`, timer `cementeria-avisos`): antes de que llegue nadie.
 * 2. Si ese día no corrió (el servidor estuvo apagado, el timer falló, o en
 *    desarrollo), la primera pantalla que carga un operador la corre:
 *    `generarSiHaceFalta()` desde el layout. Es barata (si ya corrió, una
 *    lectura por clave primaria de `avisos_corridas`) y acotada (una sola vez
 *    por día: la fila del día se reserva con ON CONFLICT DO NOTHING en la misma
 *    transacción, así que dos cargas a la vez no la corren dos veces; y con
 *    `statement_timeout` de 10 s). Si falla, la pantalla se muestra igual.
 *
 * Una vez por día alcanza: las tres reglas son en días hábiles.
 */

/** Lo que trae la consulta de cada expediente en trabajo. */
export interface ExpedienteEnTrabajo {
  expediente_id: bigint;
  numero_interno: string;
  tramite: string;
  paso_clave: string;
  paso: string | null;
  dias_alerta: number | null;
  area_actual_id: number;
  area_actual: string;
  area_responsable_id: number;
  en_area_desde: Date;
  recibido_en: Date | null;
  dias_en_area: number | null;
  plazo_desde: string | null;
  plazo_dias_habiles: number | null;
  plazo_cumplido_en: string | null;
  vence: string | null;
  faltan: number | null;
  anios_sin_cerrar: number[] | null;
  /** El pase o la devolución que lo dejó sin confirmar, y el área de quien lo mandó. */
  envio_id: bigint | null;
  envio_area_id: number | null;
}

/** Un aviso por tiempo, antes de saber los destinatarios: va a todos los operadores de `areaId`. */
export interface AvisoPorTiempo {
  areaId: number;
  expedienteId: bigint;
  movimientoId: bigint | null;
  clave: string;
  contenido: ContenidoAviso;
}

/**
 * Qué avisos corresponden a cada expediente hoy. Pura (los días hábiles ya
 * vienen calculados por la base):
 *
 * - **Plazo DIM**: con el plazo empezado y sin cumplir, `faltan` de 0 a 5 es
 *   "por vencer" y negativo, "vencido"; a la custodia (`area_responsable_id`).
 * - **Sin confirmar**: `recibido_en` nulo y más de `DIAS_SIN_CONFIRMAR` (2)
 *   días hábiles en el área (como el panel); al área de quien lo envió.
 * - **Demorado**: `dias_en_area >= dias_alerta` del paso (como la bandeja); al
 *   área responsable.
 */
export function avisosPorTiempo(filas: readonly ExpedienteEnTrabajo[]): AvisoPorTiempo[] {
  const avisos: AvisoPorTiempo[] = [];
  for (const f of filas) {
    const base = { numero: f.numero_interno, tramite: f.tramite, paso: f.paso ?? f.paso_clave };
    const dias = f.dias_en_area ?? 0;

    if (f.plazo_dias_habiles !== null && f.plazo_desde !== null && f.plazo_cumplido_en === null && f.vence !== null && f.faltan !== null) {
      if (f.faltan <= DIAS_PLAZO_POR_VENCER) {
        const contenido = avisoPlazo({ ...base, vence: f.vence, faltan: f.faltan, provisorio: (f.anios_sin_cerrar ?? []).length > 0 });
        const tipo = contenido.tipo as "plazo_por_vencer" | "plazo_vencido";
        avisos.push({
          areaId: f.area_responsable_id,
          expedienteId: f.expediente_id,
          movimientoId: null,
          clave: claveDePlazo(tipo, f.expediente_id, f.plazo_desde),
          contenido,
        });
      }
    }

    if (f.recibido_en === null && dias > DIAS_SIN_CONFIRMAR && f.envio_id !== null && f.envio_area_id !== null && f.envio_area_id !== f.area_actual_id) {
      avisos.push({
        areaId: f.envio_area_id,
        expedienteId: f.expediente_id,
        movimientoId: f.envio_id,
        clave: claveSinConfirmar(f.envio_id),
        contenido: avisoSinConfirmar({ ...base, areaDestino: f.area_actual, dias }),
      });
    }

    if (f.dias_alerta !== null && f.dias_en_area !== null && dias >= f.dias_alerta) {
      avisos.push({
        areaId: f.area_responsable_id,
        expedienteId: f.expediente_id,
        movimientoId: null,
        clave: claveDemorado(f.expediente_id, f.paso_clave, f.en_area_desde),
        contenido: avisoDemorado({ ...base, area: f.area_actual, dias, diasAlerta: f.dias_alerta }),
      });
    }
  }
  return avisos;
}

export interface ResultadoGeneracion {
  dia: FechaISO;
  /** Avisos nuevos (sin contar los que ya estaban). */
  creados: number;
  porTipo: Record<TipoAviso, number>;
  /** Expedientes en trabajo que se miraron. */
  expedientes: number;
}

/** Los expedientes en trabajo con lo que hace falta para decidir (una consulta). */
async function expedientesEnTrabajo(tx: Pick<Transaccion, "$queryRaw">, hoy: FechaISO): Promise<ExpedienteEnTrabajo[]> {
  return tx.$queryRaw<ExpedienteEnTrabajo[]>`
    SELECT e.id AS expediente_id, e.numero_interno, pl.nombre AS tramite, e.paso_clave,
           (SELECT x ->> 'nombre' FROM jsonb_array_elements(pl.definicion -> 'pasos') AS x
             WHERE x ->> 'clave' = e.paso_clave LIMIT 1) AS paso,
           (SELECT (x ->> 'dias_alerta')::int FROM jsonb_array_elements(pl.definicion -> 'pasos') AS x
             WHERE x ->> 'clave' = e.paso_clave LIMIT 1) AS dias_alerta,
           e.area_actual_id::int AS area_actual_id, aa.nombre AS area_actual,
           e.area_responsable_id::int AS area_responsable_id,
           e.en_area_desde, e.recibido_en,
           public.f_dias_habiles_entre((e.en_area_desde AT TIME ZONE 'America/Argentina/Tucuman')::date, ${hoy}::date) AS dias_en_area,
           e.plazo_desde::text AS plazo_desde, e.plazo_dias_habiles::int AS plazo_dias_habiles,
           e.plazo_cumplido_en::text AS plazo_cumplido_en, pz.vence, pz.faltan, pz.anios_sin_cerrar,
           env.id AS envio_id, env.area_usuario_id::int AS envio_area_id
      FROM public.expedientes e
      JOIN public.plantillas pl ON pl.id = e.plantilla_id
      JOIN public.areas aa ON aa.id = e.area_actual_id
      -- El envío que espera confirmación: el último pase o devolución con la
      -- fecha de llegada (uno revertido ya no la tiene: en_area_desde volvió atrás).
      LEFT JOIN LATERAL (
        SELECT m.id, m.area_usuario_id
          FROM public.movimientos m
         WHERE m.expediente_id = e.id AND m.tipo IN ('pase', 'devolucion') AND m.fecha_efectiva = e.en_area_desde
         ORDER BY m.secuencia DESC
         LIMIT 1
      ) env ON e.recibido_en IS NULL
      ${sqlPlazo(hoy)}
     WHERE e.estado IN ('en_tramite', 'espera_pago_dim') AND NOT e.carga_historica
     ORDER BY e.id`;
}

/**
 * Genera los avisos por tiempo dentro de una transacción ya abierta (con el
 * actor fijado). La usan `generarAvisosPorTiempo()`, `generarSiHaceFalta()` y
 * el script de la tarea programada. No anota la corrida.
 */
export async function generarEn(tx: Transaccion, ahora: Date): Promise<ResultadoGeneracion> {
  const hoy = hoyEnTucuman(ahora);
  const filas = await expedientesEnTrabajo(tx, hoy);
  const candidatos = avisosPorTiempo(filas);
  const porTipo = Object.fromEntries(TIPOS_AVISO.map((t) => [t, 0])) as Record<TipoAviso, number>;
  if (candidatos.length === 0) return { dia: hoy, creados: 0, porTipo, expedientes: filas.length };

  const areas = [...new Set(candidatos.map((c) => c.areaId))];
  const usuarios = await tx.usuario.findMany({
    where: { areaId: { in: areas }, activo: true, rol: "operador" },
    select: { id: true, areaId: true },
    orderBy: { id: "asc" },
  });
  const porArea = new Map<number, number[]>();
  for (const u of usuarios) if (u.areaId !== null) porArea.set(u.areaId, [...(porArea.get(u.areaId) ?? []), u.id]);

  const nuevas: FilaAviso[] = candidatos.flatMap((c) =>
    (porArea.get(c.areaId) ?? []).map((usuarioId) => ({
      usuarioId,
      expedienteId: c.expedienteId,
      movimientoId: c.movimientoId,
      clave: c.clave,
      contenido: c.contenido,
      creadoEn: ahora,
    })),
  );
  // ON CONFLICT DO NOTHING: lo que ya estaba (de ayer, de otra corrida) no se
  // inserta ni se devuelve. Se cuentan solo los nuevos.
  const insertados = nuevas.length === 0 ? [] : await tx.aviso.createManyAndReturn({ data: nuevas.map(datosDeFila), skipDuplicates: true, select: { tipo: true } });
  for (const a of insertados) if (a.tipo in porTipo) porTipo[a.tipo as TipoAviso] += 1;
  return { dia: hoy, creados: insertados.length, porTipo, expedientes: filas.length };
}

/** Anota la corrida del día (suma lo creado si ya había una). */
async function anotarCorrida(tx: Transaccion, r: ResultadoGeneracion, ahora: Date): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO public.avisos_corridas (dia, corrido_en, avisos) VALUES (${r.dia}::date, ${ahora}, ${r.creados})
    ON CONFLICT (dia) DO UPDATE SET corrido_en = EXCLUDED.corrido_en, avisos = public.avisos_corridas.avisos + EXCLUDED.avisos`;
}

/** La tarea programada (y la semilla): genera siempre y anota la corrida. Como SISTEMA. */
export async function generarYAnotar(tx: Transaccion, ahora: Date): Promise<ResultadoGeneracion> {
  const r = await generarEn(tx, ahora);
  await anotarCorrida(tx, r, ahora);
  return r;
}

/**
 * Genera los avisos por tiempo (idempotente) y anota la corrida del día. Es lo
 * que corre `npm run avisos:generar`.
 */
export async function generarAvisosPorTiempo(deps: DependenciasAvisos, opciones: { ahora?: Date } = {}): Promise<ResultadoGeneracion> {
  const ahora = opciones.ahora ?? deps.ahora?.() ?? new Date();
  return deps.escribir(SISTEMA_ID, "Avisos por tiempo", (tx) => generarYAnotar(tx, ahora));
}

/**
 * La red de seguridad del layout: si hoy no corrió la generación, la corre
 * una vez (ver el comentario del módulo). Devuelve null si ya había corrido
 * (o si otra carga la está corriendo en este momento).
 */
export async function generarSiHaceFalta(deps: DependenciasAvisos): Promise<ResultadoGeneracion | null> {
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnTucuman(ahora);
  const ya = await deps.leer.avisoCorrida.findUnique({ where: { dia: fechaParaDb(hoy) }, select: { dia: true } });
  if (ya) return null;
  return deps.escribir(SISTEMA_ID, "Avisos por tiempo (primera carga del día)", async (tx) => {
    // Acotada: si la consulta se demora, se corta y la pantalla sigue (el layout atrapa el error).
    await tx.$executeRaw`SELECT set_config('statement_timeout', '10s', true)`;
    const reservada = await tx.$queryRaw<Array<{ dia: Date }>>`
      INSERT INTO public.avisos_corridas (dia, corrido_en) VALUES (${hoy}::date, ${ahora})
      ON CONFLICT (dia) DO NOTHING RETURNING dia`;
    if (reservada.length === 0) return null;
    const r = await generarEn(tx, ahora);
    await tx.$executeRaw`UPDATE public.avisos_corridas SET avisos = avisos + ${r.creados} WHERE dia = ${hoy}::date`;
    return r;
  });
}
