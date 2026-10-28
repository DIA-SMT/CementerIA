import { isDeepStrictEqual } from "node:util";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { comoDatetimeLocal, fechaDesdeDb, fechaParaDb, hoyEnTucuman, interpretarDatetimeLocal, type FechaISO } from "@/lib/fechas";
import { ErrorDominio, errorValidacion, limpiarMotivo } from "../expedientes/errores";
import type { Escritor } from "../expedientes/dependencias";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import {
  EntradaCementerioSitio,
  EntradaContacto,
  EntradaFechaRecorrido,
  EntradaNovedad,
  EntradaPregunta,
  EntradaRecorrido,
  leerEntradaSitio,
  novedadVigente,
} from "./validacion";

/**
 * La administración del sitio público (28/10/2026; docs/api-dominio.md,
 * sección 25): lo que carga la Dirección desde /admin/sitio-publico. Permiso
 * `editar_sitio_publico` (Dirección y el admin; los operadores no).
 *
 * Cada escritura va con `conActor()`: el trigger `auditar_cambio` la deja en
 * auditoria.cambios con el antes, el después, el autor y el motivo. Un
 * guardado que no cambia nada no escribe (así no deja una fila de auditoría
 * vacía ni mueve `actualizado_en`). No hay DELETE salvo para fechas de
 * recorrido y novedades: lo demás se desactiva.
 */

type MetodosDeLectura = "findUnique" | "findFirst" | "findMany" | "count";
type SoloLectura<D> = Pick<D, Extract<keyof D, MetodosDeLectura>>;

/** Lo que lee la administración del sitio (el cliente global o un `tx`). */
export interface LectorSitio {
  cementerio: SoloLectura<Transaccion["cementerio"]>;
  sitioCementerio: SoloLectura<Transaccion["sitioCementerio"]>;
  sitioRecorrido: SoloLectura<Transaccion["sitioRecorrido"]>;
  sitioRecorridoFecha: SoloLectura<Transaccion["sitioRecorridoFecha"]>;
  sitioNovedad: SoloLectura<Transaccion["sitioNovedad"]>;
  sitioContacto: SoloLectura<Transaccion["sitioContacto"]>;
  sitioPregunta: SoloLectura<Transaccion["sitioPregunta"]>;
}

export interface DependenciasSitio {
  leer: LectorSitio;
  /** `conActor()`. */
  escribir: Escritor;
  ahora?: () => Date;
}

export interface ResultadoSitio {
  id: number;
  creado: boolean;
  /** No había nada que cambiar: no se escribió. */
  repetido: boolean;
}

// ---------------------------------------------------------------------------
// Lectura para la pantalla
// ---------------------------------------------------------------------------

export interface FilaCementerioSitio {
  cementerioId: number;
  codigo: string;
  nombre: string;
  /** Si el cementerio está activo en el catálogo (uno inactivo no sale en la página). */
  activoEnCatalogo: boolean;
  /** Si ya tiene fila en sitio_cementerios. */
  cargado: boolean;
  visible: boolean;
  domicilio: string | null;
  mapaUrl: string | null;
  descripcion: string | null;
  queTiene: string | null;
  horarioSemana: string | null;
  horarioFinDeSemana: string | null;
  horarioEspecial: string | null;
  foto: string | null;
}

export interface FilaFechaRecorrido {
  id: number;
  fecha: Date;
  /** Para precargar un `datetime-local`. */
  fechaLocal: string;
  nota: string | null;
  pasada: boolean;
}

export interface FilaRecorrido {
  id: number;
  nombre: string;
  descripcion: string | null;
  cementerioId: number | null;
  cementerio: string | null;
  diasHora: string | null;
  duracion: string | null;
  puntoEncuentro: string | null;
  cupo: string | null;
  inscripcion: string | null;
  inscripcionUrl: string | null;
  foto: string | null;
  activo: boolean;
  orden: number;
  /** Las fechas que vienen y, para no perderlas de vista, las de los últimos 30 días. */
  fechas: FilaFechaRecorrido[];
}

export interface FilaNovedad {
  id: number;
  titulo: string;
  texto: string;
  desde: FechaISO;
  hasta: FechaISO;
  activa: boolean;
  /** Si hoy se ve en la página. */
  vigente: boolean;
  /** Para la lista: se ve hoy, todavía no empezó, ya terminó o está desactivada. */
  estado: "vigente" | "programada" | "terminada" | "inactiva";
}

export interface ContactoSitio {
  domicilio: string | null;
  horario: string | null;
  telefono: string | null;
  correo: string | null;
  mapaUrl: string | null;
}

export interface FilaPregunta {
  id: number;
  pregunta: string;
  respuesta: string;
  orden: number;
  activa: boolean;
}

export interface ContenidoSitioAdmin {
  cementerios: FilaCementerioSitio[];
  recorridos: FilaRecorrido[];
  novedades: FilaNovedad[];
  contacto: ContactoSitio;
  preguntas: FilaPregunta[];
}

const CONTACTO_VACIO: ContactoSitio = { domicilio: null, horario: null, telefono: null, correo: null, mapaUrl: null };

/** Las fechas pasadas que la pantalla todavía muestra (para corregir una mal cargada). */
const DIAS_FECHAS_PASADAS = 30;

/** Todo lo del sitio, para /admin/sitio-publico. Lecturas en serie (el lector puede ser un `tx`). */
export async function contenidoSitioAdmin(deps: DependenciasSitio, usuario: UsuarioPermisos): Promise<ContenidoSitioAdmin> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const l = deps.leer;
  const ahora = deps.ahora?.() ?? new Date();
  const hoy = hoyEnTucuman(ahora);
  const cementerios = await l.cementerio.findMany({ orderBy: { id: "asc" }, include: { sitio: true } });
  const recorridos = await l.sitioRecorrido.findMany({
    orderBy: [{ orden: "asc" }, { id: "asc" }],
    include: {
      cementerio: { select: { nombre: true } },
      fechas: { where: { fecha: { gte: new Date(ahora.getTime() - DIAS_FECHAS_PASADAS * 86_400_000) } }, orderBy: { fecha: "asc" } },
    },
  });
  const novedades = await l.sitioNovedad.findMany({ orderBy: [{ desde: "desc" }, { id: "desc" }] });
  const contacto = await l.sitioContacto.findUnique({ where: { id: 1 } });
  const preguntas = await l.sitioPregunta.findMany({ orderBy: [{ orden: "asc" }, { id: "asc" }] });

  return {
    cementerios: cementerios.map((c) => ({
      cementerioId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      activoEnCatalogo: c.activo,
      cargado: c.sitio !== null,
      visible: c.sitio?.visible ?? true,
      domicilio: c.sitio?.domicilio ?? null,
      mapaUrl: c.sitio?.mapaUrl ?? null,
      descripcion: c.sitio?.descripcion ?? null,
      queTiene: c.sitio?.queTiene ?? null,
      horarioSemana: c.sitio?.horarioSemana ?? null,
      horarioFinDeSemana: c.sitio?.horarioFinDeSemana ?? null,
      horarioEspecial: c.sitio?.horarioEspecial ?? null,
      foto: c.sitio?.foto ?? null,
    })),
    recorridos: recorridos.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion,
      cementerioId: r.cementerioId,
      cementerio: r.cementerio?.nombre ?? null,
      diasHora: r.diasHora,
      duracion: r.duracion,
      puntoEncuentro: r.puntoEncuentro,
      cupo: r.cupo,
      inscripcion: r.inscripcion,
      inscripcionUrl: r.inscripcionUrl,
      foto: r.foto,
      activo: r.activo,
      orden: r.orden,
      fechas: r.fechas.map((f) => ({ id: f.id, fecha: f.fecha, fechaLocal: comoDatetimeLocal(f.fecha), nota: f.nota, pasada: f.fecha.getTime() <= ahora.getTime() })),
    })),
    novedades: novedades.map((n) => {
      const fila = { id: n.id, titulo: n.titulo, texto: n.texto, desde: fechaDesdeDb(n.desde), hasta: fechaDesdeDb(n.hasta), activa: n.activa };
      const vigente = novedadVigente(fila, hoy);
      const estado = !n.activa ? "inactiva" : vigente ? "vigente" : fila.desde > hoy ? "programada" : "terminada";
      return { ...fila, vigente, estado };
    }),
    contacto: contacto
      ? { domicilio: contacto.domicilio, horario: contacto.horario, telefono: contacto.telefono, correo: contacto.correo, mapaUrl: contacto.mapaUrl }
      : CONTACTO_VACIO,
    preguntas: preguntas.map((p) => ({ id: p.id, pregunta: p.pregunta, respuesta: p.respuesta, orden: p.orden, activa: p.activa })),
  };
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** Si los campos nuevos ya están todos iguales en la fila. */
function sinCambios(actual: object, nuevo: Record<string, unknown>): boolean {
  return Object.entries(nuevo).every(([k, v]) => isDeepStrictEqual((actual as Record<string, unknown>)[k], v));
}

function noExiste(que: string): ErrorDominio {
  return new ErrorDominio("no_encontrado", `No existe ${que}: puede que otra persona lo haya quitado. Recargá la página.`);
}

/**
 * Los datos públicos de un cementerio del catálogo (alta la primera vez, después
 * modificación). El cementerio no se crea acá: es el del catálogo.
 *
 * @throws ErrorDominio `validacion`, `no_encontrado`
 */
export async function guardarCementerioSitio(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const { cementerioId, ...datos } = leerEntradaSitio(EntradaCementerioSitio, entrada);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const cementerio = await tx.cementerio.findUnique({ where: { id: cementerioId }, include: { sitio: true } });
    if (!cementerio) throw noExiste("ese cementerio");
    if (cementerio.sitio) {
      if (sinCambios(cementerio.sitio, datos)) return { id: cementerioId, creado: false, repetido: true };
      await tx.sitioCementerio.update({ where: { cementerioId }, data: datos });
      return { id: cementerioId, creado: false, repetido: false };
    }
    await tx.sitioCementerio.create({ data: { cementerioId, ...datos } });
    return { id: cementerioId, creado: true, repetido: false };
  });
}

/**
 * Alta (sin `id`) o modificación de un recorrido. La baja es `activo = false`.
 *
 * @throws ErrorDominio `validacion`, `no_encontrado`
 */
export async function guardarRecorrido(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const { id, ...datos } = leerEntradaSitio(EntradaRecorrido, entrada);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    if (datos.cementerioId !== null && !(await tx.cementerio.findUnique({ where: { id: datos.cementerioId } }))) {
      throw errorValidacion([{ ruta: "cementerioId", mensaje: "Ese cementerio no existe" }]);
    }
    if (id == null) {
      const r = await tx.sitioRecorrido.create({ data: datos, select: { id: true } });
      return { id: r.id, creado: true, repetido: false };
    }
    const actual = await tx.sitioRecorrido.findUnique({ where: { id } });
    if (!actual) throw noExiste("ese recorrido");
    if (sinCambios(actual, datos)) return { id, creado: false, repetido: true };
    await tx.sitioRecorrido.update({ where: { id }, data: datos });
    return { id, creado: false, repetido: false };
  });
}

/**
 * Una fecha nueva de un recorrido: fecha y hora de Tucumán (`datetime-local`),
 * que tiene que ser futura (una pasada no se mostraría nunca).
 *
 * @throws ErrorDominio `validacion`, `no_encontrado`, `ya_existe`
 */
export async function agregarFechaRecorrido(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const d = leerEntradaSitio(EntradaFechaRecorrido, entrada);
  let fecha: Date;
  try {
    fecha = interpretarDatetimeLocal(d.fecha);
  } catch {
    throw errorValidacion([{ ruta: "fecha", mensaje: "Elegí la fecha y la hora" }]);
  }
  const ahora = deps.ahora?.() ?? new Date();
  if (fecha.getTime() <= ahora.getTime()) throw errorValidacion([{ ruta: "fecha", mensaje: "Tiene que ser una fecha que todavía no pasó" }]);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    if (!(await tx.sitioRecorrido.findUnique({ where: { id: d.recorridoId } }))) throw noExiste("ese recorrido");
    if (await tx.sitioRecorridoFecha.findFirst({ where: { recorridoId: d.recorridoId, fecha } })) {
      throw new ErrorDominio("ya_existe", "Ese recorrido ya tiene esa fecha y hora", [{ ruta: "fecha", mensaje: "Ya está cargada" }]);
    }
    const f = await tx.sitioRecorridoFecha.create({ data: { recorridoId: d.recorridoId, fecha, nota: d.nota }, select: { id: true } });
    return { id: f.id, creado: true, repetido: false };
  });
}

/** Quita una fecha de recorrido (queda en la auditoría). Si ya no estaba, `repetido`. */
export async function quitarFechaRecorrido(deps: DependenciasSitio, usuario: UsuarioPermisos, id: number, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const r = await tx.sitioRecorridoFecha.deleteMany({ where: { id } });
    return { id, creado: false, repetido: r.count === 0 };
  });
}

/**
 * Alta o modificación de una novedad (vigente de `desde` a `hasta`, si está activa).
 *
 * @throws ErrorDominio `validacion`, `no_encontrado`
 */
export async function guardarNovedad(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const { id, desde, hasta, ...resto } = leerEntradaSitio(EntradaNovedad, entrada);
  const datos = { ...resto, desde: fechaParaDb(desde), hasta: fechaParaDb(hasta) };
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    if (id == null) {
      const n = await tx.sitioNovedad.create({ data: datos, select: { id: true } });
      return { id: n.id, creado: true, repetido: false };
    }
    const actual = await tx.sitioNovedad.findUnique({ where: { id } });
    if (!actual) throw noExiste("esa novedad");
    if (sinCambios(actual, datos)) return { id, creado: false, repetido: true };
    await tx.sitioNovedad.update({ where: { id }, data: datos });
    return { id, creado: false, repetido: false };
  });
}

/** Quita una novedad (queda en la auditoría). Para dejar de mostrarla sin borrarla, se desactiva. */
export async function quitarNovedad(deps: DependenciasSitio, usuario: UsuarioPermisos, id: number, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const r = await tx.sitioNovedad.deleteMany({ where: { id } });
    return { id, creado: false, repetido: r.count === 0 };
  });
}

/** El contacto de Mesa de Entradas (una sola fila). Lo que queda vacío no se muestra. */
export async function guardarContacto(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const datos = leerEntradaSitio(EntradaContacto, entrada);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const actual = await tx.sitioContacto.findUnique({ where: { id: 1 } });
    if (actual) {
      if (sinCambios(actual, datos)) return { id: 1, creado: false, repetido: true };
      await tx.sitioContacto.update({ where: { id: 1 }, data: datos });
      return { id: 1, creado: false, repetido: false };
    }
    await tx.sitioContacto.create({ data: { id: 1, ...datos } });
    return { id: 1, creado: true, repetido: false };
  });
}

/**
 * Alta o modificación de una pregunta frecuente. La baja es `activa = false`.
 *
 * @throws ErrorDominio `validacion`, `no_encontrado`
 */
export async function guardarPregunta(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoSitio> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const { id, ...datos } = leerEntradaSitio(EntradaPregunta, entrada);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    if (id == null) {
      const p = await tx.sitioPregunta.create({ data: datos, select: { id: true } });
      return { id: p.id, creado: true, repetido: false };
    }
    const actual = await tx.sitioPregunta.findUnique({ where: { id } });
    if (!actual) throw noExiste("esa pregunta");
    if (sinCambios(actual, datos)) return { id, creado: false, repetido: true };
    await tx.sitioPregunta.update({ where: { id }, data: datos });
    return { id, creado: false, repetido: false };
  });
}
