"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirUsuario } from "@/lib/auth/sesion";
import { expedientes, type AvisoDuplicado } from "@/lib/dominio/expedientes/servidor";
import {
  procesarAlta,
  procesarDevolucion,
  procesarDocumento,
  procesarDuplicados,
  procesarEdicion,
  procesarPase,
  procesarRecepcion,
  procesarRecepciones,
  procesarSubtarea,
  procesarIntegridad,
  procesarVerDatos,
  type EntradaDevolucion,
  type EntradaDocumento,
  type EntradaLote,
  type EntradaPase,
  type EntradaRecepcion,
  type EntradaSubtarea,
  type ResultadoDatosCompletos,
  type ResultadoFlujo,
  type ResultadoLote,
  type ResultadoVerificacion,
} from "@/lib/presentacion/acciones";
import {
  procesarCorreccion,
  procesarEstado,
  procesarEstadoHistorico,
  procesarNota,
  procesarReinicio,
  procesarSubtareaHistorica,
  procesarSupresion,
  procesarTerminarCarga,
  procesarTranscripcion,
  procesarVinculado,
  type EntradaCorreccion,
  type EntradaEstado,
  type EntradaEstadoHistorico,
  type EntradaNota,
  type EntradaReinicio,
  type EntradaSubtareaHistorica,
  type EntradaSupresion,
  type EntradaTranscripcion,
  type EntradaVinculado,
  type ResultadoTranscripcionPantalla,
} from "@/lib/presentacion/acciones-estados";
import type { EstadoError, EstadoFormulario } from "@/lib/presentacion/errores";

/**
 * Server Actions de las pantallas de expedientes. Cada una vuelve a pedir el
 * usuario de la sesión (la página no es la barrera) y delega en
 * src/lib/presentacion/acciones.ts, que llama al dominio: los permisos y las
 * validaciones son los del dominio, no los de la pantalla.
 *
 * `redirect()` va fuera de cualquier try: tira una excepción propia de Next.
 */

/** Alta: guarda y va a la carátula ("Guardar e imprimir carátula") o a la ficha ("Guardar"). */
export async function guardarAlta(_anterior: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const usuario = await exigirUsuario();
  const r = await procesarAlta(expedientes, usuario, form);
  if (r.ok) redirect(r.destino);
  return r;
}

/** Edición: guarda y vuelve a la ficha. El número va ligado con `bind`. */
export async function guardarEdicion(numero: string, _anterior: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const usuario = await exigirUsuario();
  const r = await procesarEdicion(expedientes, usuario, numero, form);
  if (r.ok) redirect(r.destino);
  return r;
}

/** "Ver datos completos": devuelve el contacto sin enmascarar y deja el motivo en auditoria.accesos. */
export async function verDatosCompletos(numero: string, motivo: string): Promise<ResultadoDatosCompletos> {
  const usuario = await exigirUsuario();
  return procesarVerDatos(expedientes, usuario, String(numero), String(motivo ?? ""), ipDeSolicitud(await headers()));
}

/** "Verificar integridad" del historial (cadena de hash). No cambia la ficha: no hace falta refresh(). */
export async function verificarIntegridad(numero: string): Promise<ResultadoVerificacion> {
  const usuario = await exigirUsuario();
  return procesarIntegridad(expedientes, usuario, String(numero), ipDeSolicitud(await headers()));
}

/** Aviso de posibles duplicados mientras se carga el alta o la edición. */
export async function consultarDuplicados(consulta: unknown): Promise<AvisoDuplicado[]> {
  const usuario = await exigirUsuario();
  return procesarDuplicados(expedientes, usuario, consulta);
}

// --- Semana 3: el flujo -------------------------------------------------------
//
// Las llaman los diálogos de la ficha y la bandeja con un objeto (no FormData).
// La entrada se vuelve a validar en src/lib/presentacion/acciones.ts: cualquiera
// puede mandar un POST a una Server Action. Si la acción salió bien, `refresh()`
// hace que la misma respuesta traiga la página re-renderizada (la ficha con la
// versión nueva, la bandeja y el contador "Por confirmar" del encabezado).

async function conRefresco<R extends { ok: boolean }>(r: R): Promise<R> {
  if (r.ok) refresh();
  return r;
}

/** Confirmar la recepción (ficha o fila de la bandeja). */
export async function accionRecepcion(datos: EntradaRecepcion): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarRecepcion(expedientes, usuario, datos));
}

/** "Confirmar seleccionados" de la pestaña Por confirmar. */
export async function accionRecepciones(datos: EntradaLote): Promise<ResultadoLote> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarRecepciones(expedientes, usuario, datos));
}

/** Tildar o destildar una subtarea del paso actual. */
export async function accionSubtarea(datos: EntradaSubtarea): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarSubtarea(expedientes, usuario, datos));
}

/** Marcar un documento. */
export async function accionDocumento(datos: EntradaDocumento): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarDocumento(expedientes, usuario, datos));
}

/** Dar el pase. */
export async function accionPase(datos: EntradaPase): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarPase(expedientes, usuario, datos));
}

/** Devolver a un paso anterior. */
export async function accionDevolucion(datos: EntradaDevolucion): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarDevolucion(expedientes, usuario, datos));
}

// --- Semana 4: estados, reinicio, nota, correcciones y transcripción ---------
//
// Igual que las del flujo: objeto validado en src/lib/presentacion/acciones-estados.ts,
// refresh() si salió bien. Reiniciar, "archivar y abrir vinculado" y "Terminar
// carga histórica" llevan a otra pantalla con redirect() (fuera del try).

/** Concluir, archivar (también sin concluir), desarchivar, anular, reabrir y la ubicación de archivo. */
export async function accionEstado(datos: EntradaEstado): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarEstado(expedientes, usuario, datos));
}

/** Reiniciar con otra plantilla: anula y lleva al alta precargada. */
export async function accionReiniciar(datos: EntradaReinicio): Promise<EstadoError> {
  const usuario = await exigirUsuario();
  const r = await procesarReinicio(expedientes, usuario, datos);
  if (r.ok) redirect(r.destino);
  return r;
}

/** Archivar sin concluir y abrir el expediente vinculado (caducidad): lleva a la ficha del nuevo. */
export async function accionVinculado(datos: EntradaVinculado): Promise<EstadoError> {
  const usuario = await exigirUsuario();
  const r = await procesarVinculado(expedientes, usuario, datos, ipDeSolicitud(await headers()));
  if (r.ok) redirect(r.destino);
  return r;
}

/** Nota libre en el historial. */
export async function accionNota(datos: EntradaNota): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarNota(expedientes, usuario, datos));
}

/** Una corrección del menú "Corregir" del historial. */
export async function accionCorreccion(datos: EntradaCorreccion): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarCorreccion(expedientes, usuario, datos));
}

/** Suprimir los datos de una persona (Ley 25.326, admin). */
export async function accionSupresion(datos: EntradaSupresion): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarSupresion(expedientes, usuario, datos));
}

/** "Registrar lote" de la transcripción. */
export async function accionTranscribir(datos: EntradaTranscripcion): Promise<ResultadoTranscripcionPantalla> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarTranscripcion(expedientes, usuario, datos));
}

/** Tildar una subtarea en la transcripción, con su fecha. */
export async function accionSubtareaHistorica(datos: EntradaSubtareaHistorica): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarSubtareaHistorica(expedientes, usuario, datos));
}

/** Llevar a concluido o archivado en la transcripción. */
export async function accionEstadoHistorico(datos: EntradaEstadoHistorico): Promise<ResultadoFlujo> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarEstadoHistorico(expedientes, usuario, datos));
}

/** "Terminar carga histórica": vuelve a la ficha. */
export async function accionTerminarCarga(datos: { numero: string; versionVista: number; comandoId: string }): Promise<EstadoError> {
  const usuario = await exigirUsuario();
  const r = await procesarTerminarCarga(expedientes, usuario, datos);
  if (r.ok) redirect(r.destino);
  return r;
}
