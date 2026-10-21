import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogOut, UserX } from "lucide-react";
import { CLASE_BOTON_SECUNDARIO, CLASE_ENLACE } from "@/components/formulario";
import { MarcaMunicipal } from "@/components/marca-municipal";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { COOKIE_SIN_ACCESO, verificarSinAcceso } from "@/lib/auth/sesion-token";
import { inicioPara } from "@/lib/dominio/navegacion";
import { entorno } from "@/lib/entorno";

export const metadata: Metadata = { title: "Sin acceso" };

/** 20123456789 → 20-12345678-9, como figura en la constancia de CUIL. */
function formatearCuil(cuil: string): string {
  return `${cuil.slice(0, 2)}-${cuil.slice(2, 10)}-${cuil.slice(10)}`;
}

/**
 * /sin-acceso: Cidituc reconoció a la persona, pero CementerIA no la deja
 * entrar (no tiene alta, o está dada de baja). Le muestra su nombre y CUIL
 * según Cidituc para que pida el alta con el dato exacto (sección 5).
 *
 * Esos datos llegan firmados en la cookie `cem_sin_acceso`, que dejó el
 * callback por diez minutos: en la URL serían datos personales en el historial
 * y en los logs.
 */
export default async function PaginaSinAcceso() {
  // Sin base, igual se muestra el aviso: lo que necesita viene en la cookie.
  const usuario = await getUsuarioActual().catch(() => null);
  if (usuario) redirect(inicioPara(usuario));

  const token = (await cookies()).get(COOKIE_SIN_ACCESO)?.value;
  const datos = token ? await verificarSinAcceso(token, entorno().secretoSesion) : null;

  return (
    <main className="flex flex-1 items-center justify-center bg-linear-to-b from-superficie-azul/70 to-fondo px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <MarcaMunicipal />
        <div className="tarjeta space-y-5 p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-advertencia-fondo text-advertencia">
              <UserX className="h-5 w-5" aria-hidden="true" />
            </span>
            <h1 className="text-lg font-semibold text-texto">No tenés acceso a CementerIA</h1>
          </div>
  
          {datos ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-control border border-borde bg-fondo px-3 py-2.5 text-sm">
                <dt className="text-texto-secundario">Nombre</dt>
                <dd className="text-texto">
                  {[datos.nombre, datos.apellido].filter(Boolean).join(" ") || "(sin nombre en Cidituc)"}
                </dd>
                <dt className="text-texto-secundario">CUIL</dt>
                <dd className="font-mono text-texto">{formatearCuil(datos.cuil)}</dd>
              </dl>
              <p className="text-sm text-texto">
                {datos.motivo === "inactivo"
                  ? "Tu usuario de CementerIA está dado de baja. Si tenés que volver a usarlo, pedile al administrador que lo reactive."
                  : "Ingresaste bien con Cidituc, pero tu CUIL no tiene alta en CementerIA. Pedí el alta al administrador, con el CUIL de arriba y el área en la que trabajás."}
              </p>
            </>
          ) : (
            <p className="text-sm text-texto">
              Tu cuenta no tiene alta en CementerIA o el aviso venció. Si ya pediste el alta, volvé a ingresar; si no,
              pedila al administrador.
            </p>
          )}
  
          <div className="flex items-center justify-between gap-3 border-t border-borde pt-4">
            <Link href="/login" className={`${CLASE_ENLACE} text-sm`}>
              Volver al ingreso
            </Link>
            {/* Borra los avisos que quedaron en este navegador (la PC puede ser compartida). */}
            <form action="/auth/salir" method="post">
              <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Salir
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
