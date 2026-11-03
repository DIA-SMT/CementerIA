"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { pantallaActual, suscribir } from "@/components/recorrido/estado";
import { useRecorridos } from "@/components/recorrido/proveedor";
import { ayudaDePantalla } from "@/lib/migue/ayuda-interna";
import { LARGO_MAXIMO_INTERNO } from "@/lib/migue/limites";
import type { Perfil } from "@/lib/presentacion/recorridos/motor";
import { ChatMigue } from "./chat-migue";

/**
 * Migue en el sistema (docs/diseno.md, "Migue"): "explica y consulta".
 *
 * - **Lo primero que ofrece son las preguntas de la pantalla a la vista**, con
 *   su respuesta ya escrita (src/lib/migue/ayuda-interna.ts, los textos de los
 *   recorridos guiados): se contestan acá, sin llamar a nadie. La pantalla la
 *   marca cada página para su recorrido (`<PantallaConRecorrido id=… />`), así
 *   que cambian solas al navegar.
 * - **"Otra consulta"** va al campo, y esa pregunta sí va al servidor (POST
 *   /api/migue/interno): el modelo con la guía y las herramientas de solo
 *   lectura, con el usuario de la sesión.
 *
 * No tapa lo que no tiene que tapar: no aparece en los imprimibles (ni en la
 * pantalla ni en el papel), se esconde mientras la invitación a un recorrido
 * ocupa ese rincón, y se apoya arriba de la barra de acciones fija del
 * formulario del expediente. globals.css le reserva lugar al pie del contenido.
 * El login y /cambiar-clave están fuera de esta cáscara: ahí no hay Migue.
 */

const sinPantallaEnServidor = () => null;

/** La barra de acciones fija del formulario: la burbuja va por encima (burbuja-movible.ts). */
function useAltoBarraInferior(ruta: string) {
  useEffect(() => {
    const raiz = document.documentElement;
    const barra = document.querySelector<HTMLElement>(".barra-acciones");
    if (!barra) {
      raiz.style.removeProperty("--alto-barra-inferior");
      return;
    }
    const medir = () => raiz.style.setProperty("--alto-barra-inferior", `${Math.ceil(barra.getBoundingClientRect().height)}px`);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(barra);
    return () => {
      observador.disconnect();
      raiz.style.removeProperty("--alto-barra-inferior");
    };
  }, [ruta]);
}

export function MigueInterno({ perfil }: { perfil: Perfil }) {
  const ruta = usePathname();
  const pantalla = useSyncExternalStore(suscribir, pantallaActual, sinPantallaEnServidor);
  const { invitacion } = useRecorridos();
  const ayuda = useMemo(() => ayudaDePantalla(pantalla?.id ?? null, perfil), [pantalla?.id, perfil]);
  const cuerpoExtra = useMemo(() => ({ pantalla: ayuda.id }), [ayuda.id]);
  useAltoBarraInferior(ruta);

  // Los imprimibles (carátula, historial, comprobante) van solos.
  if (/\/imprimir(?:\/|$)/.test(ruta)) return null;

  return (
    <ChatMigue
      piel="interno"
      endpoint="/api/migue/interno"
      clavePosicion="cementeria.migue.posicion-sistema"
      subtitulo={`Ayuda del sistema · ${ayuda.nombre}`}
      bienvenida={
        <p>
          ¡Hola! Soy Migue. Estás en <strong className="font-semibold">{ayuda.nombre}</strong>: estas son las dudas más comunes. También podés preguntarme por un expediente
          (CEM-2026-00042 o 42/2026), por tu bandeja o por los vencidos y demorados.
        </p>
      }
      sugerencias={ayuda.preguntas}
      sugerenciasSiempre
      maximo={LARGO_MAXIMO_INTERNO}
      cuerpoExtra={cuerpoExtra}
      ocultarBurbuja={invitacion !== null}
      rutaIngreso="/login"
    />
  );
}
