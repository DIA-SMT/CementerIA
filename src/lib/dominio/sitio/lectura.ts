import { fechaDesdeDb, fechaParaDb, hoyEnTucuman } from "@/lib/fechas";
import type { ContactoSitio, LectorSitio } from "./admin";
import { fechasProximas, fotoSitio, MAXIMO_FECHAS_PROXIMAS, novedadVigente, type FotoSitio } from "./validacion";

/**
 * Lo que muestran las páginas públicas (`/`, `/cementerios`, `/horarios`…)
 * del contenido que carga la Dirección (28/10/2026; docs/api-dominio.md,
 * sección 25). Solo lecturas, sin sesión.
 * Arranca vacío en producción: cada parte dice qué hacer cuando no hay nada.
 *
 * - Cementerios: siempre los activos del catálogo, salvo los que la Dirección
 *   marcó como no visibles; de cada uno, solo lo cargado.
 * - Recorridos: los activos, por orden; las fechas que vienen de esos
 *   recorridos, hasta 6, de la más cercana a la más lejana.
 * - Novedades: las activas y vigentes hoy (día de Tucumán).
 * - Contacto: `null` si no hay ningún dato.
 * - Preguntas: las activas, por orden.
 */

export interface CementerioPublico {
  id: number;
  nombre: string;
  domicilio: string | null;
  mapaUrl: string | null;
  descripcion: string | null;
  queTiene: string | null;
  horarioSemana: string | null;
  horarioFinDeSemana: string | null;
  horarioEspecial: string | null;
  foto: FotoSitio | null;
}

export interface RecorridoPublico {
  id: number;
  nombre: string;
  descripcion: string | null;
  cementerio: string | null;
  diasHora: string | null;
  duracion: string | null;
  puntoEncuentro: string | null;
  cupo: string | null;
  inscripcion: string | null;
  inscripcionUrl: string | null;
  foto: FotoSitio | null;
}

export interface FechaRecorridoPublica {
  id: number;
  fecha: Date;
  recorrido: string;
  cementerio: string | null;
  nota: string | null;
}

export interface NovedadPublica {
  id: number;
  titulo: string;
  texto: string;
}

export interface PreguntaPublica {
  id: number;
  pregunta: string;
  respuesta: string;
}

export interface ContenidoSitioPublico {
  cementerios: CementerioPublico[];
  /** Si algún cementerio tiene algún horario cargado (si no, la sección remite a Mesa de Entradas). */
  hayHorarios: boolean;
  recorridos: RecorridoPublico[];
  fechas: FechaRecorridoPublica[];
  novedades: NovedadPublica[];
  contacto: ContactoSitio | null;
  preguntas: PreguntaPublica[];
}

export async function contenidoSitioPublico(
  leer: Pick<LectorSitio, "cementerio" | "sitioRecorrido" | "sitioRecorridoFecha" | "sitioNovedad" | "sitioContacto" | "sitioPregunta">,
  ahora: Date = new Date(),
): Promise<ContenidoSitioPublico> {
  const hoy = hoyEnTucuman(ahora);
  const cementerios = await leer.cementerio.findMany({
    where: { activo: true, OR: [{ sitio: { is: null } }, { sitio: { is: { visible: true } } }] },
    orderBy: { id: "asc" },
    include: { sitio: true },
  });
  const recorridos = await leer.sitioRecorrido.findMany({
    where: { activo: true },
    orderBy: [{ orden: "asc" }, { id: "asc" }],
    include: { cementerio: { select: { nombre: true } } },
  });
  const fechas = await leer.sitioRecorridoFecha.findMany({
    where: { fecha: { gt: ahora }, recorrido: { activo: true } },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    take: MAXIMO_FECHAS_PROXIMAS,
    include: { recorrido: { select: { nombre: true, cementerio: { select: { nombre: true } } } } },
  });
  // El filtro grueso en la base (por día) y el fino acá, con la misma regla que la pantalla de administración.
  const hoyDb = fechaParaDb(hoy);
  const novedades = await leer.sitioNovedad.findMany({
    where: { activa: true, desde: { lte: hoyDb }, hasta: { gte: hoyDb } },
    orderBy: [{ desde: "desc" }, { id: "desc" }],
  });
  const contacto = await leer.sitioContacto.findUnique({ where: { id: 1 } });
  const preguntas = await leer.sitioPregunta.findMany({ where: { activa: true }, orderBy: [{ orden: "asc" }, { id: "asc" }] });

  const publicos: CementerioPublico[] = cementerios.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    domicilio: c.sitio?.domicilio ?? null,
    mapaUrl: c.sitio?.mapaUrl ?? null,
    descripcion: c.sitio?.descripcion ?? null,
    queTiene: c.sitio?.queTiene ?? null,
    horarioSemana: c.sitio?.horarioSemana ?? null,
    horarioFinDeSemana: c.sitio?.horarioFinDeSemana ?? null,
    horarioEspecial: c.sitio?.horarioEspecial ?? null,
    foto: fotoSitio(c.sitio?.foto),
  }));
  const datosContacto = contacto
    ? { domicilio: contacto.domicilio, horario: contacto.horario, telefono: contacto.telefono, correo: contacto.correo, mapaUrl: contacto.mapaUrl }
    : null;

  return {
    cementerios: publicos,
    hayHorarios: publicos.some((c) => c.horarioSemana || c.horarioFinDeSemana || c.horarioEspecial),
    recorridos: recorridos.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion,
      cementerio: r.cementerio?.nombre ?? null,
      diasHora: r.diasHora,
      duracion: r.duracion,
      puntoEncuentro: r.puntoEncuentro,
      cupo: r.cupo,
      inscripcion: r.inscripcion,
      inscripcionUrl: r.inscripcionUrl,
      foto: fotoSitio(r.foto),
    })),
    fechas: fechasProximas(fechas, ahora).map((f) => ({
      id: f.id,
      fecha: f.fecha,
      recorrido: f.recorrido.nombre,
      cementerio: f.recorrido.cementerio?.nombre ?? null,
      nota: f.nota,
    })),
    novedades: novedades
      .filter((n) => novedadVigente({ activa: n.activa, desde: fechaDesdeDb(n.desde), hasta: fechaDesdeDb(n.hasta) }, hoy))
      .map((n) => ({ id: n.id, titulo: n.titulo, texto: n.texto })),
    contacto: datosContacto && Object.values(datosContacto).some((v) => v !== null) ? datosContacto : null,
    preguntas: preguntas.map((p) => ({ id: p.id, pregunta: p.pregunta, respuesta: p.respuesta })),
  };
}
