import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import type { TramoHistorial } from "@/lib/dominio/expedientes/tramos";
import { formatearFechaHora, formatearSegunPrecision } from "@/lib/fechas";
import { detalleTramo, resumenMovimiento, tituloTramo, type ContextoResumen } from "@/lib/presentacion/historial";
import { etiquetaMovimiento } from "@/lib/presentacion/textos";

/**
 * El historial (2.13(c)): cada movimiento con su fecha efectiva (con la
 * precisión con que se cargó), cuándo y quién lo registró, la fuente si es
 * histórico y, semana 4 (2.13(b)), sus correcciones: lo revertido o corregido
 * se muestra tachado con el enlace a la corrección, una fecha u observación
 * corregida muestra la original tachada y la que vale, y cada corrección
 * enlaza al movimiento que corrige.
 *
 * 26/10/2026: agrupado por paso del circuito (`tramos`), con el tiempo que
 * estuvo en cada área en días hábiles. `LineaDeTiempo` es la de la hoja
 * impresa (todo, agrupado); la ficha arma cada movimiento con
 * `ItemMovimiento` y los filtra y agrupa en el navegador
 * (./[numero]/historial-filtrable.tsx), sin recargar.
 */

/** Tachado entero: revertido, o corregido en algo que no es la fecha ni la observación (un tilde, un adjunto retirado). */
function estaTachado(m: MovimientoFicha): boolean {
  return m.revertido || (m.corregidoPor.length > 0 && !m.fechaCorregida && !m.observacionCorregida);
}

/** Las clases del `<li id="mov-…">` de un movimiento: la raya, el punto de color según el tipo y lo apuntado por la dirección. */
export function claseItemMovimiento(m: MovimientoFicha): string {
  const punto = estaTachado(m) ? "before:bg-borde-control" : m.tipo === "pase" ? "before:bg-primario" : m.tipo === "devolucion" ? "before:bg-error" : "before:bg-institucional";
  return `relative scroll-mt-4 break-inside-avoid border-l-2 border-borde pb-3 pl-4 last:pb-0 target:rounded-r-control target:bg-advertencia-fondo print:border-borde-control print:before:hidden before:absolute before:-left-[7px] before:top-1 before:h-3 before:w-3 before:rounded-full before:border-2 before:border-white ${punto}`;
}

/** Lo que va adentro del `<li>` de un movimiento (el `<li>` lo pone quien lo lista, con `claseItemMovimiento`). */
export function ItemMovimiento({
  movimiento: m,
  porId,
  contexto,
  extra,
}: {
  movimiento: MovimientoFicha;
  /** Todos los movimientos por id, para nombrar las correcciones y lo corregido. */
  porId: ReadonlyMap<string, MovimientoFicha>;
  contexto: ContextoResumen;
  /** Lo que va a la derecha (el menú "Corregir" en la ficha). */
  extra?: React.ReactNode;
}) {
  const fechaDe = (id: string) => {
    const x = porId.get(id);
    return x ? `${etiquetaMovimiento(x.tipo).toLowerCase()} del ${formatearSegunPrecision(x.fechaEfectiva, x.precisionFecha)}` : "un movimiento anterior";
  };
  const tachado = estaTachado(m);
  const lineas = resumenMovimiento(m, contexto);
  const observacion = m.observacionCorregida ? m.observacionCorregida.valor : m.observacion;
  // La fecha de registro se muestra si no es la misma que se ve como fecha efectiva (al minuto).
  const vale = m.fechaCorregida ?? { fechaEfectiva: m.fechaEfectiva, precisionFecha: m.precisionFecha };
  const registro = formatearFechaHora(m.registradoEn);
  const registroDistinto = registro !== formatearSegunPrecision(vale.fechaEfectiva, vale.precisionFecha);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className={tachado ? "text-texto-secundario line-through decoration-texto-secundario" : undefined}>
          <p className="text-sm">
            {m.fechaCorregida ? (
              <>
                <s className="text-texto-secundario" aria-label={`Fecha original: ${formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}`}>
                  {formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}
                </s>{" "}
                <span className="font-medium text-texto">{formatearSegunPrecision(m.fechaCorregida.fechaEfectiva, m.fechaCorregida.precisionFecha)}</span>
              </>
            ) : (
              <span className="font-medium text-texto">{formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}</span>
            )}
            {" · "}
            <span className="font-semibold text-texto">{etiquetaMovimiento(m.tipo)}</span>
            {m.areaUsuario ? <span className="text-texto-secundario"> · {m.areaUsuario.nombre}</span> : null}
            {m.revertido ? <span className="insignia ml-2 bg-fondo text-texto no-underline ring-1 ring-inset ring-borde">Revertido</span> : null}
          </p>
          {lineas.map((l) => (
            <p key={l} className="text-sm text-texto">
              {l}
            </p>
          ))}
          {m.motivo ? <p className="text-sm text-texto">Motivo: {m.motivo}</p> : null}
          {m.observacionCorregida ? (
            <p className="text-sm text-texto">
              Observación:{" "}
              {m.observacion ? (
                <s className="text-texto-secundario" aria-label={`Observación original: ${m.observacion}`}>
                  {m.observacion}
                </s>
              ) : null}{" "}
              {observacion ?? <span className="text-texto-secundario">(borrada)</span>}
            </p>
          ) : observacion ? (
            <p className="text-sm text-texto">Observación: {observacion}</p>
          ) : null}
        </div>
        {extra ? <div className="shrink-0">{extra}</div> : null}
      </div>
      <p className="text-xs text-texto-secundario">
        {registroDistinto ? `Cargado el ${registro} por` : "Cargado por"} {m.usuario.corto}
        {m.fuente ? ` · fuente: ${m.fuente}` : ""}
        {m.cargaHistorica ? " · carga histórica" : ""}
        {m.diferido ? " · cargado después (más de 48 h)" : ""}
        {m.precisionFecha === "dia" ? " · fecha sin hora" : ""}
      </p>
      {m.corrigeMovimientoId ? (
        <p className="text-xs text-texto-secundario">
          Corrige{" "}
          <a href={`#mov-${m.corrigeMovimientoId}`} className="underline underline-offset-2 hover:text-texto">
            {fechaDe(m.corrigeMovimientoId)}
          </a>
        </p>
      ) : null}
      {m.corregidoPor.length > 0 ? (
        <p className="text-xs text-texto-secundario">
          {m.revertido ? "Revertido por " : "Corregido por "}
          {m.corregidoPor.map((id, i) => {
            const c = porId.get(id);
            return (
              <span key={id}>
                {i > 0 ? ", " : ""}
                <a href={`#mov-${id}`} className="underline underline-offset-2 hover:text-texto">
                  {c ? `la corrección del ${formatearFechaHora(c.registradoEn)}` : "una corrección"}
                </a>
              </span>
            );
          })}
        </p>
      ) : m.revertido ? (
        <p className="text-xs text-texto-secundario">Revertido junto con otro movimiento.</p>
      ) : null}
    </>
  );
}

/** El título de un grupo de la línea de tiempo: paso y área, y cuánto estuvo (días hábiles). */
export function EncabezadoTramo({ tramo: t, nivel = 3 }: { tramo: TramoHistorial; nivel?: 2 | 3 }) {
  const Titulo = nivel === 2 ? "h2" : "h3";
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-borde pb-1 print:border-borde-control">
      <Titulo className="text-sm font-semibold text-institucional">{tituloTramo(t)}</Titulo>
      {t.actual ? <span className="insignia bg-primario text-white print:bg-white print:text-texto print:ring-1 print:ring-borde-control">Está acá</span> : null}
      <p className="text-xs text-texto-secundario tabular-nums">{detalleTramo(t)}</p>
    </div>
  );
}

/**
 * La línea de tiempo completa: agrupada por tramo si se pasan `tramos` (la
 * hoja impresa), o de corrido.
 */
export function LineaDeTiempo({
  historial,
  tramos,
  contexto,
  acciones,
  nivelTitulos = 3,
}: {
  historial: readonly MovimientoFicha[];
  tramos?: readonly TramoHistorial[];
  /** El nivel de los títulos de cada tramo: 2 en la hoja impresa (debajo del h1), 3 debajo de un bloque. */
  nivelTitulos?: 2 | 3;
  contexto: ContextoResumen;
  /** Lo que va a la derecha de cada movimiento (el menú "Corregir" en la ficha). */
  acciones?: (m: MovimientoFicha) => React.ReactNode;
}) {
  if (historial.length === 0) return <p className="text-sm text-texto-secundario">Sin movimientos.</p>;
  const porId = new Map(historial.map((m) => [m.id, m]));
  const item = (m: MovimientoFicha) => (
    <li key={m.id} id={`mov-${m.id}`} className={claseItemMovimiento(m)}>
      <ItemMovimiento movimiento={m} porId={porId} contexto={contexto} extra={acciones?.(m)} />
    </li>
  );
  if (!tramos || tramos.length === 0) return <ol className="ml-1">{historial.map(item)}</ol>;
  return (
    <div className="space-y-4">
      {tramos.map((t) => (
        <div key={t.orden} className="break-inside-avoid-page">
          <EncabezadoTramo tramo={t} nivel={nivelTitulos} />
          <ol className="ml-1">
            {t.movimientos.map((id) => {
              const m = porId.get(id);
              return m ? item(m) : null;
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
