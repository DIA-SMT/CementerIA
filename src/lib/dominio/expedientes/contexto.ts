import type { FechaISO } from "@/lib/fechas";
import { analizarDefinicion, type DefinicionPlantilla } from "../plantillas/esquema";
import { resolverDefinicion, resolverPorCementerio, type CircunstanciasExpediente } from "../plantillas/resolver";
import type { Lector } from "./dependencias";
import { ErrorDominio } from "./errores";
import type { ContextoEsquema } from "./esquemas";
import { leerCamposUbicacion, type CampoUbicacion } from "./ubicacion";

/**
 * Lo que el alta y la edición necesitan leer de la base: la plantilla, el
 * cementerio y los catálogos. Las funciones reciben un `Lector`, que puede ser
 * el cliente global o el `tx` de la transacción en curso.
 */

export interface CodigoNombre {
  codigo: string;
  nombre: string;
}

export interface PlantillaCargada {
  id: number;
  codigo: string;
  version: number;
  nombre: string;
  /** borrador, publicada o retirada. */
  estado: string;
  tipoTramite: { id: number } & CodigoNombre;
  definicion: DefinicionPlantilla;
}

export interface CementerioCargado {
  id: number;
  codigo: string;
  nombre: string;
  /** Su área externa (a donde va el papel en un paso `$CEMENTERIO`). */
  areaId: number;
  activo: boolean;
  /** Todos los campos, también los desactivados (para mostrar valores viejos). */
  camposUbicacion: CampoUbicacion[];
  /** Códigos habilitados en el cementerio. */
  tiposMonumento: string[];
}

/**
 * Lo que decide qué partes de la plantilla valen para un expediente: el código
 * de su cementerio y los roles con una persona jurídica vigente (ver
 * plantillas/resolver.ts). Las suprimidas cuentan: conservan el tipo.
 */
export async function circunstanciasDe(
  lector: Pick<Lector, "cementerio" | "expedientePersona">,
  exp: { id: bigint; cementerioId: number },
): Promise<CircunstanciasExpediente> {
  const cementerio = await lector.cementerio.findUniqueOrThrow({ where: { id: exp.cementerioId }, select: { codigo: true } });
  const juridicas = await lector.expedientePersona.findMany({
    where: { expedienteId: exp.id, vigente: true, tipoPersona: "juridica" },
    select: { rol: true },
  });
  return { cementerio: cementerio.codigo, rolesJuridicos: juridicas.map((p) => p.rol) };
}

/**
 * La definición de la plantilla de un expediente, validada y resuelta para su
 * cementerio y sus personas: es la que muestran la ficha y la carátula y la
 * que exigen el pase, la devolución, las subtareas y los documentos.
 */
export async function definicionDelExpediente(
  lector: Pick<Lector, "cementerio" | "expedientePersona">,
  exp: { id: bigint; cementerioId: number },
  plantilla: { definicion: unknown; codigo: string; version: number },
): Promise<DefinicionPlantilla> {
  const def = leerDefinicion(plantilla.definicion, plantilla.codigo, plantilla.version);
  return resolverDefinicion(def, await circunstanciasDe(lector, exp));
}

/**
 * La definición guardada, validada. Una publicada siempre la pasa (se validó al
 * publicar); si no, es un defecto de datos y se dice como tal.
 */
export function leerDefinicion(valor: unknown, codigo: string, version: number): DefinicionPlantilla {
  const r = analizarDefinicion(valor);
  if (!r.ok) {
    throw new ErrorDominio(
      "configuracion_incompleta",
      `La plantilla ${codigo} v${version} tiene una definición inválida: avisá al administrador`,
    );
  }
  return r.definicion;
}

export async function cargarPlantilla(lector: Lector, id: number): Promise<PlantillaCargada | null> {
  const p = await lector.plantilla.findUnique({
    where: { id },
    select: {
      id: true,
      codigo: true,
      version: true,
      nombre: true,
      estado: true,
      definicion: true,
      tipoTramite: { select: { id: true, codigo: true, nombre: true } },
    },
  });
  if (!p) return null;
  return { ...p, definicion: leerDefinicion(p.definicion, p.codigo, p.version) };
}

export async function cargarCementerio(lector: Lector, id: number): Promise<CementerioCargado | null> {
  const c = await lector.cementerio.findUnique({ where: { id } });
  if (!c) return null;
  return {
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    areaId: c.areaId,
    activo: c.activo,
    camposUbicacion: leerCamposUbicacion(c.camposUbicacion, c.nombre),
    tiposMonumento: c.tiposMonumento,
  };
}

/**
 * Tipos de monumento que admite un expediente: los de la plantilla (`[]` =
 * todos) que el cementerio tiene habilitados y que están activos, en el orden
 * del cementerio.
 */
export function tiposMonumentoAdmitidos(
  def: DefinicionPlantilla,
  cementerio: Pick<CementerioCargado, "tiposMonumento">,
  activos: readonly CodigoNombre[],
): CodigoNombre[] {
  const porCodigo = new Map(activos.map((t) => [t.codigo, t]));
  return cementerio.tiposMonumento
    .filter((codigo) => def.tipos_monumento.length === 0 || def.tipos_monumento.includes(codigo))
    .map((codigo) => porCodigo.get(codigo))
    .filter((t): t is CodigoNombre => t !== undefined);
}

/** Lo que el formulario del alta (o de la edición) necesita para una plantilla y un cementerio. */
export interface ContextoFormulario {
  plantilla: PlantillaCargada;
  cementerio: CementerioCargado;
  /**
   * La definición sin lo que no corresponde al cementerio (documentos,
   * conceptos y subtareas filtrados): la que muestra el formulario. Los
   * documentos que dependen de una persona jurídica quedan; el formulario los
   * muestra según las personas cargadas.
   */
  definicion: DefinicionPlantilla;
  /** Campos de ubicación ACTIVOS, en orden: los que muestra el formulario. */
  camposUbicacion: CampoUbicacion[];
  tiposMonumento: CodigoNombre[];
  /** Cementerios activos, para los campos extra de tipo `cementerio`. */
  cementerios: CodigoNombre[];
  hoy: FechaISO;
  /**
   * Lo que impide cargar el expediente y no es culpa del usuario ("Falta
   * configurar el cementerio…"). Si no está vacío, el formulario muestra esto
   * en lugar de listas vacías (2.2).
   */
  problemas: string[];
  /** Para `construirEsquemaAlta()` / `construirEsquemaEdicion()`. */
  esquema: ContextoEsquema;
}

export async function cargarContexto(
  lector: Lector,
  plantilla: PlantillaCargada,
  cementerio: CementerioCargado,
  hoy: FechaISO,
): Promise<ContextoFormulario> {
  // De a una y no con Promise.all: el lector puede ser el `tx` de una
  // transacción, que tiene una sola conexión.
  const monumentos = await lector.tipoMonumento.findMany({
    where: { activo: true },
    select: { codigo: true, nombre: true },
    orderBy: { id: "asc" },
  });
  const cementerios = await lector.cementerio.findMany({
    where: { activo: true },
    select: { codigo: true, nombre: true },
    orderBy: { id: "asc" },
  });
  const def = plantilla.definicion;
  const tiposMonumento = tiposMonumentoAdmitidos(def, cementerio, monumentos);
  const camposActivos = cementerio.camposUbicacion.filter((c) => c.activo);

  const problemas: string[] = [];
  if (!cementerio.activo) problemas.push(`El cementerio ${cementerio.nombre} está inactivo`);
  if (tiposMonumento.length === 0) {
    problemas.push(`Falta configurar el cementerio ${cementerio.nombre}: no tiene tipos de monumento habilitados para este trámite`);
  }
  if (def.ubicacion_obligatoria && camposActivos.length === 0) {
    problemas.push(`Falta configurar el cementerio ${cementerio.nombre}: no tiene campos de ubicación activos`);
  }

  return {
    plantilla,
    cementerio,
    definicion: resolverPorCementerio(def, cementerio.codigo),
    camposUbicacion: camposActivos,
    tiposMonumento,
    cementerios,
    hoy,
    problemas,
    esquema: {
      plantilla: { id: plantilla.id, definicion: def },
      cementerio: { id: cementerio.id, codigo: cementerio.codigo, camposUbicacion: cementerio.camposUbicacion },
      tiposMonumento: tiposMonumento.map((t) => t.codigo),
      cementerios: cementerios.map((c) => c.codigo),
      hoy,
    },
  };
}

export interface PlantillaOpcion {
  id: number;
  codigo: string;
  version: number;
  nombre: string;
  tipoTramite: { id: number } & CodigoNombre;
  formaPago: DefinicionPlantilla["forma_pago"];
}

export interface CementerioOpcion extends CodigoNombre {
  id: number;
}

/** Para el primer paso del formulario: qué trámites (plantillas publicadas) y qué cementerios hay. */
export interface OpcionesAlta {
  plantillas: PlantillaOpcion[];
  cementerios: CementerioOpcion[];
}

/** Un cementerio para los filtros del buscador, con sus campos de ubicación activos. */
export interface CementerioFiltro extends CementerioOpcion {
  activo: boolean;
  camposUbicacion: CampoUbicacion[];
}

/** Para los filtros de `/expedientes` (sección 5): los catálogos con los que se filtra. */
export interface OpcionesBusqueda {
  tiposTramite: Array<{ id: number } & CodigoNombre>;
  /** Una por código (los filtros toman todas sus versiones), con el nombre de la última versión no borrador. */
  plantillas: CodigoNombre[];
  /** Todos, también los inactivos (pueden tener expedientes viejos); los activos primero. */
  cementerios: CementerioFiltro[];
  /** Las áreas donde puede estar un expediente, en el orden del catálogo. */
  areas: Array<{ id: number } & CodigoNombre>;
}

export async function opcionesBusqueda(lector: Lector): Promise<OpcionesBusqueda> {
  const tiposTramite = await lector.tipoTramite.findMany({
    select: { id: true, codigo: true, nombre: true },
    orderBy: [{ activo: "desc" }, { id: "asc" }],
  });
  const versiones = await lector.plantilla.findMany({
    where: { estado: { not: "borrador" } },
    select: { codigo: true, nombre: true },
    orderBy: [{ codigo: "asc" }, { version: "desc" }],
  });
  const cementerios = await lector.cementerio.findMany({ orderBy: [{ activo: "desc" }, { id: "asc" }] });
  const areas = await lector.area.findMany({
    where: { recibePases: true },
    select: { id: true, codigo: true, nombre: true },
    orderBy: [{ orden: "asc" }, { id: "asc" }],
  });
  const plantillas = new Map<string, CodigoNombre>();
  for (const p of versiones) if (!plantillas.has(p.codigo)) plantillas.set(p.codigo, p);
  return {
    tiposTramite,
    plantillas: [...plantillas.values()],
    cementerios: cementerios.map((c) => ({
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      activo: c.activo,
      camposUbicacion: leerCamposUbicacion(c.camposUbicacion, c.nombre).filter((campo) => campo.activo),
    })),
    areas,
  };
}

export async function opcionesAlta(lector: Lector): Promise<OpcionesAlta> {
  const plantillas = await lector.plantilla.findMany({
    where: { estado: "publicada", tipoTramite: { activo: true } },
    select: {
      id: true,
      codigo: true,
      version: true,
      nombre: true,
      definicion: true,
      tipoTramite: { select: { id: true, codigo: true, nombre: true } },
    },
    orderBy: [{ tipoTramiteId: "asc" }, { codigo: "asc" }],
  });
  const cementerios = await lector.cementerio.findMany({
    where: { activo: true },
    select: { id: true, codigo: true, nombre: true },
    orderBy: { id: "asc" },
  });
  return {
    plantillas: plantillas.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      version: p.version,
      nombre: p.nombre,
      tipoTramite: p.tipoTramite,
      formaPago: leerDefinicion(p.definicion, p.codigo, p.version).forma_pago,
    })),
    cementerios,
  };
}
