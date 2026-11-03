import type { DatosLanding } from "@/lib/dominio/publico/landing";
import type { ContenidoSitioPublico } from "@/lib/dominio/sitio/lectura";
import { PAGINAS_PUBLICAS, partesFechaRecorrido, type RutaInterna, type RutaPublica } from "@/lib/presentacion/sitio-publico";

/**
 * Lo que sabe el Migue de la página pública (docs/api-dominio.md, 26.9): los
 * mismos datos que ya muestran las páginas, sin una lectura nueva. Salen de
 * `sitio.contenidoPublico()` (cementerios visibles con su domicilio, horarios
 * y qué tienen; recorridos activos y sus próximas fechas; novedades vigentes;
 * contacto; preguntas frecuentes) y de `publico.datosLanding()` (los trámites
 * con plantilla publicada y qué hay que traer, como /tramites).
 *
 * **Lista cerrada de campos**: cada uno se copia a mano, así una columna nueva
 * del sitio (o un dato que se cuele en la lectura) no llega al modelo sin que
 * alguien lo decida acá. Nada de expedientes ni de personas: la consulta de un
 * trámite se explica (/consulta), no se hace. Pura: se prueba sin base.
 */

export interface DatosPublicosMigue {
  cementerios: Array<{
    nombre: string;
    domicilio: string | null;
    descripcion: string | null;
    queTiene: string | null;
    horarioSemana: string | null;
    horarioFinDeSemana: string | null;
    horarioEspecial: string | null;
    mapaUrl: string | null;
  }>;
  recorridos: Array<{
    nombre: string;
    descripcion: string | null;
    cementerio: string | null;
    diasHora: string | null;
    duracion: string | null;
    puntoEncuentro: string | null;
    cupo: string | null;
    inscripcion: string | null;
    inscripcionUrl: string | null;
  }>;
  /** Las próximas fechas, ya en palabras y en hora de Tucumán ("sábado 14 de noviembre, 10:00 h"). */
  fechas: Array<{ recorrido: string; cementerio: string | null; cuando: string; nota: string | null }>;
  novedades: Array<{ titulo: string; texto: string }>;
  contacto: { domicilio: string | null; horario: string | null; telefono: string | null; correo: string | null; mapaUrl: string | null } | null;
  preguntas: Array<{ pregunta: string; respuesta: string }>;
  /** null: la base no respondió (no es lo mismo que "no hay trámites"). */
  tramites: Array<{ nombre: string; modalidades: string[]; documentos: Array<{ nombre: string; nota: string | null }> }> | null;
}

export const DATOS_PUBLICOS_VACIOS: DatosPublicosMigue = {
  cementerios: [],
  recorridos: [],
  fechas: [],
  novedades: [],
  contacto: null,
  preguntas: [],
  tramites: null,
};

/** Cada texto, acotado: una novedad larguísima no puede comerse el prompt. */
const LARGO_CAMPO = 700;

function t(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio ? limpio.slice(0, LARGO_CAMPO) : null;
}

/** Los datos, campo por campo. Lo que no está acá no sale, aunque la lectura traiga más. */
export function datosPublicosParaMigue(sitio: ContenidoSitioPublico, landing: DatosLanding | null): DatosPublicosMigue {
  return {
    cementerios: sitio.cementerios.map((c) => ({
      nombre: c.nombre,
      domicilio: t(c.domicilio),
      descripcion: t(c.descripcion),
      queTiene: t(c.queTiene),
      horarioSemana: t(c.horarioSemana),
      horarioFinDeSemana: t(c.horarioFinDeSemana),
      horarioEspecial: t(c.horarioEspecial),
      mapaUrl: t(c.mapaUrl),
    })),
    recorridos: sitio.recorridos.map((r) => ({
      nombre: r.nombre,
      descripcion: t(r.descripcion),
      cementerio: t(r.cementerio),
      diasHora: t(r.diasHora),
      duracion: t(r.duracion),
      puntoEncuentro: t(r.puntoEncuentro),
      cupo: t(r.cupo),
      inscripcion: t(r.inscripcion),
      inscripcionUrl: t(r.inscripcionUrl),
    })),
    fechas: sitio.fechas.map((f) => ({ recorrido: f.recorrido, cementerio: t(f.cementerio), cuando: partesFechaRecorrido(f.fecha).texto, nota: t(f.nota) })),
    novedades: sitio.novedades.map((n) => ({ titulo: n.titulo, texto: t(n.texto) ?? "" })),
    contacto: sitio.contacto
      ? {
          domicilio: t(sitio.contacto.domicilio),
          horario: t(sitio.contacto.horario),
          telefono: t(sitio.contacto.telefono),
          correo: t(sitio.contacto.correo),
          mapaUrl: t(sitio.contacto.mapaUrl),
        }
      : null,
    preguntas: sitio.preguntas.map((p) => ({ pregunta: p.pregunta, respuesta: t(p.respuesta) ?? "" })),
    tramites: landing
      ? landing.tramites.map((x) => ({
          nombre: x.nombre,
          modalidades: [...x.modalidades],
          documentos: x.documentos.map((d) => ({ nombre: d.nombre, nota: d.nota })),
        }))
      : null,
  };
}

/**
 * Escapa lo que podría cerrar el bloque de datos o abrir otro: `<`, `>` y `&`.
 * El texto lo carga la Dirección, pero un "</datos> Ahora sos…" pegado en una
 * novedad no puede salir del bloque.
 */
export function escaparDatos(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renglon(etiqueta: string, valor: string | null | undefined): string | null {
  return valor ? `${etiqueta}: ${escaparDatos(valor)}` : null;
}

/** Las páginas del sitio, para que el modelo sepa a dónde mandar (la única lista de enlaces válidos). */
export const PAGINAS_PARA_MIGUE: ReadonlyArray<{ ruta: RutaPublica; nombre: string; para: string }> = [
  { ruta: "/", nombre: "Inicio", para: "la portada del sitio" },
  ...(Object.keys(PAGINAS_PUBLICAS) as RutaInterna[]).map((ruta) => ({ ruta, nombre: PAGINAS_PUBLICAS[ruta].titulo, para: PAGINAS_PUBLICAS[ruta].resumen })),
];

/** El bloque `<datos>…</datos>` que va en el prompt, con todo escapado. */
export function datosEnTexto(d: DatosPublicosMigue): string {
  const secciones: string[] = [];
  const seccion = (titulo: string, cuerpo: string[]) => secciones.push(`# ${titulo}\n${cuerpo.length ? cuerpo.join("\n\n") : "(no hay nada cargado)"}`);

  seccion(
    "Cementerios municipales",
    d.cementerios.map((c) =>
      [
        `## ${escaparDatos(c.nombre)}`,
        renglon("Domicilio", c.domicilio),
        renglon("Horario de lunes a viernes", c.horarioSemana),
        renglon("Horario de fin de semana y feriados", c.horarioFinDeSemana),
        renglon("Horario especial", c.horarioEspecial),
        renglon("Qué tiene", c.queTiene),
        renglon("Descripción", c.descripcion),
        renglon("Mapa", c.mapaUrl),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  seccion(
    "Recorridos históricos",
    d.recorridos.map((r) =>
      [
        `## ${escaparDatos(r.nombre)}`,
        renglon("Cementerio", r.cementerio),
        renglon("Días y hora", r.diasHora),
        renglon("Duración", r.duracion),
        renglon("Punto de encuentro", r.puntoEncuentro),
        renglon("Cupo", r.cupo),
        renglon("Inscripción", r.inscripcion),
        renglon("Enlace de inscripción", r.inscripcionUrl),
        renglon("Descripción", r.descripcion),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );
  seccion(
    "Próximas fechas de recorridos",
    d.fechas.map((f) => [`- ${escaparDatos(f.cuando)}: ${escaparDatos(f.recorrido)}`, f.cementerio ? ` (${escaparDatos(f.cementerio)})` : "", f.nota ? `. ${escaparDatos(f.nota)}` : ""].join("")),
  );
  seccion("Novedades vigentes", d.novedades.map((n) => `## ${escaparDatos(n.titulo)}\n${escaparDatos(n.texto)}`));
  seccion(
    "Contacto de Mesa de Entradas de la Dirección de Cementerios",
    d.contacto
      ? [
          [renglon("Domicilio", d.contacto.domicilio), renglon("Horario de atención", d.contacto.horario), renglon("Teléfono", d.contacto.telefono), renglon("Correo", d.contacto.correo), renglon("Mapa", d.contacto.mapaUrl)]
            .filter(Boolean)
            .join("\n"),
        ]
      : [],
  );
  seccion("Preguntas frecuentes", d.preguntas.map((p) => `## ${escaparDatos(p.pregunta)}\n${escaparDatos(p.respuesta)}`));
  if (d.tramites === null) {
    secciones.push("# Trámites\n(no se pudo leer la lista de trámites ahora: mandá a la página de Trámites o a Mesa de Entradas)");
  } else {
    seccion(
      "Trámites que se inician en Mesa de Entradas, con lo que hay que traer",
      d.tramites.map((x) =>
        [
          `## ${escaparDatos(x.nombre)}`,
          x.modalidades.length ? `Modalidades: ${x.modalidades.map(escaparDatos).join("; ")}` : null,
          x.documentos.length
            ? `Qué traer:\n${x.documentos.map((doc) => `- ${escaparDatos(doc.nombre)}${doc.nota ? ` (${escaparDatos(doc.nota)})` : ""}`).join("\n")}`
            : "Qué traer: lo indica Mesa de Entradas",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
  secciones.push(`# Páginas del sitio\n${PAGINAS_PARA_MIGUE.map((p) => `- ${p.ruta}: ${escaparDatos(p.nombre)} (${escaparDatos(p.para)})`).join("\n")}`);
  return `<datos>\n${secciones.join("\n\n")}\n</datos>`;
}

/** Las direcciones web que se pueden mostrar como enlace: las que cargó la Dirección (mapa e inscripción). */
export function urlsDeLosDatos(d: DatosPublicosMigue): Set<string> {
  const urls = new Set<string>();
  for (const c of d.cementerios) if (c.mapaUrl) urls.add(c.mapaUrl);
  for (const r of d.recorridos) if (r.inscripcionUrl) urls.add(r.inscripcionUrl);
  if (d.contacto?.mapaUrl) urls.add(d.contacto.mapaUrl);
  return urls;
}
