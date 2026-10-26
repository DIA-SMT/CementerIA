import { Archive, CalendarX2, Clock, Hourglass, Inbox, SendHorizontal, Undo2, type LucideIcon } from "lucide-react";
import type { TipoAviso } from "@/lib/dominio/avisos/tipos";
import { CLASE_ICONO_TONO, TONO_TIPO_AVISO } from "@/lib/presentacion/avisos";

/** El ícono de cada tipo de aviso (la campana y /avisos). */
export const ICONO_TIPO_AVISO: Readonly<Record<TipoAviso, LucideIcon>> = {
  llego: Inbox,
  devuelto: Undo2,
  plazo_por_vencer: Hourglass,
  plazo_vencido: CalendarX2,
  sin_confirmar: SendHorizontal,
  demorado: Clock,
  cerrado: Archive,
};

/**
 * El ícono del tipo en un círculo con el tono del aviso (error para los de
 * prioridad alta, advertencia para los que piden atención). Decorativo: el
 * título y el texto del aviso dicen lo mismo.
 */
export function IconoAviso({ tipo, tamano = "normal" }: { tipo: TipoAviso; tamano?: "normal" | "chico" }) {
  const Icono = ICONO_TIPO_AVISO[tipo];
  const caja = tamano === "chico" ? "h-8 w-8" : "h-9 w-9";
  return (
    <span aria-hidden="true" className={`inline-flex ${caja} shrink-0 items-center justify-center rounded-full ${CLASE_ICONO_TONO[TONO_TIPO_AVISO[tipo]]}`}>
      <Icono className="h-4 w-4" />
    </span>
  );
}
