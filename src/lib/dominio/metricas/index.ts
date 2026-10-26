/**
 * Métricas de gestión (`/panel/metricas`): cómo viene funcionando el circuito.
 * El panel dice qué hay que mirar hoy; esto mide tiempos (de punta a punta,
 * por paso y área, hasta confirmar la recepción), flujo y stock, devoluciones,
 * carga por área, el plazo DIM, la línea de base de antes del sistema y el
 * papel. Dirección y admin (permiso `ver_metricas`). Referencia:
 * docs/api-dominio.md, sección 20.
 *
 * Todo sale de `movimientos` (con las correcciones aplicadas) y `expedientes`,
 * con la fecha efectiva y días hábiles de la base (`f_dias_habiles_entre`).
 * Como los demás servicios, recibe sus dependencias: la app usa `metricas` de
 * ./servidor.ts; los tests, `crearServicioMetricas({ leer, escribir, ahora })`.
 *
 * Mirar las métricas no registra accesos (son agregados, sin datos
 * personales); exportar una tabla sí (`exportar` en auditoria.accesos).
 */

import type { Prisma } from "@/generated/prisma/client";
import { hoyEnTucuman } from "@/lib/fechas";
import { registrarAcceso, type OpcionesAcceso } from "../expedientes/acceso";
import type { Escritor, Lector } from "../expedientes/dependencias";
import { armarCsv } from "../expedientes/exportar";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { calcularMetricas, calendarioDe, calendarioQueAnota, type EntradaCalculo, type Metricas } from "./calculo";
import { calcularDiasHabiles, leerAcumulados, leerAreas, leerExpedientes, leerMovimientos, leerPasos } from "./consultas";
import { PARAMETROS_PAPEL, type ParametrosPapel } from "./papel";
import { filtrosPorDefecto, validarFiltros, type FiltrosMetricas } from "./periodos";
import { agruparPor } from "./estadisticas";
import { recorrer, type Recorrido } from "./recorrido";
import { tablaCsv, type TablaMetricas } from "./tablas";

export interface DependenciasMetricas {
  leer: Lector;
  /** Solo para registrar la exportación en auditoria.accesos. */
  escribir: Escritor;
  ahora?: () => Date;
  /** Los supuestos del papel; por defecto `PARAMETROS_PAPEL`. */
  papel?: ParametrosPapel;
}

/** Los filtros pedidos sobre los de por defecto (últimos 6 meses, por mes, sin la carga histórica). */
export function resolverFiltros(pedidos: Partial<FiltrosMetricas> | undefined, hoy: string): FiltrosMetricas {
  const base = filtrosPorDefecto(hoy);
  const f: FiltrosMetricas = { ...base };
  for (const [k, v] of Object.entries(pedidos ?? {})) if (v !== undefined) (f as unknown as Record<string, unknown>)[k] = v;
  return validarFiltros(f, hoy);
}

async function calcular(lector: Lector, filtros: FiltrosMetricas, ahora: Date, papel: ParametrosPapel): Promise<Metricas> {
  const hoy = hoyEnTucuman(ahora);
  const areas = await leerAreas(lector);
  const expedientes = await leerExpedientes(lector, filtros);
  const pasos = await leerPasos(lector, [...new Set(expedientes.map((x) => x.plantillaId))]);
  const movimientos = await leerMovimientos(
    lector,
    expedientes.map((x) => x.id),
  );
  const acumulados = await leerAcumulados(lector, filtros);

  const externas = new Set([...areas.values()].filter((a) => a.tipo === "externa").map((a) => a.id));
  const porExpediente = agruparPor(movimientos, (m) => m.expedienteId);
  const recorridos = new Map<string, Recorrido>();
  for (const x of expedientes) recorridos.set(x.id, recorrer(porExpediente.get(x.id) ?? [], pasos.get(x.plantillaId) ?? new Map(), externas));

  const entrada: EntradaCalculo = { filtros, hoy, ahora, expedientes, recorridos, pasos, areas, acumulados, papel };
  // Dos pasadas: la primera junta los días hábiles que hacen falta, la base los
  // calcula todos juntos y la segunda arma las métricas con esos números.
  const anotador = calendarioQueAnota();
  calcularMetricas(entrada, anotador);
  const { dias, vencimientos } = await calcularDiasHabiles(lector, [...anotador.pares.values()], [...anotador.sumas.values()]);
  return calcularMetricas(entrada, calendarioDe(dias, vencimientos));
}

/**
 * Las métricas con esos filtros (los que falten, por defecto).
 *
 * @throws PermisoDenegado (no es Dirección ni admin)
 * @throws ErrorDominio `validacion` (período inválido)
 */
export async function obtenerMetricas(deps: DependenciasMetricas, usuario: UsuarioPermisos, filtros?: Partial<FiltrosMetricas>): Promise<Metricas> {
  exigirPermiso("ver_metricas", null, usuario);
  const ahora = deps.ahora?.() ?? new Date();
  const f = resolverFiltros(filtros, hoyEnTucuman(ahora));
  return calcular(deps.leer, f, ahora, deps.papel ?? PARAMETROS_PAPEL);
}

export interface ExportacionMetricas {
  /** `metricas-pasos-2026-10-26.csv`. */
  nombreArchivo: string;
  tipo: "text/csv; charset=utf-8";
  contenido: string;
  filas: number;
}

/**
 * Una tabla de las métricas como CSV (`;`, CRLF, UTF-8 con BOM, como el del
 * buscador). Lee y registra `exportar` en auditoria.accesos en la misma
 * transacción: si no se puede registrar, no se exporta.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `validacion`
 */
export async function exportarMetricas(
  deps: DependenciasMetricas,
  usuario: UsuarioPermisos,
  filtros: Partial<FiltrosMetricas> | undefined,
  tabla: TablaMetricas,
  opciones: OpcionesAcceso = {},
): Promise<ExportacionMetricas> {
  exigirPermiso("ver_metricas", null, usuario);
  exigirPermiso("exportar_csv", null, usuario);
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnTucuman(ahora);
  const f = resolverFiltros(filtros, hoy);
  return deps.escribir(usuario.id, null, async (tx) => {
    const m = await calcular(tx, f, ahora, deps.papel ?? PARAMETROS_PAPEL);
    const t = tablaCsv(m, tabla);
    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "exportar",
      expedienteId: null,
      detalle: {
        formato: "csv",
        origen: "metricas",
        tabla,
        filtros: JSON.parse(JSON.stringify(f)) as Prisma.InputJsonObject,
        filas: t.filas.length,
      },
      ip: opciones.ip,
    });
    return {
      nombreArchivo: `metricas-${tabla}-${hoy}.csv`,
      tipo: "text/csv; charset=utf-8",
      contenido: armarCsv(t.encabezados, t.filas),
      filas: t.filas.length,
    };
  });
}

export function crearServicioMetricas(deps: DependenciasMetricas) {
  return {
    metricas: (usuario: UsuarioPermisos, filtros?: Partial<FiltrosMetricas>) => obtenerMetricas(deps, usuario, filtros),
    exportarCsv: (usuario: UsuarioPermisos, filtros: Partial<FiltrosMetricas> | undefined, tabla: TablaMetricas, opciones?: OpcionesAcceso) =>
      exportarMetricas(deps, usuario, filtros, tabla, opciones),
  };
}

export type ServicioMetricas = ReturnType<typeof crearServicioMetricas>;

export type { Calendario, ExpedienteMetricas, FilaCarga, FilaPaso, FilaPeriodo, FilaRecepcion, FilaRuta, FilaTiempos, Metricas, MotivoDevolucion } from "./calculo";
export { grupoDeMotivo, MOTIVOS_DEVOLUCION, MUESTRA_MINIMA } from "./calculo";
export type { Resumen } from "./estadisticas";
export { hojasDeFicha, PARAMETROS_PAPEL, type ParametrosPapel } from "./papel";
export {
  AGRUPACIONES,
  DIAS_MAXIMOS_PERIODO,
  filtrosPorDefecto,
  HISTORICOS,
  SEMANAS_MAXIMAS,
  type Agrupacion,
  type FiltrosMetricas,
  type ModoHistoricos,
  type Periodo,
} from "./periodos";
export { esTablaMetricas, TABLAS_METRICAS, tablaCsv, type TablaCsv, type TablaMetricas } from "./tablas";
