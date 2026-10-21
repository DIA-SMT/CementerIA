import { FilePlus2, Inbox, LayoutDashboard, Search, Settings, type LucideIcon } from "lucide-react";
import type { Pantalla } from "@/lib/dominio/navegacion";

/**
 * El ícono (outline, de lucide) de cada módulo: la barra lateral y los accesos
 * rápidos del panel usan los mismos. En un módulo aparte, sin "use client",
 * para que lo puedan importar Server y Client Components.
 */
export const ICONO_PANTALLA: Record<Pantalla, LucideIcon> = {
  bandeja: Inbox,
  expedientes_nuevo: FilePlus2,
  expedientes: Search,
  panel: LayoutDashboard,
  admin: Settings,
};
