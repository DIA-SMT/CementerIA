import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import { formatearFechaHora, formatearSegunPrecision } from "@/lib/fechas";
import { resumenMovimiento, type ContextoResumen } from "@/lib/presentacion/historial";
import { etiquetaMovimiento } from "@/lib/presentacion/textos";

/**
 * El historial (2.13(c)): cada movimiento con su fecha efectiva (con la
 * precisión con que se cargó), cuándo y quién lo registró, la fuente si es
 * histórico y, semana 4 (2.13(b)), sus correcciones: lo revertido o corregido
 * se muestra tachado con el enlace a la corrección, una fecha u observación
 * corregida muestra la original tachada y la que vale, y cada corrección
 * enlaza al movimiento que corrige. Lo usan la ficha (con el menú "Corregir"
 * de cada movimiento, `acciones`) y la hoja impresa.
 */
export function LineaDeTiempo({
  historial,
  contexto,
  acciones,
}: {
  historial: readonly MovimientoFicha[];
  contexto: ContextoResumen;
  /** Lo que va a la derecha de cada movimiento (el menú "Corregir" en la ficha). */
  acciones?: (m: MovimientoFicha) => React.ReactNode;
}) {
  if (historial.length === 0) return <p className="text-sm text-slate-600">Sin movimientos.</p>;
  const porId = new Map(historial.map((m) => [m.id, m]));
  const fechaDe = (id: string) => {
    const m = porId.get(id);
    return m ? `${etiquetaMovimiento(m.tipo).toLowerCase()} del ${formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}` : "un movimiento anterior";
  };
  return (
    <ol className="space-y-3">
      {historial.map((m) => {
        // Tachado entero: revertido, o corregido en algo que no es la fecha ni la observación (un tilde, un adjunto retirado).
        const tachado = m.revertido || (m.corregidoPor.length > 0 && !m.fechaCorregida && !m.observacionCorregida);
        const lineas = resumenMovimiento(m, contexto);
        const extra = acciones?.(m);
        const observacion = m.observacionCorregida ? m.observacionCorregida.valor : m.observacion;
        return (
          <li key={m.id} id={`mov-${m.id}`} className="scroll-mt-4 break-inside-avoid border-l-2 border-slate-300 pl-3 target:bg-amber-50 print:border-slate-500">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className={tachado ? "text-slate-500 line-through decoration-slate-500" : undefined}>
                <p className="text-sm">
                  {m.fechaCorregida ? (
                    <>
                      <s className="text-slate-500" aria-label={`Fecha original: ${formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}`}>
                        {formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}
                      </s>{" "}
                      <span className="font-medium text-slate-900">{formatearSegunPrecision(m.fechaCorregida.fechaEfectiva, m.fechaCorregida.precisionFecha)}</span>
                    </>
                  ) : (
                    <span className="font-medium text-slate-900">{formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}</span>
                  )}
                  {" · "}
                  <span className="font-medium">{etiquetaMovimiento(m.tipo)}</span>
                  {m.areaUsuario ? <span className="text-slate-700"> · {m.areaUsuario.nombre}</span> : null}
                  {m.revertido ? (
                    <span className="ml-2 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-800 no-underline">Revertido</span>
                  ) : null}
                </p>
                {lineas.map((l) => (
                  <p key={l} className="text-sm text-slate-800">
                    {l}
                  </p>
                ))}
                {m.motivo ? <p className="text-sm text-slate-800">Motivo: {m.motivo}</p> : null}
                {m.observacionCorregida ? (
                  <p className="text-sm text-slate-800">
                    Observación:{" "}
                    {m.observacion ? (
                      <s className="text-slate-500" aria-label={`Observación original: ${m.observacion}`}>
                        {m.observacion}
                      </s>
                    ) : null}{" "}
                    {observacion ?? <span className="text-slate-600">(borrada)</span>}
                  </p>
                ) : observacion ? (
                  <p className="text-sm text-slate-800">Observación: {observacion}</p>
                ) : null}
              </div>
              {extra ? <div className="shrink-0">{extra}</div> : null}
            </div>
            <p className="text-xs text-slate-600">
              Cargado el {formatearFechaHora(m.registradoEn)} por {m.usuario.corto}
              {m.fuente ? ` · fuente: ${m.fuente}` : ""}
              {m.cargaHistorica ? " · carga histórica" : ""}
              {m.diferido ? " · cargado después (más de 48 h)" : ""}
              {m.precisionFecha === "dia" ? " · fecha sin hora" : ""}
            </p>
            {m.corrigeMovimientoId ? (
              <p className="text-xs text-slate-700">
                Corrige{" "}
                <a href={`#mov-${m.corrigeMovimientoId}`} className="underline underline-offset-2 hover:text-slate-900">
                  {fechaDe(m.corrigeMovimientoId)}
                </a>
              </p>
            ) : null}
            {m.corregidoPor.length > 0 ? (
              <p className="text-xs text-slate-700">
                {m.revertido ? "Revertido por " : "Corregido por "}
                {m.corregidoPor.map((id, i) => {
                  const c = porId.get(id);
                  return (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      <a href={`#mov-${id}`} className="underline underline-offset-2 hover:text-slate-900">
                        {c ? `la corrección del ${formatearFechaHora(c.registradoEn)}` : "una corrección"}
                      </a>
                    </span>
                  );
                })}
              </p>
            ) : m.revertido ? (
              <p className="text-xs text-slate-700">Revertido junto con otro movimiento.</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
