import { z } from "zod";
import type { AvisoDuplicado, DatosCompletos, ServicioExpedientes } from "@/lib/dominio/expedientes";
import { errorValidacion } from "@/lib/dominio/expedientes/errores";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { rutaFicha, rutaImprimir } from "./enlaces";
import { estadoDeError, type EstadoError } from "./errores";

/**
 * La lógica de las Server Actions de los formularios de expedientes, sin Next:
 * recibe el servicio del dominio y el usuario de la sesión, lee el FormData y
 * devuelve un estado serializable (o a dónde navegar). Las acciones de
 * src/app/(app)/expedientes/acciones.ts solo ponen la sesión, el servicio de
 * la app y el `redirect()`; los tests de integración llaman a esto con el
 * servicio de la base de prueba.
 *
 * No reimplementa reglas: todo lo valida el dominio. Acá solo se traduce.
 */

export type ResultadoFormulario = { ok: true; destino: string } | EstadoError;

const FORMULARIO_INCOMPLETO = "El formulario llegó incompleto: recargá la página y volvé a intentar";

function campo(form: FormData, nombre: string): string | null {
  const v = form.get(nombre);
  return typeof v === "string" ? v : null;
}

function json(form: FormData, nombre: string): unknown {
  const v = campo(form, nombre);
  if (v === null) throw errorValidacion([], FORMULARIO_INCOMPLETO);
  try {
    return JSON.parse(v) as unknown;
  } catch {
    throw errorValidacion([], FORMULARIO_INCOMPLETO);
  }
}

/**
 * Alta. FormData: `datos` (JSON de `DatosAlta`), `comandoId` (generado al abrir
 * el formulario) y `destino` (`caratula`, el botón predeterminado, o `ficha`).
 */
export async function procesarAlta(servicio: ServicioExpedientes, usuario: UsuarioPermisos, form: FormData): Promise<ResultadoFormulario> {
  try {
    const r = await servicio.alta(usuario, json(form, "datos"), campo(form, "comandoId") ?? "");
    const destino = campo(form, "destino") === "ficha" ? rutaFicha(r.numero) : rutaImprimir(r.numero, "caratula");
    return { ok: true, destino };
  } catch (e) {
    return estadoDeError(e);
  }
}

/** Aviso que muestra la ficha después de guardar una edición. */
export const AVISO_EDITADO = "editado";

/**
 * Edición. FormData: `datos` (JSON de `CambiosEdicion`), `versionVista`,
 * `motivo` (puede venir vacío) y `comandoId`.
 */
export async function procesarEdicion(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  form: FormData,
): Promise<ResultadoFormulario> {
  try {
    const version = Number(campo(form, "versionVista"));
    if (!Number.isSafeInteger(version) || version < 0) throw errorValidacion([], FORMULARIO_INCOMPLETO);
    const motivo = campo(form, "motivo");
    const r = await servicio.editar(
      usuario,
      numero,
      json(form, "datos"),
      version,
      motivo && motivo.trim() !== "" ? motivo : null,
      campo(form, "comandoId") ?? "",
    );
    return { ok: true, destino: `${rutaFicha(r.numero)}?aviso=${AVISO_EDITADO}` };
  } catch (e) {
    return estadoDeError(e);
  }
}

export type ResultadoDatosCompletos = { ok: true; datos: DatosCompletos } | EstadoError;

/** "Ver datos completos" con su motivo (decisión 13). */
export async function procesarVerDatos(
  servicio: ServicioExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  motivo: string,
  ip: string | null,
): Promise<ResultadoDatosCompletos> {
  try {
    return { ok: true, datos: await servicio.verDatosCompletos(usuario, numero, motivo, { ip }) };
  } catch (e) {
    return estadoDeError(e);
  }
}

const ConsultaDuplicados = z.object({
  cementerioId: z.int().positive(),
  ubicacion: z.record(z.string().max(40), z.string().max(80).nullable()).optional(),
  padron: z.string().max(60).nullish(),
  numeroMunicipal: z.string().max(60).nullish(),
  excluirNumero: z.string().max(30).nullish(),
});

/**
 * Posibles duplicados mientras se carga el formulario. Es un aviso: si la
 * consulta no tiene forma o falla por un permiso, no hay aviso (el alta y la
 * edición devuelven lo mismo al guardar).
 */
export async function procesarDuplicados(servicio: ServicioExpedientes, usuario: UsuarioPermisos, consulta: unknown): Promise<AvisoDuplicado[]> {
  const r = ConsultaDuplicados.safeParse(consulta);
  if (!r.success) return [];
  try {
    return await servicio.avisosDuplicados(usuario, r.data);
  } catch (e) {
    estadoDeError(e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Semana 3: las acciones del flujo (diálogos de la ficha y bandeja)
// ---------------------------------------------------------------------------

/**
 * Lo que devuelve una acción del flujo: la `version` nueva (para la próxima
 * acción sin esperar a que se recargue la ficha) y un aviso para mostrar.
 */
export type ResultadoFlujo = { ok: true; version: number; repetido: boolean; mensaje: string } | EstadoError;

const Version = z.int().min(0);
const Comando = z.string().max(100);
const Texto = z.string().max(2000);
const Fecha = z.string().max(40).nullish();

const Base = z.object({ numero: z.string().min(1).max(40), versionVista: Version, comandoId: Comando });

/** Lee la entrada de una Server Action (que llega del navegador: no se confía en su forma). */
function entrada<T extends z.ZodType>(esquema: T, valor: unknown): z.infer<T> {
  const r = esquema.safeParse(valor);
  if (!r.success) throw errorValidacion([], FORMULARIO_INCOMPLETO);
  return r.data;
}

const vacioANull = (v: string | null | undefined) => (v === undefined || v === null || v.trim() === "" ? null : v);

const EntradaRecepcion = Base.extend({ fechaEfectiva: Fecha });
export type EntradaRecepcion = z.input<typeof EntradaRecepcion>;

/** Confirmar la recepción desde la ficha o desde la fila de la bandeja. */
export async function procesarRecepcion(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = entrada(EntradaRecepcion, valor);
    const r = await servicio.confirmarRecepcion(usuario, d.numero, d.versionVista, d.comandoId, { fechaEfectiva: vacioANull(d.fechaEfectiva) });
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Recepción de ${r.numero} confirmada.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaLote = z.object({
  seleccion: z.array(z.object({ numero: z.string().min(1).max(40), version: Version })).min(1).max(200),
  comandoId: Comando,
});
export type EntradaLote = z.input<typeof EntradaLote>;
export type ResultadoLote =
  | { ok: true; resultados: Array<{ ok: true; numero: string } | { ok: false; numero: string; codigo: string; mensaje: string }> }
  | EstadoError;

/** "Confirmar seleccionados" de la pestaña Por confirmar: cada expediente por su lado. */
export async function procesarRecepciones(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoLote> {
  try {
    const d = entrada(EntradaLote, valor);
    const r = await servicio.confirmarRecepciones(usuario, d.seleccion, d.comandoId);
    return {
      ok: true,
      resultados: r.map((x) => (x.ok ? { ok: true as const, numero: x.numero } : { ok: false as const, numero: x.numero, codigo: x.codigo, mensaje: x.mensaje })),
    };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaSubtarea = Base.extend({
  clave: z.string().min(1).max(80),
  hecha: z.boolean(),
  dato: z.string().max(400).nullish(),
  motivo: Texto.nullish(),
  observacion: Texto.nullish(),
  fechaEfectiva: Fecha,
});
export type EntradaSubtarea = z.input<typeof EntradaSubtarea>;

/** Tildar (con su dato) o destildar (con motivo) una subtarea del paso actual. */
export async function procesarSubtarea(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = entrada(EntradaSubtarea, valor);
    const opciones = { fechaEfectiva: vacioANull(d.fechaEfectiva), observacion: vacioANull(d.observacion) };
    const r = d.hecha
      ? await servicio.tildarSubtarea(usuario, d.numero, d.clave, vacioANull(d.dato), d.versionVista, d.comandoId, opciones)
      : await servicio.destildarSubtarea(usuario, d.numero, d.clave, vacioANull(d.motivo), d.versionVista, d.comandoId, opciones);
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: r.hecha ? "Subtarea tildada." : "Subtarea destildada." };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaDocumento = Base.extend({
  clave: z.string().min(1).max(80),
  estado: z.enum(["presentado", "no_corresponde", "pendiente"]),
  observacion: Texto.nullish(),
});
export type EntradaDocumento = z.input<typeof EntradaDocumento>;

const TEXTO_ESTADO_DOCUMENTO = { presentado: "presentado", no_corresponde: "no corresponde", pendiente: "pendiente" } as const;

/** Marcar un documento: presentado, no corresponde (con observación) o de vuelta a pendiente. */
export async function procesarDocumento(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = entrada(EntradaDocumento, valor);
    const r = await servicio.marcarDocumento(usuario, d.numero, d.clave, d.estado, vacioANull(d.observacion), d.versionVista, d.comandoId);
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Documento marcado como ${TEXTO_ESTADO_DOCUMENTO[r.estado]}.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaPase = Base.extend({
  pasoDestino: z.string().min(1).max(80),
  fechaEfectiva: Fecha,
  motivo: Texto.nullish(),
  observacion: Texto.nullish(),
});
export type EntradaPase = z.input<typeof EntradaPase>;

/** Dar el pase (desde el diálogo de la ficha o el "Dar pase rápido" de la bandeja). */
export async function procesarPase(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = entrada(EntradaPase, valor);
    const r = await servicio.darPase(usuario, d.numero, d.pasoDestino, d.versionVista, d.comandoId, {
      fechaEfectiva: vacioANull(d.fechaEfectiva),
      motivo: vacioANull(d.motivo),
      observacion: vacioANull(d.observacion),
    });
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Pase dado a ${r.paso.nombre} (${r.areaActual.nombre}).` };
  } catch (e) {
    return estadoDeError(e);
  }
}

const EntradaDevolucion = Base.extend({
  pasoDestino: z.string().min(1).max(80),
  motivo: Texto.nullish(),
  subtareas: z.array(z.string().min(1).max(80)).max(100).default([]),
  fechaEfectiva: Fecha,
  observacion: Texto.nullish(),
});
export type EntradaDevolucion = z.input<typeof EntradaDevolucion>;

/** Devolver a un paso anterior, con motivo y las subtareas que hay que rehacer. */
export async function procesarDevolucion(servicio: ServicioExpedientes, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoFlujo> {
  try {
    const d = entrada(EntradaDevolucion, valor);
    const r = await servicio.devolver(usuario, d.numero, d.pasoDestino, vacioANull(d.motivo), d.subtareas, d.versionVista, d.comandoId, {
      fechaEfectiva: vacioANull(d.fechaEfectiva),
      observacion: vacioANull(d.observacion),
    });
    return { ok: true, version: r.version, repetido: r.repetido, mensaje: `Expediente devuelto a ${r.paso.nombre}.` };
  } catch (e) {
    return estadoDeError(e);
  }
}

// Para las acciones de la semana 4 (./acciones-estados.ts): la misma lectura de la entrada.
export { Base as BaseAccion, entrada as leerEntrada, vacioANull, Texto as TextoAccion, Fecha as FechaAccion, FORMULARIO_INCOMPLETO };
