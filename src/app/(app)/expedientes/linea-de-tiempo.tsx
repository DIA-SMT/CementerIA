import type { MovimientoFicha } from "@/lib/dominio/expedientes/ficha";
import { formatearFechaHora, formatearSegunPrecision } from "@/lib/fechas";
import { resumenMovimiento, type ContextoResumen } from "@/lib/presentacion/historial";
import { etiquetaMovimiento } from "@/lib/presentacion/textos";

/**
 * El historial (2.13(c)): cada movimiento con su fecha efectiva (con la
 * precisión con que se cargó), cuándo y quién lo registró, la fuente si es
 * histórico y, si se corrigió, tachado. Lo usan la ficha y la hoja impresa.
 */
export function LineaDeTiempo({ historial, contexto }: { historial: readonly MovimientoFicha[]; contexto: ContextoResumen }) {
  if (historial.length === 0) return <p className="text-sm text-slate-600">Sin movimientos.</p>;
  return (
    <ol className="space-y-3">
      {historial.map((m) => {
        const corregido = m.corregidoPor.length > 0;
        const lineas = resumenMovimiento(m, contexto);
        return (
          <li key={m.id} className="break-inside-avoid border-l-2 border-slate-300 pl-3 print:border-slate-500">
            <div className={corregido ? "text-slate-500 line-through decoration-slate-500" : undefined}>
              <p className="text-sm">
                <span className="font-medium text-slate-900">{formatearSegunPrecision(m.fechaEfectiva, m.precisionFecha)}</span>
                {" · "}
                <span className="font-medium">{etiquetaMovimiento(m.tipo)}</span>
                {m.areaUsuario ? <span className="text-slate-700"> · {m.areaUsuario.nombre}</span> : null}
              </p>
              {lineas.map((l) => (
                <p key={l} className="text-sm text-slate-800">
                  {l}
                </p>
              ))}
              {m.motivo ? <p className="text-sm text-slate-800">Motivo: {m.motivo}</p> : null}
              {m.observacion ? <p className="text-sm text-slate-800">Observación: {m.observacion}</p> : null}
            </div>
            <p className="text-xs text-slate-600">
              Cargado el {formatearFechaHora(m.registradoEn)} por {m.usuario.corto}
              {m.fuente ? ` · fuente: ${m.fuente}` : ""}
              {m.cargaHistorica ? " · carga histórica" : ""}
              {m.diferido ? " · cargado después (más de 48 h)" : ""}
              {m.precisionFecha === "dia" ? " · fecha sin hora" : ""}
              {m.corrigeMovimientoId ? " · corrige un movimiento anterior" : ""}
              {corregido ? " · corregido más adelante" : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
