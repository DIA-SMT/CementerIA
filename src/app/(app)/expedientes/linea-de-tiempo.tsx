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
  if (historial.length === 0) return <p className="text-sm text-texto-secundario">Sin movimientos.</p>;
  const porId = new Map(historial.map((m) => [m.id, m]));
  const fechaDe = (id: string) => {
    const m = porId.get(id);
    return m ? `${etiquetaMovimiento(m.tipo).toLowerCase()} del ${formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}` : "un movimiento anterior";
  };
  return (
    <ol className="ml-1">
      {historial.map((m) => {
        // Tachado entero: revertido, o corregido en algo que no es la fecha ni la observación (un tilde, un adjunto retirado).
        const tachado = m.revertido || (m.corregidoPor.length > 0 && !m.fechaCorregida && !m.observacionCorregida);
        const lineas = resumenMovimiento(m, contexto);
        const extra = acciones?.(m);
        const observacion = m.observacionCorregida ? m.observacionCorregida.valor : m.observacion;
        return (
          <li key={m.id} id={`mov-${m.id}`} className={`relative scroll-mt-4 break-inside-avoid border-l-2 border-borde pb-3 pl-4 last:pb-0 target:rounded-r-control target:bg-advertencia-fondo print:border-borde-control print:before:hidden before:absolute before:-left-[7px] before:top-1 before:h-3 before:w-3 before:rounded-full before:border-2 before:border-white ${
              tachado ? "before:bg-borde-control" : m.tipo === "pase" ? "before:bg-primario" : m.tipo === "devolucion" ? "before:bg-error" : "before:bg-institucional"
            }`}>
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
                  {m.revertido ? (
                    <span className="insignia ml-2 bg-fondo text-texto no-underline ring-1 ring-inset ring-borde">Revertido</span>
                  ) : null}
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
              Cargado el {formatearFechaHora(m.registradoEn)} por {m.usuario.corto}
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
          </li>
        );
      })}
    </ol>
  );
}
