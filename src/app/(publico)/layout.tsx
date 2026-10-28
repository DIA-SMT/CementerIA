import type { Metadata } from "next";
import { FondoPublico, PiePublico, SaltarAlContenido } from "@/components/publico";
import { ScriptTema } from "@/components/tema-publico";
import { TITULO_SITIO } from "@/lib/presentacion/sitio-publico";

/**
 * El layout de las páginas públicas (28/10/2026; docs/diseno.md, "Página
 * pública"): `/` (el inicio), `/cementerios`, `/horarios`, `/recorridos`,
 * `/tramites`, `/consulta` (y `/consulta/[numero]`) y `/contacto`. Sin sesión
 * (el proxy no corre en estas rutas), sin barra lateral.
 *
 * Pone lo que no depende de la página, dentro del contenedor del sitio
 * (`.sitio-publico`, el que lleva el modo claro u oscuro en `data-tema`):
 * el script que pone el modo guardado antes de pintar (ScriptTema, primero),
 * el fondo fijo, "Saltar al contenido" (el primer foco) y el pie. El modo va
 * en el contenedor y no en <html>: el layout raíz es el de la app interna, que
 * no tiene modo oscuro, y React no lo pisa al remontar en desarrollo.
 * `suppressHydrationWarning`: el script le cambia el atributo antes de
 * hidratar. `overflow-x-clip`: los halos difusos que se salen del contenedor
 * no dan desplazamiento lateral (`clip` no crea contenedor de desplazamiento:
 * la barra sigue fija).
 *
 * La barra, en cambio, la pone cada página con su ruta (`BarraPublica
 * actual=…`, o `PaginaInterna`): un layout no recibe la ruta ni se vuelve a
 * renderizar al navegar, y así el enlace de la página actual
 * (`aria-current="page"`, el subrayado amarillo) sale del servidor.
 */
export const metadata: Metadata = {
  // "Recorridos históricos · Cementerios de San Miguel de Tucumán". El inicio pone el suyo, absoluto.
  title: { template: `%s · ${TITULO_SITIO}`, default: TITULO_SITIO },
  // [C] Sin indexar hasta que la Dirección apruebe la publicación (README, "Página pública y consulta").
  robots: { index: false, follow: false },
};

export default function LayoutPublico({ children }: { children: React.ReactNode }) {
  return (
    <div data-sitio-publico="" suppressHydrationWarning className="sitio-publico relative isolate flex min-h-full flex-1 flex-col overflow-x-clip">
      <ScriptTema />
      <FondoPublico />
      <SaltarAlContenido />
      {children}
      <PiePublico />
    </div>
  );
}
