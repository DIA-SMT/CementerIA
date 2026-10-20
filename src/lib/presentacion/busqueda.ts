import type { EntradaBusqueda, FiltrosBusqueda } from "@/lib/dominio/busqueda";
import { ESTADOS_EXPEDIENTE, type EstadoExpediente } from "@/lib/dominio/permisos";

/**
 * Los parámetros de `/expedientes` (la caja única y los filtros) ↔ lo que
 * recibe `expedientes.buscar()`. La búsqueda vive en la URL: se puede
 * recargar, volver atrás y pasar el enlace a otra persona.
 *
 * | Parámetro | Filtro |
 * |---|---|
 * | `q` | Caja única |
 * | `estado` (repetible) | `estados` |
 * | `tramite` | `tipoTramiteId` |
 * | `plantilla` | `plantillaCodigo` |
 * | `cementerio` | `cementerioId` |
 * | `u.<clave>` | `ubicacion[clave]` (los campos del cementerio) |
 * | `area` | `areaActualId` |
 * | `desde`, `hasta` | `fechaInicioDesde`, `fechaInicioHasta` |
 * | `anulados=1` | `incluirAnulados` |
 *
 * Lo que no tiene forma válida se ignora (un enlace viejo o tipeado no rompe
 * la pantalla); las fechas pasan tal cual y las valida el dominio.
 */

export type ParametrosUrl = Record<string, string | string[] | undefined>;

/** Lo que muestra el formulario de filtros (para volver a llenarlo). */
export interface ValoresBusqueda {
  q: string;
  estados: EstadoExpediente[];
  tramite: string;
  plantilla: string;
  cementerio: string;
  ubicacion: Record<string, string>;
  area: string;
  desde: string;
  hasta: string;
  anulados: boolean;
}

export const PREFIJO_UBICACION = "u.";
const LARGO_MAXIMO_Q = 200;
const RE_ENTERO = /^[1-9]\d{0,5}$/;
const RE_CODIGO_PLANTILLA = /^[A-Z][A-Z0-9_]{0,59}$/;
const RE_CLAVE_UBICACION = /^[a-z][a-z0-9_]{0,39}$/;

function primero(valor: string | string[] | undefined): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (v ?? "").trim();
}

function todos(valor: string | string[] | undefined): string[] {
  if (valor === undefined) return [];
  return (Array.isArray(valor) ? valor : [valor]).map((v) => v.trim());
}

function esEstado(v: string): v is EstadoExpediente {
  return (ESTADOS_EXPEDIENTE as readonly string[]).includes(v);
}

export interface BusquedaLeida {
  valores: ValoresBusqueda;
  entrada: EntradaBusqueda;
  /** Hay algo escrito o algún filtro: la pantalla dice "N resultados" en vez de "los últimos". */
  conCriterio: boolean;
}

export function leerParametrosBusqueda(parametros: ParametrosUrl): BusquedaLeida {
  const q = primero(parametros.q).slice(0, LARGO_MAXIMO_Q);
  const estados = [...new Set(todos(parametros.estado).filter(esEstado))];
  const tramite = RE_ENTERO.test(primero(parametros.tramite)) ? primero(parametros.tramite) : "";
  const plantilla = RE_CODIGO_PLANTILLA.test(primero(parametros.plantilla)) ? primero(parametros.plantilla) : "";
  const cementerio = RE_ENTERO.test(primero(parametros.cementerio)) ? primero(parametros.cementerio) : "";
  const area = RE_ENTERO.test(primero(parametros.area)) ? primero(parametros.area) : "";
  const desde = primero(parametros.desde).slice(0, 10);
  const hasta = primero(parametros.hasta).slice(0, 10);
  const anulados = primero(parametros.anulados) === "1";

  const ubicacion: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(parametros)) {
    if (!nombre.startsWith(PREFIJO_UBICACION)) continue;
    const clave = nombre.slice(PREFIJO_UBICACION.length);
    const v = primero(valor).slice(0, 40);
    if (RE_CLAVE_UBICACION.test(clave) && v !== "") ubicacion[clave] = v;
  }

  const filtros: FiltrosBusqueda = {};
  if (estados.length > 0) filtros.estados = estados;
  if (tramite) filtros.tipoTramiteId = Number(tramite);
  if (plantilla) filtros.plantillaCodigo = plantilla;
  if (cementerio) filtros.cementerioId = Number(cementerio);
  if (Object.keys(ubicacion).length > 0) filtros.ubicacion = ubicacion;
  if (area) filtros.areaActualId = Number(area);
  if (desde) filtros.fechaInicioDesde = desde;
  if (hasta) filtros.fechaInicioHasta = hasta;
  if (anulados) filtros.incluirAnulados = true;

  return {
    valores: { q, estados, tramite, plantilla, cementerio, ubicacion, area, desde, hasta, anulados },
    entrada: { q: q === "" ? null : q, filtros },
    conCriterio: q !== "" || Object.keys(filtros).length > 0,
  };
}

/** Cuántos filtros (sin la caja) hay puestos: para abrir el panel de filtros si hay alguno. */
export function cantidadDeFiltros(v: ValoresBusqueda): number {
  return [
    v.estados.length > 0,
    v.tramite !== "",
    v.plantilla !== "",
    v.cementerio !== "",
    Object.keys(v.ubicacion).length > 0,
    v.area !== "",
    v.desde !== "",
    v.hasta !== "",
    v.anulados,
  ].filter(Boolean).length;
}
