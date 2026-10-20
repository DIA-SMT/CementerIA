import { Prisma } from "@/generated/prisma/client";
import { exigirPermiso, type EstadoExpediente, type UsuarioPermisos } from "../permisos";
import type { Lector } from "./dependencias";
import { claveDeUbicacion, leerCamposUbicacion, normalizarValorUbicacion } from "./ubicacion";

/**
 * Aviso de "otro expediente sobre lo mismo" (docs/propuesta-mvp.md, 2.13(d) y
 * sección 5, alta): otros expedientes NO anulados con la misma ubicación en el
 * mismo cementerio (`ubicacion_clave`), el mismo padrón o el mismo N°
 * municipal. Es un aviso, no un bloqueo: una renovación puede ser legítima
 * sobre un espacio que tuvo trámites antes.
 *
 * La ubicación no avisa si su clave es NULL (sin valores). Padrón y N°
 * municipal se comparan normalizados con la misma expresión que el trigger.
 */

export type MotivoDuplicado = "ubicacion" | "padron" | "numero_municipal";

export interface AvisoDuplicado {
  numero: string;
  estado: EstadoExpediente;
  /** Por qué coincide (puede ser más de uno). */
  coincidencias: MotivoDuplicado[];
  /** "CEM-2026-00012 (en trámite) tiene la misma ubicación y el mismo padrón". */
  mensaje: string;
}

export interface ConsultaDuplicados {
  cementerioId: number;
  /** Valores tal como están en el formulario: se normalizan con los campos del cementerio. */
  ubicacion?: Record<string, string | null>;
  padron?: string | null;
  numeroMunicipal?: string | null;
  /** En la edición: el propio expediente no cuenta. */
  excluirNumero?: string | null;
}

/** Lo mismo, con la ubicación ya normalizada y el id a excluir (uso interno del alta y la edición). */
export interface ConsultaDuplicadosNormalizada {
  cementerioId: number;
  ubicacionClave: string | null;
  padron: string | null;
  numeroMunicipal: string | null;
  excluirId: bigint | null;
}

const DESCRIPCION: Record<MotivoDuplicado, string> = {
  ubicacion: "la misma ubicación",
  padron: "el mismo padrón",
  numero_municipal: "el mismo N° municipal",
};

const ESTADO_TEXTO: Record<string, string> = {
  en_tramite: "en trámite",
  espera_pago_dim: "en espera de pago en la DIM",
  concluido: "concluido",
  archivado: "archivado",
  anulado: "anulado",
};

interface Fila {
  numero_interno: string;
  estado: EstadoExpediente;
  por_ubicacion: boolean;
  por_padron: boolean;
  por_municipal: boolean;
}

const LIMITE = 20;

/** Normaliza como el trigger expedientes_preparar (mismo SQL). */
const norm = (valor: string | null) =>
  Prisma.sql`nullif(upper(regexp_replace(public.f_unaccent(coalesce(${valor}::text, '')), '[^A-Za-z0-9]', '', 'g')), '')`;

export async function buscarDuplicados(lector: Lector, c: ConsultaDuplicadosNormalizada): Promise<AvisoDuplicado[]> {
  if (c.ubicacionClave === null && !c.padron?.trim() && !c.numeroMunicipal?.trim()) return [];
  const filas = await lector.$queryRaw<Fila[]>`
    WITH buscado AS (
      SELECT ${c.cementerioId}::smallint AS cementerio_id, ${c.ubicacionClave}::text AS ubicacion_clave,
             ${norm(c.padron)} AS padron_norm, ${norm(c.numeroMunicipal)} AS municipal_norm
    )
    SELECT e.numero_interno, e.estado,
           coalesce(e.cementerio_id = b.cementerio_id AND e.ubicacion_clave = b.ubicacion_clave, false) AS por_ubicacion,
           coalesce(e.padron_norm = b.padron_norm, false) AS por_padron,
           coalesce(e.numero_municipal_norm = b.municipal_norm, false) AS por_municipal
      FROM public.expedientes e, buscado b
     WHERE e.estado <> 'anulado'
       AND (${c.excluirId}::bigint IS NULL OR e.id <> ${c.excluirId}::bigint)
       AND ((e.cementerio_id = b.cementerio_id AND e.ubicacion_clave = b.ubicacion_clave)
            OR e.padron_norm = b.padron_norm
            OR e.numero_municipal_norm = b.municipal_norm)
     ORDER BY e.anio DESC, e.secuencia DESC
     LIMIT ${LIMITE}`;

  return filas.map((f) => {
    const coincidencias: MotivoDuplicado[] = [];
    if (f.por_ubicacion) coincidencias.push("ubicacion");
    if (f.por_padron) coincidencias.push("padron");
    if (f.por_municipal) coincidencias.push("numero_municipal");
    const que = coincidencias.map((m) => DESCRIPCION[m]);
    const lista = que.length > 1 ? `${que.slice(0, -1).join(", ")} y ${que.at(-1) ?? ""}` : (que[0] ?? "");
    return {
      numero: f.numero_interno,
      estado: f.estado,
      coincidencias,
      mensaje: `${f.numero_interno} (${ESTADO_TEXTO[f.estado] ?? f.estado}) tiene ${lista}`,
    };
  });
}

/**
 * Para el formulario del alta (y de la edición), mientras se carga: avisa antes
 * de guardar. Cualquiera que vea expedientes puede consultarlo.
 */
export async function avisosDuplicados(
  lector: Lector,
  usuario: UsuarioPermisos,
  consulta: ConsultaDuplicados,
): Promise<AvisoDuplicado[]> {
  exigirPermiso("ver_expediente", null, usuario);
  const cementerio = await lector.cementerio.findUnique({ where: { id: consulta.cementerioId } });
  let ubicacionClave: string | null = null;
  if (cementerio && consulta.ubicacion) {
    const campos = new Map(leerCamposUbicacion(cementerio.camposUbicacion, cementerio.nombre).map((c) => [c.clave, c]));
    const normalizada: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(consulta.ubicacion)) {
      const campo = campos.get(clave);
      if (campo && valor) normalizada[clave] = normalizarValorUbicacion(campo, valor);
    }
    ubicacionClave = claveDeUbicacion(normalizada);
  }
  let excluirId: bigint | null = null;
  if (consulta.excluirNumero) {
    const propio = await lector.expediente.findUnique({ where: { numeroInterno: consulta.excluirNumero }, select: { id: true } });
    excluirId = propio?.id ?? null;
  }
  return buscarDuplicados(lector, {
    cementerioId: consulta.cementerioId,
    ubicacionClave,
    padron: consulta.padron ?? null,
    numeroMunicipal: consulta.numeroMunicipal ?? null,
    excluirId,
  });
}
