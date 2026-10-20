import { destinoDePaso, type PasoPlantilla } from "../plantillas/esquema";
import { ErrorDominio } from "./errores";

/**
 * Piezas puras de la proyección (`expedientes`): a qué área concreta va el
 * papel en un paso y quién lo opera (docs/propuesta-mvp.md, 2.6 y 2.13(e)).
 */

export interface AreaCatalogo {
  id: number;
  codigo: string;
  /** interna o externa. */
  tipo: string;
}

export interface EntornoAreas {
  /** Áreas por código. */
  areas: ReadonlyMap<string, AreaCatalogo>;
  /** Área externa del cementerio del expediente (`$CEMENTERIO`). */
  areaCementerioId: number;
  /** Área externa de cada cementerio, por código (`$CAMPO:<clave>`). */
  areaDeCementerio: ReadonlyMap<string, number>;
  /** `datos_extra` del expediente: de ahí sale el cementerio de un `$CAMPO`. */
  datosExtra: Readonly<Record<string, unknown>>;
}

export interface AreasDelPaso {
  /** Dónde está el papel: siempre un área concreta, nunca un comodín. */
  areaActualId: number;
  /** Quién lo opera: la custodia si el paso la tiene, si no el área del paso. */
  areaResponsableId: number;
  /** El área del paso es externa (la DIM, un cementerio): nadie confirma la recepción ahí. */
  externa: boolean;
}

function area(entorno: EntornoAreas, codigo: string, paso: PasoPlantilla): AreaCatalogo {
  const a = entorno.areas.get(codigo);
  if (!a) {
    throw new ErrorDominio("configuracion_incompleta", `El paso "${paso.nombre}" va al área ${codigo}, que no existe`);
  }
  return a;
}

/** Resuelve `pasos[].area` (código, `$CEMENTERIO` o `$CAMPO:x`) y su custodia. */
export function areasDelPaso(paso: PasoPlantilla, entorno: EntornoAreas): AreasDelPaso {
  const destino = destinoDePaso(paso.area);
  let actual: number;
  let externa: boolean;
  if (destino.tipo === "area") {
    const a = area(entorno, destino.codigo, paso);
    actual = a.id;
    externa = a.tipo === "externa";
  } else if (destino.tipo === "cementerio") {
    actual = entorno.areaCementerioId;
    externa = true;
  } else {
    const codigo = entorno.datosExtra[destino.clave];
    const id = typeof codigo === "string" ? entorno.areaDeCementerio.get(codigo) : undefined;
    if (id === undefined) {
      throw new ErrorDominio("validacion", `El paso "${paso.nombre}" va al cementerio del campo "${destino.clave}", que no tiene valor`, [
        { ruta: `datosExtra.${destino.clave}`, mensaje: "Elegí el cementerio" },
      ]);
    }
    actual = id;
    externa = true;
  }
  const responsable = paso.custodia === null ? actual : area(entorno, paso.custodia, paso).id;
  return { areaActualId: actual, areaResponsableId: responsable, externa };
}
