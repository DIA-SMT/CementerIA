import Link from "next/link";
import { LogOut } from "lucide-react";
import { exigirUsuario } from "@/lib/auth/sesion";
import { inicioPara, navegacionPara } from "@/lib/dominio/navegacion";
import { NavegacionPrincipal } from "./navegacion";

/**
 * Cáscara de las pantallas con sesión: encabezado con la navegación del rol,
 * nombre, área y Salir (sección 5, "Navegación por rol").
 *
 * Este layout NO es la barrera: Next puede renderizar una página sin volver a
 * renderizar su layout (navegación del lado del cliente), así que cada página
 * vuelve a pedir el usuario con exigirPantalla(). Por `cache()` la base se
 * consulta una sola vez por request aunque lo pidan los dos.
 */
export default async function LayoutConSesion({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario();
  const items = navegacionPara(usuario);
  const area = usuario.area?.nombre ?? (usuario.rol === "admin" ? "Administración del sistema" : "Sin área");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <Link href={inicioPara(usuario)} className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight text-slate-900">CementerIA</span>
            <span className="text-xs text-slate-500">Dirección de Cementerios</span>
          </Link>

          <NavegacionPrincipal items={items} />

          <div className="ml-auto flex items-center gap-4">
            <div className="text-right leading-tight">
              <p className="text-sm font-medium text-slate-900">
                {usuario.nombre} {usuario.apellido}
              </p>
              <p className="text-xs text-slate-500">
                {area}
                {usuario.rol === "lectura" ? " · solo lectura" : null}
              </p>
            </div>
            {/* Formulario y no enlace: la salida cambia estado (cierra todas las
                sesiones del usuario) y un GET lo dispararía cualquier prefetch. */}
            <form action="/auth/salir" method="post">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
