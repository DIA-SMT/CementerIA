"use server";

import { refresh } from "next/cache";
import { exigirUsuario } from "@/lib/auth/sesion";
import { sitio } from "@/lib/dominio/sitio/servidor";
import type { ResultadoAdmin } from "@/lib/presentacion/acciones-admin";
import { procesarSitio, type EntradaSitioAdmin } from "@/lib/presentacion/acciones-sitio";

/**
 * La Server Action de /admin/sitio-publico (28/10/2026). Vuelve a pedir el
 * usuario de la sesión (la página no es la barrera) y delega en
 * src/lib/presentacion/acciones-sitio.ts; el dominio controla el permiso
 * `editar_sitio_publico` y los datos. Si sale bien, `refresh()` trae la página
 * al día en la misma respuesta.
 */
export async function accionSitio(datos: EntradaSitioAdmin): Promise<ResultadoAdmin> {
  const usuario = await exigirUsuario();
  const r = await procesarSitio(sitio, usuario, datos);
  if (r.ok) refresh();
  return r;
}
