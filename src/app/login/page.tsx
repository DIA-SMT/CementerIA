import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CircleCheck, LogIn, ShieldCheck, TriangleAlert } from "lucide-react";
import { CLASE_BOTON_SECUNDARIO, CLASE_ENLACE } from "@/components/formulario";
import { FotoIngreso, FranjaMarcaIngreso } from "@/components/foto-ingreso";
import { Wordmark } from "@/components/marca-municipal";
import { destinoSeguro } from "@/lib/auth/destino";
import { textoDeError } from "@/lib/auth/errores";
import { hostnameDeSolicitud } from "@/lib/auth/red";
import { getSesionActual, RUTA_CAMBIAR_CLAVE } from "@/lib/auth/sesion";
import { inicioPara } from "@/lib/dominio/navegacion";
import { devLoginPara, entorno } from "@/lib/entorno";
import { log, resumenError } from "@/lib/log";
import { FormularioIngreso } from "./formulario-ingreso";

export const metadata: Metadata = { title: "Ingresar" };

type Parametros = Record<string, string | string[] | undefined>;

function texto(valor: string | string[] | undefined): string | null {
  return typeof valor === "string" ? valor : null;
}

/** `ruta` con `?volver=` si hay destino. */
function conDestino(ruta: string, destino: string | null): string {
  return destino ? `${ruta}?${new URLSearchParams({ volver: destino })}` : ruta;
}

/**
 * /login: el formulario del login propio (CUIL o correo y contraseña,
 * 27/10/2026) y el aviso de uso interno y de la Ley 25.326 (sección 5).
 *
 * El ingreso con Cidituc está en pausa: su botón (que apunta a GET
 * /auth/ingresar) aparece solo con CIDITUC_HABILITADO=1, como alternativa
 * debajo del formulario. El código sigue entero para reactivarlo.
 *
 * Diseño (kit institucional, 30/10/2026; docs/diseno.md, "Ingreso"): en
 * escritorio, dividido 55/45, la foto con el logo a la izquierda y el
 * formulario a la derecha; en tablet y celular, una franja con el logo y
 * enseguida el formulario (la foto no se muestra). Del moodboard NO se toman
 * "Recordarme" ni "¿Olvidaste tu contraseña?" (no existen: el blanqueo lo
 * hace un administrador, y así lo dice la ayuda) ni "CUIL o correo
 * electrónico" (el campo y los mensajes siguen como estaban).
 */
export default async function PaginaLogin({ searchParams }: { searchParams: Promise<Parametros> }) {
  // Todo lo de abajo depende del request (cookie, entorno, host): nada que
  // prerenderizar en el build, donde además no hay SESSION_SECRET.
  await connection();
  const parametros = await searchParams;
  const destino = destinoSeguro(texto(parametros.volver));

  // Quien ya tiene sesión no tiene nada que hacer acá (con una contraseña
  // temporal, va a cambiarla). Si la base no responde, se muestra el ingreso
  // igual: es la pantalla a la que se vuelve ante cualquier problema, y no
  // puede ser ella la que falle.
  const usuario = await getSesionActual().catch((error: unknown) => {
    log.error("login.sin_base", resumenError(error));
    return null;
  });
  if (usuario) redirect(usuario.debeCambiarClave ? conDestino(RUTA_CAMBIAR_CLAVE, destino) : (destino ?? inicioPara(usuario)));

  const e = entorno();
  const devLogin = devLoginPara(e, hostnameDeSolicitud(await headers()));
  // Solo códigos conocidos: el texto sale de una tabla, nunca de la URL.
  const error = textoDeError(texto(parametros.error));
  const salio = texto(parametros.salida) === "1";

  return (
    <main className="flex flex-1 flex-col bg-white lg:flex-row">
      <FotoIngreso />
      <FranjaMarcaIngreso />

      <div data-panel-ingreso="" className="flex flex-1 items-start justify-center bg-linear-to-b from-superficie-azul/70 to-white px-4 py-8 sm:px-8 sm:py-12 lg:items-center lg:py-12">
        <div className="w-full max-w-md space-y-6 motion-safe:animate-aparecer">
          <div>
            <h1 className="text-[2.25rem] leading-none sm:text-[2.5rem]">
              <Wordmark variante="clara" />
            </h1>
            <p className="mt-2 text-base font-medium text-texto-secundario">Dirección de Cementerios</p>
          </div>

          <div className="tarjeta space-y-5 border-t-4 border-t-primario p-6 shadow-elevada sm:p-7">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-texto">Ingresar</h2>
              <p className="text-sm text-texto-secundario">Ingresá para acceder al seguimiento de expedientes.</p>
            </div>

            {error ? (
              <p
                role="alert"
                className="flex gap-2 rounded-control border border-advertencia-borde bg-advertencia-fondo px-3 py-2.5 text-sm text-advertencia"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </p>
            ) : null}
            {salio && !error ? (
              <p
                role="status"
                className="flex gap-2 rounded-control border border-info-borde bg-info-fondo px-3 py-2.5 text-sm text-info"
              >
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Saliste de CementerIA. Se cerraron tus sesiones en esta y en las demás computadoras.</span>
              </p>
            ) : null}

            <FormularioIngreso volver={destino} />

            {e.cidituc.habilitado ? (
              // Un <a> común y no un <Link>: Link precarga el destino, y precargar
              // /auth/ingresar emitiría un `state` nuevo que pisaría el del
              // intento en curso.
              <div className="space-y-3 border-t border-borde pt-4">
                <p className="text-center text-xs text-texto-secundario">o</p>
                <a href={conDestino("/auth/ingresar", destino)} className={`${CLASE_BOTON_SECUNDARIO} w-full`}>
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Ingresar con Cidituc
                </a>
              </div>
            ) : null}

            {devLogin ? (
              <p className="border-t border-borde pt-4 text-center text-sm">
                <a href={conDestino("/dev/login", destino)} className={CLASE_ENLACE}>
                  Login simulado ({e.produccion ? "staging" : "desarrollo"})
                </a>
              </p>
            ) : null}
          </div>

          <aside className="flex gap-2.5 text-xs leading-relaxed text-texto-secundario">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-institucional" aria-hidden="true" />
            <p>
              Sistema de uso interno, solo para el personal autorizado de la Municipalidad. Los ingresos y las consultas
              quedan registrados. Los datos personales que contiene están protegidos por la Ley 25.326 de Protección de
              los Datos Personales: se usan solo para tramitar los expedientes y no se copian ni se comparten fuera de
              ese fin.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
