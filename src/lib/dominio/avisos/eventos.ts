import type { Transaccion } from "@/lib/db/crear-cliente";
import { AREA_MESA_ENTRADAS } from "../permisos";
import {
  avisoCierre,
  avisoDevolucion,
  avisoLlegada,
  claveDeMovimiento,
  TIPOS_DESACTIVABLES,
  type ContenidoAviso,
  type TipoAviso,
} from "./tipos";

/**
 * Los avisos que nacen de una acción: el pase ("llegó"), la devolución
 * ("te devolvieron") y concluir o archivar ("cerrado"). Los llama el dominio
 * de expedientes (pase.ts, devolucion.ts, estados.ts) con el `tx` de la
 * acción, después de insertar el movimiento: el aviso y el movimiento van en
 * la MISMA transacción, así que no hay pase sin aviso ni aviso sin pase (si
 * algo falla, se deshacen los dos). Nunca desde la pantalla.
 *
 * La idempotencia es la de la acción: un comando repetido devuelve lo de la
 * primera vez sin volver a llegar acá. Igual, la clave única
 * (`usuario_id`, `clave`) con `skipDuplicates` hace que insertar dos veces lo
 * mismo no duplique nada.
 */

/** Una fila de `avisos` por destinatario. */
export interface FilaAviso {
  usuarioId: number;
  expedienteId: bigint;
  movimientoId: bigint | null;
  clave: string;
  contenido: ContenidoAviso;
  creadoEn: Date;
}

/** Las columnas de `avisos` de una fila. */
export function datosDeFila(f: FilaAviso) {
  return {
    usuarioId: f.usuarioId,
    expedienteId: f.expedienteId,
    movimientoId: f.movimientoId,
    clave: f.clave,
    tipo: f.contenido.tipo,
    prioridad: f.contenido.prioridad,
    titulo: f.contenido.titulo,
    texto: f.contenido.texto,
    enlace: f.contenido.enlace,
    creadoEn: f.creadoEn,
  };
}

/** Inserta los avisos sin duplicar (ON CONFLICT DO NOTHING). Devuelve cuántos se crearon. */
export async function insertarAvisos(tx: Pick<Transaccion, "aviso">, filas: readonly FilaAviso[]): Promise<number> {
  if (filas.length === 0) return 0;
  const r = await tx.aviso.createMany({ data: filas.map(datosDeFila), skipDuplicates: true });
  return r.count;
}

/**
 * Los destinatarios de un aviso en un área: sus operadores activos (ni el
 * admin, ni Dirección, que es de solo lectura, ni SISTEMA, que está inactivo),
 * menos quien hizo la acción y menos los que apagaron ese tipo (si se puede
 * apagar).
 */
export async function destinatariosDelArea(
  tx: Pick<Transaccion, "usuario" | "avisoPreferencia">,
  areaId: number,
  tipo: TipoAviso,
  excluir: number | null,
): Promise<number[]> {
  const usuarios = await tx.usuario.findMany({
    where: { areaId, activo: true, rol: "operador", ...(excluir !== null ? { id: { not: excluir } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const ids = usuarios.map((u) => u.id);
  if (ids.length === 0 || !TIPOS_DESACTIVABLES.includes(tipo)) return ids;
  const apagados = await tx.avisoPreferencia.findMany({
    where: { usuarioId: { in: ids }, tipo, canal: "sistema", activo: false },
    select: { usuarioId: true },
  });
  const sin = new Set(apagados.map((p) => p.usuarioId));
  return ids.filter((id) => !sin.has(id));
}

async function expedienteDelAviso(tx: Pick<Transaccion, "expediente">, expedienteId: bigint) {
  return tx.expediente.findUniqueOrThrow({
    where: { id: expedienteId },
    select: { numeroInterno: true, plantilla: { select: { nombre: true } } },
  });
}

async function areasPorId(tx: Pick<Transaccion, "area">, ids: ReadonlyArray<number | null>) {
  const unicos = [...new Set(ids.filter((id): id is number => id !== null))];
  const areas = await tx.area.findMany({ where: { id: { in: unicos } }, select: { id: true, nombre: true, tipo: true } });
  return new Map(areas.map((a) => [a.id, a]));
}

export interface EventoLlegada {
  /** El movimiento que movió el papel. */
  tipo: "pase" | "devolucion";
  expedienteId: bigint;
  movimientoId: bigint;
  /** Quien dio el pase o devolvió (no se avisa a sí mismo). */
  actorId: number;
  /** El área de quien actuó: "Asesoría Legal lo devolvió". */
  actorAreaId: number | null;
  /** El nombre del paso al que llegó. */
  paso: string;
  /** Dónde estaba el papel antes. */
  areaOrigenId: number;
  /** Dónde está ahora (el área concreta: `$CEMENTERIO` resuelto). */
  areaActualId: number;
  /** Quién lo opera ahora: el área del paso o su custodia. */
  areaResponsableId: number;
  /** El motivo de la devolución. */
  motivo?: string | null;
  ahora: Date;
}

/**
 * "Llegó un expediente" (pase) o "Te devolvieron un expediente" (devolución)
 * al área de destino; si el paso es externo (la DIM, un cementerio), a la
 * custodia. Devuelve cuántos avisos creó.
 */
export async function avisarLlegada(tx: Transaccion, e: EventoLlegada): Promise<number> {
  const areas = await areasPorId(tx, [e.areaOrigenId, e.areaActualId, e.areaResponsableId, e.actorAreaId]);
  const actual = areas.get(e.areaActualId);
  if (!actual) return 0;
  const externo = actual.tipo === "externa";
  const destino = externo ? e.areaResponsableId : e.areaActualId;
  const tipoAviso: TipoAviso = e.tipo === "devolucion" ? "devuelto" : "llego";
  const usuarios = await destinatariosDelArea(tx, destino, tipoAviso, e.actorId);
  if (usuarios.length === 0) return 0;

  const exp = await expedienteDelAviso(tx, e.expedienteId);
  const base = { numero: exp.numeroInterno, tramite: exp.plantilla.nombre, paso: e.paso, areaActual: actual.nombre, externo };
  const contenido =
    e.tipo === "devolucion"
      ? avisoDevolucion({
          ...base,
          // El área de quien devolvió (como la bandeja: "Devuelto por …"); si no tiene, de dónde salió.
          areaQueDevolvio: (e.actorAreaId !== null ? areas.get(e.actorAreaId)?.nombre : undefined) ?? areas.get(e.areaOrigenId)?.nombre ?? null,
          motivo: e.motivo ?? "",
        })
      : avisoLlegada({ ...base, areaOrigen: areas.get(e.areaOrigenId)?.nombre ?? null });
  const clave = claveDeMovimiento(tipoAviso, e.movimientoId);
  return insertarAvisos(
    tx,
    usuarios.map((usuarioId) => ({ usuarioId, expedienteId: e.expedienteId, movimientoId: e.movimientoId, clave, contenido, creadoEn: e.ahora })),
  );
}

export interface EventoCierre {
  expedienteId: bigint;
  movimientoId: bigint;
  actorId: number;
  actorAreaId: number | null;
  estado: "concluido" | "archivado";
  ubicacionArchivo: string | null;
  /** Archivado sin concluir. */
  sinConcluir: boolean;
  ahora: Date;
}

/**
 * "Concluido o archivado", informativo, a Mesa de Entradas (prioridad baja).
 * Cada usuario lo puede apagar en /avisos (preferencia `cerrado`).
 */
export async function avisarCierre(tx: Transaccion, e: EventoCierre): Promise<number> {
  const mesa = await tx.area.findUnique({ where: { codigo: AREA_MESA_ENTRADAS }, select: { id: true } });
  if (!mesa) return 0;
  const usuarios = await destinatariosDelArea(tx, mesa.id, "cerrado", e.actorId);
  if (usuarios.length === 0) return 0;
  const exp = await expedienteDelAviso(tx, e.expedienteId);
  const areas = await areasPorId(tx, [e.actorAreaId]);
  const contenido = avisoCierre({
    numero: exp.numeroInterno,
    tramite: exp.plantilla.nombre,
    estado: e.estado,
    area: e.actorAreaId !== null ? (areas.get(e.actorAreaId)?.nombre ?? null) : null,
    ubicacionArchivo: e.ubicacionArchivo,
    sinConcluir: e.sinConcluir,
  });
  const clave = claveDeMovimiento("cerrado", e.movimientoId);
  return insertarAvisos(
    tx,
    usuarios.map((usuarioId) => ({ usuarioId, expedienteId: e.expedienteId, movimientoId: e.movimientoId, clave, contenido, creadoEn: e.ahora })),
  );
}
