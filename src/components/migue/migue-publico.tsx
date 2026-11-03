"use client";

import { LARGO_MAXIMO_PUBLICO } from "@/lib/migue/limites";
import { ChatMigue } from "./chat-migue";

/**
 * Migue en la página pública (docs/diseno.md, "Migue"): abierto, sin
 * ingresar. Lo monta el layout de `src/app/(publico)/`, dentro del contenedor
 * del sitio, así toma el modo claro u oscuro. Contesta sobre lo que publica la
 * Dirección (POST /api/migue) y nunca consulta expedientes: para eso explica
 * «Consultá tu trámite».
 */

const SUGERENCIAS = [
  { pregunta: "¿Cuáles son los horarios de visita?" },
  { pregunta: "¿Qué trámites se pueden hacer?" },
  { pregunta: "¿Cómo consulto mi trámite?" },
] as const;

export function MiguePublico() {
  return (
    <ChatMigue
      piel="publico"
      endpoint="/api/migue"
      clavePosicion="cementeria.migue.posicion"
      subtitulo="Asistente de la Dirección de Cementerios"
      bienvenida={
        <p>
          ¡Hola! Soy Migue, el asistente de la Dirección de Cementerios. Te cuento horarios, trámites, recorridos y cómo consultar tu trámite. ¿En qué te ayudo?
        </p>
      }
      sugerencias={SUGERENCIAS}
      maximo={LARGO_MAXIMO_PUBLICO}
    />
  );
}
