import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Info, LogIn, TriangleAlert } from "lucide-react";
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
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CementerIA</h1>
          <p className="mt-1 text-sm text-slate-600">
            Seguimiento de expedientes de la Dirección de Cementerios
            <br />
            Municipalidad de San Miguel de Tucumán
          </p>
        </div>

        <div className="space-y-5 rounded border border-slate-300 bg-white p-6 shadow-sm">
          {error ? (
            <p
              role="alert"
              className="flex gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          ) : null}
          {salio && !error ? (
            <p role="status" className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Saliste de CementerIA. Se cerraron tus sesiones en esta y en las demás computadoras.
            </p>
          ) : null}

          {e.cidituc.habilitado ? (
            // Un <a> común y no un <Link>: Link precarga el destino, y precargar
            // /auth/ingresar emitiría un `state` nuevo que pisaría el del
            // intento en curso.
            <a
              href={conDestino("/auth/ingresar", destino)}
              className="flex w-full items-center justify-center gap-2 rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Ingresar con Cidituc
            </a>
          ) : (
            <p className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              El ingreso con Cidituc todavía no está habilitado en este entorno.
            </p>
          )}

          {devLogin ? (
            <a
              href={conDestino("/dev/login", destino)}
              className="block text-center text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900"
            >
              Login simulado ({e.produccion ? "staging" : "desarrollo"})
            </a>
          ) : null}
        </div>

        <aside className="flex gap-2 text-xs leading-relaxed text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Sistema de uso interno, solo para el personal autorizado de la Municipalidad. Los ingresos y las consultas
            quedan registrados. Los datos personales que contiene están protegidos por la Ley 25.326 de Protección de
            los Datos Personales: se usan solo para tramitar los expedientes y no se copian ni se comparten fuera de
            ese fin.
          </p>
        </aside>
      </div>
    </main>
  );
}
