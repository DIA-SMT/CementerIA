import { esTablaMetricas, type FiltrosMetricas, type Periodo, type ServicioMetricas, type TablaMetricas } from "@/lib/dominio/metricas";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { esFechaValida, formatearFecha } from "@/lib/fechas";
import type { ParametrosUrl } from "./busqueda";
import { estadoDeError } from "./errores";
import { parametrosDe } from "./exportar-http";
import { textoMes } from "./panel";

/**
 * `/panel/metricas`: los filtros en la URL y los textos de la pantalla. Puro.
 *
 * | Parámetro | Filtro |
 * |---|---|
 * | `desde`, `hasta` | Período (`YYYY-MM-DD`, inclusive) |
 * | `tramite` | `tipoTramiteId` |
 * | `plantilla` | `plantillaCodigo` (todas sus versiones) |
 * | `cementerio` | `cementerioId` |
 * | `agrupar=semana` | Flujo por semana (por defecto, por mes) |
 * | `historicos=incluir` | Suma la carga histórica a "con el sistema" (por defecto se excluye) |
 *
 * Lo que no tiene forma válida se ignora y queda el valor por defecto; un
 * período al revés lo rechaza el dominio y la pantalla lo muestra.
 */

const RE_ENTERO = /^[1-9]\d{0,5}$/;
const RE_CODIGO_PLANTILLA = /^[A-Z][A-Z0-9_]{0,59}$/;

export interface ValoresMetricas {
  desde: string;
  hasta: string;
  tramite: string;
  plantilla: string;
  cementerio: string;
  agrupar: "mes" | "semana";
  historicos: "excluir" | "incluir";
}

function primero(valor: string | string[] | undefined): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (v ?? "").trim();
}

/** Los filtros pedidos (solo lo que vino bien formado) y los valores para volver a llenar el formulario. */
export function leerFiltrosMetricas(parametros: ParametrosUrl): { filtros: Partial<FiltrosMetricas>; valores: ValoresMetricas } {
  const desde = esFechaValida(primero(parametros.desde)) ? primero(parametros.desde) : "";
  const hasta = esFechaValida(primero(parametros.hasta)) ? primero(parametros.hasta) : "";
  const tramite = RE_ENTERO.test(primero(parametros.tramite)) ? primero(parametros.tramite) : "";
  const plantilla = RE_CODIGO_PLANTILLA.test(primero(parametros.plantilla)) ? primero(parametros.plantilla) : "";
  const cementerio = RE_ENTERO.test(primero(parametros.cementerio)) ? primero(parametros.cementerio) : "";
  const agrupar = primero(parametros.agrupar) === "semana" ? "semana" : "mes";
  const historicos = primero(parametros.historicos) === "incluir" ? "incluir" : "excluir";
  const filtros: Partial<FiltrosMetricas> = { agrupar, historicos };
  if (desde) filtros.desde = desde;
  if (hasta) filtros.hasta = hasta;
  if (tramite) filtros.tipoTramiteId = Number(tramite);
  if (plantilla) filtros.plantillaCodigo = plantilla;
  if (cementerio) filtros.cementerioId = Number(cementerio);
  return { filtros, valores: { desde, hasta, tramite, plantilla, cementerio, agrupar, historicos } };
}

/** Los parámetros de la URL que corresponden a unos filtros ya resueltos (sin los que están por defecto). */
export function parametrosMetricas(f: FiltrosMetricas): URLSearchParams {
  const p = new URLSearchParams();
  p.set("desde", f.desde);
  p.set("hasta", f.hasta);
  if (f.tipoTramiteId !== undefined) p.set("tramite", String(f.tipoTramiteId));
  if (f.plantillaCodigo !== undefined) p.set("plantilla", f.plantillaCodigo);
  if (f.cementerioId !== undefined) p.set("cementerio", String(f.cementerioId));
  if (f.agrupar === "semana") p.set("agrupar", "semana");
  if (f.historicos === "incluir") p.set("historicos", "incluir");
  return p;
}

/** `GET /panel/metricas/exportar?tabla=…&<los filtros>`. */
export function rutaExportarMetricas(tabla: TablaMetricas, f: FiltrosMetricas): string {
  const p = parametrosMetricas(f);
  p.set("tabla", tabla);
  return `/panel/metricas/exportar?${p.toString()}`;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** "12", "12,5" (es-AR), o "—" sin dato. */
export function textoNumero(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/** "1 día hábil", "12,5 días hábiles", "—". */
export function textoDiasHabiles(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${textoNumero(v)} ${v === 1 ? "día hábil" : "días hábiles"}`;
}

/** Una proporción (0 a 1) como "12,5 %", o "—". */
export function textoPorcentaje(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${(Math.round(v * 1000) / 10).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}

/** "octubre de 2026" o "semana del 05/10/2026". */
export function textoPeriodo(p: Periodo): string {
  return p.agrupacion === "mes" ? textoMes(p.clave) : `semana del ${formatearFecha(p.clave)}`;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Rótulo corto para el eje del gráfico: "oct 26" o "05/10". */
export function rotuloPeriodo(p: Periodo): string {
  if (p.agrupacion === "mes") {
    const [a, m] = p.clave.split("-");
    return `${MESES_CORTOS[Number(m) - 1] ?? m} ${a.slice(2)}`;
  }
  return `${p.clave.slice(8, 10)}/${p.clave.slice(5, 7)}`;
}

/**
 * Cómo se compara un tiempo con el de antes: "−8 días hábiles (−40 %) respecto
 * de antes del sistema". Menos es mejor. Null si falta alguno de los dos.
 */
export function comparacion(actual: number | null, antes: number | null): { texto: string; mejora: boolean | null } | null {
  if (actual === null || antes === null) return null;
  const diferencia = Math.round((actual - antes) * 10) / 10;
  if (diferencia === 0) return { texto: "igual que antes del sistema", mejora: null };
  const signo = diferencia < 0 ? "−" : "+";
  const porcentaje = antes > 0 ? ` (${signo}${Math.round((Math.abs(diferencia) / antes) * 100)} %)` : "";
  return {
    texto: `${signo}${textoDiasHabiles(Math.abs(diferencia))}${porcentaje} respecto de antes del sistema`,
    mejora: diferencia < 0,
  };
}

// ---------------------------------------------------------------------------
// CSV (Route Handler)
// ---------------------------------------------------------------------------

const HEADERS_TEXTO = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

function respuestaTexto(cuerpo: string, status: number): Response {
  return new Response(cuerpo, { status, headers: HEADERS_TEXTO });
}

/**
 * La respuesta de `GET /panel/metricas/exportar?tabla=…&<filtros>`, sin Next:
 * el CSV de esa tabla como `attachment`, o un error en texto plano (401 sin
 * sesión, 403 sin permiso, 404 con una tabla que no existe, 422 con un período
 * inválido). El dominio controla el permiso y registra `exportar`.
 */
export async function responderExportacionMetricas(
  servicio: Pick<ServicioMetricas, "exportarCsv">,
  usuario: UsuarioPermisos | null,
  request: Request,
  ip: string | null,
): Promise<Response> {
  if (!usuario) return respuestaTexto("Tu sesión venció: volvé a ingresar.", 401);
  const parametros = parametrosDe(new URL(request.url).searchParams);
  const tabla = primero(parametros.tabla);
  if (!esTablaMetricas(tabla)) return respuestaTexto("No existe esa tabla de métricas.", 404);
  const { filtros } = leerFiltrosMetricas(parametros);
  try {
    const csv = await servicio.exportarCsv(usuario, filtros, tabla, { ip });
    return new Response(csv.contenido, {
      status: 200,
      headers: {
        "Content-Type": csv.tipo,
        "Content-Disposition": `attachment; filename="${csv.nombreArchivo}"; filename*=UTF-8''${encodeURIComponent(csv.nombreArchivo)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Filas": String(csv.filas),
      },
    });
  } catch (e) {
    const error = estadoDeError(e);
    return respuestaTexto(error.mensaje, error.codigo === "permiso" ? 403 : 422);
  }
}
