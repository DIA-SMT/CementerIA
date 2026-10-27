"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BIENVENIDA, RECORRIDOS, recorridoDePantalla } from "@/lib/presentacion/recorridos/contenido";
import {
  diaLocal,
  invitacionPara,
  registrarDecision,
  reiniciarRecorridos,
  resolverPasos,
  type Decision,
  type PasoResuelto,
  type Perfil,
  type Recorrido,
} from "@/lib/presentacion/recorridos/motor";
import { buscarAncla } from "./dom";
import { almacenDelNavegador, avisar, desmarcarPantalla, marcarPantalla, pantallaActual, suscribir } from "./estado";
import { GloboRecorrido } from "./globo";
import { InvitacionRecorrido } from "./invitacion";

/**
 * Recorridos guiados (docs/diseno.md, "Recorridos guiados"). El proveedor va
 * en la cáscara de las pantallas con sesión (y en /cambiar-clave): sabe quién
 * es (id y perfil), qué pantalla está a la vista y si hay un recorrido en
 * curso. Lo usan el botón "?" del encabezado, la invitación y "Reiniciar los
 * recorridos".
 *
 * El recorrido nunca se abre solo: solo con "?" o con "Empezar" de la
 * invitación. La invitación es una tarjeta chica que no bloquea ni toma el
 * foco.
 */

interface RecorridoActivo {
  recorrido: Recorrido;
  pasos: PasoResuelto[];
  /** El botón que lo abrió (para devolverle el foco). */
  origen: HTMLElement | null;
}

export interface Invitacion {
  recorrido: Recorrido;
  bienvenida: boolean;
}

interface ValorRecorridos {
  /** La invitación a mostrar ahora, o null. */
  invitacion: Invitacion | null;
  /** "?": el recorrido de la pantalla a la vista (o la bienvenida, si la pantalla no tiene uno propio). */
  iniciarPantalla: (origen: HTMLElement | null) => void;
  /** Lo que se contestó en la invitación. */
  responder: (decision: Decision, origen?: HTMLElement | null) => void;
  /** "Reiniciar los recorridos": devuelve cuántos se olvidaron, o null si el navegador no guarda nada. */
  reiniciar: () => number | null;
}

const Contexto = createContext<ValorRecorridos | null>(null);

export function useRecorridos(): ValorRecorridos {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useRecorridos va dentro de <ProveedorRecorridos>");
  return valor;
}

const sinPantallaEnServidor = () => null;

export function ProveedorRecorridos({
  usuarioId,
  perfil,
  bienvenida = true,
  invitacionEnLinea = false,
  children,
}: {
  usuarioId: number;
  perfil: Perfil;
  /** Ofrecer la bienvenida general (en la cáscara sí; en /cambiar-clave no). */
  bienvenida?: boolean;
  /** La página pone `<InvitacionRecorrido enLinea />` donde quiere (en /cambiar-clave), en vez de la tarjeta flotante. */
  invitacionEnLinea?: boolean;
  children: React.ReactNode;
}) {
  const pantalla = useSyncExternalStore(suscribir, pantallaActual, sinPantallaEnServidor);
  const [activo, setActivo] = useState<RecorridoActivo | null>(null);
  // Una sola invitación por vista: si contestó la de bienvenida, la de la
  // pantalla espera a la próxima (no se encadenan).
  const [contestadaEn, setContestadaEn] = useState<number | null>(null);

  // El id del recorrido a invitar (un string: así useSyncExternalStore compara por valor).
  const leerInvitacion = useCallback(() => {
    const p = pantallaActual();
    if (!p) return null;
    const propio = Object.hasOwn(RECORRIDOS, p.id) ? recorridoDePantalla(p.id) : null;
    const r = invitacionPara(almacenDelNavegador(), usuarioId, { bienvenida: bienvenida ? BIENVENIDA : null, pantalla: propio }, diaLocal(new Date()));
    return r?.id ?? null;
  }, [usuarioId, bienvenida]);
  const idInvitacion = useSyncExternalStore(suscribir, leerInvitacion, sinPantallaEnServidor);

  const invitacion = useMemo<Invitacion | null>(() => {
    if (!idInvitacion || !pantalla || activo || contestadaEn === pantalla.vista) return null;
    const recorrido = idInvitacion === BIENVENIDA.id ? BIENVENIDA : recorridoDePantalla(idInvitacion);
    return { recorrido, bienvenida: recorrido.id === BIENVENIDA.id };
  }, [idInvitacion, pantalla, activo, contestadaEn]);

  const iniciar = useCallback(
    (recorrido: Recorrido, origen: HTMLElement | null) => {
      let elegido = recorrido;
      let pasos = resolverPasos(recorrido, perfil, (ancla) => buscarAncla(ancla) !== null);
      // Nada para mostrar en este momento (raro: una pantalla vacía): la bienvenida.
      if (pasos.length === 0) {
        elegido = BIENVENIDA;
        pasos = resolverPasos(BIENVENIDA, perfil, (ancla) => buscarAncla(ancla) !== null);
      }
      registrarDecision(almacenDelNavegador(), usuarioId, recorrido, "empezado", diaLocal(new Date()));
      // Al cerrarlo no aparece otra invitación en esta misma vista (por ejemplo, la bienvenida después del "?").
      const actual = pantallaActual();
      if (actual) setContestadaEn(actual.vista);
      setActivo({ recorrido: elegido, pasos, origen });
      avisar();
    },
    [perfil, usuarioId],
  );

  const valor = useMemo<ValorRecorridos>(
    () => ({
      invitacion,
      iniciarPantalla: (origen) => iniciar(recorridoDePantalla(pantallaActual()?.id ?? null), origen),
      responder: (decision, origen = null) => {
        const actual = pantallaActual();
        if (actual) setContestadaEn(actual.vista);
        if (!invitacion) return;
        if (decision === "empezado") {
          iniciar(invitacion.recorrido, origen);
          return;
        }
        // La bienvenida se ofrece una sola vez: "Ahora no" la cierra para siempre.
        const guardar: Decision = invitacion.bienvenida ? "no_mostrar" : decision;
        registrarDecision(almacenDelNavegador(), usuarioId, invitacion.recorrido, guardar, diaLocal(new Date()));
        avisar();
      },
      reiniciar: () => {
        const cuantos = reiniciarRecorridos(almacenDelNavegador(), usuarioId);
        // No invitar en esta misma vista: la persona acaba de tocar el botón.
        const actual = pantallaActual();
        if (actual) setContestadaEn(actual.vista);
        avisar();
        return cuantos;
      },
    }),
    [invitacion, iniciar, usuarioId],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      {!invitacionEnLinea ? <InvitacionRecorrido /> : null}
      {activo
        ? createPortal(
            <GloboRecorrido
              recorrido={activo.recorrido}
              pasos={activo.pasos}
              origen={activo.origen}
              onCerrar={() => setActivo(null)}
              onReiniciarTodos={() => {
                reiniciarRecorridos(almacenDelNavegador(), usuarioId);
                // Este recorrido ya se vio: no se vuelve a invitar en esta vista.
                const actual = pantallaActual();
                if (actual) setContestadaEn(actual.vista);
                avisar();
              }}
            />,
            document.body,
          )
        : null}
    </Contexto.Provider>
  );
}

/**
 * La marca de la pantalla: cada página la pone con el id de su recorrido
 * (src/lib/presentacion/recorridos/contenido.ts). No dibuja nada.
 */
export function PantallaConRecorrido({ id }: { id: keyof typeof RECORRIDOS }) {
  useEffect(() => {
    const vista = marcarPantalla(id);
    return () => desmarcarPantalla(vista);
  }, [id]);
  return null;
}
