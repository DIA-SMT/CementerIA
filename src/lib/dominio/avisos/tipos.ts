import { formatearFecha, type FechaISO } from "@/lib/fechas";

/**
 * Los avisos en el sistema (docs/api-dominio.md, sección 21): qué tipos hay,
 * su prioridad, la clave que evita duplicarlos y el texto de cada uno. Puro:
 * lo usan el dominio (eventos.ts, tiempo.ts), las pantallas y los tests.
 *
 * Qué se avisa y a quién (los operadores activos del área; nunca el admin ni
 * Dirección, que no operan; nunca quien hizo la acción):
 *
 * | Tipo | Cuándo | A quién | Prioridad |
 * |---|---|---|---|
 * | `llego` | Un pase llega a un área | El área de destino (en un paso externo, la custodia) | normal |
 * | `devuelto` | Una devolución (con el motivo) | El área de destino (externo: la custodia) | alta |
 * | `plazo_por_vencer` | Plazo DIM con 5 días hábiles o menos | La custodia (Tributario) | normal |
 * | `plazo_vencido` | Plazo DIM vencido | La custodia | alta |
 * | `sin_confirmar` | Más de 2 días hábiles sin confirmar la recepción | El área que lo envió | normal |
 * | `demorado` | `dias_alerta` del paso cumplidos en el área | El área responsable | normal |
 * | `cerrado` | Concluido o archivado | Mesa de Entradas (se puede apagar) | baja |
 *
 * Una devolución genera solo `devuelto` (no además `llego`): es la misma
 * llegada, con más información.
 *
 * Sin datos personales: número, trámite, paso, área y, en una devolución, el
 * motivo (que ya está en el historial y en la bandeja). Nunca el titular ni el
 * contacto.
 */

export const TIPOS_AVISO = ["llego", "devuelto", "plazo_por_vencer", "plazo_vencido", "sin_confirmar", "demorado", "cerrado"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

export function esTipoAviso(valor: unknown): valor is TipoAviso {
  return typeof valor === "string" && (TIPOS_AVISO as readonly string[]).includes(valor);
}

export const PRIORIDADES_AVISO = ["baja", "normal", "alta"] as const;
export type PrioridadAviso = (typeof PRIORIDADES_AVISO)[number];

/**
 * Por dónde sale un aviso. Hoy solo `sistema` (la campana y /avisos). Para
 * sumar correo o WhatsApp (como el canal sistema/email/migue de Tramita
 * Capital): agregar el canal acá y en el CHECK de `avisos_preferencias`, una
 * tabla de envíos (aviso, canal, estado, intentos) que llene un proceso aparte
 * leyendo `avisos` y las preferencias, y el texto corto de cada canal. Los
 * generadores no cambian: crean la fila en `avisos` y nada más.
 */
export const CANALES_AVISO = ["sistema"] as const;
export type CanalAviso = (typeof CANALES_AVISO)[number];

export const PRIORIDAD_DE: Readonly<Record<TipoAviso, PrioridadAviso>> = {
  llego: "normal",
  devuelto: "alta",
  plazo_por_vencer: "normal",
  plazo_vencido: "alta",
  sin_confirmar: "normal",
  demorado: "normal",
  cerrado: "baja",
};

/** El nombre de cada tipo (filtro de /avisos, preferencias). */
export const ETIQUETA_TIPO_AVISO: Readonly<Record<TipoAviso, string>> = {
  llego: "Llegó un expediente",
  devuelto: "Te devolvieron un expediente",
  plazo_por_vencer: "Plazo DIM por vencer",
  plazo_vencido: "Plazo DIM vencido",
  sin_confirmar: "Enviado sin confirmar",
  demorado: "Demorado",
  cerrado: "Concluido o archivado",
};

/** Los que cada usuario puede apagar (los demás son parte del trabajo del área). */
export const TIPOS_DESACTIVABLES: readonly TipoAviso[] = ["cerrado"];

/** Los que se generan por el paso del tiempo (tiempo.ts), no por una acción. */
export const TIPOS_POR_TIEMPO: readonly TipoAviso[] = ["plazo_por_vencer", "plazo_vencido", "sin_confirmar", "demorado"];

/** Retención (docs/despliegue.md): los leídos de más de estos días se pueden purgar; menos, nunca. */
export const DIAS_RETENCION_MINIMA = 90;

/**
 * Los días de `--dias` del script de purga: un entero de `DIAS_RETENCION_MINIMA`
 * (90) o más; por defecto, 90. Menos no se admite: un aviso leído hace poco
 * todavía sirve para encontrar qué pasó.
 */
export function diasDePurga(valor: string | undefined): number {
  if (valor === undefined) return DIAS_RETENCION_MINIMA;
  if (!/^\d{1,5}$/.test(valor)) throw new RangeError(`--dias: se esperaba un número de días y llegó "${valor}"`);
  const dias = Number(valor);
  if (dias < DIAS_RETENCION_MINIMA) throw new RangeError(`--dias: como mínimo ${DIAS_RETENCION_MINIMA} (llegó ${dias})`);
  return dias;
}

export const LARGO_MAXIMO_TITULO = 160;
export const LARGO_MAXIMO_TEXTO = 600;
/** El motivo de una devolución dentro del texto del aviso (el completo está en el historial). */
export const LARGO_MAXIMO_MOTIVO = 280;

/** Corta en `maximo` caracteres con "…" (sin partir un par sustituto). */
export function recortar(texto: string, maximo: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  const caracteres = Array.from(limpio);
  if (caracteres.length <= maximo) return limpio;
  return `${caracteres.slice(0, maximo - 1).join("").trimEnd()}…`;
}

/** El enlace de un aviso: la ficha del expediente (ruta relativa: el CHECK de la base lo exige). */
export function enlaceExpediente(numero: string): string {
  return `/expedientes/${encodeURIComponent(numero)}`;
}

// ---------------------------------------------------------------------------
// Claves (una por destinatario: avisos_usuario_id_clave_key)
// ---------------------------------------------------------------------------

/** `llego`, `devuelto` y `cerrado`: uno por movimiento. */
export function claveDeMovimiento(tipo: "llego" | "devuelto" | "cerrado", movimientoId: bigint | string): string {
  return `${tipo}:${movimientoId.toString()}`;
}

/** El plazo: uno por expediente y por inicio del plazo (si se vuelve a notificar, es otro plazo). */
export function claveDePlazo(tipo: "plazo_por_vencer" | "plazo_vencido", expedienteId: bigint | string, plazoDesde: FechaISO): string {
  return `${tipo}:${expedienteId.toString()}:${plazoDesde}`;
}

/** Sin confirmar: uno por envío (el pase o la devolución que no se confirmó). */
export function claveSinConfirmar(movimientoId: bigint | string): string {
  return `sin_confirmar:${movimientoId.toString()}`;
}

/**
 * Demorado: uno por expediente y paso (por estadía: la llegada al área), no
 * uno por día. Si vuelve al mismo paso más adelante, es otra estadía.
 */
export function claveDemorado(expedienteId: bigint | string, pasoClave: string, enAreaDesde: Date): string {
  return `demorado:${expedienteId.toString()}:${pasoClave}:${enAreaDesde.toISOString()}`;
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

export interface ContenidoAviso {
  tipo: TipoAviso;
  prioridad: PrioridadAviso;
  titulo: string;
  texto: string;
  enlace: string;
}

function contenido(tipo: TipoAviso, numero: string, titulo: string, partes: Array<string | null | undefined | false>): ContenidoAviso {
  return {
    tipo,
    prioridad: PRIORIDAD_DE[tipo],
    titulo: recortar(titulo, LARGO_MAXIMO_TITULO),
    texto: recortar(partes.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" · "), LARGO_MAXIMO_TEXTO),
    enlace: enlaceExpediente(numero),
  };
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);

/** Lo común de los avisos: el expediente, su trámite (la plantilla) y el paso. */
export interface DatosExpedienteAviso {
  numero: string;
  /** El nombre de la plantilla ("Renovación, pago de contado"). */
  tramite: string;
  /** El nombre del paso ("Cómputo: alta"). */
  paso: string;
}

/** "Llegó CEM-2026-00031" (o, en un paso externo, "CEM-… está en la DIM"). */
export function avisoLlegada(d: DatosExpedienteAviso & { areaOrigen: string | null; areaActual: string; externo: boolean }): ContenidoAviso {
  return d.externo
    ? contenido("llego", d.numero, `${d.numero} está en ${d.areaActual}`, [d.tramite, `paso ${d.paso}`, "lo custodia tu área", d.areaOrigen && `desde ${d.areaOrigen}`])
    : contenido("llego", d.numero, `Llegó ${d.numero}`, [d.tramite, `paso ${d.paso}`, d.areaOrigen && `desde ${d.areaOrigen}`]);
}

/** "Te devolvieron CEM-…": quién, a qué paso y el motivo. */
export function avisoDevolucion(d: DatosExpedienteAviso & { areaQueDevolvio: string | null; motivo: string; externo: boolean; areaActual: string }): ContenidoAviso {
  const quien = d.areaQueDevolvio ? `${d.areaQueDevolvio} lo devolvió a ${d.paso}` : `Devuelto a ${d.paso}`;
  return contenido("devuelto", d.numero, `Te devolvieron ${d.numero}`, [
    `${quien}: ${recortar(d.motivo, LARGO_MAXIMO_MOTIVO)}`,
    d.externo && `está en ${d.areaActual}, lo custodia tu área`,
    d.tramite,
  ]);
}

/** Plazo DIM por vencer ("vence el 30/11 · faltan 3 días hábiles") o vencido. */
export function avisoPlazo(
  d: DatosExpedienteAviso & { vence: FechaISO; faltan: number; provisorio: boolean },
): ContenidoAviso {
  const provisorio = d.provisorio ? " (provisorio)" : "";
  if (d.faltan < 0) {
    return contenido("plazo_vencido", d.numero, `Plazo DIM vencido: ${d.numero}`, [
      `Venció el ${formatearFecha(d.vence)}, hace ${plural(-d.faltan, "día hábil", "días hábiles")}${provisorio}`,
      d.tramite,
      `paso ${d.paso}`,
    ]);
  }
  const cuando = d.faltan === 0 ? "vence hoy" : `faltan ${plural(d.faltan, "día hábil", "días hábiles")}`;
  return contenido("plazo_por_vencer", d.numero, `Plazo DIM por vencer: ${d.numero}`, [
    `Vence el ${formatearFecha(d.vence)}, ${cuando}${provisorio}`,
    d.tramite,
    `paso ${d.paso}`,
  ]);
}

/** Enviado sin confirmar, al área que lo envió. */
export function avisoSinConfirmar(d: DatosExpedienteAviso & { areaDestino: string; dias: number }): ContenidoAviso {
  return contenido("sin_confirmar", d.numero, `Sin confirmar: ${d.numero}`, [
    `Tu área lo envió a ${d.areaDestino} hace ${plural(d.dias, "día hábil", "días hábiles")} y todavía no confirmaron la recepción`,
    d.tramite,
    `paso ${d.paso}`,
  ]);
}

/** Demorado en el área: los días hábiles y el umbral del paso. */
export function avisoDemorado(d: DatosExpedienteAviso & { area: string; dias: number; diasAlerta: number }): ContenidoAviso {
  return contenido("demorado", d.numero, `Demorado: ${d.numero}`, [
    `${plural(d.dias, "día hábil", "días hábiles")} en ${d.area} (la alerta del paso es a los ${d.diasAlerta})`,
    d.tramite,
    `paso ${d.paso}`,
  ]);
}

/** Concluido o archivado, informativo para Mesa de Entradas. */
export function avisoCierre(
  d: Omit<DatosExpedienteAviso, "paso"> & { estado: "concluido" | "archivado"; area: string | null; ubicacionArchivo: string | null; sinConcluir: boolean },
): ContenidoAviso {
  if (d.estado === "concluido") {
    return contenido("cerrado", d.numero, `Concluido: ${d.numero}`, [d.tramite, d.area && `lo concluyó ${d.area}`]);
  }
  return contenido("cerrado", d.numero, `Archivado: ${d.numero}`, [
    d.tramite,
    d.sinConcluir ? "sin concluir" : null,
    d.ubicacionArchivo && `ubicación ${d.ubicacionArchivo}`,
    d.area && `lo archivó ${d.area}`,
  ]);
}
