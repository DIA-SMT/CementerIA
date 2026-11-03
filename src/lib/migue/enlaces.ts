/**
 * Cómo se lee lo que contesta el modelo (docs/api-dominio.md, 26.6): el texto
 * para la persona, los enlaces y si dijo que no tenía el dato. Pura (sin red
 * ni base): se prueba con lo que escribe el modelo de verdad.
 *
 * Se le pide al modelo que cierre con líneas de servicio:
 *   ENLACE: /consulta          (hasta dos)
 *   [SIN_RESPUESTA]            (si el dato no está)
 * y se las saca **línea por línea, no con una expresión exacta**, como El
 * Sanmiguelino (interpretacion.ts): el modelo escribe «**ENLACE:** /x»,
 * «- ENLACE: [x](/x)» o «> ENLACE: /x», y ser estricto solo deja basura en
 * pantalla. A cada línea se le saca la puntuación de markdown y se mira si lo
 * que queda empieza con la palabra de servicio.
 *
 * **Un enlace vale solo si es una ruta conocida** (como el diario valida el
 * slug contra la edición): las páginas del sitio en lo público; en lo interno,
 * las pantallas del sistema y la ficha de un expediente que una herramienta
 * devolvió en esta misma consulta. Lo demás se descarta, y del texto se sacan
 * las direcciones web que no estén entre las permitidas (las de inscripción y
 * mapa que cargó la Dirección): un enlace inventado manda a la persona a
 * cualquier lado.
 */

export interface EnlaceMigue {
  /** Una ruta de la app (`/consulta`, `/expedientes/CEM-2026-00042`) o una URL permitida. */
  href: string;
  etiqueta: string;
}

export interface RespuestaInterpretada {
  texto: string;
  enlaces: EnlaceMigue[];
  /** El modelo dijo que no tenía el dato (la marca). */
  sinRespuesta: boolean;
}

export const MARCA_SIN_RESPUESTA = "[SIN_RESPUESTA]";

/** Máximo de enlaces debajo de una respuesta. */
export const MAXIMO_ENLACES = 3;

/** Decide si un href se puede mostrar y con qué etiqueta (null: no). */
export type ValidadorEnlaces = (href: string) => string | null;

const PUNTUACION_MARKDOWN = /^[\s>*_`#~\-•·]+/;
const ENLACE_MARKDOWN = /\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)/g;
// Sin el signo de puntuación final: «…/turnos.» es la URL y un punto.
const URL_SUELTA = /\bhttps?:\/\/[^\s<>"')\]]*[^\s<>"')\].,;:!?]/gi;

/** La ruta de un href escrito por el modelo: sin espacios, comillas, signos de cierre ni barra final. */
export function normalizarHref(crudo: string): string {
  let h = crudo.trim().replace(/^[<("'`]+|[>)"'`.,;:]+$/g, "");
  if (h.length > 1 && h.startsWith("/") && h.endsWith("/")) h = h.slice(0, -1);
  return h;
}

export function interpretarRespuesta(crudo: string, validar: ValidadorEnlaces): RespuestaInterpretada {
  const enlaces: EnlaceMigue[] = [];
  const agregar = (href: string) => {
    const h = normalizarHref(href);
    const etiqueta = validar(h);
    if (etiqueta && !enlaces.some((e) => e.href === h) && enlaces.length < MAXIMO_ENLACES) enlaces.push({ href: h, etiqueta });
  };
  let sinRespuesta = false;
  const lineas: string[] = [];

  for (const original of crudo.replace(/\r\n?/g, "\n").split("\n")) {
    const pelada = original.replace(PUNTUACION_MARKDOWN, "").replace(/\*\*/g, "").trim();
    if (pelada.toUpperCase().includes(MARCA_SIN_RESPUESTA)) {
      sinRespuesta = true;
      const resto = original.replace(/\[SIN_RESPUESTA\]/gi, "").trim();
      if (resto) lineas.push(resto);
      continue;
    }
    const servicio = /^ENLACES?\s*:\s*(.*)$/i.exec(pelada);
    if (servicio) {
      // «ENLACE: [Consultá tu trámite](/consulta)» o «ENLACE: /consulta, /contacto».
      const valor = servicio[1];
      const enMarkdown = [...valor.matchAll(ENLACE_MARKDOWN)].map((m) => m[2]);
      for (const h of enMarkdown.length ? enMarkdown : valor.split(/[\s,]+/)) if (h) agregar(h);
      continue;
    }
    lineas.push(original);
  }

  let texto = lineas.join("\n");
  // Los enlaces en el cuerpo: el texto queda; el destino, solo si es conocido (va abajo, como botón).
  texto = texto.replace(ENLACE_MARKDOWN, (_, etiqueta: string, href: string) => {
    agregar(href);
    return etiqueta;
  });
  // Las URL sueltas que no son de los datos se sacan del texto.
  texto = texto.replace(URL_SUELTA, (url: string) => {
    const h = normalizarHref(url);
    if (validar(h)) {
      agregar(h);
      return h;
    }
    return "";
  });
  // Las rutas internas escritas en el texto («entrá a /consulta») también van como botón.
  for (const m of texto.matchAll(/(?:^|[\s(«"])(\/[a-z][a-z0-9-]*(?:\/[A-Za-z0-9-]+)?)/g)) agregar(m[1]);

  texto = texto
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
  return { texto, enlaces, sinRespuesta };
}
