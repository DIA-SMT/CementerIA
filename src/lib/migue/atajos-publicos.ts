import { palabras, parecidas, simplificar } from "./ayuda-interna";
import type { DatosPublicosMigue } from "./datos-publicos";
import type { EnlaceMigue } from "./enlaces";

/**
 * Lo que Migue contesta en la página pública **sin modelo** (docs/api-dominio.md,
 * 26.9): los atajos deterministas y el buscador por palabras. Puros: se prueban
 * con lo que escribe la gente.
 *
 * - Los atajos (saludo, qué trámites hay, horarios, contacto) se resuelven
 *   antes del modelo y no cuentan para el tope: la lista exacta es mejor que
 *   cualquier resumen, y así no se paga una llamada por cada "hola". Como en
 *   El Sanmiguelino, valen solo para el PRIMER mensaje (con charla encima, el
 *   que sabe a qué se refiere un "¿y el otro?" es el modelo). La excepción es
 *   la consulta del trámite: siempre se explica /consulta, porque Migue no
 *   consulta expedientes.
 * - El buscador es el respaldo: si no hay clave, si el modelo falla o si se
 *   pasó el tope, contesta con la ficha que más palabras comparte con la
 *   pregunta, de los mismos datos.
 *
 * Todo lo que decide un camino mira la pregunta simplificada (minúsculas, sin
 * tildes): la gente escribe así, y `\b` no reconoce la "é" como letra.
 */

export interface RespuestaSinModelo {
  texto: string;
  enlaces: EnlaceMigue[];
  /** Hubo una respuesta con contenido (false: "no encontré", que también es una respuesta). */
  resuelta: boolean;
}

const ENLACE = {
  consulta: { href: "/consulta", etiqueta: "Consultá tu trámite" },
  tramites: { href: "/tramites", etiqueta: "Trámites y requisitos" },
  horarios: { href: "/horarios", etiqueta: "Horarios de visita" },
  contacto: { href: "/contacto", etiqueta: "Contacto" },
  cementerios: { href: "/cementerios", etiqueta: "Cementerios municipales" },
  recorridos: { href: "/recorridos", etiqueta: "Recorridos históricos" },
} as const satisfies Record<string, EnlaceMigue>;

/** Un saludo y nada más (anclado: "hola, ¿qué horario tiene?" no es un saludo). */
export const ES_SOLO_UN_SALUDO =
  /^[\s¡!¿?,.]*(hola|holis|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|que tal)([\s,!¡.]*(migue|como estas|como andas|que tal|todo bien))?[\s!¡.?]*$/;

/** Pregunta por la lista de trámites, no por uno ("¿qué trámite necesito para…?" va al modelo). */
const PIDE_TRAMITES = [
  /\b(que|cuales)\s+tramites\b/,
  /\btramites\b.{0,25}\b(hay|hacen|se pueden|puedo hacer|existen|ofrecen|realizan|tienen)\b/,
  /^\s*(los\s+)?tramites\s*\??\s*$/,
  /\blista de tramites\b/,
];

const PIDE_HORARIOS = [/\bhorarios?\b/, /\b(a que hora|cuando|que dias?)\b.{0,20}\b(abre|abren|cierra|cierran|se puede visitar|puedo visitar|visitas?)\b/];
/** Un horario que no es de visita: el de la oficina (contacto) o el de un recorrido (lo contesta el modelo). */
const HORARIO_DE_OTRA_COSA = /\b(mesa de entradas|oficina|atencion|atienden|direccion de cementerios|recorridos?|visitas? guiadas?)\b/;

const PIDE_CONTACTO = [
  /\b(contacto|contactar|comunicarme|telefono|telefonos|llamar|whatsapp|mail|email|correo)\b/,
  /\bmesa de entradas\b.{0,30}\b(donde|queda|direccion|horario|atiende|atienden)\b/,
  /\b(donde|a donde)\b.{0,20}\b(queda|esta|atienden|voy|tengo que ir)\b.{0,25}\b(mesa de entradas|oficina|direccion)\b/,
];

/** Por su trámite: el estado de un expediente, el número, el código del comprobante. */
const PIDE_SU_TRAMITE = [
  /\bcem\W{0,3}\d{4}\W{1,3}\d{1,6}\b/,
  /\b\d{1,6}\s*\/\s*(19|20)\d{2}\b/,
  /\b(mi|el|su|un)\s+(tramite|expediente)\b.{0,40}\b(estado|como va|en que (anda|esta|va)|donde esta|avanzo|avanza|novedad|novedades|seguimiento|consultar|consulto|salio)\b/,
  /\b(estado|seguimiento|consultar|consulto|como va|como sigue|en que (anda|esta|va)|donde esta)\b.{0,25}\b(mi|el|su)\s+(tramite|expediente)\b/,
  /\bcodigo (de consulta|del comprobante)\b/,
  /\bcomprobante\b/,
];

function lista(items: string[]): string {
  return items.map((i) => `• ${i}`).join("\n");
}

function respuestaConsulta(): RespuestaSinModelo {
  return {
    texto:
      "Yo no puedo ver los expedientes, pero vos podés seguir el tuyo en «Consultá tu trámite»: escribís el número de expediente y el código de consulta que figuran en el comprobante que te dieron en Mesa de Entradas (o escaneás el QR del comprobante). Ahí ves en qué área está y cuánto avanzó. Si perdiste el comprobante, en Mesa de Entradas te dan un código nuevo.",
    enlaces: [ENLACE.consulta, ENLACE.contacto],
    resuelta: true,
  };
}

function respuestaTramites(d: DatosPublicosMigue): RespuestaSinModelo {
  if (d.tramites === null) {
    return { texto: "Ahora no pude leer la lista de trámites. La tenés en la página de Trámites, o te la dan en Mesa de Entradas.", enlaces: [ENLACE.tramites, ENLACE.contacto], resuelta: false };
  }
  if (d.tramites.length === 0) {
    return { texto: "Todavía no hay trámites cargados en el sitio. En Mesa de Entradas te dicen qué corresponde en tu caso.", enlaces: [ENLACE.contacto], resuelta: false };
  }
  return {
    texto: `Estos son los trámites que se inician en Mesa de Entradas de la Dirección de Cementerios:\n${lista(d.tramites.map((x) => x.nombre))}\n\nEn la página de Trámites está qué hay que traer para cada uno. Preguntame por cualquiera y te cuento.`,
    enlaces: [ENLACE.tramites],
    resuelta: true,
  };
}

function horariosDe(c: DatosPublicosMigue["cementerios"][number]): string | null {
  const partes = [
    c.horarioSemana ? `de lunes a viernes, ${c.horarioSemana}` : null,
    c.horarioFinDeSemana ? `fines de semana y feriados, ${c.horarioFinDeSemana}` : null,
    c.horarioEspecial ? `(${c.horarioEspecial})` : null,
  ].filter(Boolean);
  return partes.length ? `${c.nombre}: ${partes.join("; ")}` : null;
}

function respuestaHorarios(d: DatosPublicosMigue, simple: string): RespuestaSinModelo {
  // Si nombra un cementerio, solo ese.
  const nombrado = d.cementerios.filter((c) => palabras(c.nombre).some((p) => p.length > 4 && !["cementerio"].includes(p) && simple.includes(p)));
  const elegidos = nombrado.length ? nombrado : d.cementerios;
  const renglones = elegidos.map(horariosDe).filter((x): x is string => x !== null);
  if (renglones.length === 0) {
    return {
      texto: "Todavía no hay horarios de visita cargados en el sitio. Te los dicen en Mesa de Entradas de la Dirección de Cementerios.",
      enlaces: [ENLACE.contacto],
      resuelta: false,
    };
  }
  return { texto: `Los horarios de visita:\n${lista(renglones)}`, enlaces: [ENLACE.horarios], resuelta: true };
}

function respuestaContacto(d: DatosPublicosMigue): RespuestaSinModelo {
  const c = d.contacto;
  const renglones = c
    ? [
        c.domicilio ? `Dirección: ${c.domicilio}` : null,
        c.horario ? `Horario de atención: ${c.horario}` : null,
        c.telefono ? `Teléfono: ${c.telefono}` : null,
        c.correo ? `Correo: ${c.correo}` : null,
      ].filter((x): x is string => x !== null)
    : [];
  if (renglones.length === 0) {
    return { texto: "Todavía no están cargados los datos de contacto en el sitio. Mirá la página de Contacto, que tiene también las preguntas frecuentes.", enlaces: [ENLACE.contacto], resuelta: false };
  }
  return { texto: `Mesa de Entradas de la Dirección de Cementerios:\n${lista(renglones)}`, enlaces: [ENLACE.contacto], resuelta: true };
}

export const SALUDO_PUBLICO =
  "¡Hola! Soy Migue, el asistente de la Dirección de Cementerios. Te puedo contar los horarios de visita, qué trámites se hacen y qué hay que traer, los recorridos históricos o cómo consultar tu trámite. ¿En qué te ayudo?";

export type Atajo = "saludo" | "consulta" | "tramites" | "horarios" | "contacto";

/** Qué atajo corresponde, o null (va al modelo). Pura. */
export function atajoPublico(pregunta: string, empezandoDeCero: boolean): Atajo | null {
  const simple = simplificar(pregunta);
  if (PIDE_SU_TRAMITE.some((p) => p.test(simple))) return "consulta";
  if (!empezandoDeCero) return null;
  if (ES_SOLO_UN_SALUDO.test(simple)) return "saludo";
  if (PIDE_TRAMITES.some((p) => p.test(simple))) return "tramites";
  if (PIDE_HORARIOS.some((p) => p.test(simple)) && !HORARIO_DE_OTRA_COSA.test(simple)) return "horarios";
  if (PIDE_CONTACTO.some((p) => p.test(simple))) return "contacto";
  return null;
}

export function responderAtajo(atajo: Atajo, d: DatosPublicosMigue, pregunta: string): RespuestaSinModelo {
  switch (atajo) {
    case "saludo":
      return { texto: SALUDO_PUBLICO, enlaces: [], resuelta: true };
    case "consulta":
      return respuestaConsulta();
    case "tramites":
      return respuestaTramites(d);
    case "horarios":
      return respuestaHorarios(d, simplificar(pregunta));
    case "contacto":
      return respuestaContacto(d);
  }
}

// ── El buscador ─────────────────────────────────────────────────────────

interface Ficha {
  titulo: string;
  texto: string;
  enlace: EnlaceMigue;
}

function fichas(d: DatosPublicosMigue): Ficha[] {
  const f: Ficha[] = [];
  for (const c of d.cementerios) {
    const horario = horariosDe(c);
    const texto = [c.domicilio ? `Queda en ${c.domicilio}.` : null, horario ? `Horario de visita: ${horario.slice(c.nombre.length + 2)}.` : null, c.queTiene, c.descripcion]
      .filter(Boolean)
      .join(" ");
    if (texto) f.push({ titulo: c.nombre, texto, enlace: ENLACE.cementerios });
  }
  for (const r of d.recorridos) {
    const fechas = d.fechas.filter((x) => x.recorrido === r.nombre).map((x) => x.cuando);
    const texto = [
      r.descripcion,
      r.cementerio ? `En el ${r.cementerio}.` : null,
      r.diasHora ? `Cuándo: ${r.diasHora}.` : null,
      fechas.length ? `Próximas fechas: ${fechas.join("; ")}.` : null,
      r.puntoEncuentro ? `Punto de encuentro: ${r.puntoEncuentro}.` : null,
      r.inscripcion ? `Inscripción: ${r.inscripcion}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    f.push({ titulo: `Recorrido «${r.nombre}»`, texto: texto || "Hay más datos en la página de Recorridos.", enlace: ENLACE.recorridos });
  }
  for (const n of d.novedades) f.push({ titulo: n.titulo, texto: n.texto, enlace: { href: "/", etiqueta: "Inicio" } });
  for (const p of d.preguntas) f.push({ titulo: p.pregunta, texto: p.respuesta, enlace: ENLACE.contacto });
  for (const x of d.tramites ?? []) {
    const docs = x.documentos.map((doc) => (doc.nota ? `${doc.nombre} (${doc.nota})` : doc.nombre));
    f.push({
      titulo: `Trámite: ${x.nombre}`,
      texto: docs.length ? `Qué traer: ${docs.join("; ")}. Lo que corresponde puede variar según el caso: lo confirma Mesa de Entradas.` : "Lo que hay que traer lo indica Mesa de Entradas.",
      enlace: ENLACE.tramites,
    });
  }
  return f;
}

/** La ficha que más palabras comparte con la pregunta (el título pesa el doble), si comparte lo suficiente. */
export function buscarEnDatosPublicos(pregunta: string, d: DatosPublicosMigue): RespuestaSinModelo {
  const buscadas = palabras(pregunta).filter((p) => !["cementerio", "cementerios", "migue"].includes(p));
  const puntuadas = fichas(d)
    .map((f) => {
      const enTitulo = palabras(f.titulo);
      const enTexto = palabras(f.texto);
      const puntaje = buscadas.reduce((t, b) => t + (enTitulo.some((p) => parecidas(p, b)) ? 2 : enTexto.some((p) => parecidas(p, b)) ? 1 : 0), 0);
      return { f, puntaje };
    })
    .sort((a, b) => b.puntaje - a.puntaje);
  const mejor = puntuadas[0];
  if (!mejor || buscadas.length === 0 || mejor.puntaje < Math.min(2, buscadas.length)) {
    return {
      texto:
        "Sobre eso no encontré nada en lo que publica la Dirección de Cementerios. Para consultarlo, acercate o comunicate con Mesa de Entradas: en Contacto están el domicilio, el horario y las preguntas frecuentes.",
      enlaces: [ENLACE.contacto],
      resuelta: false,
    };
  }
  return { texto: `Esto es lo que encontré:\n\n${mejor.f.titulo}. ${mejor.f.texto}`, enlaces: [mejor.f.enlace], resuelta: true };
}
