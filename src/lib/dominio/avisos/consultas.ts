import type { Prisma } from "@/generated/prisma/client";
import type { UsuarioPermisos } from "../permisos";
import type { DependenciasAvisos } from "./dependencias";
import {
  esTipoAviso,
  ETIQUETA_TIPO_AVISO,
  TIPOS_DESACTIVABLES,
  type PrioridadAviso,
  type TipoAviso,
} from "./tipos";

/**
 * Lo que ve cada usuario de sus avisos: el contador y los últimos de la
 * campana, la lista de /avisos, marcar leído y no leído, y las preferencias.
 * Siempre los PROPIOS: cada consulta y cada UPDATE filtra por `usuario_id`
 * del usuario de la sesión, así que no se puede leer ni marcar un aviso de
 * otro aunque se mande su id.
 *
 * Solo reciben avisos los operadores activos con área (`recibeAvisos`): para
 * Dirección y el admin todo da 0 y vacío.
 */

/** Avisos por página en /avisos. */
export const AVISOS_POR_PAGINA = 25;
/** Los que muestra el panel de la campana. */
export const AVISOS_EN_CAMPANA = 8;

export function recibeAvisos(usuario: UsuarioPermisos): boolean {
  return usuario.activo && usuario.rol === "operador" && usuario.area !== null;
}

/** Un aviso como lo muestra la pantalla (serializable: va también al navegador). */
export interface AvisoVista {
  id: string;
  tipo: TipoAviso;
  prioridad: PrioridadAviso;
  titulo: string;
  texto: string;
  enlace: string;
  numero: string;
  /** ISO 8601 (es serializable en JSON y en las props de un Client Component). */
  creadoEn: string;
  leidoEn: string | null;
}

export interface ResumenAvisos {
  noLeidos: number;
  /** Los últimos (leídos o no), del más nuevo al más viejo. */
  ultimos: AvisoVista[];
}

const SELECCION = {
  id: true,
  tipo: true,
  prioridad: true,
  titulo: true,
  texto: true,
  enlace: true,
  creadoEn: true,
  leidoEn: true,
  expediente: { select: { numeroInterno: true } },
} as const satisfies Prisma.AvisoSelect;

type FilaAviso = Prisma.AvisoGetPayload<{ select: typeof SELECCION }>;

function vista(f: FilaAviso): AvisoVista {
  return {
    id: f.id.toString(),
    tipo: esTipoAviso(f.tipo) ? f.tipo : "llego",
    prioridad: f.prioridad === "alta" || f.prioridad === "baja" ? f.prioridad : "normal",
    titulo: f.titulo,
    texto: f.texto,
    enlace: f.enlace,
    numero: f.expediente.numeroInterno,
    creadoEn: f.creadoEn.toISOString(),
    leidoEn: f.leidoEn?.toISOString() ?? null,
  };
}

const VACIO: ResumenAvisos = { noLeidos: 0, ultimos: [] };

/** El contador del encabezado. Usa el índice parcial `avisos_no_leidos_idx`. */
export async function contarNoLeidos(deps: DependenciasAvisos, usuario: UsuarioPermisos): Promise<number> {
  if (!recibeAvisos(usuario)) return 0;
  return deps.leer.aviso.count({ where: { usuarioId: usuario.id, leidoEn: null } });
}

/** La campana: cuántos sin leer y los últimos `limite`. */
export async function resumenAvisos(deps: DependenciasAvisos, usuario: UsuarioPermisos, limite = AVISOS_EN_CAMPANA): Promise<ResumenAvisos> {
  if (!recibeAvisos(usuario)) return VACIO;
  const [noLeidos, filas] = await Promise.all([
    contarNoLeidos(deps, usuario),
    deps.leer.aviso.findMany({
      where: { usuarioId: usuario.id },
      select: SELECCION,
      orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(limite, 50)),
    }),
  ]);
  return { noLeidos, ultimos: filas.map(vista) };
}

export interface FiltrosAvisos {
  soloNoLeidos?: boolean;
  tipo?: TipoAviso | null;
  /** Desde 1. */
  pagina?: number;
}

export interface ListaAvisos {
  filas: AvisoVista[];
  /** Con los filtros. */
  total: number;
  pagina: number;
  paginas: number;
  /** Sin filtros: para el encabezado de la pantalla. */
  noLeidos: number;
}

/** La lista completa de /avisos, paginada, con los filtros. */
export async function listarAvisos(deps: DependenciasAvisos, usuario: UsuarioPermisos, filtros: FiltrosAvisos = {}): Promise<ListaAvisos> {
  if (!recibeAvisos(usuario)) return { filas: [], total: 0, pagina: 1, paginas: 1, noLeidos: 0 };
  const where: Prisma.AvisoWhereInput = {
    usuarioId: usuario.id,
    ...(filtros.soloNoLeidos ? { leidoEn: null } : {}),
    ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
  };
  const [total, noLeidos] = await Promise.all([deps.leer.aviso.count({ where }), contarNoLeidos(deps, usuario)]);
  const paginas = Math.max(1, Math.ceil(total / AVISOS_POR_PAGINA));
  const pagina = Math.min(Math.max(1, Math.trunc(filtros.pagina ?? 1) || 1), paginas);
  const filas = await deps.leer.aviso.findMany({
    where,
    select: SELECCION,
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    skip: (pagina - 1) * AVISOS_POR_PAGINA,
    take: AVISOS_POR_PAGINA,
  });
  return { filas: filas.map(vista), total, pagina, paginas, noLeidos };
}

/** Los ids que llegan de la pantalla: enteros positivos como texto. Lo demás se descarta. */
export function idsValidos(ids: readonly unknown[]): bigint[] {
  const vistos = new Set<string>();
  const r: bigint[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !/^[1-9]\d{0,18}$/.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    r.push(BigInt(id));
  }
  return r.slice(0, 200);
}

/**
 * Marca como leídos (o no leídos) esos avisos del usuario. Los de otro usuario
 * no se tocan (el `where` lleva `usuario_id`). Devuelve cuántos cambiaron.
 */
export async function marcarAvisos(deps: DependenciasAvisos, usuario: UsuarioPermisos, ids: readonly unknown[], leido: boolean): Promise<number> {
  if (!recibeAvisos(usuario)) return 0;
  const validos = idsValidos(ids);
  if (validos.length === 0) return 0;
  const ahora = deps.ahora?.() ?? new Date();
  return deps.escribir(usuario.id, null, async (tx) => {
    const r = await tx.aviso.updateMany({
      where: { id: { in: validos }, usuarioId: usuario.id, leidoEn: leido ? null : { not: null } },
      data: { leidoEn: leido ? ahora : null },
    });
    return r.count;
  });
}

/** "Marcar todos como leídos". */
export async function marcarTodosLeidos(deps: DependenciasAvisos, usuario: UsuarioPermisos): Promise<number> {
  if (!recibeAvisos(usuario)) return 0;
  const ahora = deps.ahora?.() ?? new Date();
  return deps.escribir(usuario.id, null, async (tx) => {
    const r = await tx.aviso.updateMany({ where: { usuarioId: usuario.id, leidoEn: null }, data: { leidoEn: ahora } });
    return r.count;
  });
}

export interface PreferenciaAviso {
  tipo: TipoAviso;
  etiqueta: string;
  activo: boolean;
}

/** Las preferencias que el usuario puede cambiar (hoy, "Concluido o archivado"; sin fila = activo). */
export async function preferenciasAvisos(deps: DependenciasAvisos, usuario: UsuarioPermisos): Promise<PreferenciaAviso[]> {
  if (!recibeAvisos(usuario)) return [];
  const filas = await deps.leer.avisoPreferencia.findMany({
    where: { usuarioId: usuario.id, canal: "sistema", tipo: { in: [...TIPOS_DESACTIVABLES] } },
    select: { tipo: true, activo: true },
  });
  const guardadas = new Map(filas.map((f) => [f.tipo, f.activo]));
  return TIPOS_DESACTIVABLES.map((tipo) => ({ tipo, etiqueta: ETIQUETA_TIPO_AVISO[tipo], activo: guardadas.get(tipo) ?? true }));
}

/**
 * Prende o apaga un tipo de aviso para el usuario (solo los de
 * `TIPOS_DESACTIVABLES`; otro tipo no hace nada y devuelve false). Rige para
 * los avisos que se creen desde ahora.
 */
export async function cambiarPreferencia(deps: DependenciasAvisos, usuario: UsuarioPermisos, tipo: unknown, activo: boolean): Promise<boolean> {
  if (!recibeAvisos(usuario) || !esTipoAviso(tipo) || !TIPOS_DESACTIVABLES.includes(tipo)) return false;
  const ahora = deps.ahora?.() ?? new Date();
  await deps.escribir(usuario.id, null, (tx) =>
    tx.avisoPreferencia.upsert({
      where: { usuarioId_tipo_canal: { usuarioId: usuario.id, tipo, canal: "sistema" } },
      create: { usuarioId: usuario.id, tipo, canal: "sistema", activo, actualizadoEn: ahora },
      update: { activo, actualizadoEn: ahora },
      select: { activo: true },
    }),
  );
  return true;
}
