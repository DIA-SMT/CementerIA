import type { ValorCsv } from "../expedientes/exportar";
import type { Metricas } from "./calculo";
import type { Resumen } from "./estadisticas";

/**
 * Cada tabla de la pantalla de métricas como filas de CSV (lo que baja
 * "Exportar CSV" de cada sección). Puro. Los decimales van con coma, como los
 * lee Excel en español; los días son hábiles.
 */

export const TABLAS_METRICAS = [
  "punta-a-punta",
  "pasos",
  "recepcion",
  "flujo",
  "devoluciones",
  "motivos",
  "carga",
  "dim",
  "linea-base",
  "papel",
] as const;
export type TablaMetricas = (typeof TABLAS_METRICAS)[number];

export function esTablaMetricas(valor: unknown): valor is TablaMetricas {
  return typeof valor === "string" && (TABLAS_METRICAS as readonly string[]).includes(valor);
}

export interface TablaCsv {
  titulo: string;
  encabezados: string[];
  filas: ValorCsv[][];
}

/** Un número con coma decimal ("12,5"), o vacío. */
export function numeroCsv(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(v).replace(".", ",");
}

/** Una proporción (0 a 1) como porcentaje con un decimal ("12,5"). */
export function porcentajeCsv(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : numeroCsv(Math.round(v * 1000) / 10);
}

const COLUMNAS_RESUMEN = ["n", "Mediana", "Promedio", "Percentil 90", "Máximo"];
function resumenCsv(r: Resumen): ValorCsv[] {
  return [r.n, numeroCsv(r.mediana), numeroCsv(r.promedio), numeroCsv(r.p90), numeroCsv(r.maximo)];
}
const prefijar = (prefijo: string, columnas: string[]) => columnas.map((c) => `${prefijo} ${c.toLowerCase()}`);

export function tablaCsv(m: Metricas, tabla: TablaMetricas): TablaCsv {
  switch (tabla) {
    case "punta-a-punta": {
      const filas: ValorCsv[][] = [];
      const fila = (grupo: string, f: Metricas["puntaAPunta"]["total"]) => filas.push([grupo, f.etiqueta, ...resumenCsv(f.conSistema), ...resumenCsv(f.antes)]);
      fila("Total", m.puntaAPunta.total);
      m.puntaAPunta.porTipo.forEach((f) => fila("Tipo de trámite", f));
      m.puntaAPunta.porPlantilla.forEach((f) => fila("Plantilla", f));
      return {
        titulo: "Tiempo de punta a punta de los concluidos (días hábiles)",
        encabezados: ["Agrupación", "Nombre", ...prefijar("Con sistema:", COLUMNAS_RESUMEN), ...prefijar("Antes del sistema:", COLUMNAS_RESUMEN)],
        filas,
      };
    }
    case "pasos":
      return {
        titulo: "Tiempo por paso y área (días hábiles)",
        encabezados: [
          "Paso",
          "Área",
          "Área externa",
          ...COLUMNAS_RESUMEN,
          "Acumulado",
          "Días de alerta",
          "Superaron la alerta",
          "Devoluciones",
          "Tasa de devolución (%)",
          "Hoy en el paso",
          ...prefijar("Antes del sistema:", ["n", "Mediana", "Percentil 90"]),
        ],
        filas: m.pasos.map((p) => [
          p.paso,
          p.area.nombre,
          p.area.externa,
          ...resumenCsv(p.tiempos),
          p.tiempos.total,
          p.diasAlerta,
          p.superaronAlerta,
          p.devoluciones,
          porcentajeCsv(p.tasaDevolucion),
          p.hoy,
          p.antes.n,
          numeroCsv(p.antes.mediana),
          numeroCsv(p.antes.p90),
        ]),
      };
    case "recepcion":
      return {
        titulo: "Tiempo hasta confirmar la recepción (días hábiles)",
        encabezados: ["Área", ...prefijar("Confirmadas:", COLUMNAS_RESUMEN), "Confirmadas al operar", "Sin confirmar hoy"],
        filas: m.recepcion.map((r) => [r.area.nombre, ...resumenCsv(r.confirmadas), r.implicitas, r.sinConfirmarHoy]),
      };
    case "flujo":
      return {
        titulo: "Flujo por período",
        encabezados: ["Período", "Desde", "Hasta", "Ingresados", "Concluidos", "Archivados", "Anulados", "En trámite al cierre"],
        filas: m.flujo.map((f) => [f.periodo.clave, f.periodo.desde, f.periodo.hasta, f.ingresados, f.concluidos, f.archivados, f.anulados, f.stockFinal]),
      };
    case "devoluciones":
      return {
        titulo: "Devoluciones de qué área a qué área",
        encabezados: ["Área que devolvió", "Paso", "Área de destino", "Paso de destino", "Cantidad"],
        filas: m.devoluciones.rutas.map((r) => [r.origen.area.nombre, r.origen.paso, r.destino.area?.nombre ?? null, r.destino.paso, r.cantidad]),
      };
    case "motivos":
      return {
        titulo: "Motivos de devolución",
        encabezados: ["Motivo", "Cantidad", "Porcentaje (%)"],
        filas: m.devoluciones.motivos.map((x) => [x.motivo, x.cantidad, porcentajeCsv(x.proporcion)]),
      };
    case "carga":
      return {
        titulo: "Carga por área",
        encabezados: ["Área", "Área externa", "Hoy", "Promedio en el período", "Demorados hoy", ...prefijar("Estadías del período:", ["n", "Mediana", "Percentil 90"])],
        filas: m.carga.map((c) => [
          c.area.nombre,
          c.area.externa,
          c.hoy,
          numeroCsv(c.promedioPeriodo),
          c.demoradosHoy,
          c.tiempos.n,
          numeroCsv(c.tiempos.mediana),
          numeroCsv(c.tiempos.p90),
        ]),
      };
    case "dim":
      return {
        titulo: "Plazo DIM (30 días hábiles)",
        encabezados: ["Situación", "Cantidad"],
        filas: [
          ["Cumplido en término", m.dim.enTermino],
          ["Cumplido con el plazo vencido", m.dim.cumplidoVencido],
          ["Vencido sin cumplir", m.dim.vencidoSinCumplir],
          ["Volvió de la DIM antes de vencer, sin plan", m.dim.salioAntesDeVencer],
          ["En curso, en término", m.dim.enCurso],
          ["Sin fecha de notificación", m.dim.sinNotificacion],
          ["Total", m.dim.total],
          ["Demora de la notificación a la vuelta de la DIM: n", m.dim.demora.n],
          ["Demora: mediana (días hábiles)", numeroCsv(m.dim.demora.mediana)],
          ["Demora: promedio (días hábiles)", numeroCsv(m.dim.demora.promedio)],
          ["Demora: percentil 90 (días hábiles)", numeroCsv(m.dim.demora.p90)],
        ],
      };
    case "linea-base":
      return {
        titulo: "Línea de base: antes y con el sistema (días hábiles)",
        encabezados: ["Qué", "Área", ...prefijar("Antes del sistema:", COLUMNAS_RESUMEN), ...prefijar("Con sistema:", COLUMNAS_RESUMEN)],
        filas: [
          ["Punta a punta (concluidos)", null, ...resumenCsv(m.lineaBase.puntaAPunta.antes), ...resumenCsv(m.lineaBase.puntaAPunta.conSistema)],
          ...m.lineaBase.pasos.map((p): ValorCsv[] => [p.paso, p.area.nombre, ...resumenCsv(p.antes), ...resumenCsv(p.conSistema)]),
        ],
      };
    case "papel":
      return {
        titulo: "Papel",
        encabezados: ["Concepto", "Valor"],
        filas: [
          ["Fichas de papel reemplazadas en el período (altas en el sistema)", m.papel.fichasReemplazadas],
          ["Anotaciones de esas fichas (alta, pases, devoluciones y cambios de estado)", m.papel.anotaciones],
          ["Hojas estimadas (supuesto)", m.papel.hojasEstimadas],
          ["Supuesto: anotaciones por hoja", m.papel.parametros.anotacionesPorHoja],
          ["Altas en el sistema desde el comienzo", m.papel.acumuladoSistema],
          ["Fichas de papel transcriptas (carga histórica)", m.papel.cargasHistoricas],
        ],
      };
  }
}
