import { z } from "zod";
import { PerfilPruebaDenegado, type ServicioPerfilPrueba } from "@/lib/dominio/admin/perfil-prueba";
import type { UsuarioPermisos } from "@/lib/dominio/permisos";
import { leerEntrada } from "./acciones";
import { estadoDeError, type EstadoError } from "./errores";

/**
 * La lógica de la Server Action del selector "Ver como…" (modo prueba,
 * docs/api-dominio.md, sección 23), sin Next, como ./acciones-admin.ts: valida
 * la forma de la entrada (llega del navegador), llama al dominio y traduce sus
 * errores a un estado serializable.
 *
 * `ModoPruebaInexistente` (sin PERFILES_PRUEBA_CUILS) no se traduce: se deja
 * subir, y la Server Action responde 404, como si no existiera. Los tests de
 * integración llaman a esto con el servicio de la base de prueba
 * (tests/integracion/perfil-prueba.test.ts).
 */

export type ResultadoPerfilPrueba = { ok: true; destino: string; mensaje: string; repetido: boolean; sinOtroAdmin: boolean } | EstadoError;

const Entrada = z.object({ clave: z.string().max(80) });
export type EntradaPerfilPrueba = z.input<typeof Entrada>;

export const MENSAJE_PERFIL_DENEGADO = "No podés usar el modo prueba: tu usuario no está habilitado para cambiar de perfil.";

export async function procesarCambioPerfilPrueba(servicio: ServicioPerfilPrueba, usuario: UsuarioPermisos, valor: unknown): Promise<ResultadoPerfilPrueba> {
  try {
    const d = leerEntrada(Entrada, valor);
    const r = await servicio.cambiar(usuario, d.clave);
    return {
      ok: true,
      destino: r.destino,
      repetido: r.repetido,
      sinOtroAdmin: r.sinOtroAdmin,
      mensaje: r.repetido ? `Ya estabas viendo como ${r.perfil.etiqueta}.` : `Ahora estás viendo como ${r.perfil.etiqueta}.`,
    };
  } catch (e) {
    if (e instanceof PerfilPruebaDenegado) return { ok: false, codigo: "permiso", mensaje: MENSAJE_PERFIL_DENEGADO, errores: [] };
    return estadoDeError(e);
  }
}
