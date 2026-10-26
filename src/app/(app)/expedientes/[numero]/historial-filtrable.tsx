"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { CLASE_CONTROL, CLASE_FOCO } from "@/components/formulario";
import {
  alternarCategoria,
  atajoDe,
  CATEGORIAS_HISTORIAL,
  CATEGORIAS_IMPORTANTES,
  filtroInicial,
  pasaFiltro,
  textoConteo,
  TODAS_LAS_CATEGORIAS,
  type AgrupacionHistorial,
  type CategoriaHistorial,
  type FiltroHistorial,
} from "@/lib/presentacion/historial";

/**
 * La línea de tiempo de la ficha con filtros y agrupada (26/10/2026). Filtra
 * en el navegador, sin recargar: los movimientos llegan ya armados desde el
 * servidor (`nodo`, con su menú "Corregir") y acá solo se decide cuáles se ven
 * y bajo qué título.
 *
 * - Atajos "Todo" y "Solo lo importante" (pases, devoluciones y estados), y un
 *   botón por tipo de movimiento: botones con `aria-pressed`. Un historial
 *   largo abre en "Solo lo importante".
 * - Paso: un `<select>` con los pasos por los que pasó.
 * - Agrupar por paso (con el tiempo en cada área, en días hábiles) o por día.
 *
 * Lo filtrado queda en la página con `hidden` (los enlaces "Corrige…" y
 * "Corregido por…" siguen apuntando a algo), y el movimiento al que apunta la
 * dirección (`#mov-…`) se muestra aunque el filtro lo oculte.
 */

export interface EntradaHistorial {
  id: string;
  categoria: CategoriaHistorial;
  /** Orden del tramo (paso del circuito) en que está. */
  tramo: number;
  /** Clave del paso de ese tramo. */
  paso: string | null;
  /** Día de la fecha efectiva (la que vale) en Tucumán, `YYYY-MM-DD`, y cómo se muestra. */
  dia: string;
  diaTexto: string;
  /** Las clases del `<li>` (el punto de color y lo tachado). */
  clase: string;
  /** El movimiento armado en el servidor (`ItemMovimiento`). */
  nodo: React.ReactNode;
}

export interface GrupoTramo {
  orden: number;
  titulo: string;
  detalle: string;
  actual: boolean;
}

const CLASE_CHIP_BASE = `inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-[0.8125rem] leading-5 font-medium transition-colors duration-150 ${CLASE_FOCO}`;

function claseChip(apretado: boolean): string {
  return `${CLASE_CHIP_BASE} ${
    apretado ? "border-primario-oscuro bg-superficie-azul text-primario-oscuro" : "border-borde-control bg-white text-texto hover:bg-fondo"
  }`;
}

function suscribirHash(avisar: () => void): () => void {
  window.addEventListener("hashchange", avisar);
  return () => window.removeEventListener("hashchange", avisar);
}

function Chip({ apretado, onClick, children }: { apretado: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={apretado} onClick={onClick} className={claseChip(apretado)}>
      {apretado ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function HistorialFiltrable({
  entradas,
  tramos,
  pasos,
}: {
  entradas: readonly EntradaHistorial[];
  tramos: readonly GrupoTramo[];
  /** Los pasos por los que pasó, en orden, para el filtro. */
  pasos: ReadonlyArray<{ clave: string; nombre: string }>;
}) {
  const [filtro, setFiltro] = useState<FiltroHistorial>(() => filtroInicial(entradas.length));
  const id = useId();
  // El movimiento al que apunta la dirección (#mov-123): se ve aunque el filtro lo oculte.
  const hash = useSyncExternalStore(
    suscribirHash,
    () => window.location.hash,
    () => "",
  );
  const apuntado = hash.startsWith("#mov-") ? decodeURIComponent(hash.slice("#mov-".length)) : null;

  // Si el apuntado estaba oculto, el navegador no pudo llevar la vista hasta él: se hace al mostrarlo.
  useEffect(() => {
    if (apuntado) document.getElementById(`mov-${apuntado}`)?.scrollIntoView({ block: "start" });
  }, [apuntado]);

  if (entradas.length === 0) return <p className="text-sm text-texto-secundario">Sin movimientos.</p>;

  const visible = (e: EntradaHistorial) => e.id === apuntado || pasaFiltro(e, filtro);
  const cantidadVisibles = entradas.filter(visible).length;
  const atajo = atajoDe(filtro);
  const conteo = new Map<CategoriaHistorial, number>();
  for (const e of entradas) conteo.set(e.categoria, (conteo.get(e.categoria) ?? 0) + 1);
  const categoriasPresentes = CATEGORIAS_HISTORIAL.filter((c) => (conteo.get(c.clave) ?? 0) > 0);

  const grupos: Array<{ clave: string; titulo: string; detalle: string | null; actual: boolean; entradas: EntradaHistorial[] }> = [];
  if (filtro.agrupar === "paso") {
    for (const t of tramos) {
      grupos.push({ clave: `t${t.orden}`, titulo: t.titulo, detalle: t.detalle, actual: t.actual, entradas: entradas.filter((e) => e.tramo === t.orden) });
    }
  } else {
    // Por día de la fecha efectiva que vale: una fecha corregida puede caer en un día que ya apareció.
    const porDia = new Map<string, (typeof grupos)[number]>();
    for (const e of entradas) {
      const grupo = porDia.get(e.dia);
      if (grupo) grupo.entradas.push(e);
      else {
        const nuevo = { clave: `d${e.dia}`, titulo: e.diaTexto, detalle: null, actual: false, entradas: [e] };
        porDia.set(e.dia, nuevo);
        grupos.push(nuevo);
      }
    }
  }

  const fijar = (cambios: Partial<FiltroHistorial>) => setFiltro((f) => ({ ...f, ...cambios }));
  const agrupar = (a: AgrupacionHistorial) => fijar({ agrupar: a });

  return (
    <div>
      <div className="mb-4 space-y-2.5 rounded-control border border-borde bg-fondo/70 p-3 print:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div role="group" aria-labelledby={`${id}-mostrar`} className="flex flex-wrap items-center gap-1.5">
            <span id={`${id}-mostrar`} className="mr-1 text-xs font-semibold uppercase tracking-[0.06em] text-texto-secundario">
              Mostrar
            </span>
            <Chip apretado={atajo === "todo"} onClick={() => fijar({ categorias: new Set(TODAS_LAS_CATEGORIAS), paso: null })}>
              Todo
            </Chip>
            <Chip apretado={atajo === "importante"} onClick={() => fijar({ categorias: new Set(CATEGORIAS_IMPORTANTES), paso: null })}>
              Solo lo importante
            </Chip>
          </div>
          <div role="group" aria-labelledby={`${id}-agrupar`} className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            <span id={`${id}-agrupar`} className="mr-1 text-xs font-semibold uppercase tracking-[0.06em] text-texto-secundario">
              Agrupar por
            </span>
            <Chip apretado={filtro.agrupar === "paso"} onClick={() => agrupar("paso")}>
              Paso
            </Chip>
            <Chip apretado={filtro.agrupar === "dia"} onClick={() => agrupar("dia")}>
              Día
            </Chip>
          </div>
        </div>
        <div role="group" aria-labelledby={`${id}-tipos`} className="flex flex-wrap items-center gap-1.5">
          <span id={`${id}-tipos`} className="mr-1 text-xs font-semibold uppercase tracking-[0.06em] text-texto-secundario">
            Tipos de movimiento
          </span>
          {categoriasPresentes.map((c) => (
            <Chip key={c.clave} apretado={filtro.categorias.has(c.clave)} onClick={() => setFiltro((f) => alternarCategoria(f, c.clave))}>
              {c.etiqueta}
              <span className="tabular-nums text-texto-secundario">
                <span className="sr-only">(</span>
                {conteo.get(c.clave)}
                <span className="sr-only">)</span>
              </span>
            </Chip>
          ))}
        </div>
        {pasos.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-paso`} className="text-xs font-semibold uppercase tracking-[0.06em] text-texto-secundario">
              Paso
            </label>
            <select
              id={`${id}-paso`}
              value={filtro.paso ?? ""}
              onChange={(e) => fijar({ paso: e.target.value === "" ? null : e.target.value })}
              className={`${CLASE_CONTROL} max-w-xs`}
            >
              <option value="">Todos los pasos</option>
              {pasos.map((p) => (
                <option key={p.clave} value={p.clave}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {/* Región viva sin role="status": el aviso de la última acción de la ficha es el `status` de la página. */}
        <p aria-live="polite" aria-atomic="true" className="text-xs text-texto-secundario">
          {textoConteo(cantidadVisibles, entradas.length)}
        </p>
      </div>

      {cantidadVisibles === 0 ? (
        <p className="text-sm text-texto-secundario">
          Ningún movimiento con estos filtros.{" "}
          <button
            type="button"
            onClick={() => fijar({ categorias: new Set(TODAS_LAS_CATEGORIAS), paso: null })}
            className="rounded-sm text-primario-oscuro underline underline-offset-2 hover:text-institucional"
          >
            Mostrar todo
          </button>
        </p>
      ) : null}

      <div className="space-y-4">
        {grupos.map((g) => {
          const algunoVisible = g.entradas.some(visible);
          return (
            <div key={g.clave} hidden={!algunoVisible}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-borde pb-1">
                <h3 className="text-sm font-semibold text-institucional">{g.titulo}</h3>
                {g.actual ? <span className="insignia bg-primario text-white">Está acá</span> : null}
                {g.detalle ? <p className="text-xs text-texto-secundario tabular-nums">{g.detalle}</p> : null}
              </div>
              <ol className="ml-1">
                {g.entradas.map((e) => (
                  <li key={e.id} id={`mov-${e.id}`} hidden={!visible(e)} className={e.clase}>
                    {e.nodo}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}
