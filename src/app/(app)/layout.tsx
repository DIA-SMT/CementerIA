import Link from "next/link";
import { cookies } from "next/headers";
import { Inbox, KeyRound, LogOut } from "lucide-react";
import { exigirUsuario } from "@/lib/auth/sesion";
import { avisos, recibeAvisos } from "@/lib/dominio/avisos/servidor";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { inicioPara, navegacionPara, puedeVerPantalla } from "@/lib/dominio/navegacion";
import { log, resumenError } from "@/lib/log";
import { COOKIE_BARRA, leerPreferenciaBarra } from "@/lib/presentacion/barra-lateral";
import { rutaBandeja } from "@/lib/presentacion/flujo";
import { CLASE_FOCO } from "@/components/formulario";
import { BotonRecorrido } from "@/components/recorrido/botones";
import { ProveedorRecorridos } from "@/components/recorrido/proveedor";
import { perfilDe } from "@/lib/presentacion/recorridos/motor";
import { BuscadorGlobal } from "./buscador-global";
import { CampanaAvisos } from "./campana-avisos";
import { BarraLateral } from "./navegacion";

/**
 * Cáscara de las pantallas con sesión: barra lateral con la marca y la
 * navegación del rol (en tablet y celular, franja con menú colapsable) y
 * encabezado con la búsqueda global (lleva a /expedientes?q=), el contador "Por confirmar"
 * (enlazado a esa pestaña de la bandeja), la campana de avisos, nombre, área y Salir (sección 5,
 * "Navegación por rol"). Al imprimir no sale ni la barra ni el encabezado: los
 * imprimibles van solos.
 *
 * En el celular el encabezado es una sola fila (57 px): el buscador queda detrás
 * del botón "Buscador" (BuscadorGlobal), "Por confirmar" muestra solo el ícono y
 * el número y Salir solo el ícono; los dos conservan su nombre accesible.
 *
 * La barra lateral se puede contraer a una franja de íconos en escritorio. La
 * preferencia viene de una cookie que se lee acá, en el servidor (en Next 16
 * `cookies()` es asíncrona): así la primera pintura ya sale contraída o
 * expandida, sin parpadeo. Sin cookie, el CSS la contrae entre 1024 y 1279 px
 * (src/lib/presentacion/barra-lateral.ts).
 *
 * Las Server Actions del flujo llaman a `refresh()`: la respuesta trae también
 * este layout, así que el contador se actualiza al confirmar o dar un pase.
 *
 * Avisos (26/10/2026): la campana con los no leídos y los últimos avisos, para
 * quien los recibe (operadores con área). Antes de contarlos, si hoy todavía no
 * corrió la generación de avisos por tiempo (la tarea programada de las 6:00),
 * la corre (`generarSiHaceFalta`: si ya corrió, es una lectura por clave
 * primaria; la bandeja, que es el inicio de los operadores, pasa siempre por
 * acá). Si falla, se registra y la pantalla se muestra igual. Como el layout no
 * se vuelve a dibujar al navegar del lado del cliente, la campana además pide
 * el resumen al cambiar de pantalla y cada 60 s (campana-avisos.tsx).
 *
 * Recorridos guiados (27/10/2026, docs/diseno.md): el proveedor envuelve la
 * cáscara (sabe quién es: id y perfil) y el botón "?" del encabezado inicia el
 * recorrido de la pantalla a la vista. La invitación (una tarjeta chica que no
 * bloquea) la pone el proveedor; la preferencia queda en el navegador.
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
  const conBandeja = puedeVerPantalla(usuario, "bandeja");
  const porConfirmar = conBandeja ? await expedientes.contadorPorConfirmar(usuario) : 0;
  const conAvisos = recibeAvisos(usuario);
  if (conAvisos) {
    try {
      await avisos.generarSiHaceFalta();
    } catch (error) {
      log.error("avisos.generacion_en_carga_fallo", resumenError(error));
    }
  }
  const resumenAvisos = conAvisos ? await avisos.resumen(usuario) : null;
  const preferenciaBarra = leerPreferenciaBarra((await cookies()).get(COOKIE_BARRA)?.value);

  // En escritorio el fondo azul sigue debajo de la barra lateral (que es
  // sticky) hasta el final de la página.
  return (
    <ProveedorRecorridos usuarioId={usuario.id} perfil={perfilDe(usuario)}>
      <div className="flex min-h-full flex-1 flex-col lg:flex-row lg:bg-institucional print:bg-white">
        <BarraLateral items={items} inicio={inicioPara(usuario)} preferencia={preferenciaBarra} />

        <div className="flex min-w-0 flex-1 flex-col bg-fondo print:bg-white">
          <header className="border-b border-borde bg-white print:hidden">
            {/* En el celular, una sola fila: buscador (detrás de un botón), "Por
                confirmar" con su número, el usuario y Salir (solo ícono, con su
                nombre para lectores de pantalla). Desde sm, el buscador abierto. */}
            <div className="relative mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 sm:gap-x-4 sm:py-2.5 lg:px-8">
              <BuscadorGlobal />

              {conBandeja ? (
                <Link
                  href={rutaBandeja("por_confirmar")}
                  data-recorrido="por-confirmar"
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-control border px-2.5 text-sm font-medium transition-colors duration-150 sm:px-3 ${CLASE_FOCO} ${
                    porConfirmar > 0
                      ? "border-advertencia-borde bg-advertencia-fondo text-advertencia hover:border-advertencia"
                      : "border-borde bg-white text-texto-secundario hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro"
                  }`}
                >
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Por confirmar</span>
                  <span
                    className={`min-w-6 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${
                      porConfirmar > 0 ? "bg-institucional text-white" : "bg-fondo text-texto-secundario ring-1 ring-inset ring-borde"
                    }`}
                  >
                    {porConfirmar}
                  </span>
                </Link>
              ) : null}

              {/* flex-1 con base 0: así este grupo no salta a otra fila en el celular
                  (con la campana no entraba con un área de nombre largo); el nombre se trunca. */}
              <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
                {/* "?": el recorrido de esta pantalla (también en el celular, solo el ícono). */}
                <BotonRecorrido />
                {/* La campana: en el celular, solo el ícono y el número; su panel se
                    abre debajo del encabezado, a todo su ancho (el div de la fila es relative). */}
                {resumenAvisos ? <CampanaAvisos inicial={resumenAvisos} ahoraServidor={new Date().toISOString()} /> : null}
                <div className="flex min-w-0 items-center gap-2.5 text-right leading-tight">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-texto">
                      {usuario.nombre} {usuario.apellido}
                    </p>
                    <p className="truncate text-xs text-texto-secundario">
                      {area}
                      {usuario.rol === "lectura" ? " · solo lectura" : null}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-superficie-azul text-xs font-semibold text-primario-oscuro sm:inline-flex"
                  >
                    {iniciales(usuario.nombre, usuario.apellido)}
                  </span>
                </div>
                {/* Cambiar la contraseña (login propio): /cambiar-clave, fuera de esta
                    cáscara. En el celular, solo el ícono con su nombre accesible. */}
                <Link
                  href="/cambiar-clave"
                  title="Cambiar contraseña"
                  className={`inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-control border border-borde-control bg-white px-2.5 text-sm font-medium text-texto shadow-xs transition-colors duration-150 hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro ${CLASE_FOCO}`}
                >
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Cambiar contraseña</span>
                </Link>
                {/* Formulario y no enlace: la salida cambia estado (cierra todas las
                    sesiones del usuario) y un GET lo dispararía cualquier prefetch. */}
                <form action="/auth/salir" method="post" className="shrink-0">
                  <button
                    type="submit"
                    className={`inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-control border border-borde-control bg-white px-2.5 text-sm font-medium text-texto shadow-xs transition-colors duration-150 hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro sm:px-3.5 ${CLASE_FOCO}`}
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">Salir</span>
                  </button>
                </form>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</main>
        </div>
      </div>
    </ProveedorRecorridos>
  );
}

/** "Ana", "Pérez" → "AP": el círculo junto al nombre (decorativo). */
function iniciales(nombre: string | null | undefined, apellido: string | null | undefined): string {
  return [nombre, apellido]
    .map((p) => (p ?? "").trim().charAt(0))
    .join("")
    .toLocaleUpperCase("es-AR");
}
