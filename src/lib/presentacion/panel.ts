import type { FiltrosBusqueda } from "@/lib/dominio/busqueda";
import type { FiltrosPanel } from "@/lib/dominio/expedientes/panel";
import { rutaBusqueda, type ParametrosUrl } from "./busqueda";

/**
 * El panel (`/panel`, sección 5): sus filtros en la URL (`tramite`,
 * `cementerio`, los mismos nombres que el buscador) y a dónde lleva cada
 * número. Puro.
 */

const RE_ENTERO = /^[1-9]\d{0,5}$/;

function primero(valor: string | string[] | undefined): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (v ?? "").trim();
}

export function leerFiltrosPanel(parametros: ParametrosUrl): { filtros: FiltrosPanel; valores: { tramite: string; cementerio: string } } {
  const tramite = RE_ENTERO.test(primero(parametros.tramite)) ? primero(parametros.tramite) : "";
  const cementerio = RE_ENTERO.test(primero(parametros.cementerio)) ? primero(parametros.cementerio) : "";
  const filtros: FiltrosPanel = {};
  if (tramite) filtros.tipoTramiteId = Number(tramite);
  if (cementerio) filtros.cementerioId = Number(cementerio);
  return { filtros, valores: { tramite, cementerio } };
}

/** La búsqueda filtrada de un conteo, o null si el conteo no tiene filtro equivalente (los demorados). */
export function enlaceConteo(busqueda: FiltrosBusqueda | null): string | null {
  return busqueda ? rutaBusqueda(busqueda) : null;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-10" → "octubre de 2026". */
export function textoMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return mes;
  return `${MESES[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
}

/** "1 expediente" / "3 expedientes". */
export function textoCantidad(n: number, singular = "expediente", plural = "expedientes"): string {
  return `${n.toLocaleString("es-AR")} ${n === 1 ? singular : plural}`;
}
