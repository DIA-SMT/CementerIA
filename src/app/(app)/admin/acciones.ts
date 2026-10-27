"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirUsuario } from "@/lib/auth/sesion";
import { admin } from "@/lib/dominio/admin/servidor";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import {
  procesarCatalogo,
  procesarDescartar,
  procesarEditarPlantilla,
  procesarFeriado,
  procesarGuardarBorrador,
  procesarNuevaPlantilla,
  procesarPublicar,
  procesarRetirar,
  procesarUsuario,
  procesarValidarBorrador,
  type EntradaCatalogoAdmin,
  type EntradaContenidoBorrador,
  type EntradaFeriadoAdmin,
  type EntradaNuevaPlantilla,
  type EntradaPublicarBorrador,
  type EntradaRetirarPlantilla,
  type EntradaUsuarioAdmin,
  type ResultadoAdmin,
  type ResultadoGuardadoPantalla,
  type ResultadoUsuarioAdmin,
  type ResultadoValidacion,
} from "@/lib/presentacion/acciones-admin";
import type { EstadoError } from "@/lib/presentacion/errores";

/**
 * Server Actions de `/admin/*` (semana 5). Cada una vuelve a pedir el usuario
 * de la sesión (la página no es la barrera: cualquiera puede mandar un POST a
 * una Server Action) y delega en src/lib/presentacion/acciones-admin.ts; el
 * dominio controla el permiso `administrar` (3.2) y las reglas.
 *
 * Las que cambian lo que se ve llaman a `refresh()` para que la misma
 * respuesta traiga la página al día; las que llevan a otra pantalla, a
 * `redirect()`, fuera de cualquier try (tira una excepción propia de Next).
 */

async function conRefresco<R extends { ok: boolean }>(r: R): Promise<R> {
  if (r.ok) refresh();
  return r;
}

/** "Nueva plantilla": crea el borrador v1 y abre el editor. */
export async function accionNuevaPlantilla(datos: EntradaNuevaPlantilla): Promise<EstadoError> {
  const usuario = await exigirUsuario();
  const r = await procesarNuevaPlantilla(admin, usuario, datos);
  if (r.ok) redirect(r.destino);
  return r;
}

/** "Editar": crea (o abre) el borrador v+1. */
export async function accionEditarPlantilla(codigo: string): Promise<EstadoError> {
  const usuario = await exigirUsuario();
  const r = await procesarEditarPlantilla(admin, usuario, { codigo });
  if (r.ok) redirect(r.destino);
  return r;
}

export async function accionGuardarBorrador(datos: EntradaContenidoBorrador): Promise<ResultadoGuardadoPantalla> {
  const usuario = await exigirUsuario();
  return procesarGuardarBorrador(admin, usuario, datos);
}

export async function accionValidarBorrador(datos: { nombre: string; definicion: Record<string, unknown> }): Promise<ResultadoValidacion> {
  const usuario = await exigirUsuario();
  return procesarValidarBorrador(admin, usuario, datos);
}

/** "Publicar": si sale bien, recarga la versión (ahora publicada). */
export async function accionPublicar(datos: EntradaPublicarBorrador): Promise<EstadoError> {
  const usuario = await exigirUsuario();
  const r = await procesarPublicar(admin, usuario, datos);
  if (r.ok) redirect(`${r.destino}?aviso=publicada`);
  return r;
}

export async function accionDescartar(datos: { codigo: string; version: number }): Promise<EstadoError> {
  const usuario = await exigirUsuario();
  const r = await procesarDescartar(admin, usuario, datos);
  if (r.ok) redirect(r.destino);
  return r;
}

export async function accionRetirar(datos: EntradaRetirarPlantilla): Promise<ResultadoAdmin> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarRetirar(admin, usuario, datos));
}

/** Alta, área o rol, desactivar, reactivar, blanquear la contraseña y desbloquear. */
export async function accionUsuario(datos: EntradaUsuarioAdmin): Promise<ResultadoUsuarioAdmin> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarUsuario(admin, usuario, datos, { ip: ipDeSolicitud(await headers()) }));
}

export async function accionCatalogo(datos: EntradaCatalogoAdmin): Promise<ResultadoAdmin> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarCatalogo(admin, usuario, datos));
}

export async function accionFeriado(datos: EntradaFeriadoAdmin): Promise<ResultadoAdmin> {
  const usuario = await exigirUsuario();
  return conRefresco(await procesarFeriado(expedientes, usuario, datos));
}
