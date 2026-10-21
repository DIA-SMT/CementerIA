import type { Prisma } from "@/generated/prisma/client";
import { formatearFecha, hoyEnTucuman } from "@/lib/fechas";
import { buscarExpedientes, type EntradaBusqueda, type ResultadoBusquedaFila } from "../busqueda";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { registrarAcceso, type OpcionesAcceso } from "./acceso";
import type { DependenciasExpedientes } from "./dependencias";

/**
 * "Exportar CSV" del buscador (docs/propuesta-mvp.md, 3.2 y sección 5):
 * Dirección y el admin, con los mismos filtros de la búsqueda, SIN teléfono,
 * correo ni domicilio (decisión 13). Queda en `auditoria.accesos` como
 * `exportar`, con la consulta, los filtros y la cantidad de filas, en la
 * misma transacción que la lectura: si no se puede registrar, no se exporta.
 *
 * El archivo es para Excel en español: separador `;`, fin de línea CRLF,
 * UTF-8 con BOM. Las celdas que empiezan con `=`, `+`, `-` o `@` llevan un
 * apóstrofo adelante: si no, Excel las ejecuta como fórmulas.
 */

/** Filas como máximo: más que eso es una extracción, no una consulta. */
export const MAXIMO_FILAS_CSV = 5000;

export const COLUMNAS_CSV = [
  "N° interno",
  "N° municipal",
  "Estado",
  "Fecha de inicio",
  "Tipo de trámite",
  "Plantilla",
  "Versión",
  "Cementerio",
  "Ubicación",
  "Paso",
  "Área actual",
  "Titular",
  "Carga histórica",
] as const;

const ESTADOS: Record<string, string> = {
  en_tramite: "En trámite",
  espera_pago_dim: "En espera de pago DIM",
  concluido: "Concluido",
  archivado: "Archivado",
  anulado: "Anulado",
};

export type ValorCsv = string | number | boolean | null;

/** Una celda: comillas si hace falta y sin fórmulas. */
export function celdaCsv(valor: ValorCsv): string {
  if (valor === null) return "";
  let t = typeof valor === "boolean" ? (valor ? "Sí" : "No") : String(valor);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/** El archivo: BOM, encabezados y filas separadas por CRLF. */
export function armarCsv(encabezados: readonly string[], filas: readonly (readonly ValorCsv[])[]): string {
  const lineas = [encabezados, ...filas].map((f) => f.map(celdaCsv).join(";"));
  return `﻿${lineas.join("\r\n")}\r\n`;
}

/** Una fila del buscador como fila del CSV. No hay datos de contacto que sacar: la búsqueda no los trae. */
export function filaCsv(r: ResultadoBusquedaFila): ValorCsv[] {
  return [
    r.numero,
    r.numeroMunicipal,
    ESTADOS[r.estado] ?? r.estado,
    formatearFecha(r.fechaInicio),
    r.tipoTramite.nombre,
    r.plantilla.nombre,
    r.plantilla.version,
    r.cementerio.nombre,
    r.ubicacionTexto,
    r.paso.nombre,
    r.areaActual.nombre,
    r.titular,
    r.cargaHistorica,
  ];
}

export interface ExportacionCsv {
  /** `expedientes-2026-10-20.csv`. */
  nombreArchivo: string;
  tipo: "text/csv; charset=utf-8";
  contenido: string;
  filas: number;
  /** Había más de 5000: el archivo trae las primeras. */
  truncado: boolean;
}

/**
 * Exporta el resultado de una búsqueda. El Route Handler responde con
 * `Content-Type: tipo`, `Content-Disposition: attachment; filename=…` y
 * `Cache-Control: private, no-store`.
 *
 * @throws PermisoDenegado (no es Dirección ni admin)
 * @throws ErrorDominio `validacion` (filtros inválidos)
 */
export async function exportarCsv(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  entrada: EntradaBusqueda,
  opciones: OpcionesAcceso = {},
): Promise<ExportacionCsv> {
  exigirPermiso("exportar_csv", null, usuario);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());
  return deps.escribir(usuario.id, null, async (tx) => {
    const r = await buscarExpedientes(tx, usuario, entrada, { limite: MAXIMO_FILAS_CSV, listarNumeroInterno: true });
    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "exportar",
      expedienteId: null,
      detalle: {
        formato: "csv",
        q: entrada.q ?? null,
        // Los filtros son datos simples (números, textos, fechas): van tal cual, como JSON.
        filtros: JSON.parse(JSON.stringify(entrada.filtros ?? {})) as Prisma.InputJsonObject,
        filas: r.resultados.length,
        truncado: r.hayMas,
      },
      ip: opciones.ip,
    });
    return {
      nombreArchivo: `expedientes-${hoy}.csv`,
      tipo: "text/csv; charset=utf-8",
      contenido: armarCsv(COLUMNAS_CSV, r.resultados.map(filaCsv)),
      filas: r.resultados.length,
      truncado: r.hayMas,
    };
  });
}
