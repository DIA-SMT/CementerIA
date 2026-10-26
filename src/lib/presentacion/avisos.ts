import type { AvisoVista, ResumenAvisos } from "@/lib/dominio/avisos/consultas";
import { esTipoAviso, type TipoAviso } from "@/lib/dominio/avisos/tipos";
import { diaEnTucuman, formatearFecha, sumarDias } from "@/lib/fechas";

/**
 * Lógica de las pantallas de avisos (la campana del encabezado y /avisos).
 * Pura: sin Next ni base; la usan los Server y los Client Components, las
 * Server Actions y los tests.
 */

/** Cada cuánto la campana pide el resumen mientras la pestaña está visible. */
export const REFRESCO_CAMPANA_MS = 60_000;
/** Al cambiar de pantalla no se vuelve a pedir si la última respuesta tiene menos que esto. */
export const REFRESCO_MINIMO_MS = 5_000;
/** El Route Handler del refresco (fuera del matcher del proxy: no renueva la sesión). */
export const RUTA_RESUMEN_AVISOS = "/api/avisos/resumen";

/** El nombre accesible de la campana: "Avisos, 3 sin leer". */
export function nombreCampana(noLeidos: number): string {
  if (noLeidos <= 0) return "Avisos, ninguno sin leer";
  return `Avisos, ${noLeidos} sin leer`;
}

/** El número que se ve en la campana (más de 99, "99+"); nada con 0. */
export function numeroCampana(noLeidos: number): string | null {
  if (noLeidos <= 0) return null;
  return noLeidos > 99 ? "99+" : String(noLeidos);
}

/**
 * "hace cuánto", corto: "recién", "hace 5 min", "hace 2 h", "ayer", "hace 3
 * días" y, desde la semana, la fecha ("el 12/10/2026"). Los días son los de
 * Tucumán (un aviso de las 23:50 es "ayer" a las 0:10).
 */
export function haceCuanto(desde: Date | string, ahora: Date): string {
  const instante = typeof desde === "string" ? new Date(desde) : desde;
  const ms = ahora.getTime() - instante.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 60_000) return "recién";
  const minutos = Math.floor(ms / 60_000);
  const hoy = diaEnTucuman(ahora);
  const dia = diaEnTucuman(instante);
  if (dia === hoy) return minutos < 60 ? `hace ${minutos} min` : `hace ${Math.floor(minutos / 60)} h`;
  if (dia === sumarDias(hoy, -1)) return "ayer";
  for (let n = 2; n <= 6; n++) if (dia === sumarDias(hoy, -n)) return `hace ${n} días`;
  return `el ${formatearFecha(instante)}`;
}

/**
 * El tono de cada tipo (docs/diseno.md, "Campana de avisos"): los de prioridad
 * alta (devuelto y plazo vencido) en `error`; los que piden atención sin ser
 * urgentes (plazo por vencer, sin confirmar, demorado) en `advertencia`; el
 * resto, informativo. El color nunca va solo: ícono y texto lo dicen.
 */
export type TonoAvisoUi = "error" | "advertencia" | "info" | "neutro";

export const TONO_TIPO_AVISO: Readonly<Record<TipoAviso, TonoAvisoUi>> = {
  devuelto: "error",
  plazo_vencido: "error",
  plazo_por_vencer: "advertencia",
  sin_confirmar: "advertencia",
  demorado: "advertencia",
  llego: "info",
  cerrado: "neutro",
};

/** El círculo del ícono, por tono (texto del tono sobre su fondo: 5,76 a 6,21:1). */
export const CLASE_ICONO_TONO: Readonly<Record<TonoAvisoUi, string>> = {
  error: "bg-error-fondo text-error ring-1 ring-inset ring-error-borde",
  advertencia: "bg-advertencia-fondo text-advertencia ring-1 ring-inset ring-advertencia-borde",
  info: "bg-info-fondo text-info ring-1 ring-inset ring-info-borde",
  neutro: "bg-fondo text-texto-secundario ring-1 ring-inset ring-borde",
};

// ---------------------------------------------------------------------------
// /avisos: filtros en la URL
// ---------------------------------------------------------------------------

export interface FiltrosPantallaAvisos {
  soloNoLeidos: boolean;
  tipo: TipoAviso | null;
  pagina: number;
}

type Parametro = string | string[] | undefined;
const primero = (v: Parametro) => (Array.isArray(v) ? v[0] : v);

/** `?estado=no_leidos&tipo=devuelto&pagina=2`. Lo que no se entiende, se ignora. */
export function leerFiltrosAvisos(p: { estado?: Parametro; tipo?: Parametro; pagina?: Parametro }): FiltrosPantallaAvisos {
  const tipo = primero(p.tipo);
  const pagina = Number(primero(p.pagina));
  return {
    soloNoLeidos: primero(p.estado) === "no_leidos",
    tipo: esTipoAviso(tipo) ? tipo : null,
    pagina: Number.isInteger(pagina) && pagina >= 1 ? pagina : 1,
  };
}

/** La URL de /avisos con esos filtros (sin lo que está por defecto). */
export function rutaAvisos(f: Partial<FiltrosPantallaAvisos> = {}): string {
  const q = new URLSearchParams();
  if (f.soloNoLeidos) q.set("estado", "no_leidos");
  if (f.tipo) q.set("tipo", f.tipo);
  if (f.pagina && f.pagina > 1) q.set("pagina", String(f.pagina));
  const s = q.toString();
  return s ? `/avisos?${s}` : "/avisos";
}

// ---------------------------------------------------------------------------
// La campana: estado local
// ---------------------------------------------------------------------------

/** El resumen con esos avisos marcados como leídos (lo que muestra la campana antes de que vuelva el servidor). */
export function marcarEnResumen(r: ResumenAvisos, ids: readonly string[] | "todos", ahora: Date): ResumenAvisos {
  const marcar = (a: AvisoVista) => a.leidoEn === null && (ids === "todos" || ids.includes(a.id));
  const cambiados = r.ultimos.filter(marcar).length;
  const restar = ids === "todos" ? r.noLeidos : cambiados;
  return {
    noLeidos: Math.max(0, r.noLeidos - restar),
    ultimos: r.ultimos.map((a) => (marcar(a) ? { ...a, leidoEn: ahora.toISOString() } : a)),
  };
}

/** ¿Es un resumen como el que devuelve el Route Handler? (lo que llega por fetch no se cree a ciegas). */
export function esResumenAvisos(v: unknown): v is ResumenAvisos {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { noLeidos?: unknown; ultimos?: unknown };
  return (
    typeof r.noLeidos === "number" &&
    Array.isArray(r.ultimos) &&
    r.ultimos.every(
      (a: unknown) =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as AvisoVista).id === "string" &&
        esTipoAviso((a as AvisoVista).tipo) &&
        typeof (a as AvisoVista).titulo === "string" &&
        typeof (a as AvisoVista).enlace === "string" &&
        (a as AvisoVista).enlace.startsWith("/"),
    )
  );
}

/** Lo que mandan las Server Actions de avisos: una lista de ids (texto). */
export function leerIds(entrada: unknown): string[] {
  if (!Array.isArray(entrada)) return [];
  return entrada.filter((x): x is string => typeof x === "string" && /^[1-9]\d{0,18}$/.test(x)).slice(0, 200);
}
