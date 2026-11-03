import { leerDefinicion } from "../expedientes/contexto";
import type { Lector } from "../expedientes/dependencias";
import { COMODIN_CEMENTERIO, PREFIJO_CAMPO } from "./esquema";

/**
 * El circuito de cada trámite publicado, en palabras (02/11/2026; lo usa la
 * herramienta `plantilla_tramite` de Migue, docs/api-dominio.md, 26.8): los
 * pasos con el área que los hace y sus subtareas, y los documentos. Es lo que
 * cualquiera del sistema ya ve en la ficha de un expediente de ese trámite, y
 * nada de expedientes ni de personas. Solo lecturas, de las plantillas
 * publicadas (la versión vigente de cada una), como `datosLanding` y
 * `opcionesAlta`.
 */

export interface PasoResumen {
  orden: number;
  nombre: string;
  /** El nombre del área ("Cómputo"), o "el cementerio del expediente" / "según <campo>". */
  area: string;
  /** El área interna que lo sigue cuando el paso es afuera (la DIM, un cementerio). */
  custodia: string | null;
  esperaPagoDim: boolean;
  omitible: boolean;
  /** Días hábiles en el área a partir de los cuales se marca demorado. */
  diasAlerta: number;
  /** El plazo del paso en días hábiles (la DIM), si tiene. */
  plazoDiasHabiles: number | null;
  subtareas: Array<{ nombre: string; obligatoria: boolean }>;
}

export interface PlantillaResumen {
  codigo: string;
  nombre: string;
  tipoTramite: string;
  formaPago: string;
  pasos: PasoResumen[];
  documentos: Array<{ nombre: string; origen: "direccion" | "concesionario"; obligatorio: boolean }>;
}

export async function resumenPlantillasPublicadas(leer: Pick<Lector, "plantilla" | "area">): Promise<PlantillaResumen[]> {
  const [plantillas, areas] = await Promise.all([
    leer.plantilla.findMany({
      where: { estado: "publicada", tipoTramite: { activo: true } },
      select: { codigo: true, version: true, nombre: true, definicion: true, tipoTramite: { select: { nombre: true } } },
      orderBy: [{ tipoTramiteId: "asc" }, { codigo: "asc" }],
    }),
    leer.area.findMany({ select: { codigo: true, nombre: true } }),
  ]);
  const nombreArea = new Map(areas.map((a) => [a.codigo, a.nombre]));
  const area = (codigo: string): string => {
    if (codigo === COMODIN_CEMENTERIO) return "el cementerio del expediente";
    if (codigo.startsWith(PREFIJO_CAMPO)) return `según el campo «${codigo.slice(PREFIJO_CAMPO.length)}» del expediente`;
    return nombreArea.get(codigo) ?? codigo;
  };
  return plantillas.map((p) => {
    const def = leerDefinicion(p.definicion, p.codigo, p.version);
    return {
      codigo: p.codigo,
      nombre: p.nombre,
      tipoTramite: p.tipoTramite.nombre,
      formaPago: def.forma_pago,
      pasos: def.pasos.map((paso, i) => ({
        orden: i + 1,
        nombre: paso.nombre,
        area: area(paso.area),
        custodia: paso.custodia ? area(paso.custodia) : null,
        esperaPagoDim: paso.estado === "espera_pago_dim",
        omitible: paso.omitible,
        diasAlerta: paso.dias_alerta,
        plazoDiasHabiles: paso.plazo?.dias_habiles ?? null,
        subtareas: paso.subtareas.map((s) => ({ nombre: s.nombre, obligatoria: s.obligatoria })),
      })),
      documentos: def.documentos.map((d) => ({ nombre: d.nombre, origen: d.origen, obligatorio: d.obligatorio })),
    };
  });
}
