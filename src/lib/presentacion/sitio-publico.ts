import { ZONA_TUCUMAN } from "@/lib/fechas";

/**
 * Lo que las páginas públicas (28/10/2026) necesitan para mostrar el contenido
 * del sitio, sin Next ni base: las páginas y la barra, las fechas de los
 * recorridos, los párrafos y los enlaces de contacto. Puro.
 */

/**
 * Las páginas internas del sitio público, una por sección (antes eran anclas
 * de una sola página larga). Cada una es una ruta de `src/app/(publico)/`, y el
 * matcher de `src/proxy.ts` deja afuera exactamente estas y `/`.
 */
export type RutaInterna = "/cementerios" | "/horarios" | "/recorridos" | "/tramites" | "/consulta" | "/contacto";
export type RutaPublica = "/" | RutaInterna;

export type PaginaPublica = {
  /** En la barra, las migas de pan y la pestaña de la administración. */
  etiqueta: string;
  /** El `h1` de la página y su `<title>` (con " · Cementerios de San Miguel de Tucumán"). */
  titulo: string;
  /** La bajada debajo de las migas y la descripción de la página. */
  bajada: string;
  /** Lo que dicen los accesos del inicio y las invitaciones al pie de las otras páginas. */
  resumen: string;
  /** El título en la invitación al pie de otra página, si no es el `titulo`. */
  invitacion?: string;
};

export const PAGINAS_PUBLICAS: Readonly<Record<RutaInterna, PaginaPublica>> = {
  "/cementerios": {
    etiqueta: "Cementerios",
    titulo: "Cementerios municipales",
    bajada: "Dónde están, qué tienen y cómo llegar.",
    resumen: "Dónde están, qué tienen y cómo llegar.",
  },
  "/horarios": {
    etiqueta: "Horarios de visita",
    titulo: "Horarios de visita",
    bajada: "Cuándo abre cada cementerio para las visitas.",
    resumen: "Cuándo abre cada cementerio, feriados y fechas especiales.",
  },
  "/recorridos": {
    etiqueta: "Recorridos",
    titulo: "Recorridos históricos",
    bajada: "Visitas guiadas para conocer la historia de la ciudad a través de sus monumentos y personalidades.",
    resumen: "Visitas guiadas por el patrimonio: fechas e inscripción.",
  },
  "/tramites": {
    etiqueta: "Trámites",
    titulo: "Trámites y requisitos",
    bajada:
      "Se inician en Mesa de Entradas de la Dirección de Cementerios. Lo que hay que traer puede variar según el caso: ahí te dicen qué corresponde.",
    resumen: "Qué trámites se hacen y qué documentación traer.",
  },
  "/consulta": {
    etiqueta: "Consultá tu trámite",
    titulo: "Consultá tu trámite",
    bajada: "Sabé en qué área está tu expediente y cuánto avanzó, sin acercarte a la oficina.",
    resumen: "Con el número de expediente y el código del comprobante.",
    invitacion: "¿Ya iniciaste un trámite? Consultalo",
  },
  "/contacto": {
    etiqueta: "Contacto",
    titulo: "Contacto",
    bajada: "Dónde y cuándo atiende Mesa de Entradas de la Dirección de Cementerios.",
    resumen: "Mesa de Entradas: dónde, cuándo y las preguntas frecuentes.",
  },
};

/** Las páginas en el orden de la barra y de los accesos del inicio; "Consultá tu trámite", destacada. */
export const NAVEGACION_PUBLICA: ReadonlyArray<{ ruta: RutaInterna; etiqueta: string; destacada?: boolean }> = (
  ["/cementerios", "/horarios", "/recorridos", "/tramites", "/consulta", "/contacto"] as const
).map((ruta) => ({ ruta, etiqueta: PAGINAS_PUBLICAS[ruta].etiqueta, ...(ruta === "/consulta" ? { destacada: true } : {}) }));

/**
 * Al pie de cada página interna, dos invitaciones a otras secciones: distintas
 * en cada página (no la misma franja repetida) y nunca a sí misma.
 */
export const INVITACIONES: Readonly<Record<RutaInterna, readonly [RutaInterna, RutaInterna]>> = {
  "/cementerios": ["/horarios", "/recorridos"],
  "/horarios": ["/cementerios", "/contacto"],
  "/recorridos": ["/horarios", "/cementerios"],
  "/tramites": ["/consulta", "/contacto"],
  "/consulta": ["/tramites", "/contacto"],
  "/contacto": ["/consulta", "/tramites"],
};

/**
 * Los tres pasos del seguimiento: "Cómo funciona" en /consulta y la banda del
 * inicio. Describen lo que ya pasa en Mesa de Entradas (el comprobante con
 * número, código y QR), sin plazos ni datos inventados.
 */
export const PASOS_CONSULTA: ReadonlyArray<{ titulo: string; texto: string }> = [
  { titulo: "Iniciás el trámite en Mesa de Entradas", texto: "Con la documentación que corresponde." },
  { titulo: "Te dan un comprobante", texto: "Con el número de expediente y un código de consulta. Guardalo: el código es para vos." },
  { titulo: "Lo consultás acá o con el QR", texto: "Escribí el número y el código, o escaneá el QR del comprobante con el celular." },
];

/** El nombre del sitio: el final del `<title>` de cada página interna (lo agrega el layout de `(publico)`). */
export const TITULO_SITIO = "Cementerios de San Miguel de Tucumán";

/** La vista previa desde Administración: `/?vista=publica` muestra el inicio público aunque haya sesión. */
export const RUTA_VISTA_PUBLICA = "/?vista=publica";

const NUMEROS = ["", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis"];

/** "Tres cementerios municipales" (en palabras hasta seis), o "Los cementerios municipales". */
export function tituloCementerios(cantidad: number): string {
  if (cantidad === 1) return "El cementerio municipal";
  return cantidad > 1 && cantidad < NUMEROS.length ? `${NUMEROS[cantidad]} cementerios municipales` : "Los cementerios municipales";
}

const FORMATO_DIA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_TUCUMAN, day: "numeric" });
const FORMATO_MES = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_TUCUMAN, month: "short" });
const FORMATO_COMPLETO = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_TUCUMAN,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const FORMATO_HORA = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_TUCUMAN, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Una fecha de recorrido, en hora de Tucumán: el día y el mes corto para la
 * cajita ("14", "nov") y el texto completo ("sábado 14 de noviembre, 10:00 h").
 */
export function partesFechaRecorrido(fecha: Date): { dia: string; mes: string; texto: string } {
  const mes = FORMATO_MES.format(fecha).replace(".", "");
  return { dia: FORMATO_DIA.format(fecha), mes, texto: `${FORMATO_COMPLETO.format(fecha).replace(",", "")}, ${FORMATO_HORA.format(fecha)} h` };
}

/** Los párrafos de un texto (separados por una línea en blanco). Cada uno conserva sus saltos de línea simples. */
export function parrafosDe(texto: string | null): string[] {
  if (!texto) return [];
  return texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** `tel:` para un teléfono con al menos 6 dígitos (el texto puede traer aclaraciones); si no, `null`. */
export function hrefTelefono(telefono: string | null): string | null {
  if (!telefono) return null;
  // Solo la parte del número: hasta la primera letra o paréntesis de aclaración.
  const numero = telefono.split(/[A-Za-zÀ-ÿ(]/)[0] ?? "";
  const digitos = numero.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digitos.replace(/\D/g, "").length >= 6 ? `tel:${digitos}` : null;
}

/** `mailto:` del correo (ya validado al guardar). */
export function hrefCorreo(correo: string | null): string | null {
  return correo ? `mailto:${correo}` : null;
}

/**
 * El enlace "Cómo llegar": el de mapa que cargó la Dirección o, si no hay, la
 * búsqueda del domicilio en Google Maps. Sin domicilio, `null` (no hay botón).
 */
export function hrefComoLlegar(domicilio: string | null, mapaUrl: string | null): string | null {
  if (!domicilio) return null;
  return mapaUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(domicilio)}`;
}
