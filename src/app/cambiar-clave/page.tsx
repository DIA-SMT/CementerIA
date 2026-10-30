import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, LogOut } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { CLASE_BOTON_SECUNDARIO, CLASE_ENLACE } from "@/components/formulario";
import { FotoIngreso, FranjaMarcaIngreso } from "@/components/foto-ingreso";
import { Wordmark } from "@/components/marca-municipal";
import { BotonRecorrido } from "@/components/recorrido/botones";
import { InvitacionRecorrido } from "@/components/recorrido/invitacion";
import { PantallaConRecorrido, ProveedorRecorridos } from "@/components/recorrido/proveedor";
import { LARGO_MINIMO_CLAVE, reglasClave } from "@/lib/auth/clave";
import { destinoSeguro } from "@/lib/auth/destino";
import { politicaClave } from "@/lib/auth/ingreso-clave";
import { getSesionActual } from "@/lib/auth/sesion";
import { inicioPara } from "@/lib/dominio/navegacion";
import { perfilDe } from "@/lib/presentacion/recorridos/motor";
import { FormularioClave } from "./formulario-clave";

export const metadata: Metadata = { title: "Cambiar contraseña" };

/**
 * /cambiar-clave (login propio, 27/10/2026): cambiar la propia contraseña.
 *
 * - Obligatoria después de ingresar con una contraseña temporal (alta,
 *   blanqueo, admin inicial): mientras `debe_cambiar_clave`, exigirUsuario()
 *   manda acá desde cualquier pantalla y lo único que se puede hacer es esto o
 *   Salir.
 * - Voluntaria desde "Contraseña" en el encabezado.
 *
 * Va fuera del grupo (app): su layout exige un usuario que ya no tenga que
 * cambiarla. Usa el diseño del ingreso (la foto y el panel).
 *
 * Recorrido guiado (docs/diseno.md): el "?" junto al título y la invitación en
 * el flujo de la página, debajo de la tarjeta (no flota: no tapa el formulario).
 * Sin la bienvenida general, que se ofrece en la primera pantalla de la app.
 */
export default async function PaginaCambiarClave({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const usuario = await getSesionActual();
  if (!usuario) redirect("/login");
  const { volver } = await searchParams;
  const destino = destinoSeguro(typeof volver === "string" ? volver : null);
  const obligatorio = usuario.debeCambiarClave;

  return (
    <ProveedorRecorridos usuarioId={usuario.id} perfil={perfilDe(usuario)} bienvenida={false} invitacionEnLinea>
      <main className="flex flex-1 flex-col bg-white lg:flex-row">
        <PantallaConRecorrido id="cambiar-clave" />
        <FotoIngreso />
        <FranjaMarcaIngreso />

        <div className="flex flex-1 items-start justify-center bg-linear-to-b from-superficie-azul/70 to-white px-4 py-8 sm:px-8 sm:py-12 lg:items-center lg:py-12">
          <div className="w-full max-w-md space-y-6">
            <div>
              <h1 className="text-[2.25rem] leading-none sm:text-[2.5rem]">
                <Wordmark variante="clara" />
              </h1>
              <p className="mt-2 text-base font-medium text-texto-secundario">Dirección de Cementerios</p>
            </div>

            <div className="tarjeta space-y-5 border-t-4 border-t-primario p-6 shadow-elevada sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-texto">Cambiar contraseña</h2>
                  <p className="text-sm text-texto-secundario">
                    {usuario.nombre} {usuario.apellido}
                  </p>
                </div>
                <BotonRecorrido />
              </div>

              {obligatorio ? (
                <Aviso tono="advertencia" titulo="Tu contraseña es temporal">
                  <p>Antes de seguir, elegí una contraseña nueva. Solo vos la vas a conocer.</p>
                </Aviso>
              ) : (
                <p className="text-sm text-texto">Al cambiarla se cierran tus sesiones en las demás computadoras.</p>
              )}

              <FormularioClave cuil={usuario.cuil} obligatorio={obligatorio} volver={destino} reglas={reglasClave(politicaClave())}
                largoMinimo={politicaClave() === "libre" ? 1 : LARGO_MINIMO_CLAVE}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
                {obligatorio ? (
                  <span />
                ) : (
                  <Link href={destino ?? inicioPara(usuario)} className={`${CLASE_ENLACE} inline-flex items-center gap-1 text-sm`}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Volver sin cambiarla
                  </Link>
                )}
                {/* Formulario y no enlace: la salida cierra todas las sesiones del usuario. */}
                <form action="/auth/salir" method="post">
                  <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Salir
                  </button>
                </form>
              </div>
            </div>
            <InvitacionRecorrido enLinea />
          </div>
        </div>
      </main>
    </ProveedorRecorridos>
  );
}
