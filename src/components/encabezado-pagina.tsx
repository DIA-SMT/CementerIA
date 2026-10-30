import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CLASE_FOCO } from "./formulario";

/**
 * Encabezado de una pantalla: un "volver" opcional, el título (h1, con el id
 * que la `section` usa en `aria-labelledby`), una bajada en gris y, a la
 * derecha, las acciones de la pantalla. En celular las acciones bajan debajo
 * del título. Desde el kit institucional (30/10/2026), el antetítulo va en
 * `primario-oscuro` (6,72:1) con un filete amarillo decorativo delante, como
 * en el sitio público, y el título en azul institucional (13,25:1).
 */
export function EncabezadoPagina({
  id = "titulo-pantalla",
  titulo,
  descripcion,
  volver,
  acciones,
  antetitulo,
}: {
  id?: string;
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  /** Enlace a la pantalla anterior: `{ href, texto }`. */
  volver?: { href: string; texto: string };
  acciones?: React.ReactNode;
  /** Una línea chica arriba del título (el módulo, la sección). */
  antetitulo?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {volver ? (
          <Link
            href={volver.href}
            prefetch={false}
            className={`-ml-1 mb-1 inline-flex items-center gap-0.5 rounded-control px-1 text-sm font-medium text-primario-oscuro transition-colors duration-150 hover:text-institucional ${CLASE_FOCO}`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {volver.texto}
          </Link>
        ) : null}
        {antetitulo ? (
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-primario-oscuro before:block before:h-0.5 before:w-4 before:shrink-0 before:rounded-full before:bg-amarillo">
            {antetitulo}
          </p>
        ) : null}
        <h1 id={id} className="text-2xl font-bold tracking-tight text-institucional">
          {titulo}
        </h1>
        {descripcion ? <div className="mt-1 max-w-3xl text-sm text-texto-secundario">{descripcion}</div> : null}
      </div>
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
    </div>
  );
}
