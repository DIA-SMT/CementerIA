/**
 * Los límites de Migue, escritos una sola vez (docs/api-dominio.md, 26.2).
 *
 * Vive acá, solo y sin importar nada del servidor, porque lo leen los dos
 * lados: el cuadro del chat, que no deja escribir más, y las rutas que
 * contestan, que rechazan lo que llegue más largo igual. Si estuviera escrito
 * dos veces, el día que cambie uno la persona escribe una pregunta entera y
 * recibe un error que el cuadro no le avisó.
 */

/** La pregunta en la página pública (como El Sanmiguelino). */
export const LARGO_MAXIMO_PUBLICO = 500;

/** La pregunta en el sistema (como AppAmbiente): un número de expediente y una duda caben de sobra. */
export const LARGO_MAXIMO_INTERNO = 600;

/** Los turnos anteriores que se le mandan al modelo: cuatro idas y vueltas alcanzan para un "¿y eso?". */
export const TURNOS_DE_MEMORIA = 8;

/** Cada turno viejo se recorta: de una respuesta anterior importa de qué se hablaba, no el párrafo entero. */
export const LARGO_TURNO = 600;

/** Lo que se guarda de la pregunta y de la respuesta en el registro (auditoria.consultas_migue). */
export const LARGO_REGISTRO = 500;

// ── Datos personales ────────────────────────────────────────────────────
// Un DNI, un CUIL o CUIT, un teléfono o un correo no tienen por qué viajar al
// proveedor del modelo ni quedar en el registro. La pregunta que los trae se
// rechaza entera, con un mensaje amable (AppAmbiente, limites.ts).
//
// La forma: siete dígitos o más, con hasta tres caracteres de separación entre
// uno y otro («27.123.456», «20-12345678-3», «381 555-1234»). Antes de mirar
// se pasa a NFKC, porque algunos teclados de celular escriben dígitos de ancho
// completo que ninguna expresión con \d reconoce. Y antes se apartan las dos
// cosas con muchos dígitos que SÍ se pueden escribir:
//   - el número de expediente, en sus dos formas (CEM-2026-00042 y 42/2026):
//     es lo que se pregunta en el sistema, y no identifica a nadie;
//   - las fechas («del 01-09-2026 al 15-09-2026»), que no son el teléfono de nadie.

const NUMERO_EXPEDIENTE = [/\bCEM\D{0,3}\d{4}\D{1,3}\d{1,6}\b/gi, /\b\d{1,6}\s*\/\s*(?:19|20)\d{2}\b/g];

const FECHAS = [/\b\d{4}-\d{1,2}-\d{1,2}\b/g, /\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g, /\b(?:19|20)\d{2}\b/g];

// El «+» opcional es el del prefijo internacional.
const DOCUMENTO_O_TELEFONO = /\+?\d(?:[\s._()\-]{0,3}\d){6,}/;
const CORREO = /[^\s@]+\s*@\s*[^\s@]+\.[^\s@]+|\S+\s*\(?\s*\barroba\b\s*\)?\s*\S+/i;

function sinLoQueSePuede(texto: string): string {
  let limpio = texto.normalize("NFKC");
  for (const patron of [...NUMERO_EXPEDIENTE, ...FECHAS]) limpio = limpio.replace(patron, " ");
  return limpio;
}

/** Si el texto trae algo con forma de DNI, CUIL, CUIT, teléfono o correo. El número de expediente no cuenta. */
export function tieneDatoPersonal(texto: string): boolean {
  const limpio = sinLoQueSePuede(texto);
  return DOCUMENTO_O_TELEFONO.test(limpio) || CORREO.test(limpio);
}

/** Lo que contesta Migue cuando la pregunta trae un dato personal (no se guarda ni se manda). */
export const MENSAJE_DATO_PERSONAL_PUBLICO =
  "Por cuidado, no escribas acá números de documento, CUIL, teléfonos ni correos: no los necesito para ayudarte. Si querés saber cómo va tu trámite, usá «Consultá tu trámite» con el número de expediente y el código del comprobante.";

export const MENSAJE_DATO_PERSONAL_INTERNO =
  "No escribas DNI, CUIL, CUIT, teléfonos ni correos acá: la pregunta viaja al proveedor del modelo y queda en el registro. Preguntame por el número de expediente (CEM-2026-00042 o 42/2026), que sí lo puedo buscar.";

/**
 * Los nombres presentados («soy Ana Pérez», «me llamo…») se tapan antes de
 * guardar la pregunta en el registro (como Presupuesto Participativo). No
 * atrapa todos los nombres: por eso además se guarda poco y por 90 días.
 */
export function taparNombresPresentados(texto: string): string {
  return texto
    .replace(/\b([Ss]oy|[Mm]e llamo|[Mm]i nombre es)\s+((?:\p{Lu}[\p{L}'-]*\s*){1,3})/gu, (_, presentacion: string) => `${presentacion} [nombre] `)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Recorta sin dejar un emoji partido a la mitad (Postgres rechaza el pedazo suelto). */
export function recortar(texto: string, largo: number): string {
  return texto.slice(0, largo).replace(/[\uD800-\uDBFF]$/, "");
}

/** Un turno de la conversación, como lo manda el chat. */
export interface Turno {
  rol: "usuario" | "migue";
  texto: string;
}

/**
 * El hilo de la conversación, saneado. Llega del navegador, así que no se
 * confía: se valida la forma, se descartan los turnos que no la cumplen y se
 * recorta. No se guarda en ningún lado: viaja en el pedido y muere ahí.
 *
 * Una pregunta anterior con un dato personal (la que se rechazó, que el chat
 * sigue mostrando) tampoco viaja: si no, el DNI que no se mandó en su turno
 * llegaría al modelo en el siguiente. Las respuestas de Migue sí, aunque
 * traigan el teléfono de Mesa de Entradas: ese dato es público.
 */
export function historialValido(crudo: unknown): Turno[] {
  if (!Array.isArray(crudo)) return [];
  return crudo
    .filter(
      (t): t is Turno =>
        typeof t === "object" &&
        t !== null &&
        ((t as { rol?: unknown }).rol === "usuario" || (t as { rol?: unknown }).rol === "migue") &&
        typeof (t as { texto?: unknown }).texto === "string" &&
        (t as { texto: string }).texto.trim() !== "",
    )
    .filter((t) => t.rol === "migue" || !tieneDatoPersonal(t.texto))
    .slice(-TURNOS_DE_MEMORIA)
    .map((t) => ({ rol: t.rol, texto: recortar(t.texto, LARGO_TURNO) }));
}
