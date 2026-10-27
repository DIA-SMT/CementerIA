import Link from "next/link";
import { Download } from "lucide-react";
import { CLASE_BOTON_COMPACTO, CLASE_ENLACE, CLASE_FOCO } from "@/components/formulario";
import type { FiltrosBusqueda } from "@/lib/dominio/busqueda";
import type { FiltrosMetricas, Resumen, TablaMetricas } from "@/lib/dominio/metricas";
import { enlaceConteo } from "@/lib/presentacion/panel";
import { rutaExportarMetricas, textoNumero } from "@/lib/presentacion/metricas";

/** Las celdas de las tablas (como en el panel): compactas, con aire en los bordes de la tarjeta. */
export const CLASE_CELDA = "px-3 py-2 align-top first:pl-4 last:pr-4 print:px-1.5 print:py-1";
export const CLASE_NUMERO = `${CLASE_CELDA} text-right tabular-nums`;

/**
 * Un bloque de la pantalla: tarjeta con su título (h2), una bajada que dice
 * cómo se mide y "Exportar CSV" de su tabla (no sale en el papel).
 */
export function Seccion({
  id,
  titulo,
  descripcion,
  tabla,
  filtros,
  children,
}: {
  id: string;
  titulo: string;
  descripcion?: React.ReactNode;
  tabla?: TablaMetricas;
  filtros: FiltrosMetricas;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`titulo-${id}`} data-recorrido={`metricas-${id}`} className="tarjeta min-w-0 overflow-hidden print:break-inside-avoid">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-borde px-4 py-3 print:px-2 print:py-1.5">
        <div className="min-w-0 max-w-3xl">
          <h2 id={`titulo-${id}`} className="titulo-seccion">
            {titulo}
          </h2>
          {descripcion ? <div className="mt-0.5 text-xs text-texto-secundario">{descripcion}</div> : null}
        </div>
        {tabla ? <BotonCsv tabla={tabla} filtros={filtros} titulo={titulo} /> : null}
      </div>
      <div className="space-y-5 p-4 print:p-2">{children}</div>
    </section>
  );
}

export function BotonCsv({ tabla, filtros, titulo }: { tabla: TablaMetricas; filtros: FiltrosMetricas; titulo: string }) {
  return (
    <a href={rutaExportarMetricas(tabla, filtros)} data-recorrido="metricas-csv" className={`${CLASE_BOTON_COMPACTO} shrink-0 print:hidden`} download>
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      Exportar CSV<span className="sr-only"> de {titulo}</span>
    </a>
  );
}

/**
 * Una cifra clave del resumen: rótulo, número y, abajo, con qué se compara.
 * Si tiene una búsqueda equivalente, la tarjeta entera es el enlace.
 */
export function Cifra({
  rotulo,
  valor,
  unidad,
  detalle,
  busqueda,
  tono = "neutro",
  textual = false,
}: {
  rotulo: string;
  valor: string;
  unidad?: string;
  detalle?: React.ReactNode;
  busqueda?: FiltrosBusqueda | null;
  /** `mejor` / `peor`: el detalle se pinta en verde o rojo (con el texto que lo dice). */
  tono?: "neutro" | "mejor" | "peor";
  /** El valor es un nombre (el cuello de botella), no un número: va más chico. */
  textual?: boolean;
}) {
  const enlace = enlaceConteo(busqueda ?? null);
  const colorDetalle = tono === "mejor" ? "text-exito" : tono === "peor" ? "text-error" : "text-texto-secundario";
  const contenido = (
    <>
      <span className="block text-xs font-medium text-texto-secundario">{rotulo}</span>
      <span className={`mt-1 block font-semibold tracking-tight text-institucional ${textual ? "text-lg leading-snug" : "text-2xl tabular-nums"} print:text-lg`}>
        {valor}
        {unidad ? <span className="ml-1 text-sm font-normal text-texto-secundario">{unidad}</span> : null}
      </span>
      {detalle ? <span className={`mt-1 block text-xs ${colorDetalle}`}>{detalle}</span> : null}
      {enlace ? <span className="sr-only">: ver en la búsqueda</span> : null}
    </>
  );
  return enlace ? (
    <Link href={enlace} prefetch={false} className={`tarjeta block h-full p-4 transition duration-150 hover:border-primario hover:shadow-elevada ${CLASE_FOCO} print:p-2`}>
      {contenido}
    </Link>
  ) : (
    <div className="tarjeta h-full p-4 print:p-2">{contenido}</div>
  );
}

/** Un número que lleva a la búsqueda equivalente (si la hay). */
export function NumeroEnlazado({ valor, busqueda, descripcion }: { valor: number; busqueda: FiltrosBusqueda | null; descripcion: string }) {
  const enlace = enlaceConteo(busqueda);
  if (!enlace || valor === 0) return <>{valor.toLocaleString("es-AR")}</>;
  return (
    <Link href={enlace} prefetch={false} className={`${CLASE_ENLACE} font-medium`}>
      {valor.toLocaleString("es-AR")}
      <span className="sr-only"> {descripcion}: ver en la búsqueda</span>
    </Link>
  );
}

/** "12 · n = 4" o "—", para las columnas de la línea de base. */
export function textoConN(r: Resumen, campo: "mediana" | "p90" | "promedio" = "mediana"): string {
  return r.n === 0 ? "—" : `${textoNumero(r[campo])} · n = ${r.n}`;
}

/** Aviso de muestra chica, pegado a un número: "(n = 3)". */
export function MarcaMuestra({ n, minimo }: { n: number; minimo: number }) {
  if (n === 0 || n >= minimo) return null;
  return <span className="block text-[0.6875rem] font-normal text-advertencia">muestra chica</span>;
}
