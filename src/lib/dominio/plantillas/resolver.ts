import type { DefinicionPlantilla, DocumentoPlantilla, FiltroCementerios } from "./esquema";

/**
 * La definición que vale para UN expediente (semana 4, docs/fuentes/README.md,
 * "Cambios que esto implica", puntos 2, 3 y 5).
 *
 * Una plantilla sirve para los tres cementerios, pero no todo vale en todos:
 * Jardín no cobra inspección técnica, la Conservación de los últimos 5 años se
 * pide en el Oeste y en Jardín, y la personería y la designación de asamblea
 * se piden solo si el titular es una persona jurídica. En vez de una plantilla
 * por cementerio (que repetiría todo el recorrido) o código por caso, la
 * definición marca cada concepto, documento o subtarea con un filtro, y esta
 * función saca lo que no corresponde.
 *
 * Todo lo que mira la definición de un expediente (la ficha, la carátula, el
 * "Faltan N", el pase, la devolución, las subtareas, los documentos, los
 * adjuntos, la bandeja) la toma ya resuelta, así que muestra y exige lo mismo.
 * La validación de "Publicar" (validar.ts) mira la definición completa, sin
 * resolver.
 *
 * Pura: quien llama sabe el cementerio y las personas del expediente.
 */

export interface CircunstanciasExpediente {
  /** Código del cementerio del expediente (`OESTE`, `JARDIN_NORTE`…). */
  cementerio: string;
  /** Roles con alguna persona jurídica vigente (también si se suprimieron sus datos). */
  rolesJuridicos: Iterable<string>;
}

/** ¿El filtro deja pasar ese cementerio? Sin filtro, siempre. */
export function aplicaEnCementerio(filtro: FiltroCementerios, cementerio: string): boolean {
  if (filtro.solo_cementerios !== null && !filtro.solo_cementerios.includes(cementerio)) return false;
  if (filtro.excepto_cementerios !== null && filtro.excepto_cementerios.includes(cementerio)) return false;
  return true;
}

/** ¿El documento corresponde con esas personas? (`solo_si_juridica`). */
export function aplicaPorPersonas(documento: Pick<DocumentoPlantilla, "solo_si_juridica">, rolesJuridicos: ReadonlySet<string>): boolean {
  return documento.solo_si_juridica === null || rolesJuridicos.has(documento.solo_si_juridica);
}

/**
 * Solo lo que depende del cementerio: es lo que el formulario del alta conoce
 * antes de cargar las personas. Los documentos con `solo_si_juridica` quedan;
 * el formulario los muestra según lo que se vaya cargando.
 */
export function resolverPorCementerio(def: DefinicionPlantilla, cementerio: string): DefinicionPlantilla {
  return {
    ...def,
    documentos: def.documentos.filter((d) => aplicaEnCementerio(d, cementerio)),
    conceptos: def.conceptos.filter((c) => aplicaEnCementerio(c, cementerio)),
    pasos: def.pasos.map((p) => ({ ...p, subtareas: p.subtareas.filter((s) => aplicaEnCementerio(s, cementerio)) })),
  };
}

/** La definición de un expediente: sin lo que no corresponde a su cementerio ni a sus personas. */
export function resolverDefinicion(def: DefinicionPlantilla, c: CircunstanciasExpediente): DefinicionPlantilla {
  const porCementerio = resolverPorCementerio(def, c.cementerio);
  const roles = new Set(c.rolesJuridicos);
  return { ...porCementerio, documentos: porCementerio.documentos.filter((d) => aplicaPorPersonas(d, roles)) };
}
