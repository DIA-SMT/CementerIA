import type { Prisma } from "@/generated/prisma/client";
import { esFechaValida, formatearFechaHora, inicioDelDiaEnTucuman, sumarDias, hoyEnTucuman } from "@/lib/fechas";
import { registrarAcceso } from "../expedientes/acceso";
import { errorValidacion, type ErrorCampo } from "../expedientes/errores";
import { armarCsv } from "../expedientes/exportar";
import { canonizarNumeroInterno } from "../expedientes/numero";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { enSerie, type DependenciasAdmin } from "./dependencias";
import { descripcionRegistro, diferenciasCambio, diferenciasEnTexto, ETIQUETA_OPERACION, ETIQUETA_TABLA, type Diferencia, type NombresAuditoria } from "./diferencias";

/**
 * `/admin/auditoria` (semana 5; docs/propuesta-mvp.md, 2.10 y sección 5):
 * los accesos (`auditoria.accesos`: ingresos, aperturas de ficha, "Ver datos
 * completos" con su motivo, adjuntos, impresiones, exportaciones) y los
 * cambios de configuración (`auditoria.cambios`, con el antes y el después
 * legibles), filtrables y paginados, y el CSV de lo filtrado.
 *
 * Mirar la auditoría no se registra (es del admin y no muestra datos de
 * expedientes); exportarla sí, como `exportar`: el archivo sale de la
 * pantalla y puede circular.
 */

export const ACCIONES_ACCESO = [
  "ingreso",
  "ingreso_rechazado",
  "salida",
  "ver_expediente",
  "ver_datos_completos",
  "ver_adjunto",
  "descargar_adjunto",
  "imprimir",
  "exportar",
  // 26/10/2026: "Verificar integridad" de la ficha y la verificación de todos los expedientes.
  "verificar_historial",
] as const;
export type AccionAccesoAuditoria = (typeof ACCIONES_ACCESO)[number];

export const ETIQUETA_ACCION_ACCESO: Record<AccionAccesoAuditoria, string> = {
  ingreso: "Ingreso",
  ingreso_rechazado: "Ingreso rechazado",
  salida: "Salida",
  ver_expediente: "Abrió la ficha",
  ver_datos_completos: "Vio datos completos",
  ver_adjunto: "Vio un adjunto",
  descargar_adjunto: "Descargó un adjunto",
  imprimir: "Imprimió",
  exportar: "Exportó",
  verificar_historial: "Verificó el historial",
};

export const TABLAS_AUDITADAS = Object.keys(ETIQUETA_TABLA);

export const POR_PAGINA = 50;
/** Lo que se exporta como máximo, como el CSV del buscador. */
export const MAXIMO_FILAS_CSV_AUDITORIA = 5000;

export interface FiltrosAccesos {
  usuarioId?: number | null;
  /** N° interno del expediente (`CEM-2026-00042`, `42/2026`). */
  numero?: string | null;
  accion?: string | null;
  /** `YYYY-MM-DD`, días de Tucumán, inclusive. */
  desde?: string | null;
  hasta?: string | null;
  pagina?: number | null;
}

export interface FiltrosCambios {
  tabla?: string | null;
  usuarioId?: number | null;
  desde?: string | null;
  hasta?: string | null;
  pagina?: number | null;
}

export interface Pagina<T> {
  filas: T[];
  total: number;
  pagina: number;
  paginas: number;
  porPagina: number;
}

export interface FilaAcceso {
  id: string;
  en: Date;
  usuario: { id: number; nombre: string; cuil: string } | null;
  accion: string;
  expediente: string | null;
  /** El motivo de "Ver datos completos" o de ver un adjunto sin haber trabajado el expediente. */
  motivo: string | null;
  detalle: Record<string, unknown>;
  ip: string | null;
}

export interface FilaCambio {
  id: string;
  en: Date;
  tabla: string;
  tablaEtiqueta: string;
  registro: string;
  operacion: string;
  operacionEtiqueta: string;
  usuario: { id: number; nombre: string };
  motivo: string | null;
  diferencias: Diferencia[];
}

function rangoDeFechas(desde: string | null | undefined, hasta: string | null | undefined, errores: ErrorCampo[]): Prisma.DateTimeFilter | undefined {
  const filtro: Prisma.DateTimeFilter = {};
  if (desde) {
    if (esFechaValida(desde)) filtro.gte = inicioDelDiaEnTucuman(desde);
    else errores.push({ ruta: "desde", mensaje: "Fecha inválida" });
  }
  if (hasta) {
    if (esFechaValida(hasta)) filtro.lt = inicioDelDiaEnTucuman(sumarDias(hasta, 1));
    else errores.push({ ruta: "hasta", mensaje: "Fecha inválida" });
  }
  return filtro.gte || filtro.lt ? filtro : undefined;
}

function paginaPedida(p: number | null | undefined): number {
  return p && Number.isSafeInteger(p) && p > 0 ? p : 1;
}

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function whereAccesos(deps: DependenciasAdmin, f: FiltrosAccesos): Promise<Prisma.AuditoriaAccesoWhereInput | null> {
  const errores: ErrorCampo[] = [];
  const where: Prisma.AuditoriaAccesoWhereInput = {};
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.accion) {
    if ((ACCIONES_ACCESO as readonly string[]).includes(f.accion)) where.accion = f.accion;
    else errores.push({ ruta: "accion", mensaje: "Acción desconocida" });
  }
  const en = rangoDeFechas(f.desde, f.hasta, errores);
  if (en) where.en = en;
  if (errores.length > 0) throw errorValidacion(errores);
  if (f.numero && f.numero.trim() !== "") {
    const numero = canonizarNumeroInterno(f.numero);
    const exp = numero ? await deps.leer.expediente.findUnique({ where: { numeroInterno: numero }, select: { id: true } }) : null;
    // Un número que no existe no tiene accesos: la lista sale vacía, sin error.
    if (!exp) return null;
    where.expedienteId = exp.id;
  }
  return where;
}

/** Los accesos, del más nuevo al más viejo, de a 50. */
export async function listarAccesos(deps: DependenciasAdmin, usuario: UsuarioPermisos, filtros: FiltrosAccesos = {}): Promise<Pagina<FilaAcceso>> {
  exigirPermiso("administrar", null, usuario);
  const pagina = paginaPedida(filtros.pagina);
  const where = await whereAccesos(deps, filtros);
  if (where === null) return { filas: [], total: 0, pagina: 1, paginas: 1, porPagina: POR_PAGINA };
  const [total, filas] = await enSerie(
    () => deps.leer.auditoriaAcceso.count({ where }),
    () => leerAccesos(deps, where, (pagina - 1) * POR_PAGINA, POR_PAGINA),
  );
  return { filas, total, pagina, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)), porPagina: POR_PAGINA };
}

async function leerAccesos(deps: DependenciasAdmin, where: Prisma.AuditoriaAccesoWhereInput, skip: number, take: number): Promise<FilaAcceso[]> {
  const filas = await deps.leer.auditoriaAcceso.findMany({
    where,
    orderBy: [{ en: "desc" }, { id: "desc" }],
    skip,
    take,
    include: { usuario: { select: { id: true, nombre: true, apellido: true, cuil: true } }, expediente: { select: { numeroInterno: true } } },
  });
  return filas.map((f) => {
    const detalle = objeto(f.detalle);
    return {
      id: f.id.toString(),
      en: f.en,
      usuario: f.usuario ? { id: f.usuario.id, nombre: `${f.usuario.nombre} ${f.usuario.apellido}`, cuil: f.usuario.cuil } : null,
      accion: f.accion,
      expediente: f.expediente?.numeroInterno ?? null,
      motivo: typeof detalle.motivo === "string" ? detalle.motivo : null,
      detalle,
      ip: f.ip,
    };
  });
}

async function nombresAuditoria(deps: DependenciasAdmin): Promise<NombresAuditoria> {
  const [areas, usuarios, tipos] = await enSerie(
    () => deps.leer.area.findMany({ select: { id: true, nombre: true } }),
    () => deps.leer.usuario.findMany({ select: { id: true, nombre: true, apellido: true } }),
    () => deps.leer.tipoTramite.findMany({ select: { id: true, nombre: true } }),
  );
  return {
    areas: new Map(areas.map((a) => [a.id, a.nombre])),
    usuarios: new Map(usuarios.map((u) => [u.id, `${u.nombre} ${u.apellido}`])),
    tiposTramite: new Map(tipos.map((t) => [t.id, t.nombre])),
  };
}

function whereCambios(f: FiltrosCambios): Prisma.AuditoriaCambioWhereInput {
  const errores: ErrorCampo[] = [];
  const where: Prisma.AuditoriaCambioWhereInput = {};
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.tabla) {
    if (TABLAS_AUDITADAS.includes(f.tabla)) where.tabla = f.tabla;
    else errores.push({ ruta: "tabla", mensaje: "Tabla desconocida" });
  }
  const en = rangoDeFechas(f.desde, f.hasta, errores);
  if (en) where.en = en;
  if (errores.length > 0) throw errorValidacion(errores);
  return where;
}

async function leerCambios(deps: DependenciasAdmin, where: Prisma.AuditoriaCambioWhereInput, skip: number, take: number): Promise<FilaCambio[]> {
  const [filas, nombres] = await enSerie(
    () => deps.leer.auditoriaCambio.findMany({
      where,
      orderBy: [{ en: "desc" }, { id: "desc" }],
      skip,
      take,
      include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
    }),
    () => nombresAuditoria(deps),
  );
  return filas.map((f) => ({
    id: f.id.toString(),
    en: f.en,
    tabla: f.tabla,
    tablaEtiqueta: ETIQUETA_TABLA[f.tabla] ?? f.tabla,
    registro: descripcionRegistro(f.tabla, f.registroId, f.antes, f.despues),
    operacion: f.operacion,
    operacionEtiqueta: ETIQUETA_OPERACION[f.operacion] ?? f.operacion,
    usuario: { id: f.usuario.id, nombre: `${f.usuario.nombre} ${f.usuario.apellido}` },
    motivo: f.motivo,
    diferencias: diferenciasCambio(f.operacion, f.antes, f.despues, nombres),
  }));
}

/** Los cambios de configuración, del más nuevo al más viejo, de a 50. */
export async function listarCambios(deps: DependenciasAdmin, usuario: UsuarioPermisos, filtros: FiltrosCambios = {}): Promise<Pagina<FilaCambio>> {
  exigirPermiso("administrar", null, usuario);
  const pagina = paginaPedida(filtros.pagina);
  const where = whereCambios(filtros);
  const [total, filas] = await enSerie(
    () => deps.leer.auditoriaCambio.count({ where }),
    () => leerCambios(deps, where, (pagina - 1) * POR_PAGINA, POR_PAGINA),
  );
  return { filas, total, pagina, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)), porPagina: POR_PAGINA };
}

/** Los usuarios para el filtro (también SISTEMA: firma la semilla). */
export async function opcionesAuditoria(deps: DependenciasAdmin, usuario: UsuarioPermisos) {
  exigirPermiso("administrar", null, usuario);
  const usuarios = await deps.leer.usuario.findMany({ select: { id: true, nombre: true, apellido: true, cuil: true }, orderBy: [{ apellido: "asc" }, { nombre: "asc" }] });
  return {
    usuarios: usuarios.map((u) => ({ id: u.id, nombre: `${u.apellido}, ${u.nombre}`, cuil: u.cuil })),
    acciones: ACCIONES_ACCESO.map((a) => ({ valor: a, etiqueta: ETIQUETA_ACCION_ACCESO[a] })),
    tablas: TABLAS_AUDITADAS.map((t) => ({ valor: t, etiqueta: ETIQUETA_TABLA[t] })),
  };
}

export interface ExportacionAuditoria {
  nombreArchivo: string;
  tipo: string;
  contenido: string;
  filas: number;
  truncado: boolean;
}

function detalleEnTexto(detalle: Record<string, unknown>): string {
  return Object.entries(detalle)
    .filter(([k]) => k !== "motivo")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("; ");
}

/**
 * El CSV de lo filtrado (hasta 5000 filas, como el del buscador: `;`, CRLF,
 * UTF-8 con BOM, celdas que empiezan con `=`, `+`, `-` o `@` neutralizadas).
 * Registra `exportar` en `auditoria.accesos` con `detalle.origen: "auditoria"`.
 */
export async function exportarAuditoria(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  pedido: { vista: "accesos"; filtros: FiltrosAccesos } | { vista: "cambios"; filtros: FiltrosCambios },
  opciones: { ip?: string | null } = {},
): Promise<ExportacionAuditoria> {
  exigirPermiso("administrar", null, usuario);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());
  let encabezados: string[];
  let filas: Array<Array<string | null>>;
  let total: number;
  if (pedido.vista === "accesos") {
    const where = await whereAccesos(deps, pedido.filtros);
    const leidas = where === null ? [] : await leerAccesos(deps, where, 0, MAXIMO_FILAS_CSV_AUDITORIA + 1);
    total = leidas.length;
    encabezados = ["Fecha y hora", "Usuario", "CUIL", "Acción", "Expediente", "Motivo", "Detalle", "IP"];
    filas = leidas.slice(0, MAXIMO_FILAS_CSV_AUDITORIA).map((f) => [
      formatearFechaHora(f.en),
      f.usuario?.nombre ?? null,
      f.usuario?.cuil ?? null,
      ETIQUETA_ACCION_ACCESO[f.accion as AccionAccesoAuditoria] ?? f.accion,
      f.expediente,
      f.motivo,
      detalleEnTexto(f.detalle),
      f.ip,
    ]);
  } else {
    const leidas = await leerCambios(deps, whereCambios(pedido.filtros), 0, MAXIMO_FILAS_CSV_AUDITORIA + 1);
    total = leidas.length;
    encabezados = ["Fecha y hora", "Usuario", "Tabla", "Registro", "Operación", "Motivo", "Cambios"];
    filas = leidas.slice(0, MAXIMO_FILAS_CSV_AUDITORIA).map((f) => [
      formatearFechaHora(f.en),
      f.usuario.nombre,
      f.tablaEtiqueta,
      f.registro,
      f.operacionEtiqueta,
      f.motivo,
      diferenciasEnTexto(f.diferencias),
    ]);
  }
  const truncado = total > MAXIMO_FILAS_CSV_AUDITORIA;
  const filtrosDetalle = Object.fromEntries(Object.entries(pedido.filtros).filter(([k, v]) => k !== "pagina" && v !== null && v !== undefined && v !== "")) as Prisma.InputJsonObject;
  await deps.escribir(usuario.id, null, (tx) =>
    registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "exportar",
      expedienteId: null,
      detalle: { formato: "csv", origen: "auditoria", vista: pedido.vista, filtros: filtrosDetalle, filas: filas.length, truncado },
      ip: opciones.ip ?? null,
    }),
  );
  return {
    nombreArchivo: `auditoria-${pedido.vista}-${hoy}.csv`,
    tipo: "text/csv; charset=utf-8",
    contenido: armarCsv(encabezados, filas),
    filas: filas.length,
    truncado,
  };
}
