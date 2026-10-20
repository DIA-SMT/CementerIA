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
