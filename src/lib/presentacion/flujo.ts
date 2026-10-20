import type { ContadoresBandeja, PestanaBandeja } from "@/lib/dominio/expedientes/bandejas";
import type { DestinoPase, Faltante, SubtareaReiniciable } from "@/lib/dominio/expedientes/flujo";
import { comoDatetimeLocal, hoyEnTucuman, sumarDias } from "@/lib/fechas";
import { idDeCampo } from "./errores";

/**
 * Lógica de las pantallas del flujo (semana 3): la bandeja, el "Faltan N" de
 * la ficha, los diálogos de pase y devolución y la fecha efectiva. Pura: sin
 * Next ni base, la usan los Server y los Client Components y los tests.
 *
 * No decide reglas: lo que falta, los destinos y los permisos los da el
 * dominio (`ficha.pase`, `ficha.acciones`, `fila.paseRapido`). Acá solo se
 * ordena y se dice.
 */

// ---------------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------------

/** Las pestañas de la semana 3, en el orden en que se muestran (Plazos y Carga histórica son de la semana 4). */
export const PESTANAS: readonly PestanaBandeja[] = ["por_confirmar", "en_mi_area", "afuera"];

export const ETIQUETA_PESTANA: Record<PestanaBandeja, string> = {
  por_confirmar: "Por confirmar",
  en_mi_area: "En mi área",
  afuera: "Afuera",
};

/** `?pestana=` de la URL, si es una pestaña válida. */
export function leerPestana(valor: string | string[] | undefined): PestanaBandeja | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (PESTANAS as readonly string[]).includes(v ?? "") ? (v as PestanaBandeja) : null;
}

/**
 * La pestaña que se abre: la pedida en la URL o, si no, la primera que tiene
 * trabajo (lo que hay que confirmar, después lo que está en el área, después
 * lo que se custodia afuera). Lo que Mesa de Entradas solo consulta afuera no
 * es trabajo. Sin nada, "En mi área".
 */
export function pestanaPorDefecto(contadores: ContadoresBandeja, pedida: PestanaBandeja | null): PestanaBandeja {
  if (pedida) return pedida;
  if (contadores.por_confirmar > 0) return "por_confirmar";
  if (contadores.en_mi_area > 0) return "en_mi_area";
  if (contadores.afueraCustodia > 0) return "afuera";
  return "en_mi_area";
}

export function rutaBandeja(pestana?: PestanaBandeja): string {
  return pestana ? `/bandeja?pestana=${pestana}` : "/bandeja";
}

/** "1 día hábil" / "3 días hábiles". */
export function textoDias(dias: number): string {
  return `${dias} ${dias === 1 ? "día hábil" : "días hábiles"}`;
}

/** "Devuelto por Asesoría Legal: Falta firma del director" (3.4). */
export function textoDevuelto(e: { porArea: string | null; motivo: string | null }): string {
  const quien = e.porArea ? `Devuelto por ${e.porArea}` : "Devuelto";
  return e.motivo ? `${quien}: ${e.motivo}` : quien;
}

/** Lo que contestó el lote de "Confirmar seleccionados", para el aviso. */
export function resumenLote(resultados: ReadonlyArray<{ ok: boolean; numero: string; mensaje?: string }>): {
  confirmados: number;
  fallidos: Array<{ numero: string; mensaje: string }>;
  texto: string;
} {
  const confirmados = resultados.filter((r) => r.ok).length;
  const fallidos = resultados.filter((r) => !r.ok).map((r) => ({ numero: r.numero, mensaje: r.mensaje ?? "No se pudo confirmar" }));
  const partes: string[] = [];
  if (confirmados > 0) partes.push(confirmados === 1 ? "Se confirmó 1 recepción" : `Se confirmaron ${confirmados} recepciones`);
  if (fallidos.length > 0) partes.push(fallidos.length === 1 ? "1 no se pudo confirmar" : `${fallidos.length} no se pudieron confirmar`);
  return { confirmados, fallidos, texto: partes.length === 0 ? "No había nada para confirmar" : `${partes.join("; ")}.` };
}

// ---------------------------------------------------------------------------
// "Faltan N" y el panel "Qué falta para avanzar" (3.3)
// ---------------------------------------------------------------------------

/** Qué abre el acceso directo de un faltante. */
export type AccesoFaltante =
  | { tipo: "tildar"; clave: string }
  | { tipo: "documento"; clave: string }
  | { tipo: "adjuntar"; documento: string }
  | { tipo: "campo"; href: string };

export interface ItemFaltante {
  /** Única en la lista: `subtareas.X`, `documentos.X`, `datosExtra.X`. */
  id: string;
  texto: string;
  /** Qué hacer ("Tildar", "Marcar", "Adjuntar", "Completar"), o null si el usuario no puede hacerlo. */
  accion: { etiqueta: string; acceso: AccesoFaltante } | null;
  /** Por qué no tiene acceso directo ("Lo completa el área responsable"). */
  aviso: string | null;
}

/** Lo que el usuario puede hacer en la ficha (de `ficha.acciones`, solo `permitido`). */
export interface PermisosFaltan {
  tildarSubtarea: boolean;
  marcarDocumento: boolean;
  adjuntar: boolean;
  completarCamposExtra: boolean;
}

/** Dónde se completa un campo extra: el formulario de edición, con el foco en el campo. */
export function rutaCampoExtra(rutaEditar: string, clave: string): string {
  return `${rutaEditar}#${idDeCampo(`datosExtra.${clave}`)}`;
}

/**
 * La lista exacta de lo que falta, con el acceso directo para resolver cada
 * cosa (3.3: "abre la lista exacta de lo que falta, con acceso directo para
 * tildar, marcar el documento o completar el campo"). Sin permiso para esa
 * cosa, el ítem va sin acceso y con un aviso.
 */
export function itemsFaltan(faltan: readonly Faltante[], permisos: PermisosFaltan, rutaEditar: string): ItemFaltante[] {
  return faltan.map((f): ItemFaltante => {
    if (f.tipo === "subtarea") {
      return {
        id: `subtareas.${f.clave}`,
        texto: f.mensaje,
        accion: permisos.tildarSubtarea ? { etiqueta: f.motivo === "sin_dato" ? "Completar el dato" : "Tildar", acceso: { tipo: "tildar", clave: f.clave } } : null,
        aviso: permisos.tildarSubtarea ? null : "La tilda el área responsable",
      };
    }
    if (f.tipo === "documento") {
      const adjuntar = f.motivo === "sin_adjunto";
      const puede = adjuntar ? permisos.adjuntar : permisos.marcarDocumento;
      return {
        id: `documentos.${f.clave}`,
        texto: f.mensaje,
        accion: puede
          ? adjuntar
            ? { etiqueta: "Adjuntar", acceso: { tipo: "adjuntar", documento: f.clave } }
            : { etiqueta: f.motivo === "sin_observacion" ? "Agregar la observación" : "Marcar", acceso: { tipo: "documento", clave: f.clave } }
          : null,
        aviso: puede ? null : "Lo marca el área responsable o Mesa de Entradas",
      };
    }
    return {
      id: `datosExtra.${f.clave}`,
      texto: f.mensaje,
      accion: permisos.completarCamposExtra ? { etiqueta: "Completar", acceso: { tipo: "campo", href: rutaCampoExtra(rutaEditar, f.clave) } } : null,
      aviso: permisos.completarCamposExtra ? null : "Lo completa el área responsable o Mesa de Entradas",
    };
  });
}

/** El texto del botón: "Dar pase" o "Dar pase · Faltan 3". */
export function textoBotonPase(faltan: number): string {
  return faltan > 0 ? `Dar pase · Faltan ${faltan}` : "Dar pase";
}

/** "Faltan 3: …" para el título de la lista. */
export function tituloFaltan(n: number): string {
  return n === 1 ? "Falta 1 cosa para avanzar" : `Faltan ${n} cosas para avanzar`;
}

// ---------------------------------------------------------------------------
// Diálogo "Dar pase" (3.3, punto 8)
// ---------------------------------------------------------------------------

export interface OpcionDestino {
  clave: string;
  etiqueta: string;
  detalle: string | null;
  disponible: boolean;
  requiereMotivo: boolean;
  faltan: number;
}

/** Los destinos del diálogo, con su explicación. Se ofrecen todos; los que tienen algo pendiente, deshabilitados. */
export function opcionesDestino(destinos: readonly DestinoPase[], nombrePaso: (clave: string) => string): OpcionDestino[] {
  return destinos.map((d) => {
    const nombres = (claves: readonly string[]) => claves.map(nombrePaso).join(", ");
    let etiqueta: string;
    let detalle: string | null = null;
    if (d.tipo === "siguiente") {
      etiqueta = `${d.orden}. ${d.nombre} (paso siguiente)`;
      if (d.esRetorno) detalle = "Es el paso que lo devolvió.";
    } else if (d.tipo === "reenvio") {
      etiqueta = `${d.orden}. ${d.nombre} (reenvío directo)`;
      detalle = `Vuelve al paso que lo devolvió, salteando ${nombres(d.pasosSalteados)}.`;
    } else {
      etiqueta = `${d.orden}. ${d.nombre} (salteando ${nombres(d.pasosOmitidos)})`;
      detalle = "Saltear pasos omitibles pide motivo.";
    }
    if (d.faltan.length > 0) {
      const pendiente = d.faltan.length === 1 ? "Falta 1 cosa" : `Faltan ${d.faltan.length} cosas`;
      detalle = `${detalle ? `${detalle} ` : ""}${pendiente}: ${d.faltan.map((f) => f.mensaje).join("; ")}.`;
    }
    return { clave: d.clave, etiqueta, detalle, disponible: d.faltan.length === 0, requiereMotivo: d.requiereMotivo, faltan: d.faltan.length };
  });
}

/** El destino que viene marcado: el primero disponible (el siguiente, si se puede). */
export function destinoInicial(opciones: readonly OpcionDestino[]): string | null {
  return opciones.find((o) => o.disponible)?.clave ?? null;
}

// ---------------------------------------------------------------------------
// Devolución (3.4)
// ---------------------------------------------------------------------------

export const ATAJOS_DEVOLUCION = ["Falta firma", "Error en boleta", "Falta documentación"] as const;

/**
 * Pone el atajo al comienzo del motivo ("Falta firma: …"), reemplazando otro
 * atajo si ya había uno; lo que se escribió después se conserva.
 */
export function aplicarAtajo(motivo: string, atajo: string): string {
  let resto = motivo.trimStart();
  for (const a of ATAJOS_DEVOLUCION) {
    if (resto.toLowerCase().startsWith(a.toLowerCase())) {
      resto = resto.slice(a.length).replace(/^\s*[:.,-]?\s*/, "");
      break;
    }
  }
  return `${atajo}: ${resto}`;
}

/** Las subtareas que se pueden mandar a rehacer al devolver a ese paso (las del destino en adelante). */
export function reiniciablesPara(reiniciables: readonly SubtareaReiniciable[], ordenDestino: number | null): SubtareaReiniciable[] {
  if (ordenDestino === null) return [];
  return reiniciables.filter((s) => s.paso.orden >= ordenDestino);
}

// ---------------------------------------------------------------------------
// Fecha efectiva (12.1)
// ---------------------------------------------------------------------------

/** "ahora"; "momento": fecha y hora (`datetime-local`); "dia": solo la fecha, con precisión de día. */
export type ModoFecha = "ahora" | "momento" | "dia";

/** Días hacia atrás que admite una fecha efectiva (`DIAS_RETROACTIVOS_MAX` del dominio). */
export const DIAS_ATRAS_FECHA = 30;

/** Mínimos y máximos de los controles: de hace 30 días (desde las 00:00 de Tucumán) hasta ahora. */
export function limitesFecha(ahora: Date): { minDia: string; maxDia: string; minMomento: string; maxMomento: string } {
  const hoy = hoyEnTucuman(ahora);
  const minDia = sumarDias(hoy, -DIAS_ATRAS_FECHA);
  return { minDia, maxDia: hoy, minMomento: `${minDia}T00:00`, maxMomento: comoDatetimeLocal(ahora) };
}

/** Lo que se manda como `fechaEfectiva` (`EntradaFechaEfectiva` del dominio): vacío es ahora. */
export function valorFechaEfectiva(modo: ModoFecha, momento: string, dia: string): string {
  if (modo === "momento") return momento.trim();
  if (modo === "dia") return dia.trim();
  return "";
}

// ---------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------

/**
 * Un UUID v4 para `comandoId`, generado al abrir el diálogo. `randomUUID()`
 * existe solo en contextos seguros (https o localhost); con http en la red
 * municipal se arma con `getRandomValues()`, que está siempre.
 */
export function nuevoComandoId(c: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // Fuera de un contexto seguro algunos navegadores la exponen y tiran.
    }
  }
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "1,2 MB", "340 KB". */
export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}
