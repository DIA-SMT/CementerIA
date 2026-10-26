"use server";

import { refresh } from "next/cache";
import { exigirUsuario } from "@/lib/auth/sesion";
import { avisos } from "@/lib/dominio/avisos/servidor";
import { leerIds } from "@/lib/presentacion/avisos";

/**
 * Server Actions de los avisos (la campana y /avisos). Cada una vuelve a pedir
 * el usuario de la sesión y el dominio filtra por él: un id de otro usuario no
 * cambia nada. La pantalla no escribe por su cuenta.
 */

export interface ResultadoAvisos {
  ok: boolean;
  cambiados: number;
}

/**
 * Al abrir un aviso: lo marca leído. Sin `refresh()`: la campana ya lo muestra
 * leído y la pantalla siguiente se pide igual (es una navegación).
 */
export async function accionAbrirAviso(id: unknown): Promise<ResultadoAvisos> {
  const usuario = await exigirUsuario();
  const cambiados = await avisos.marcarLeidos(usuario, leerIds([id]));
  return { ok: true, cambiados };
}

/** "Marcar todos como leídos" (la campana y /avisos). Con `refresh()`: /avisos y el contador se vuelven a dibujar. */
export async function accionMarcarTodos(): Promise<ResultadoAvisos> {
  const usuario = await exigirUsuario();
  const cambiados = await avisos.marcarTodosLeidos(usuario);
  refresh();
  return { ok: true, cambiados };
}

/** "Marcar todos como leídos" de /avisos (formulario: sin valor de retorno). */
export async function accionMarcarTodosDesdePagina(): Promise<void> {
  await accionMarcarTodos();
}

/** "Marcar como leído" o "Marcar como no leído" de una fila de /avisos (formulario; `id` y `leido` van ligados con `bind`). */
export async function accionMarcarAviso(id: string, leido: boolean): Promise<void> {
  const usuario = await exigirUsuario();
  const ids = leerIds([id]);
  if (leido) await avisos.marcarLeidos(usuario, ids);
  else await avisos.marcarNoLeidos(usuario, ids);
  refresh();
}

/** La preferencia "Concluido o archivado" de /avisos (formulario con la casilla `activo`). */
export async function accionPreferencia(tipo: string, form: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  await avisos.cambiarPreferencia(usuario, tipo, form.get("activo") === "si");
  refresh();
}
