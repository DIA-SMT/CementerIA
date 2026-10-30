import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MapPinOff } from "lucide-react";
import { CLASE_BOTON_PRIMARIO } from "@/components/formulario";
import { MarcaMunicipal } from "@/components/marca-municipal";

export const metadata: Metadata = { title: "No encontrada" };

/**
 * 404 de toda la app. También es lo que ve quien abre /dev/login donde el login
 * simulado no está habilitado: a propósito, nada indica que esa ruta exista.
 *
 * Con la misma marca y tarjeta que /sin-acceso; arriba, una franja angosta con
 * la foto `parque-memorial` (decorativa, `alt=""`, sin texto encima).
 */
export default function NoEncontrada() {
  return (
    <main className="flex flex-1 items-center justify-center bg-linear-to-b from-superficie-azul/70 to-fondo px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <MarcaMunicipal />
        <div className="tarjeta overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/assets. */}
          <img
            src="/assets/cementeria/feature-ambiental-960.webp"
            width={960}
            height={540}
            alt=""
            decoding="async"
            className="h-24 w-full object-cover object-[50%_60%]"
          />
          <div className="space-y-4 p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-superficie-azul text-primario-oscuro">
                <MapPinOff className="h-5 w-5" aria-hidden="true" />
              </span>
              <h1 className="text-lg font-semibold text-texto">No encontramos esa página</h1>
            </div>
            <p className="text-sm text-texto-secundario">Revisá la dirección, o volvé al inicio.</p>
            <div className="border-t border-borde pt-4">
              <Link href="/" className={CLASE_BOTON_PRIMARIO}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Ir al inicio
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
