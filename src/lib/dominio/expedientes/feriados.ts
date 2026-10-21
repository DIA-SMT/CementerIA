import { esFechaValida, fechaDesdeDb, fechaParaDb, type FechaISO } from "@/lib/fechas";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, exigirMotivo, limpiarMotivo, type ErrorCampo } from "./errores";

/**
 * Feriados y cierre de año (docs/propuesta-mvp.md, 2.9 y 3.6). La pantalla es
 * de la semana 5 (`/admin/catalogos`, pestaña Feriados, con "Cerrar año");
 * esta es su API. Escribir es del admin; cada cambio queda en
 * `auditoria.cambios` por el trigger `auditar_cambio` (con el motivo, si se
 * da).
 *
 * Los días hábiles (bandejas y plazo DIM) saltean sábados, domingos y TODAS
 * las filas de `feriados`, de cualquier ámbito. Un año "cerrado" dice que ya
 * se cargaron todos sus feriados: mientras no lo esté, los vencimientos que lo
 * tocan se muestran como provisorios y el panel avisa.
 */

export const AMBITOS_FERIADO = ["nacional", "provincial", "municipal", "asueto", "feria"] as const;
export type AmbitoFeriado = (typeof AMBITOS_FERIADO)[number];

export interface Feriado {
  fecha: FechaISO;
  descripcion: string;
  ambito: AmbitoFeriado;
  norma: string | null;
}

export interface AnioFeriados {
  anio: number;
  cerrado: boolean;
  cerradoPor: { id: number; nombre: string; apellido: string } | null;
  cerradoEn: Date | null;
  feriados: Feriado[];
}

const ANIO_MINIMO = 1950;
const ANIO_MAXIMO = 2100;

function exigirAnio(anio: number): number {
  if (!Number.isInteger(anio) || anio < ANIO_MINIMO || anio > ANIO_MAXIMO) {
    throw errorValidacion([{ ruta: "anio", mensaje: `Año inválido (${ANIO_MINIMO} a ${ANIO_MAXIMO})` }]);
  }
  return anio;
}

function esAmbito(v: unknown): v is AmbitoFeriado {
  return typeof v === "string" && (AMBITOS_FERIADO as readonly string[]).includes(v);
}

/** Los feriados de un año y si está cerrado. Lo puede ver cualquiera (es el calendario). */
export async function listarFeriados(deps: DependenciasExpedientes, anio: number): Promise<AnioFeriados> {
  exigirAnio(anio);
  const fila = await deps.leer.feriadoAnio.findUnique({
    where: { anio },
    select: { cerrado: true, cerradoEn: true, cerrador: { select: { id: true, nombre: true, apellido: true } } },
  });
  const feriados = await deps.leer.feriado.findMany({
    where: { fecha: { gte: fechaParaDb(`${anio}-01-01`), lte: fechaParaDb(`${anio}-12-31`) } },
    orderBy: { fecha: "asc" },
  });
  return {
    anio,
    cerrado: fila?.cerrado ?? false,
    cerradoPor: fila?.cerrador ?? null,
    cerradoEn: fila?.cerradoEn ?? null,
    feriados: feriados.map((f) => ({
      fecha: fechaDesdeDb(f.fecha),
      descripcion: f.descripcion,
      ambito: esAmbito(f.ambito) ? f.ambito : "nacional",
      norma: f.norma,
    })),
  };
}

/** Los años de la tabla `feriados_anios`, con su estado (para elegir cuál ver). */
export async function aniosDeFeriados(deps: DependenciasExpedientes): Promise<Array<{ anio: number; cerrado: boolean }>> {
  return deps.leer.feriadoAnio.findMany({ select: { anio: true, cerrado: true }, orderBy: { anio: "asc" } });
}

/**
 * Agrega un feriado o cambia el de esa fecha (descripción, ámbito, norma). El
 * año se da de alta (abierto) si no estaba. Se admite en un año cerrado: un
 * asueto puede decretarse después, y el vencimiento se corrige solo (3.6).
 *
 * @returns si se creó (o se modificó uno existente).
 * @throws PermisoDenegado si no es el admin
 * @throws ErrorDominio `validacion`, `sin_cambios`
 */
export async function guardarFeriado(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  entrada: { fecha: string; descripcion: string; ambito: string; norma?: string | null },
  motivo: string | null = null,
): Promise<{ creado: boolean; feriado: Feriado }> {
  exigirPermiso("administrar", null, usuario);
  const errores: ErrorCampo[] = [];
  if (!esFechaValida(entrada.fecha)) errores.push({ ruta: "fecha", mensaje: "Fecha inválida (AAAA-MM-DD)" });
  const descripcion = limpiarMotivo(entrada.descripcion);
  if (descripcion === null || descripcion.length > 200) errores.push({ ruta: "descripcion", mensaje: "Escribí la descripción (hasta 200 caracteres)" });
  if (!esAmbito(entrada.ambito)) errores.push({ ruta: "ambito", mensaje: "Elegí nacional, provincial, municipal, asueto o feria" });
  const norma = limpiarMotivo(entrada.norma);
  if (norma !== null && norma.length > 200) errores.push({ ruta: "norma", mensaje: "Hasta 200 caracteres" });
  if (errores.length > 0 || descripcion === null || !esAmbito(entrada.ambito)) throw errorValidacion(errores);
  const anio = exigirAnio(Number(entrada.fecha.slice(0, 4)));
  const feriado: Feriado = { fecha: entrada.fecha, descripcion, ambito: entrada.ambito, norma };

  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const fecha = fechaParaDb(entrada.fecha);
    const previo = await tx.feriado.findUnique({ where: { fecha } });
    if (previo && previo.descripcion === descripcion && previo.ambito === feriado.ambito && previo.norma === norma) {
      throw new ErrorDominio("sin_cambios", "Ese feriado ya está cargado así");
    }
    if (!(await tx.feriadoAnio.findUnique({ where: { anio } }))) await tx.feriadoAnio.create({ data: { anio, cerrado: false } });
    if (previo) await tx.feriado.update({ where: { fecha }, data: { descripcion, ambito: feriado.ambito, norma } });
    else await tx.feriado.create({ data: { fecha, descripcion, ambito: feriado.ambito, norma } });
    return { creado: previo === null, feriado };
  });
}

/**
 * Quita un feriado (por ejemplo, uno que se derogó).
 *
 * @throws PermisoDenegado si no es el admin
 * @throws ErrorDominio `validacion`, `no_encontrado`
 */
export async function quitarFeriado(deps: DependenciasExpedientes, usuario: UsuarioPermisos, fecha: string, motivo: string | null = null): Promise<void> {
  exigirPermiso("administrar", null, usuario);
  if (!esFechaValida(fecha)) throw errorValidacion([{ ruta: "fecha", mensaje: "Fecha inválida (AAAA-MM-DD)" }]);
  await deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const r = await tx.feriado.deleteMany({ where: { fecha: fechaParaDb(fecha) } });
    if (r.count === 0) throw new ErrorDominio("no_encontrado", `No hay un feriado el ${fecha}`);
  });
}

/**
 * "Cerrar año": el admin confirma que cargó todos los feriados del año. Desde
 * ahí, los vencimientos que caen en él dejan de ser provisorios.
 *
 * @throws PermisoDenegado si no es el admin
 * @throws ErrorDominio `validacion`, `sin_cambios` (ya estaba cerrado)
 */
export async function cerrarAnioFeriados(deps: DependenciasExpedientes, usuario: UsuarioPermisos, anio: number, motivo: string | null = null): Promise<AnioFeriados> {
  exigirPermiso("administrar", null, usuario);
  exigirAnio(anio);
  const ahora = deps.ahora?.() ?? new Date();
  await deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const fila = await tx.feriadoAnio.findUnique({ where: { anio } });
    if (fila?.cerrado) throw new ErrorDominio("sin_cambios", `${anio} ya está cerrado`);
    const datos = { cerrado: true, cerradoPor: usuario.id, cerradoEn: ahora };
    if (fila) await tx.feriadoAnio.update({ where: { anio }, data: datos });
    else await tx.feriadoAnio.create({ data: { anio, ...datos } });
  });
  return listarFeriados(deps, anio);
}

/**
 * Vuelve a abrir un año cerrado (falta un feriado que no se cargó). Exige
 * motivo: los vencimientos de ese año vuelven a ser provisorios.
 *
 * @throws PermisoDenegado si no es el admin
 * @throws ErrorDominio `validacion`, `motivo_requerido`, `sin_cambios`
 */
export async function reabrirAnioFeriados(deps: DependenciasExpedientes, usuario: UsuarioPermisos, anio: number, motivo: string | null): Promise<AnioFeriados> {
  exigirPermiso("administrar", null, usuario);
  exigirAnio(anio);
  const m = exigirMotivo(motivo, "Reabrir un año de feriados");
  await deps.escribir(usuario.id, m, async (tx) => {
    const fila = await tx.feriadoAnio.findUnique({ where: { anio } });
    if (!fila?.cerrado) throw new ErrorDominio("sin_cambios", `${anio} no está cerrado`);
    await tx.feriadoAnio.update({ where: { anio }, data: { cerrado: false, cerradoPor: null, cerradoEn: null } });
  });
  return listarFeriados(deps, anio);
}
