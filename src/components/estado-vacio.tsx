import type { LucideIcon } from "lucide-react";

/**
 * Estado vacío: ícono, una frase y, si suma, una ayuda o una acción. Compacto
 * (densidad administrativa): no agranda la pantalla.
 *
 * `imagen` pone de fondo una de las fotos preparadas (public/imagenes) como
 * banda angosta y decorativa (`alt=""`), bajo un velo blanco casi opaco: el
 * texto se lee sobre blanco (texto 14,1:1; secundario 5,62:1). Ver
 * docs/diseno.md, "Imágenes".
 */
export function EstadoVacio({
  icono: Icono,
  titulo,
  children,
  imagen,
  className = "",
}: {
  icono: LucideIcon;
  titulo: React.ReactNode;
  children?: React.ReactNode;
  imagen?: "parque-memorial" | "avenida-azul";
  className?: string;
}) {
  return (
    <div className={`tarjeta relative overflow-hidden ${className}`}>
      {imagen ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- nginx cierra /_next/image: archivo estático de public/imagenes. */}
          <img
            src={`/imagenes/${imagen}-960.webp`}
            width={960}
            height={540}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-y-0 right-0 hidden h-full w-2/5 object-cover object-center sm:block print:hidden"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-linear-to-r from-white from-60% to-white/15 sm:block print:hidden"
          />
        </>
      ) : null}
      <div className="relative flex items-start gap-3 px-4 py-5 sm:px-6 sm:py-6">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-superficie-azul text-primario-oscuro">
          <Icono className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1 text-sm sm:max-w-[55%]">
          <p className="font-semibold text-texto">{titulo}</p>
          {children ? <div className="text-texto-secundario">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}
