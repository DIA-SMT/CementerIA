"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, LogIn, MessageCircleQuestion, RefreshCw, Send, X } from "lucide-react";
import type { EnlaceMigue } from "@/lib/migue/enlaces";
import { ESTILO_SOBRE_LA_BARRA, useBurbujaMovible } from "./burbuja-movible";
import { CuerpoMigue, RetratoMigue } from "./retrato-migue";

/**
 * El chat de Migue (docs/diseno.md, "Migue"): la burbuja flotante abajo a la
 * derecha, que se puede arrastrar, y el panel de unos 390 × 580 px. Es el de
 * El Sanmiguelino (src/components/migue/migue-chat.tsx) sin sus dependencias:
 * CementerIA no tiene @radix-ui/react-dialog ni motion, así que es un
 * `<section role="dialog" aria-modal="false">` con transiciones de CSS.
 *
 * - **No modal**: no tapa la página ni atrapa el foco; se puede seguir usando
 *   lo de atrás. Esc lo cierra y el foco vuelve a la burbuja; al abrirlo va al
 *   campo de la pregunta.
 * - **Accesible**: el historial es una región viva (`aria-live="polite"`), el
 *   "Migue está escribiendo" es un `role="status"`, el error un `role="alert"`
 *   con "Reintentar". Con movimiento reducido, sin animación (la regla global
 *   de globals.css).
 * - **Dos pieles**: `publico` con los tokens `pub-*` del sitio (claro y
 *   oscuro, porque vive dentro de `.sitio-publico`); `interno` con los del
 *   sistema. La cabecera, en el azul institucional con el filete
 *   amarillo-celeste-azul del kit, en los dos. La bienvenida del chat vacío,
 *   con Migue entero (public/migue/cuerpo.webp).
 * - La conversación vive en el layout: sobrevive al cambio de página. No se
 *   guarda en ningún lado.
 */

export interface MensajeChat {
  rol: "usuario" | "migue";
  texto: string;
  enlaces?: EnlaceMigue[];
}

export interface SugerenciaChat {
  pregunta: string;
  /** Con respuesta: se contesta acá mismo, sin llamar a nadie (las preguntas de cada pantalla). */
  respuesta?: string;
}

type Piel = "publico" | "interno";

const CLASES: Record<
  Piel,
  { panel: string; cuerpo: string; migue: string; usuario: string; sugerencia: string; campo: string; pie: string; texto2: string; foco: string; enlace: string; alerta: string }
> = {
  publico: {
    panel: "border-pub-borde bg-pub-superficie text-pub-texto shadow-pub-elevada",
    cuerpo: "bg-pub-superficie",
    migue: "mr-auto border border-pub-borde bg-pub-tinte text-pub-texto",
    usuario: "ml-auto bg-primario text-white",
    sugerencia: "border-pub-borde bg-pub-superficie text-pub-texto hover:border-pub-enlace hover:bg-pub-tinte",
    campo: "border-pub-borde-control bg-pub-superficie text-pub-texto placeholder:text-pub-texto-secundario",
    pie: "border-pub-borde bg-pub-tinte",
    texto2: "text-pub-texto-secundario",
    foco: "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-foco",
    enlace: "border-pub-borde text-pub-enlace hover:border-pub-enlace hover:bg-pub-chip",
    alerta: "border-pub-error-borde bg-pub-error-fondo text-pub-error",
  },
  interno: {
    panel: "border-borde bg-white text-texto shadow-destacada",
    cuerpo: "bg-white",
    migue: "mr-auto border border-borde bg-fondo text-texto",
    usuario: "ml-auto bg-primario text-white",
    sugerencia: "border-borde bg-white text-texto hover:border-primario hover:bg-superficie-azul",
    campo: "border-borde-control bg-white text-texto placeholder:text-texto-secundario",
    pie: "border-borde bg-fondo",
    texto2: "text-texto-secundario",
    foco: "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario",
    enlace: "border-info-borde text-primario-oscuro hover:border-primario hover:bg-superficie-azul",
    alerta: "border-error-borde bg-error-fondo text-error",
  },
};

/** Lo que muestra la burbuja: en el celular, solo la cara; desde sm, también el texto. */
const ETIQUETA_BURBUJA = "Preguntale a Migue";

export function ChatMigue({
  piel,
  endpoint,
  clavePosicion,
  subtitulo,
  bienvenida,
  sugerencias,
  sugerenciasSiempre = false,
  maximo,
  cuerpoExtra,
  ocultarBurbuja = false,
  rutaIngreso,
}: {
  piel: Piel;
  endpoint: string;
  /** Dónde guarda el navegador la posición de la burbuja (una por piel). */
  clavePosicion: string;
  subtitulo: string;
  bienvenida: ReactNode;
  sugerencias: readonly SugerenciaChat[];
  /** Las sugerencias quedan al pie después de cada respuesta (las de la pantalla, en el sistema). */
  sugerenciasSiempre?: boolean;
  /** El largo máximo de la pregunta (src/lib/migue/limites.ts). */
  maximo: number;
  /** Lo que se manda además de la pregunta (en el sistema, la pantalla). */
  cuerpoExtra?: Record<string, unknown>;
  /** En el sistema, mientras la invitación a un recorrido ocupa ese rincón. */
  ocultarBurbuja?: boolean;
  /** A dónde volver a ingresar si la sesión venció (solo el sistema). */
  rutaIngreso?: string;
}) {
  const c = CLASES[piel];
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [errorUltima, setErrorUltima] = useState<string | null>(null);
  const [sinSesion, setSinSesion] = useState(false);
  const burbuja = useBurbujaMovible(clavePosicion);
  const botonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  // Lo nuevo, a la vista. Una respuesta de Migue se muestra desde la pregunta
  // que la pidió (debajo pueden venir las preguntas de la pantalla, y bajar
  // hasta el fondo la dejaría cortada arriba); lo demás, el fondo de la lista.
  useEffect(() => {
    const lista = listaRef.current;
    if (!lista) return;
    const ultima = mensajes.at(-1);
    const burbujas = lista.querySelectorAll<HTMLElement>("[data-mensaje]");
    const elemento = burbujas[burbujas.length - 2] ?? burbujas[burbujas.length - 1];
    if (ultima?.rol === "migue" && !cargando && errorUltima === null && elemento) {
      lista.scrollTo({ top: Math.max(0, elemento.getBoundingClientRect().top - lista.getBoundingClientRect().top + lista.scrollTop - 12) });
    } else {
      lista.scrollTo({ top: lista.scrollHeight });
    }
  }, [mensajes, cargando, errorUltima]);

  // Al abrir, el foco va al campo (después de pintar: el panel recién deja de estar oculto).
  useEffect(() => {
    if (!abierto) return;
    const t = window.setTimeout(() => campoRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [abierto]);

  const cerrar = useCallback(() => {
    setAbierto(false);
    // La burbuja vuelve a estar: el foco vuelve a ella.
    window.setTimeout(() => botonRef.current?.focus(), 0);
  }, []);

  /** Una pregunta con su respuesta escrita: se contesta acá, sin llamar a nadie. */
  const responderEscrita = useCallback((pregunta: string, respuesta: string) => {
    setErrorUltima(null);
    setMensajes((prev) => [...prev, { rol: "usuario", texto: pregunta }, { rol: "migue", texto: respuesta }]);
  }, []);

  const enviar = useCallback(
    async (pregunta: string) => {
      const limpia = pregunta.replace(/\s+/g, " ").trim();
      if (!limpia || cargando) return;
      setErrorUltima(null);
      setTexto("");
      // Los turnos anteriores, sin el actual (que va en `pregunta`).
      const historial = mensajes.slice(-8).map((m) => ({ rol: m.rol, texto: m.texto }));
      setMensajes((prev) => [...prev, { rol: "usuario", texto: limpia }]);
      setCargando(true);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pregunta: limpia, historial, ...cuerpoExtra }),
        });
        if (res.status === 401) {
          setMensajes((prev) => prev.slice(0, -1));
          setSinSesion(true);
          return;
        }
        const datos = (await res.json().catch(() => null)) as { respuesta?: string; enlaces?: EnlaceMigue[]; error?: string } | null;
        if (res.status === 400 && datos?.error) {
          setMensajes((prev) => [...prev, { rol: "migue", texto: datos.error ?? "" }]);
          return;
        }
        if (!res.ok || typeof datos?.respuesta !== "string") throw new Error(String(res.status));
        setMensajes((prev) => [...prev, { rol: "migue", texto: datos.respuesta ?? "", enlaces: Array.isArray(datos.enlaces) ? datos.enlaces.slice(0, 3) : [] }]);
      } catch {
        setErrorUltima(limpia);
      } finally {
        setCargando(false);
        campoRef.current?.focus();
      }
    },
    [cargando, cuerpoExtra, endpoint, mensajes],
  );

  const hechas = new Set(mensajes.filter((m) => m.rol === "usuario").map((m) => m.texto));
  const pendientes = sugerencias.filter((s) => !hechas.has(s.pregunta));
  const mostrarSugerencias = !cargando && !sinSesion && (mensajes.length === 0 || sugerenciasSiempre) && pendientes.length > 0;

  return (
    <div data-migue={piel} className="print:hidden">
      {!abierto && !ocultarBurbuja ? (
        <button
          ref={botonRef}
          type="button"
          data-migue-burbuja=""
          // Ancla de la bienvenida (recorridos guiados): solo la del sistema.
          data-recorrido={piel === "interno" ? "migue" : undefined}
          aria-label="Abrir el chat con Migue, el asistente de la Dirección de Cementerios"
          aria-expanded={false}
          aria-controls={`${id}-panel`}
          title="Tocá para preguntar; arrastrá para moverla"
          style={burbuja.style}
          {...burbuja.handlers}
          onClick={(e) => {
            burbuja.handlers.onClick(e);
            if (!e.defaultPrevented) setAbierto(true);
          }}
          className={`fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primario text-white shadow-destacada ring-2 ring-white/70 transition-[background-color,transform] duration-150 hover:bg-primario-oscuro active:scale-95 sm:h-auto sm:w-auto sm:gap-2.5 sm:py-1.5 sm:pl-1.5 sm:pr-4 ${c.foco}`}
        >
          <RetratoMigue prioridad className="h-11 w-11 ring-1 ring-white/40" />
          <span className="hidden text-sm font-semibold sm:inline">{ETIQUETA_BURBUJA}</span>
        </button>
      ) : null}

      <section
        ref={panelRef}
        id={`${id}-panel`}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-subtitulo`}
        data-abierto={abierto ? "" : undefined}
        inert={!abierto}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cerrar();
          }
        }}
        style={{ transformOrigin: "bottom right", ...ESTILO_SOBRE_LA_BARRA }}
        className={`fixed right-4 z-50 flex h-[min(580px,calc(100dvh-2rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-panel border transition-[opacity,transform,visibility] duration-200 ease-out ${c.panel} ${
          abierto ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible translate-y-2 scale-95 opacity-0"
        }`}
      >
        <header className="relative flex items-center gap-3 bg-institucional px-4 py-3 text-white">
          <RetratoMigue className="h-10 w-10 ring-1 ring-white/30" />
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-titulo`} className="text-base font-semibold leading-tight">
              Migue
            </h2>
            <p id={`${id}-subtitulo`} className="truncate text-xs text-institucional-texto">
              {subtitulo}
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar el chat con Migue"
            className="inline-flex h-9 w-9 items-center justify-center rounded-control text-white/90 hover:bg-institucional-hover hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-linear-to-r from-amarillo via-celeste to-primario" />
        </header>

        <div ref={listaRef} className={`flex-1 space-y-3 overflow-y-auto px-4 py-4 ${c.cuerpo}`} aria-live="polite">
          {mensajes.length === 0 && !sinSesion ? (
            <div className="flex items-end gap-2">
              {/* Migue entero, de frente (como la bienvenida de El Sanmiguelino); con transparencia, va bien en los dos modos. */}
              <CuerpoMigue className="h-32 w-auto" />
              <div className="mb-3 flex-1 text-[0.9375rem] leading-relaxed">{bienvenida}</div>
            </div>
          ) : null}

          {mensajes.map((m, i) => (
            <div key={i} data-mensaje="" className={`max-w-[88%] rounded-tarjeta px-3.5 py-2.5 text-sm leading-relaxed ${m.rol === "usuario" ? c.usuario : c.migue}`}>
              {m.rol === "migue" ? <span className="sr-only">Migue: </span> : <span className="sr-only">Vos: </span>}
              <p className="whitespace-pre-wrap">{m.texto}</p>
              {m.enlaces?.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {m.enlaces.map((e) => (
                    <li key={e.href}>
                      {e.href.startsWith("/") ? (
                        <Link href={e.href} className={`inline-flex min-h-8 items-center gap-1 rounded-control border px-2.5 text-[0.8125rem] font-medium ${c.enlace} ${c.foco}`}>
                          {e.etiqueta}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : (
                        <a
                          href={e.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex min-h-8 items-center gap-1 rounded-control border px-2.5 text-[0.8125rem] font-medium ${c.enlace} ${c.foco}`}
                        >
                          {e.etiqueta}
                          <span className="sr-only"> (se abre en otra pestaña)</span>
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}

          {cargando ? (
            <p role="status" className={`mr-auto flex items-center gap-1.5 rounded-tarjeta px-3.5 py-3 ${c.migue}`}>
              <span className="sr-only">Migue está escribiendo</span>
              <span aria-hidden="true" className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:0ms] motion-reduce:animate-none" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:120ms] motion-reduce:animate-none" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:240ms] motion-reduce:animate-none" />
              </span>
            </p>
          ) : null}

          {errorUltima !== null ? (
            <div role="alert" className={`mr-auto max-w-[88%] rounded-tarjeta border px-3.5 py-2.5 text-sm ${c.alerta}`}>
              <p>No pude responder por un problema de conexión.</p>
              <button
                type="button"
                onClick={() => {
                  setMensajes((prev) => prev.slice(0, -1));
                  void enviar(errorUltima);
                }}
                className={`mt-1.5 inline-flex items-center gap-1 font-semibold underline underline-offset-2 ${c.foco}`}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Reintentar
              </button>
            </div>
          ) : null}

          {sinSesion ? (
            <div className={`rounded-tarjeta border px-3.5 py-3 text-sm ${c.migue}`}>
              <p>Se venció tu sesión. Ingresá de nuevo para seguir preguntando.</p>
              {rutaIngreso ? (
                <a href={rutaIngreso} className={`mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-control bg-primario px-3 font-semibold text-white hover:bg-primario-oscuro ${c.foco}`}>
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Ingresar
                </a>
              ) : null}
            </div>
          ) : null}

          {mostrarSugerencias ? (
            <section aria-label="Preguntas sugeridas" className="pt-1">
              {mensajes.length > 0 ? <p className={`mb-2 text-xs font-semibold ${c.texto2}`}>También te puedo contestar</p> : null}
              <ul className="grid gap-2">
                {pendientes.map((s) => (
                  <li key={s.pregunta}>
                    <button
                      type="button"
                      onClick={() => (s.respuesta ? responderEscrita(s.pregunta, s.respuesta) : void enviar(s.pregunta))}
                      className={`w-full rounded-control border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ${c.sugerencia} ${c.foco}`}
                    >
                      {s.pregunta}
                    </button>
                  </li>
                ))}
                {sugerenciasSiempre ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => campoRef.current?.focus()}
                      className={`inline-flex w-full items-center gap-2 rounded-control px-3.5 py-2 text-left text-sm font-semibold text-primario-oscuro hover:bg-superficie-azul ${c.foco}`}
                    >
                      <MessageCircleQuestion className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Otra consulta
                    </button>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </div>

        {!sinSesion ? (
          <form
            className={`flex items-end gap-2 border-t px-3 py-3 ${c.pie}`}
            onSubmit={(e) => {
              e.preventDefault();
              void enviar(texto);
            }}
          >
            <label htmlFor={`${id}-campo`} className="sr-only">
              Escribí tu pregunta para Migue
            </label>
            <textarea
              id={`${id}-campo`}
              ref={campoRef}
              rows={1}
              value={texto}
              maxLength={maximo}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter envía; Shift+Enter, otra línea.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void enviar(texto);
                }
              }}
              placeholder="Escribí tu pregunta…"
              autoComplete="off"
              className={`max-h-28 min-h-10 flex-1 resize-none rounded-control border px-3 py-2 text-sm ${c.campo} ${c.foco}`}
            />
            <button
              type="submit"
              disabled={cargando || texto.trim() === ""}
              aria-label="Enviar la pregunta"
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primario text-white hover:bg-primario-oscuro disabled:opacity-40 ${c.foco}`}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
