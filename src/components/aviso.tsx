import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";

/**
 * Aviso en línea (panel informativo) con los tokens semánticos: info, éxito,
 * advertencia o error. El color nunca es la única señal: lleva ícono y texto.
 * Contrastes en docs/diseno.md (texto de cada tono sobre su fondo: 5,76 a
 * 6,46:1).
 *
 * No pone `role`: quien lo usa decide si es una región viva (`role="status"`,
 * `role="alert"`) o un texto fijo, y lo pasa en `role`.
 */
export type TonoAviso = "info" | "exito" | "advertencia" | "error" | "neutro";

export const CLASE_TONO_AVISO: Record<TonoAviso, string> = {
  info: "border-info-borde bg-info-fondo text-info",
  exito: "border-exito-borde bg-exito-fondo text-exito",
  advertencia: "border-advertencia-borde bg-advertencia-fondo text-advertencia",
  error: "border-error-borde bg-error-fondo text-error",
  neutro: "border-borde bg-fondo text-texto",
};

const ICONO: Record<TonoAviso, LucideIcon> = {
  info: Info,
  exito: CircleCheck,
  advertencia: TriangleAlert,
  error: CircleAlert,
  neutro: Info,
};

export function Aviso({
  tono,
  titulo,
  children,
  role,
  icono,
  className = "",
}: {
  tono: TonoAviso;
  /** La primera línea, en negrita. */
  titulo?: React.ReactNode;
  children?: React.ReactNode;
  role?: "status" | "alert";
  /** Otro ícono (por defecto, el del tono). */
  icono?: LucideIcon;
  className?: string;
}) {
  const Icono = icono ?? ICONO[tono];
  return (
    <div role={role} className={`flex items-start gap-2.5 rounded-control border px-3.5 py-2.5 text-sm ${CLASE_TONO_AVISO[tono]} ${className}`}>
      <Icono className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        {titulo ? <p className="font-semibold">{titulo}</p> : null}
        {children}
      </div>
    </div>
  );
}
