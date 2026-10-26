"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { IconoAviso } from "@/components/icono-aviso";
import { CLASE_BOTON_COMPACTO, CLASE_ENLACE, CLASE_FOCO } from "@/components/formulario";
import type { AvisoVista, ResumenAvisos } from "@/lib/dominio/avisos/consultas";
import {
  esResumenAvisos,
  haceCuanto,
  marcarEnResumen,
  nombreCampana,
  numeroCampana,
  REFRESCO_CAMPANA_MS,
  REFRESCO_MINIMO_MS,
  RUTA_RESUMEN_AVISOS,
} from "@/lib/presentacion/avisos";
import { accionAbrirAviso, accionMarcarTodos } from "./avisos/acciones";

/** Lo que la campana muestra cuando no es lo que mandó el servidor: un refresco o una marca local. */
interface Local {
  /** El `inicial` sobre el que se armó: si el servidor manda otro, gana el del servidor. */
  base: ResumenAvisos;
  dato: ResumenAvisos;
  ahora: string;
  anuncio: string;
}

/**
 * La campana de avisos del encabezado (docs/diseno.md, "Campana de avisos").
 *
 * - El número de no leídos y los últimos avisos vienen del servidor (el layout
 *   los lee en cada render: una carga, o la respuesta de una Server Action con
 *   `refresh()`). Next no vuelve a dibujar el layout en una navegación del
 *   lado del cliente (Partial Rendering), así que al cambiar de pantalla, y
 *   cada 60 s mientras la pestaña está visible, la campana pide el resumen a
 *   `GET /api/avisos/resumen` (sin librerías: `fetch`, y nada si la página está
 *   oculta). Esa ruta no renueva la sesión; con la sesión vencida (401) deja de
 *   preguntar.
 * - El botón se llama "Avisos, 3 sin leer" (el número visible es decorativo) y
 *   abre un panel desplegable (patrón disclosure: `aria-expanded`,
 *   `aria-controls`). Al abrirse el foco va al título del panel; Escape lo
 *   cierra y devuelve el foco al botón; se cierra al hacer clic afuera, al
 *   sacar el foco y al cambiar de pantalla.
 * - Cada aviso es un enlace a la ficha. Abrir uno sin leer lo marca leído
 *   (Server Action) antes de navegar; con Ctrl o el botón del medio se abre en
 *   otra pestaña y se marca igual. "Marcar todos como leídos" y "Ver todos los
 *   avisos" (/avisos) al pie.
 * - En el celular entra en la fila del encabezado (solo el ícono y el número)
 *   y el panel ocupa el ancho del encabezado, debajo de él.
 */
export function CampanaAvisos({ inicial, ahoraServidor }: { inicial: ResumenAvisos; ahoraServidor: string }) {
  const ruta = usePathname();
  const router = useRouter();
  const idPanel = useId();
  const idTitulo = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  // Abierto "en" una ruta: al navegar se cierra solo.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn === ruta;
  const [local, setLocal] = useState<Local | null>(null);
  const vigente = local !== null && local.base === inicial ? local : null;
  const resumen = vigente?.dato ?? inicial;
  const ahora = new Date(vigente?.ahora ?? ahoraServidor);
  const [, iniciar] = useTransition();

  // Lo último que se mostró, para el refresco (que corre fuera del render).
  const inicialRef = useRef(inicial);
  const noLeidosRef = useRef(resumen.noLeidos);
  const ultimaConsulta = useRef(0);
  const sinSesion = useRef(false);
  useEffect(() => {
    inicialRef.current = inicial;
    noLeidosRef.current = resumen.noLeidos;
  });

  const mostrar = useCallback((dato: ResumenAvisos, anuncio = "") => {
    setLocal({ base: inicialRef.current, dato, ahora: new Date().toISOString(), anuncio });
  }, []);

  const consultar = useCallback(async () => {
    if (sinSesion.current) return;
    ultimaConsulta.current = Date.now();
    try {
      const r = await fetch(RUTA_RESUMEN_AVISOS, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (r.status === 401) {
        sinSesion.current = true;
        return;
      }
      if (!r.ok) return;
      const dato: unknown = await r.json();
      if (!esResumenAvisos(dato)) return;
      const nuevos = dato.noLeidos > noLeidosRef.current;
      mostrar(dato, nuevos ? `Avisos nuevos: ${dato.noLeidos} sin leer` : "");
    } catch {
      // Sin red o el servidor reiniciando: se vuelve a intentar en el próximo ciclo.
    }
  }, [mostrar]);

  // Cada 60 s, solo con la pestaña visible; al volver a la pestaña, si pasó el minuto.
  useEffect(() => {
    ultimaConsulta.current = Date.now();
    const cada = window.setInterval(() => {
      if (document.visibilityState === "visible") void consultar();
    }, REFRESCO_CAMPANA_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible" && Date.now() - ultimaConsulta.current >= REFRESCO_CAMPANA_MS) void consultar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearInterval(cada);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [consultar]);

  // Al cambiar de pantalla (el layout no se vuelve a dibujar): el contador al día.
  const rutaAnterior = useRef(ruta);
  useEffect(() => {
    if (rutaAnterior.current === ruta) return;
    rutaAnterior.current = ruta;
    if (Date.now() - ultimaConsulta.current >= REFRESCO_MINIMO_MS) void consultar();
  }, [ruta, consultar]);

  // Abierto: el foco al título del panel, y un clic afuera lo cierra.
  useEffect(() => {
    if (!abierto) return;
    titulo.current?.focus();
    const afuera = (e: PointerEvent) => {
      if (e.target instanceof Node && !contenedor.current?.contains(e.target)) setAbiertoEn(null);
    };
    document.addEventListener("pointerdown", afuera);
    return () => document.removeEventListener("pointerdown", afuera);
  }, [abierto]);

  function alternar() {
    if (abierto) {
      setAbiertoEn(null);
      return;
    }
    setAbiertoEn(ruta);
    if (Date.now() - ultimaConsulta.current >= REFRESCO_MINIMO_MS) void consultar();
  }

  function abrirAviso(e: React.MouseEvent<HTMLAnchorElement>, a: AvisoVista) {
    if (a.leidoEn !== null) {
      setAbiertoEn(null);
      return;
    }
    mostrar(marcarEnResumen(resumen, [a.id], new Date()));
    // Otra pestaña o ventana: se navega como siempre y se marca en paralelo.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      void accionAbrirAviso(a.id);
      return;
    }
    e.preventDefault();
    setAbiertoEn(null);
    iniciar(async () => {
      await accionAbrirAviso(a.id);
      router.push(a.enlace);
    });
  }

  function marcarTodos() {
    mostrar(marcarEnResumen(resumen, "todos", new Date()));
    iniciar(async () => {
      await accionMarcarTodos();
    });
    titulo.current?.focus();
  }

  const numero = numeroCampana(resumen.noLeidos);
  const nombre = nombreCampana(resumen.noLeidos);

  return (
    <div
      ref={contenedor}
      className="shrink-0 sm:relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && abierto) {
          e.preventDefault();
          setAbiertoEn(null);
          boton.current?.focus();
        }
      }}
      onBlur={(e) => {
        // El foco salió del botón y del panel (Tab hacia afuera): se cierra.
        if (abierto && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setAbiertoEn(null);
      }}
    >
      <button
        ref={boton}
        type="button"
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={alternar}
        className={`relative inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-control border px-2.5 text-sm font-medium transition-colors duration-150 ${CLASE_FOCO} ${
          abierto
            ? "border-primario bg-superficie-azul text-primario-oscuro"
            : "border-borde-control bg-white text-texto hover:border-primario hover:bg-superficie-azul hover:text-primario-oscuro"
        }`}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{nombre}</span>
        {numero ? (
          <span aria-hidden="true" className="min-w-5 rounded-full bg-institucional px-1.5 text-center text-xs font-semibold leading-5 text-white tabular-nums">
            {numero}
          </span>
        ) : null}
      </button>
      {/* Los avisos nuevos que trae el refresco, para lectores de pantalla. */}
      <span aria-live="polite" className="sr-only">
        {vigente?.anuncio ?? ""}
      </span>

      <div
        id={idPanel}
        hidden={!abierto}
        className="absolute inset-x-2 top-full z-40 mt-1 overflow-hidden rounded-tarjeta border border-borde bg-white text-left shadow-elevada sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-[26rem]"
      >
        <section aria-labelledby={idTitulo}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borde px-4 py-3">
            <h2 id={idTitulo} ref={titulo} tabIndex={-1} className="rounded-sm text-sm font-semibold text-texto outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario">
              Avisos
              {resumen.noLeidos > 0 ? <span className="font-normal text-texto-secundario"> · {resumen.noLeidos} sin leer</span> : null}
            </h2>
            {resumen.noLeidos > 0 ? (
              <button type="button" onClick={marcarTodos} className={CLASE_BOTON_COMPACTO}>
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                Marcar todos como leídos
              </button>
            ) : null}
          </div>

          {resumen.ultimos.length === 0 ? (
            <p className="px-4 py-6 text-sm text-texto-secundario">No tenés avisos. Acá van a aparecer los expedientes que llegan a tu área, los devueltos, los plazos y las demoras.</p>
          ) : (
            <ul className="max-h-[min(26rem,65vh)] divide-y divide-borde overflow-y-auto">
              {resumen.ultimos.map((a) => (
                <li key={a.id}>
                  <FilaAviso aviso={a} ahora={ahora} onClick={(e) => abrirAviso(e, a)} />
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-borde bg-fondo/60 px-4 py-2.5 text-sm">
            <Link href="/avisos" prefetch={false} onClick={() => setAbiertoEn(null)} className={CLASE_ENLACE}>
              Ver todos los avisos
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Un aviso del panel: ícono por tipo, título, texto corto (dos renglones) y
 * hace cuánto. Sin leer: título en negrita, punto azul y "Sin leer" para
 * lectores de pantalla. Prioridad alta (devuelto, plazo vencido): franja roja
 * a la izquierda y la insignia "Prioridad alta" (el color no va solo).
 */
function FilaAviso({ aviso: a, ahora, onClick }: { aviso: AvisoVista; ahora: Date; onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const noLeido = a.leidoEn === null;
  const alta = a.prioridad === "alta";
  return (
    <Link
      href={a.enlace}
      prefetch={false}
      onClick={onClick}
      className={`flex gap-3 border-l-4 px-3.5 py-3 transition-colors duration-150 hover:bg-superficie-azul focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primario ${
        alta ? "border-error" : "border-transparent"
      } ${noLeido ? "bg-superficie-azul/40" : "bg-white"}`}
    >
      <IconoAviso tipo={a.tipo} tamano="chico" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`min-w-0 truncate text-sm ${noLeido ? "font-semibold text-texto" : "font-medium text-texto"}`}>
            {noLeido ? <span className="sr-only">Sin leer: </span> : null}
            {a.titulo}
          </span>
          <time dateTime={a.creadoEn} className="shrink-0 text-xs text-texto-secundario tabular-nums">
            {haceCuanto(a.creadoEn, ahora)}
          </time>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-texto-secundario">{a.texto}</span>
        {alta ? <span className="insignia mt-1 bg-error-fondo text-error ring-1 ring-inset ring-error-borde">Prioridad alta</span> : null}
      </span>
      {noLeido ? <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primario" /> : null}
    </Link>
  );
}
