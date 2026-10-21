import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CircleCheck, LogIn, ShieldCheck, TriangleAlert } from "lucide-react";
import { CLASE_BOTON_PRIMARIO, CLASE_ENLACE } from "@/components/formulario";
import { MarcaMunicipal } from "@/components/marca-municipal";
import { destinoSeguro } from "@/lib/auth/destino";
import { textoDeError } from "@/lib/auth/errores";
import { hostnameDeSolicitud } from "@/lib/auth/red";
import { getUsuarioActual } from "@/lib/auth/sesion";
import { inicioPara } from "@/lib/dominio/navegacion";
import { devLoginPara, entorno } from "@/lib/entorno";
import { log, resumenError } from "@/lib/log";

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
 * /login: el botón "Ingresar con Cidituc" y el aviso de uso interno y de la
 * Ley 25.326 (sección 5).
 *
 * El botón apunta a GET /auth/ingresar, que genera el `state`, deja la cookie y
 * redirige al derivador: una página no puede escribir cookies.
 */
export default async function PaginaLogin({ searchParams }: { searchParams: Promise<Parametros> }) {
  // Todo lo de abajo depende del request (cookie, entorno, host): nada que
  // prerenderizar en el build, donde además no hay SESSION_SECRET.
  await connection();
  const parametros = await searchParams;
  const destino = destinoSeguro(texto(parametros.volver));

  // Quien ya tiene sesión no tiene nada que hacer acá. Si la base no responde,
  // se muestra el ingreso igual: es la pantalla a la que se vuelve ante
  // cualquier problema, y no puede ser ella la que falle.
  const usuario = await getUsuarioActual().catch((error: unknown) => {
    log.error("login.sin_base", resumenError(error));
    return null;
  });
  if (usuario) redirect(destino ?? inicioPara(usuario));

  const e = entorno();
  const devLogin = devLoginPara(e, hostnameDeSolicitud(await headers()));
  // Solo códigos conocidos: el texto sale de una tabla, nunca de la URL.
  const error = textoDeError(texto(parametros.error));
  const salio = texto(parametros.salida) === "1";

  return (
    <main className="flex flex-1 flex-col bg-white lg:flex-row">
      <FotoIngreso />

      <div className="flex flex-1 items-center justify-center bg-linear-to-b from-superficie-azul/70 to-white px-4 py-10 sm:px-8 lg:py-12">
        <div className="w-full max-w-md space-y-7">
          <MarcaMunicipal tamano="grande" titulo />

          <div className="tarjeta space-y-5 p-6 sm:p-7">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-texto">Ingresar</h2>
              <p className="text-sm text-texto-secundario">Seguimiento de expedientes de la Dirección de Cementerios.</p>
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

            {e.cidituc.habilitado ? (
              // Un <a> común y no un <Link>: Link precarga el destino, y precargar
              // /auth/ingresar emitiría un `state` nuevo que pisaría el del
              // intento en curso.
              <a
                href={conDestino("/auth/ingresar", destino)}
                className={`${CLASE_BOTON_PRIMARIO} min-h-11 w-full text-[0.9375rem]`}
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Ingresar con Cidituc
              </a>
            ) : (
              <p className="rounded-control border border-borde bg-fondo px-3 py-2.5 text-sm text-texto">
                El ingreso con Cidituc todavía no está habilitado en este entorno.
              </p>
            )}

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

/**
 * La foto del ingreso (decorativa, `alt` vacío) con el velo azul: mitad
 * izquierda en escritorio, con el nombre de la Municipalidad; en tablet y
 * celular, una franja angosta arriba, sin texto. Un <img> común con srcset:
 * nginx cierra /_next/image.
 */
function FotoIngreso() {
  return (
    <div className="relative h-24 shrink-0 overflow-hidden sm:h-36 lg:h-auto lg:w-[57%]">
      {/* eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/imagenes. */}
      <img
        src="/imagenes/ingreso-paseo-sereno-960.webp"
        srcSet="/imagenes/ingreso-paseo-sereno-960.webp 960w, /imagenes/ingreso-paseo-sereno-1600.webp 1600w"
        sizes="(min-width: 1024px) 57vw, 100vw"
        width={1600}
        height={900}
        alt=""
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-[50%_60%]"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-institucional/90 via-institucional/55 to-primario/25" />
      <div className="relative hidden h-full flex-col justify-end p-10 text-white lg:flex xl:p-14">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">Municipalidad de San Miguel de Tucumán</p>
        <p className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
          Seguimiento de expedientes de la Dirección de Cementerios
        </p>
        <span aria-hidden="true" className="mt-6 block h-1 w-16 rounded-full bg-amarillo" />
      </div>
    </div>
  );
}
