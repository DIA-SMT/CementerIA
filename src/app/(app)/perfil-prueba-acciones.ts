"use server";

import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth/sesion";
import { perfilPrueba } from "@/lib/dominio/admin/servidor";
import { log } from "@/lib/log";
import { procesarCambioPerfilPrueba, type ResultadoPerfilPrueba } from "@/lib/presentacion/acciones-perfil-prueba";

/**
 * "Ver como…" del modo prueba (docs/api-dominio.md, sección 23).
 *
 * - Sin PERFILES_PRUEBA_CUILS, responde 404 (`notFound()`), como si la acción
 *   no existiera; el encabezado tampoco muestra el selector.
 * - Vuelve a pedir el usuario de la sesión (cualquiera puede mandar un POST a
 *   una Server Action) y el dominio comprueba su CUIL contra el de la base. Del
 *   navegador llega solo la clave del perfil elegido.
 * - No redirige: devuelve el inicio del perfil y el selector hace una carga
 *   completa de esa página (`window.location.assign`). Así nada del perfil
 *   anterior queda en el navegador: el layout (contador "Por confirmar",
 *   campana, menú, recorridos) se vuelve a pedir entero, y el Router Cache del
 *   cliente arranca vacío.
 */
export async function accionCambiarPerfilPrueba(clave: unknown): Promise<ResultadoPerfilPrueba> {
  if (!perfilPrueba.activo()) notFound();
  const usuario = await exigirUsuario();
  const r = await procesarCambioPerfilPrueba(perfilPrueba, usuario, { clave });
  if (r.ok && !r.repetido) {
    // Sin CUIL ni nombre: el id alcanza para cruzarlo con auditoria.cambios.
    log.info("perfil_prueba.cambio", { usuarioId: usuario.id, destino: r.destino });
    if (r.sinOtroAdmin) {
      log.warn("perfil_prueba.sin_otro_admin", {
        usuarioId: usuario.id,
        aviso: "Dejó Administrador sin otro administrador activo (modo prueba). Puede volver desde la franja.",
      });
    }
  } else if (!r.ok && r.codigo === "permiso") {
    log.warn("perfil_prueba.denegado", { usuarioId: usuario.id });
  }
  return r;
}
