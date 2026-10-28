import { leerDefinicion } from "../expedientes/contexto";
import type { Lector } from "../expedientes/dependencias";
import { normalizar } from "../normalizar";
import type { DefinicionPlantilla } from "../plantillas/esquema";

/**
 * Los trámites del sitio público (`/tramites`, 28/10/2026), leídos de la base y sin
 * inventar nada: los tipos de trámite que tienen alguna plantilla publicada,
 * con lo que tiene que traer el concesionario (los documentos de origen
 * `concesionario` de esas plantillas). Nada de expedientes ni de personas. Los
 * cementerios y el resto del contenido de la página los carga la Dirección
 * (../sitio/lectura.ts).
 *
 * Las plantillas no tienen una descripción para el público: en su lugar va la
 * lista de modalidades (los nombres de las plantillas publicadas del tipo),
 * cuando dice algo más que el nombre del tipo.
 */

export interface DocumentoParaTraer {
  nombre: string;
  /** Cuándo corresponde, si no es siempre (sale de los filtros de la plantilla). */
  nota: string | null;
}

export interface TramitePublicado {
  codigo: string;
  nombre: string;
  /** Los nombres de las plantillas publicadas del tipo, si alguno no es el del tipo. */
  modalidades: string[];
  documentos: DocumentoParaTraer[];
}

export interface DatosLanding {
  tramites: TramitePublicado[];
}

export const NOTA_SEGUN_CEMENTERIO = "según el cementerio";
export const NOTA_PERSONA_JURIDICA = "si el titular es una persona jurídica";

/**
 * Los documentos de origen concesionario de varias plantillas (las de un mismo
 * tipo de trámite), unidos sin repetir: el mismo nombre (sin mayúsculas, tildes
 * ni signos) es el mismo documento, aunque la clave cambie de una plantilla a
 * otra. Lleva nota solo si en TODAS las plantillas en que aparece está
 * condicionado (a una persona jurídica o a ciertos cementerios). En el orden
 * en que aparecen.
 */
export function documentosParaTraer(definiciones: readonly Pick<DefinicionPlantilla, "documentos">[]): DocumentoParaTraer[] {
  const vistos = new Map<string, { nombre: string; juridica: boolean; cementerio: boolean }>();
  for (const def of definiciones) {
    for (const d of def.documentos) {
      if (d.origen !== "concesionario") continue;
      const clave = normalizar(d.nombre);
      const juridica = d.solo_si_juridica !== null && d.solo_si_juridica !== undefined;
      const cementerio = (d.solo_cementerios ?? null) !== null || (d.excepto_cementerios ?? null) !== null;
      const previo = vistos.get(clave);
      if (previo) {
        previo.juridica &&= juridica;
        previo.cementerio &&= cementerio;
      } else {
        vistos.set(clave, { nombre: d.nombre, juridica, cementerio });
      }
    }
  }
  return [...vistos.values()].map((v) => ({
    nombre: v.nombre,
    nota: v.juridica ? NOTA_PERSONA_JURIDICA : v.cementerio ? NOTA_SEGUN_CEMENTERIO : null,
  }));
}

/** Los trámites de la página pública. Solo lecturas. */
export async function datosLanding(leer: Pick<Lector, "plantilla">): Promise<DatosLanding> {
  const plantillas = await leer.plantilla.findMany({
    where: { estado: "publicada", tipoTramite: { activo: true } },
    select: { codigo: true, version: true, nombre: true, definicion: true, tipoTramite: { select: { codigo: true, nombre: true } } },
    orderBy: [{ codigo: "asc" }],
  });
  const porTipo = new Map<string, { nombre: string; plantillas: Array<{ nombre: string; def: DefinicionPlantilla }> }>();
  for (const p of plantillas) {
    const grupo = porTipo.get(p.tipoTramite.codigo) ?? { nombre: p.tipoTramite.nombre, plantillas: [] };
    grupo.plantillas.push({ nombre: p.nombre, def: leerDefinicion(p.definicion, p.codigo, p.version) });
    porTipo.set(p.tipoTramite.codigo, grupo);
  }
  const tramites = [...porTipo.entries()]
    .map(([codigo, g]) => {
      const nombres = g.plantillas.map((p) => p.nombre);
      const distintas = nombres.some((n) => normalizar(n) !== normalizar(g.nombre));
      return { codigo, nombre: g.nombre, modalidades: distintas ? nombres : [], documentos: documentosParaTraer(g.plantillas.map((p) => p.def)) };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return { tramites };
}
