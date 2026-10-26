"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { accionAbrirAviso } from "./acciones";

/**
 * El enlace de un aviso en /avisos: abrir uno sin leer lo marca leído (Server
 * Action) y después navega a la ficha. Con Ctrl, Shift o el botón del medio se
 * abre como siempre y se marca en paralelo. Sin JavaScript es un enlace común.
 */
export function EnlaceAviso({ id, href, noLeido, className, children }: { id: string; href: string; noLeido: boolean; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  return (
    <Link
      href={href}
      prefetch={false}
      aria-busy={ocupado || undefined}
      className={className}
      onClick={(e) => {
        if (!noLeido) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
          void accionAbrirAviso(id);
          return;
        }
        e.preventDefault();
        iniciar(async () => {
          await accionAbrirAviso(id);
          router.push(href);
        });
      }}
    >
      {children}
    </Link>
  );
}
