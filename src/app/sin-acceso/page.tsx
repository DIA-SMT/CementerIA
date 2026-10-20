import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserX } from "lucide-react";
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
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-5 rounded border border-slate-300 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <UserX className="h-5 w-5 text-slate-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-slate-900">No tenés acceso a CementerIA</h1>
        </div>

        {datos ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded bg-slate-50 px-3 py-2 text-sm">
              <dt className="text-slate-500">Nombre</dt>
              <dd className="text-slate-900">
                {[datos.nombre, datos.apellido].filter(Boolean).join(" ") || "(sin nombre en Cidituc)"}
              </dd>
              <dt className="text-slate-500">CUIL</dt>
              <dd className="font-mono text-slate-900">{formatearCuil(datos.cuil)}</dd>
            </dl>
            <p className="text-sm text-slate-700">
              {datos.motivo === "inactivo"
                ? "Tu usuario de CementerIA está dado de baja. Si tenés que volver a usarlo, pedile al administrador que lo reactive."
                : "Ingresaste bien con Cidituc, pero tu CUIL no tiene alta en CementerIA. Pedí el alta al administrador, con el CUIL de arriba y el área en la que trabajás."}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-700">
            Tu cuenta no tiene alta en CementerIA o el aviso venció. Si ya pediste el alta, volvé a ingresar; si no,
            pedila al administrador.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <Link href="/login" className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900">
            Volver al ingreso
          </Link>
          {/* Borra los avisos que quedaron en este navegador (la PC puede ser compartida). */}
          <form action="/auth/salir" method="post">
            <button
              type="submit"
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              Salir
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
