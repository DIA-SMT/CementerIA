import type { Metadata } from "next";
import { PantallaConRecorrido } from "@/components/recorrido/proveedor";
import { exigirPantalla } from "@/lib/auth/sesion";
import { admin } from "@/lib/dominio/admin/servidor";
import { formatearCuit } from "@/lib/dominio/cuil";
import { formatearFechaHora } from "@/lib/fechas";
import { AccionesUsuario, BotonAltaUsuario } from "./usuarios";

export const metadata: Metadata = { title: "Usuarios" };

const ROL_TEXTO: Record<string, string> = { admin: "Administrador", operador: "Operador", lectura: "Lectura" };

/**
 * `/admin/usuarios` (sección 5): CUIL, nombre, área, rol, estado (con el de
 * la contraseña: temporal, sin contraseña, bloqueado) y último ingreso; alta
 * por CUIL (con contraseña temporal), cambiar área o rol, desactivar (corta la
 * sesión en el request siguiente), reactivar, blanquear la contraseña y
 * desbloquear. Las reglas (último admin, uno mismo, área interna) son del
 * dominio; los diálogos están en ./usuarios.tsx.
 */
export default async function PaginaUsuarios() {
  const usuario = await exigirPantalla("admin");
  const { usuarios, areas, adminsActivos } = await admin.listarUsuarios(usuario);
  const activos = usuarios.filter((u) => u.activo).length;

  return (
    <section aria-labelledby="titulo-usuarios" className="space-y-4">
      <PantallaConRecorrido id="admin-usuarios" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="titulo-usuarios" className="text-2xl font-bold tracking-tight text-institucional">
          Usuarios
        </h1>
        <BotonAltaUsuario areas={areas} />
      </div>
      <p className="text-sm text-texto-secundario">
        {activos} activos de {usuarios.length} · {adminsActivos === 1 ? "1 administrador activo" : `${adminsActivos} administradores activos`}. Ingresan con su
        CUIL (o su correo) y su contraseña. La contraseña temporal del alta o de un blanqueo se muestra una sola vez.
      </p>
      <div className="tarjeta relative @container overflow-x-auto" data-recorrido="usuarios-tabla">
        <table className="tabla-datos tabla-apilable-amplia">
          <caption className="sr-only">Usuarios dados de alta</caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">CUIL</th>
              <th scope="col" className="font-medium">Nombre</th>
              <th scope="col" className="font-medium">Área</th>
              <th scope="col" className="font-medium">Rol</th>
              <th scope="col" className="font-medium" data-recorrido="usuarios-estado">
                Estado
              </th>
              <th scope="col" className="font-medium">Último ingreso</th>
              <th scope="col" className="font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className={u.activo ? "" : "bg-fondo text-texto-secundario"}>
                <td data-etiqueta="CUIL" className="whitespace-nowrap font-mono text-xs">{formatearCuit(u.cuil)}</td>
                <th scope="row" className="font-normal">
                  {u.apellido}, {u.nombre}
                  {u.id === usuario.id ? <span className="ml-1 text-xs text-texto-secundario">(vos)</span> : null}
                </th>
                <td data-etiqueta="Área">{u.area?.nombre ?? <span className="text-texto-secundario">Sin área</span>}</td>
                <td data-etiqueta="Rol">{ROL_TEXTO[u.rol] ?? u.rol}</td>
                <td data-etiqueta="Estado">
                  {u.activo ? "Activo" : "Inactivo"}
                  {u.bloqueadoHasta ? (
                    <span className="mt-0.5 block text-xs font-medium text-advertencia">Bloqueado hasta {formatearFechaHora(u.bloqueadoHasta)}</span>
                  ) : null}
                  {!u.conClave ? (
                    <span className="mt-0.5 block text-xs text-texto-secundario">Sin contraseña</span>
                  ) : u.debeCambiarClave ? (
                    <span className="mt-0.5 block text-xs text-texto-secundario">Contraseña temporal</span>
                  ) : null}
                </td>
                <td data-etiqueta="Último ingreso" className="whitespace-nowrap">{u.ultimoIngreso ? formatearFechaHora(u.ultimoIngreso) : <span className="text-texto-secundario">Nunca</span>}</td>
                <td>
                  <AccionesUsuario
                    usuario={{
                      id: u.id,
                      nombre: `${u.nombre} ${u.apellido}`,
                      cuil: u.cuil,
                      areaId: u.area?.id ?? null,
                      rol: u.rol,
                      activo: u.activo,
                      bloqueado: u.bloqueadoHasta !== null,
                    }}
                    esUnoMismo={u.id === usuario.id}
                    areas={areas}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
