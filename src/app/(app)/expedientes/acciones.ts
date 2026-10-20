"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirUsuario } from "@/lib/auth/sesion";
import { expedientes, type AvisoDuplicado } from "@/lib/dominio/expedientes/servidor";
import {
  procesarAlta,
  procesarDuplicados,
  procesarEdicion,
  procesarVerDatos,
  type ResultadoDatosCompletos,
} from "@/lib/presentacion/acciones";
import type { EstadoFormulario } from "@/lib/presentacion/errores";

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

/** Aviso de posibles duplicados mientras se carga el alta o la edición. */
export async function consultarDuplicados(consulta: unknown): Promise<AvisoDuplicado[]> {
  const usuario = await exigirUsuario();
  return procesarDuplicados(expedientes, usuario, consulta);
}
