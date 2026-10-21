import type { FiltrosAccesos, FiltrosCambios } from "@/lib/dominio/admin/auditoria";
import type { ParametrosUrl } from "./busqueda";

/**
 * `/admin/auditoria` en la URL (semana 5), sin Next: qué vista, los filtros y
 * la página viven en los parámetros (`?vista=cambios&tabla=usuarios&pagina=2`),
 * así un enlace o el botón Atrás muestran lo mismo, y el CSV
 * (`/admin/auditoria/exportar?…`) lleva exactamente los mismos filtros.
 */

export const VISTAS_AUDITORIA = ["accesos", "cambios"] as const;
export type VistaAuditoria = (typeof VISTAS_AUDITORIA)[number];

export interface FiltrosAuditoria {
  vista: VistaAuditoria;
  accesos: FiltrosAccesos;
  cambios: FiltrosCambios;
}

function uno(v: string | string[] | undefined): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x === undefined || x.trim() === "" ? null : x.trim();
}

function entero(v: string | string[] | undefined): number | null {
  const x = uno(v);
  return x !== null && /^\d{1,9}$/.test(x) ? Number(x) : null;
}

export function leerFiltrosAuditoria(p: ParametrosUrl): FiltrosAuditoria {
  const vista: VistaAuditoria = uno(p.vista) === "cambios" ? "cambios" : "accesos";
  const comunes = { usuarioId: entero(p.usuario), desde: uno(p.desde), hasta: uno(p.hasta), pagina: entero(p.pagina) };
  return {
    vista,
    accesos: { ...comunes, numero: uno(p.expediente), accion: uno(p.accion) },
    cambios: { ...comunes, tabla: uno(p.tabla) },
  };
}

/** La URL de una vista con sus filtros (los vacíos no van). */
export function rutaAuditoria(vista: VistaAuditoria, filtros: FiltrosAccesos | FiltrosCambios, base = "/admin/auditoria"): string {
  const q = new URLSearchParams();
  q.set("vista", vista);
  const poner = (clave: string, valor: string | number | null | undefined) => {
    if (valor !== null && valor !== undefined && String(valor) !== "") q.set(clave, String(valor));
  };
  poner("usuario", filtros.usuarioId);
  if (vista === "accesos") {
    const f = filtros as FiltrosAccesos;
    poner("expediente", f.numero);
    poner("accion", f.accion);
  } else {
    poner("tabla", (filtros as FiltrosCambios).tabla);
  }
  poner("desde", filtros.desde);
  poner("hasta", filtros.hasta);
  if (filtros.pagina && filtros.pagina > 1) poner("pagina", filtros.pagina);
  return `${base}?${q.toString()}`;
}

/** El CSV de lo mismo que muestra la pantalla (todas las páginas). */
export function rutaExportarAuditoria(vista: VistaAuditoria, filtros: FiltrosAccesos | FiltrosCambios): string {
  return rutaAuditoria(vista, { ...filtros, pagina: null }, "/admin/auditoria/exportar");
}

/**
 * El detalle de un acceso en palabras (sin el motivo, que va en su columna):
 * qué hoja se imprimió, qué adjunto, cuántas filas se exportaron.
 */
export function detalleAcceso(detalle: Record<string, unknown>): string {
  const partes: string[] = [];
  for (const [clave, valor] of Object.entries(detalle)) {
    if (clave === "motivo" || valor === null || valor === undefined) continue;
    if (clave === "filtros" && typeof valor === "object") {
      const f = Object.entries(valor as Record<string, unknown>).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
      if (f.length > 0) partes.push(`filtros: ${f.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")}`);
      continue;
    }
    const texto = typeof valor === "boolean" ? (valor ? "sí" : "no") : typeof valor === "string" || typeof valor === "number" ? String(valor) : JSON.stringify(valor);
    partes.push(`${clave.replaceAll("_", " ")}: ${texto}`);
  }
  return partes.join(" · ");
}
