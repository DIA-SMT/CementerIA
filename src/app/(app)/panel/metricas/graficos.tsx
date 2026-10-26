import { escala, porcentajeDe, saltoDeRotulos } from "@/lib/presentacion/graficos";
import { textoNumero } from "@/lib/presentacion/metricas";

/**
 * Gráficos hechos a mano, en HTML y CSS (docs/diseno.md, "Gráficos"): sin
 * librerías y sin JavaScript en el navegador. Cada uno es un `figure` con un
 * `role="img"` y su texto alternativo (lo que muestra, en una frase); los
 * números van en la tabla accesible que lo acompaña, que es la fuente de
 * verdad. El color nunca es la única señal: hay leyenda cuando hay dos series
 * y el valor va escrito en la punta de cada barra. Cada barra tiene su globo
 * (`title`) con el dato completo.
 *
 * Colores (tokens de globals.css, contra blanco ≥ 3:1, WCAG 1.4.11):
 * `primario` (la serie principal), `institucional` (la segunda o lo
 * destacado) y `borde-control` (la línea de base, en gris). Al imprimir se
 * conservan (`print-color-adjust: exact`).
 */

export interface Serie {
  nombre: string;
  /** Clase de fondo del token: `bg-primario`, `bg-institucional`, `bg-borde-control`. */
  clase: string;
}

export const SERIE_PRINCIPAL: Serie = { nombre: "Con el sistema", clase: "bg-primario" };
export const SERIE_ANTES: Serie = { nombre: "Antes del sistema", clase: "bg-borde-control" };

/** La leyenda (con dos series o más): muestra de color y nombre, en texto del sistema. */
export function Leyenda({ series }: { series: readonly Serie[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-secundario" aria-hidden="true">
      {series.map((s) => (
        <li key={s.nombre} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-xs ${s.clase}`} />
          {s.nombre}
        </li>
      ))}
    </ul>
  );
}

export interface FilaBarras {
  clave: string;
  etiqueta: string;
  /** Una línea chica debajo de la etiqueta (el área, la cantidad de casos). */
  detalle?: string;
  /** Un valor por serie, en el mismo orden; null si no hay dato. */
  valores: Array<number | null>;
  /** Lo que dice el globo de cada barra (por defecto, el número). */
  globos?: string[];
  /** Se dibuja con `institucional` y una marca en texto (el cuello de botella). */
  destacada?: string;
}

/**
 * Barras horizontales (tiempos por paso, motivos, carga). La etiqueta va a la
 * izquierda; en un contenedor angosto, arriba de las barras. El número va en
 * la punta de la barra, en el margen que se reserva a la derecha: nunca se
 * corta ni se sale.
 */
export function BarrasHorizontales({
  alt,
  filas,
  series,
  unidad,
  maximo,
}: {
  alt: string;
  filas: readonly FilaBarras[];
  series: readonly Serie[];
  /** El nombre del eje ("días hábiles", "expedientes"). */
  unidad: string;
  /** El tope mínimo del eje (para que dos gráficos comparables usen la misma escala). */
  maximo?: number;
}) {
  const valores = filas.flatMap((f) => f.valores.filter((v): v is number => v !== null));
  const e = escala(Math.max(maximo ?? 0, ...valores, 0));
  return (
    <figure className="@container space-y-3 [print-color-adjust:exact]">
      <Leyenda series={series} />
      <div role="img" aria-label={alt} className="space-y-3">
        {filas.map((f) => (
          <div key={f.clave} className="grid grid-cols-1 gap-x-4 gap-y-1 @xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @xl:items-center">
            <div className="min-w-0 text-sm leading-tight text-texto">
              <span className="font-medium">{f.etiqueta}</span>
              {f.destacada ? (
                <span className="ml-1.5 inline-flex rounded-full bg-institucional px-1.5 py-px align-middle text-[0.6875rem] font-semibold text-white">
                  {f.destacada}
                </span>
              ) : null}
              {f.detalle ? <span className="block text-xs text-texto-secundario">{f.detalle}</span> : null}
            </div>
            <div className="space-y-1">
              {f.valores.map((v, i) => {
                const serie = series[i] ?? series[0];
                const pct = porcentajeDe(v, e.tope);
                const clase = f.destacada && i === 0 ? "bg-institucional" : serie.clase;
                return (
                  <div key={serie.nombre} className="relative mr-14 h-3.5" title={f.globos?.[i] ?? `${f.etiqueta} · ${serie.nombre}: ${textoNumero(v)} ${unidad}`}>
                    {/* Las marcas del eje, detrás de la barra. */}
                    {e.marcas.slice(1).map((m) => (
                      <span key={m} aria-hidden="true" className="absolute inset-y-0 w-px bg-borde" style={{ left: `${porcentajeDe(m, e.tope)}%` }} />
                    ))}
                    {v !== null ? (
                      <>
                        <span className={`absolute inset-y-0 left-0 rounded-r-[4px] ${clase}`} style={{ width: `${Math.max(pct, v > 0 ? 0.75 : 0)}%` }} />
                        <span className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-xs font-medium tabular-nums text-texto" style={{ left: `${pct}%` }}>
                          {textoNumero(v)}
                        </span>
                      </>
                    ) : (
                      <span className="absolute top-1/2 left-0 -translate-y-1/2 text-xs text-texto-secundario">sin datos</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {/* El eje, alineado con las barras. */}
        <div className="grid grid-cols-1 gap-x-4 @xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]" aria-hidden="true">
          <span className="hidden @xl:block" />
          <div className="relative mr-14 h-4 border-t border-borde-control text-[0.6875rem] text-texto-secundario">
            {e.marcas.map((m, i) => (
              <span
                key={m}
                className={`absolute top-0.5 tabular-nums ${i === 0 ? "" : i === e.marcas.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${porcentajeDe(m, e.tope)}%` }}
              >
                {m.toLocaleString("es-AR")}
              </span>
            ))}
          </div>
        </div>
        <p className="text-right text-[0.6875rem] text-texto-secundario" aria-hidden="true">
          {unidad}
        </p>
      </div>
    </figure>
  );
}

export interface GrupoColumnas {
  clave: string;
  /** El rótulo corto del eje ("oct 26"). */
  rotulo: string;
  /** El nombre completo, para el globo ("octubre de 2026"). */
  nombre: string;
  valores: number[];
}

/**
 * Columnas agrupadas (flujo por período, stock). Eje vertical a la izquierda
 * con marcas enteras y líneas finas; el valor va sobre cada columna cuando hay
 * lugar (16 columnas o menos), y si hay muchos períodos los rótulos del eje se
 * saltean (el dato sigue en el globo y en la tabla).
 */
export function Columnas({ alt, grupos, series, unidad }: { alt: string; grupos: readonly GrupoColumnas[]; series: readonly Serie[]; unidad: string }) {
  const e = escala(Math.max(0, ...grupos.flatMap((g) => g.valores)));
  const salto = saltoDeRotulos(grupos.length);
  const conValores = grupos.length * series.length <= 16;
  return (
    <figure className="space-y-3 [print-color-adjust:exact]">
      <Leyenda series={series} />
      <div role="img" aria-label={alt}>
        <div className="flex gap-2">
          {/* Eje vertical. */}
          <div className="relative h-48 w-8 shrink-0 text-right text-[0.6875rem] text-texto-secundario tabular-nums" aria-hidden="true">
            {e.marcas.map((m) => (
              <span key={m} className="absolute right-0 translate-y-1/2" style={{ bottom: `${porcentajeDe(m, e.tope)}%` }}>
                {m.toLocaleString("es-AR")}
              </span>
            ))}
          </div>
          <div className="relative h-48 min-w-0 flex-1 border-b border-borde-control">
            {e.marcas.slice(1).map((m) => (
              <span key={m} aria-hidden="true" className="absolute inset-x-0 h-px bg-borde" style={{ bottom: `${porcentajeDe(m, e.tope)}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-1 sm:gap-2">
              {grupos.map((g) => (
                <div key={g.clave} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
                  {g.valores.map((v, i) => {
                    const serie = series[i] ?? series[0];
                    const pct = porcentajeDe(v, e.tope);
                    return (
                      <div key={serie.nombre} className="relative flex h-full min-w-0 max-w-6 flex-1 items-end" title={`${g.nombre} · ${serie.nombre}: ${v.toLocaleString("es-AR")} ${unidad}`}>
                        <span className={`block w-full rounded-t-[4px] ${serie.clase}`} style={{ height: `${Math.max(pct, v > 0 ? 1 : 0)}%` }} />
                        {conValores ? (
                          <span
                            className="absolute left-1/2 -translate-x-1/2 pb-0.5 text-[0.6875rem] font-medium tabular-nums text-texto"
                            style={{ bottom: `${pct}%` }}
                            aria-hidden="true"
                          >
                            {v.toLocaleString("es-AR")}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Rótulos del eje horizontal. */}
        <div className="ml-10 flex gap-1 pt-1 text-[0.6875rem] text-texto-secundario sm:gap-2" aria-hidden="true">
          {grupos.map((g, i) => (
            <span key={g.clave} className="min-w-0 flex-1 truncate text-center">
              {i % salto === 0 ? g.rotulo : ""}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
