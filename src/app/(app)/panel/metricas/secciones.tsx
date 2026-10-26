import { Aviso } from "@/components/aviso";
import type { FilaTiempos, Metricas } from "@/lib/dominio/metricas";
import { rotuloPeriodo, textoDiasHabiles, textoNumero, textoPeriodo, textoPorcentaje } from "@/lib/presentacion/metricas";
import { textoCantidad } from "@/lib/presentacion/panel";
import { BarrasHorizontales, Columnas, SERIE_ANTES, SERIE_PRINCIPAL, type FilaBarras } from "./graficos";
import { BotonCsv, CLASE_CELDA, CLASE_NUMERO, MarcaMuestra, NumeroEnlazado, Seccion, textoConN } from "./piezas";

/**
 * Las secciones de `/panel/metricas`. Cada una: un gráfico simple (si ayuda) y
 * la tabla con los números, que es lo que lee un lector de pantalla y lo que
 * baja "Exportar CSV". Tablas apilables (docs/diseno.md, "Tablas y tarjetas").
 */

const CONTENEDOR_TABLA = "relative @container overflow-x-auto rounded-control border border-borde";

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-texto-secundario">{children}</p>;
}

// ---------------------------------------------------------------------------
// Punta a punta
// ---------------------------------------------------------------------------

function TablaTiempos({ titulo, filas, minimo }: { titulo: string; filas: readonly FilaTiempos[]; minimo: number }) {
  return (
    <div className={CONTENEDOR_TABLA}>
      <table className="tabla-datos tabla-apilable">
        <caption className="sr-only">{titulo}, en días hábiles</caption>
        <thead>
          <tr>
            <th scope="col" className={CLASE_CELDA}>{titulo}</th>
            <th scope="col" className={`${CLASE_CELDA} text-right`}>Concluidos</th>
            <th scope="col" className={`${CLASE_CELDA} text-right`}>Mediana</th>
            <th scope="col" className={`${CLASE_CELDA} text-right`}>Promedio</th>
            <th scope="col" className={`${CLASE_CELDA} text-right`}>Percentil 90</th>
            <th scope="col" className={`${CLASE_CELDA} text-right`}>Antes del sistema (mediana)</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave}>
              <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>{f.etiqueta}</th>
              <td data-etiqueta="Concluidos" className={CLASE_NUMERO}>
                {f.conSistema.n}
                <MarcaMuestra n={f.conSistema.n} minimo={minimo} />
              </td>
              <td data-etiqueta="Mediana" className={`${CLASE_NUMERO} font-semibold text-institucional`}>{textoNumero(f.conSistema.mediana)}</td>
              <td data-etiqueta="Promedio" className={CLASE_NUMERO}>{textoNumero(f.conSistema.promedio)}</td>
              <td data-etiqueta="Percentil 90" className={CLASE_NUMERO}>{textoNumero(f.conSistema.p90)}</td>
              <td data-etiqueta="Antes (mediana)" className={CLASE_NUMERO}>{textoConN(f.antes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SeccionPuntaAPunta({ m }: { m: Metricas }) {
  const { total, porTipo, porPlantilla } = m.puntaAPunta;
  const filas: FilaBarras[] = porTipo.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: `${textoCantidad(f.conSistema.n, "concluido", "concluidos")}${f.antes.n > 0 ? ` · antes: ${f.antes.n}` : ""}`,
    valores: total.antes.n > 0 ? [f.conSistema.mediana, f.antes.mediana] : [f.conSistema.mediana],
  }));
  return (
    <Seccion
      id="punta-a-punta"
      titulo="Tiempo de punta a punta de los concluidos"
      descripcion="Días hábiles desde la fecha de inicio hasta que se concluyó, de los concluidos en el período. La mediana es el valor del medio; el percentil 90, el tiempo en que se resolvieron 9 de cada 10."
      tabla="punta-a-punta"
      filtros={m.filtros}
    >
      {total.conSistema.n === 0 ? (
        <Vacio>No hay expedientes concluidos en el período.</Vacio>
      ) : (
        <BarrasHorizontales
          alt={`Mediana de días hábiles de punta a punta por tipo de trámite. En total: ${textoDiasHabiles(total.conSistema.mediana)} con el sistema${total.antes.n > 0 ? ` y ${textoDiasHabiles(total.antes.mediana)} antes del sistema` : ""}. El detalle está en la tabla que sigue.`}
          filas={filas}
          series={total.antes.n > 0 ? [SERIE_PRINCIPAL, SERIE_ANTES] : [SERIE_PRINCIPAL]}
          unidad="días hábiles (mediana)"
        />
      )}
      <TablaTiempos titulo="Tipo de trámite" filas={[total, ...porTipo]} minimo={m.lineaBase.minimo} />
      {porPlantilla.length > 0 ? <TablaTiempos titulo="Plantilla" filas={porPlantilla} minimo={m.lineaBase.minimo} /> : null}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Por paso y área
// ---------------------------------------------------------------------------

export function SeccionPasos({ m }: { m: Metricas }) {
  const conCasos = m.pasos.filter((p) => p.tiempos.n > 0);
  const cuello = m.resumen.cuelloMediana?.clave;
  const acumulado = m.resumen.cuelloAcumulado?.clave;
  return (
    <Seccion
      id="pasos"
      titulo="Tiempo por paso y área"
      descripcion="Días hábiles desde que el papel llega a un paso hasta que sale (por pase, devolución o cambio de estado), de las estadías que salieron en el período. Los pasos externos (DIM, cementerios) incluyen la espera afuera."
      tabla="pasos"
      filtros={m.filtros}
    >
      {conCasos.length === 0 ? (
        <Vacio>Ningún expediente salió de un paso en el período.</Vacio>
      ) : (
        <BarrasHorizontales
          alt={`Mediana de días hábiles en cada paso. El cuello de botella es ${m.resumen.cuelloMediana?.paso} en ${m.resumen.cuelloMediana?.area.nombre}, con ${textoDiasHabiles(m.resumen.cuelloMediana?.tiempos.mediana)} de mediana. El detalle está en la tabla que sigue.`}
          filas={conCasos.map((p) => ({
            clave: p.clave,
            etiqueta: p.paso,
            detalle: `${p.area.nombre} · ${textoCantidad(p.tiempos.n, "salida", "salidas")}`,
            valores: [p.tiempos.mediana],
            destacada: p.clave === cuello ? "Cuello de botella" : undefined,
          }))}
          series={[SERIE_PRINCIPAL]}
          unidad="días hábiles (mediana)"
        />
      )}
      {m.pasos.length > 0 ? (
        <div className={CONTENEDOR_TABLA}>
          <table className="tabla-datos tabla-apilable-amplia">
            <caption className="sr-only">Tiempo en cada paso y área, en días hábiles</caption>
            <thead>
              <tr>
                <th scope="col" className={CLASE_CELDA}>Paso y área</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Salidas</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Mediana</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Percentil 90</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Acumulado</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Superaron la alerta</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Hoy en el paso</th>
              </tr>
            </thead>
            <tbody>
              {m.pasos.map((p) => (
                <tr key={p.clave}>
                  <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                    {p.paso}
                    {p.clave === cuello ? <span className="block text-xs font-semibold text-institucional">Cuello de botella (mayor mediana)</span> : null}
                    {p.clave === acumulado ? <span className="block text-xs font-semibold text-institucional">Más días acumulados</span> : null}
                    <span className="block text-xs text-texto-secundario">
                      {p.area.nombre}
                      {p.area.externa ? " (externa)" : ""}
                    </span>
                  </th>
                  <td data-etiqueta="Salidas" className={CLASE_NUMERO}>{p.tiempos.n}</td>
                  <td data-etiqueta="Mediana" className={`${CLASE_NUMERO} font-semibold text-institucional`}>{textoNumero(p.tiempos.mediana)}</td>
                  <td data-etiqueta="Percentil 90" className={CLASE_NUMERO}>{textoNumero(p.tiempos.p90)}</td>
                  <td data-etiqueta="Acumulado" className={CLASE_NUMERO}>{p.tiempos.total.toLocaleString("es-AR")}</td>
                  <td data-etiqueta="Superaron la alerta" className={CLASE_NUMERO}>
                    {p.superaronAlerta}
                    {p.diasAlerta !== null ? <span className="block text-xs text-texto-secundario">alerta: {p.diasAlerta}</span> : null}
                  </td>
                  <td data-etiqueta="Hoy en el paso" className={CLASE_NUMERO}>{p.hoy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Recepción
// ---------------------------------------------------------------------------

export function SeccionRecepcion({ m }: { m: Metricas }) {
  return (
    <Seccion
      id="recepcion"
      titulo="Tiempo hasta confirmar la recepción"
      descripcion="Días hábiles desde el pase hasta que el área de destino tocó “Confirmar recepción”. “Al operar”: el área no la confirmó y quedó confirmada sola al trabajar el expediente (no tiene fecha propia)."
      tabla="recepcion"
      filtros={m.filtros}
    >
      {m.recepcion.length === 0 ? (
        <Vacio>No hubo recepciones en el período.</Vacio>
      ) : (
        <div className={CONTENEDOR_TABLA}>
          <table className="tabla-datos tabla-apilable">
            <caption className="sr-only">Tiempo hasta confirmar la recepción por área, en días hábiles</caption>
            <thead>
              <tr>
                <th scope="col" className={CLASE_CELDA}>Área</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Confirmadas</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Mediana</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Percentil 90</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Al operar</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Sin confirmar hoy</th>
              </tr>
            </thead>
            <tbody>
              {m.recepcion.map((r) => (
                <tr key={r.area.id}>
                  <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>{r.area.nombre}</th>
                  <td data-etiqueta="Confirmadas" className={CLASE_NUMERO}>{r.confirmadas.n}</td>
                  <td data-etiqueta="Mediana" className={`${CLASE_NUMERO} font-semibold text-institucional`}>{textoNumero(r.confirmadas.mediana)}</td>
                  <td data-etiqueta="Percentil 90" className={CLASE_NUMERO}>{textoNumero(r.confirmadas.p90)}</td>
                  <td data-etiqueta="Al operar" className={CLASE_NUMERO}>{r.implicitas}</td>
                  <td data-etiqueta="Sin confirmar hoy" className={CLASE_NUMERO}>{r.sinConfirmarHoy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Flujo
// ---------------------------------------------------------------------------

export function SeccionFlujo({ m }: { m: Metricas }) {
  const porMes = m.filtros.agrupar === "mes";
  const grupo = porMes ? "mes" : "semana";
  const ingresados = m.flujo.reduce((s, f) => s + f.ingresados, 0);
  const concluidos = m.flujo.reduce((s, f) => s + f.concluidos, 0);
  const ultimo = m.flujo.at(-1);
  return (
    <Seccion
      id="flujo"
      titulo={`Flujo por ${grupo}`}
      descripcion={`Ingresados (por fecha de inicio), concluidos, archivados y anulados en cada ${grupo}, y los que quedaron en trámite al cierre. Si entran más de los que se concluyen, el stock crece.`}
      tabla="flujo"
      filtros={m.filtros}
    >
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold text-texto">Ingresados y concluidos</h3>
          <Columnas
            alt={`Columnas de ingresados y concluidos por ${grupo}: en el período ingresaron ${ingresados} y se concluyeron ${concluidos}. El detalle está en la tabla que sigue.`}
            grupos={m.flujo.map((f) => ({ clave: f.periodo.clave, rotulo: rotuloPeriodo(f.periodo), nombre: textoPeriodo(f.periodo), valores: [f.ingresados, f.concluidos] }))}
            series={[
              { nombre: "Ingresados", clase: "bg-primario" },
              { nombre: "Concluidos", clase: "bg-institucional" },
            ]}
            unidad="expedientes"
          />
        </div>
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold text-texto">En trámite al cierre de cada {grupo}</h3>
          <Columnas
            alt={`Columnas del stock en trámite al cierre de cada ${grupo}${ultimo ? `: ${ultimo.stockFinal} al cierre de ${textoPeriodo(ultimo.periodo)}` : ""}. El detalle está en la tabla que sigue.`}
            grupos={m.flujo.map((f) => ({ clave: f.periodo.clave, rotulo: rotuloPeriodo(f.periodo), nombre: textoPeriodo(f.periodo), valores: [f.stockFinal] }))}
            series={[{ nombre: "En trámite", clase: "bg-primario" }]}
            unidad="expedientes en trámite"
          />
        </div>
      </div>
      <div className={CONTENEDOR_TABLA}>
        <table className="tabla-datos tabla-apilable">
          <caption className="sr-only">Flujo por {grupo}</caption>
          <thead>
            <tr>
              <th scope="col" className={CLASE_CELDA}>{porMes ? "Mes" : "Semana"}</th>
              <th scope="col" className={`${CLASE_CELDA} text-right`}>Ingresados</th>
              <th scope="col" className={`${CLASE_CELDA} text-right`}>Concluidos</th>
              <th scope="col" className={`${CLASE_CELDA} text-right`}>Archivados</th>
              <th scope="col" className={`${CLASE_CELDA} text-right`}>Anulados</th>
              <th scope="col" className={`${CLASE_CELDA} text-right`}>En trámite al cierre</th>
            </tr>
          </thead>
          <tbody>
            {m.flujo.map((f) => (
              <tr key={f.periodo.clave}>
                <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                  <span className="first-letter:uppercase">{textoPeriodo(f.periodo)}</span>
                </th>
                <td data-etiqueta="Ingresados" className={CLASE_NUMERO}>
                  <NumeroEnlazado valor={f.ingresados} busqueda={f.busquedaIngresados} descripcion={`ingresados en ${textoPeriodo(f.periodo)}`} />
                </td>
                <td data-etiqueta="Concluidos" className={CLASE_NUMERO}>{f.concluidos}</td>
                <td data-etiqueta="Archivados" className={CLASE_NUMERO}>{f.archivados}</td>
                <td data-etiqueta="Anulados" className={CLASE_NUMERO}>{f.anulados}</td>
                <td data-etiqueta="En trámite al cierre" className={`${CLASE_NUMERO} font-semibold text-institucional`}>{f.stockFinal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Devoluciones
// ---------------------------------------------------------------------------

export function SeccionDevoluciones({ m }: { m: Metricas }) {
  const conSalidas = m.pasos.filter((p) => p.tiempos.n > 0);
  const { total, rutas, motivos } = m.devoluciones;
  return (
    <Seccion
      id="devoluciones"
      titulo="Devoluciones"
      descripcion={`${textoCantidad(total, "devolución", "devoluciones")} en el período, ${textoPorcentaje(m.resumen.tasaDevolucion)} de las ${m.resumen.salidas.toLocaleString("es-AR")} salidas de un paso. Los motivos se agrupan por los atajos del diálogo de devolución.`}
      tabla="devoluciones"
      filtros={m.filtros}
    >
      {total === 0 ? (
        <Vacio>No hubo devoluciones en el período.</Vacio>
      ) : (
        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-texto">Motivos más frecuentes</h3>
              <BotonCsv tabla="motivos" filtros={m.filtros} titulo="Motivos de devolución" />
            </div>
            <BarrasHorizontales
              alt={`Motivos de devolución: ${motivos.map((x) => `${x.motivo}, ${x.cantidad}`).join("; ")}.`}
              filas={motivos.map((x) => ({ clave: x.motivo, etiqueta: x.motivo, detalle: textoPorcentaje(x.proporcion), valores: [x.cantidad] }))}
              series={[SERIE_PRINCIPAL]}
              unidad="devoluciones"
            />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold text-texto">De qué área a qué área</h3>
            <div className={CONTENEDOR_TABLA}>
              <table className="tabla-datos tabla-apilable-compacta">
                <caption className="sr-only">Devoluciones de qué área a qué área</caption>
                <thead>
                  <tr>
                    <th scope="col" className={CLASE_CELDA}>Devolvió</th>
                    <th scope="col" className={CLASE_CELDA}>A</th>
                    <th scope="col" className={`${CLASE_CELDA} text-right`}>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {rutas.map((r) => (
                    <tr key={`${r.origen.area.id}-${r.origen.paso}-${r.destino.area?.id ?? ""}-${r.destino.paso ?? ""}`}>
                      <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                        {r.origen.area.nombre}
                        <span className="block text-xs text-texto-secundario">{r.origen.paso}</span>
                      </th>
                      <td data-etiqueta="A" className={CLASE_CELDA}>
                        {r.destino.area?.nombre ?? "—"}
                        {r.destino.paso ? <span className="block text-xs text-texto-secundario">{r.destino.paso}</span> : null}
                      </td>
                      <td data-etiqueta="Cantidad" className={CLASE_NUMERO}>{r.cantidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {conSalidas.length > 0 ? (
        <div className={CONTENEDOR_TABLA}>
          <table className="tabla-datos tabla-apilable">
            <caption className="sr-only">Devoluciones y tasa de devolución por paso</caption>
            <thead>
              <tr>
                <th scope="col" className={CLASE_CELDA}>Paso que devolvió</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Salidas</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Devoluciones</th>
                <th scope="col" className={`${CLASE_CELDA} text-right`}>Tasa</th>
              </tr>
            </thead>
            <tbody>
              {conSalidas.map((p) => (
                <tr key={p.clave}>
                  <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                    {p.paso}
                    <span className="block text-xs text-texto-secundario">{p.area.nombre}</span>
                  </th>
                  <td data-etiqueta="Salidas" className={CLASE_NUMERO}>{p.tiempos.n}</td>
                  <td data-etiqueta="Devoluciones" className={CLASE_NUMERO}>{p.devoluciones}</td>
                  <td data-etiqueta="Tasa" className={`${CLASE_NUMERO} ${p.devoluciones > 0 ? "font-semibold text-institucional" : ""}`}>{textoPorcentaje(p.tasaDevolucion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Carga por área
// ---------------------------------------------------------------------------

export function SeccionCarga({ m }: { m: Metricas }) {
  const filas = m.carga.filter((c) => c.hoy > 0 || c.promedioPeriodo > 0);
  return (
    <Seccion
      id="carga"
      titulo="Carga por área"
      descripcion="Expedientes en trámite en cada área hoy, cuántos hubo en promedio por día del período y cuántos están demorados hoy (días hábiles en el área iguales o mayores que la alerta del paso, como en el panel)."
      tabla="carga"
      filtros={m.filtros}
    >
      {filas.length === 0 ? (
        <Vacio>No hay expedientes en trámite.</Vacio>
      ) : (
        <>
          <BarrasHorizontales
            alt={`Expedientes por área, hoy y en promedio en el período: ${filas.map((c) => `${c.area.nombre}, ${c.hoy} hoy`).join("; ")}.`}
            filas={filas.map((c) => ({
              clave: String(c.area.id),
              etiqueta: c.area.nombre,
              detalle: c.demoradosHoy > 0 ? `${textoCantidad(c.demoradosHoy, "demorado", "demorados")} hoy` : undefined,
              valores: [c.hoy, c.promedioPeriodo],
            }))}
            series={[
              { nombre: "Hoy", clase: "bg-primario" },
              { nombre: "Promedio del período", clase: "bg-institucional" },
            ]}
            unidad="expedientes"
          />
          <div className={CONTENEDOR_TABLA}>
            <table className="tabla-datos tabla-apilable">
              <caption className="sr-only">Carga por área</caption>
              <thead>
                <tr>
                  <th scope="col" className={CLASE_CELDA}>Área</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Hoy</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Promedio en el período</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Demorados hoy</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Mediana en el área</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.area.id}>
                    <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                      {c.area.nombre}
                      {c.area.externa ? <span className="block text-xs text-texto-secundario">externa</span> : null}
                    </th>
                    <td data-etiqueta="Hoy" className={CLASE_NUMERO}>
                      <NumeroEnlazado valor={c.hoy} busqueda={c.busquedaHoy} descripcion={`en trámite en ${c.area.nombre}`} />
                    </td>
                    <td data-etiqueta="Promedio en el período" className={CLASE_NUMERO}>{textoNumero(c.promedioPeriodo)}</td>
                    <td data-etiqueta="Demorados hoy" className={`${CLASE_NUMERO} ${c.demoradosHoy > 0 ? "font-semibold text-error" : ""}`}>{c.demoradosHoy}</td>
                    <td data-etiqueta="Mediana en el área" className={CLASE_NUMERO}>{textoConN(c.tiempos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Plazo DIM
// ---------------------------------------------------------------------------

export function SeccionDim({ m }: { m: Metricas }) {
  const d = m.dim;
  const filas: Array<[string, number, string]> = [
    ["Cumplido en término", d.enTermino, "Se tildó el plan iniciado dentro de los 30 días hábiles desde la notificación"],
    ["Cumplido con el plazo vencido", d.cumplidoVencido, "Se tildó después del vencimiento"],
    ["Vencido sin cumplir", d.vencidoSinCumplir, "Pasó el vencimiento sin plan iniciado (todavía en la DIM o ya de vuelta)"],
    ["Volvió antes de vencer, sin plan", d.salioAntesDeVencer, "Salió de la DIM dentro del plazo sin plan iniciado (por ejemplo, pagó)"],
    ["En curso, en término", d.enCurso, "Sigue en la DIM y el plazo no venció"],
    ["Sin fecha de notificación", d.sinNotificacion, "No se puede medir: falta la fecha de la notificación"],
  ];
  return (
    <Seccion
      id="dim"
      titulo="Plazo DIM (30 días hábiles)"
      descripcion={`${d.pasos.length > 0 ? `Pasos con plazo: ${d.pasos.join(", ")}. ` : ""}Se cuentan las estadías que salieron en el período, más las que siguen ahí si el período llega a hoy. El vencimiento es el de la bandeja: 30 días hábiles desde la notificación.`}
      tabla="dim"
      filtros={m.filtros}
    >
      {d.total === 0 ? (
        <Vacio>Ningún expediente pasó por un paso con plazo en el período.</Vacio>
      ) : (
        <>
          <p className="text-sm text-texto">
            Demora desde la notificación hasta que el papel volvió de la DIM:{" "}
            <strong className="font-semibold text-institucional">{textoDiasHabiles(d.demora.promedio)}</strong> en promedio (mediana{" "}
            {textoDiasHabiles(d.demora.mediana)}, {textoCantidad(d.demora.n, "caso", "casos")}).
          </p>
          <div className={CONTENEDOR_TABLA}>
            <table className="tabla-datos tabla-apilable-compacta">
              <caption className="sr-only">Plazo DIM: cuántos se cumplen y cuántos vencen</caption>
              <thead>
                <tr>
                  <th scope="col" className={CLASE_CELDA}>Situación</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(([nombre, cantidad, ayuda]) => (
                  <tr key={nombre}>
                    <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                      {nombre}
                      <span className="block text-xs text-texto-secundario">{ayuda}</span>
                    </th>
                    <td data-etiqueta="Cantidad" className={`${CLASE_NUMERO} font-semibold text-institucional`}>{cantidad}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className={`${CLASE_CELDA} font-semibold text-texto`}>Total</th>
                  <td data-etiqueta="Cantidad" className={`${CLASE_NUMERO} font-semibold`}>{d.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Línea de base
// ---------------------------------------------------------------------------

export function SeccionLineaBase({ m }: { m: Metricas }) {
  const lb = m.lineaBase;
  const p2p = lb.puntaAPunta;
  const hayDatos = p2p.antes.n > 0 || lb.pasos.length > 0;
  return (
    <Seccion
      id="linea-base"
      titulo="Antes y con el sistema (línea de base)"
      descripcion={`“Antes”: los tiempos que salen de las fichas de papel transcriptas (carga histórica, ${textoCantidad(lb.expedientes)}), sin filtro de período. “Con el sistema”: los del período elegido. Solo se comparan los tiempos que la ficha registró enteros (llegada y salida).`}
      tabla="linea-base"
      filtros={m.filtros}
    >
      {!hayDatos ? (
        <Aviso tono="info" titulo="Todavía no hay línea de base">
          No hay tiempos de antes del sistema con estos filtros: hacen falta fichas de papel transcriptas (Carga histórica) con sus pases y, para el punta a punta, con la
          conclusión.
        </Aviso>
      ) : (
        <>
          {lb.muestraChica ? (
            <Aviso tono="advertencia" titulo="Muestra chica">
              Hay menos de {lb.minimo} casos en alguna comparación (mirá la columna n): tomalo como una referencia, no como una medición. Con más fichas transcriptas la
              comparación se vuelve firme.
            </Aviso>
          ) : null}
          {lb.pasos.length > 0 ? (
            <BarrasHorizontales
              alt={`Mediana de días hábiles por paso, antes y con el sistema: ${lb.pasos
                .map((p) => `${p.paso}, antes ${textoNumero(p.antes.mediana)} y con el sistema ${textoNumero(p.conSistema.mediana)}`)
                .join("; ")}.`}
              filas={lb.pasos.map((p) => ({
                clave: p.clave,
                etiqueta: p.paso,
                detalle: `${p.area.nombre} · n = ${p.conSistema.n} y ${p.antes.n}`,
                valores: [p.conSistema.n > 0 ? p.conSistema.mediana : null, p.antes.mediana],
              }))}
              series={[SERIE_PRINCIPAL, SERIE_ANTES]}
              unidad="días hábiles (mediana)"
            />
          ) : null}
          <div className={CONTENEDOR_TABLA}>
            <table className="tabla-datos tabla-apilable">
              <caption className="sr-only">Línea de base: mediana y percentil 90 antes y con el sistema, en días hábiles</caption>
              <thead>
                <tr>
                  <th scope="col" className={CLASE_CELDA}>Qué</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Antes: mediana</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Antes: percentil 90</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Con el sistema: mediana</th>
                  <th scope="col" className={`${CLASE_CELDA} text-right`}>Con el sistema: percentil 90</th>
                </tr>
              </thead>
              <tbody>
                {[{ clave: "total", paso: "Punta a punta (concluidos)", area: null, antes: p2p.antes, conSistema: p2p.conSistema }, ...lb.pasos].map((p) => (
                  <tr key={p.clave}>
                    <th scope="row" className={`${CLASE_CELDA} font-normal text-texto`}>
                      {p.paso}
                      {p.area ? <span className="block text-xs text-texto-secundario">{p.area.nombre}</span> : null}
                    </th>
                    <td data-etiqueta="Antes: mediana" className={CLASE_NUMERO}>
                      {textoConN(p.antes)}
                      <MarcaMuestra n={p.antes.n} minimo={lb.minimo} />
                    </td>
                    <td data-etiqueta="Antes: percentil 90" className={CLASE_NUMERO}>{textoNumero(p.antes.p90)}</td>
                    <td data-etiqueta="Con el sistema: mediana" className={`${CLASE_NUMERO} font-semibold text-institucional`}>
                      {textoConN(p.conSistema)}
                      <MarcaMuestra n={p.conSistema.n} minimo={lb.minimo} />
                    </td>
                    <td data-etiqueta="Con el sistema: percentil 90" className={CLASE_NUMERO}>{textoNumero(p.conSistema.p90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Papel
// ---------------------------------------------------------------------------

export function SeccionPapel({ m }: { m: Metricas }) {
  const p = m.papel;
  return (
    <Seccion
      id="papel"
      titulo="Papel"
      descripcion="Cada expediente dado de alta en el sistema es una ficha de seguimiento que no se abrió en papel. El expediente de papel sigue siendo el oficial: eso no se ahorra."
      tabla="papel"
      filtros={m.filtros}
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-control bg-fondo p-3">
          <dt className="text-xs text-texto-secundario">Fichas reemplazadas en el período</dt>
          <dd className="text-2xl font-semibold text-institucional tabular-nums">{p.fichasReemplazadas.toLocaleString("es-AR")}</dd>
        </div>
        <div className="rounded-control bg-fondo p-3">
          <dt className="text-xs text-texto-secundario">Hojas estimadas (dato informativo)</dt>
          <dd className="text-2xl font-semibold text-institucional tabular-nums">≈ {p.hojasEstimadas.toLocaleString("es-AR")}</dd>
        </div>
        <div className="rounded-control bg-fondo p-3">
          <dt className="text-xs text-texto-secundario">Altas en el sistema desde el comienzo</dt>
          <dd className="text-2xl font-semibold text-institucional tabular-nums">{p.acumuladoSistema.toLocaleString("es-AR")}</dd>
        </div>
      </dl>
      <p className="text-xs text-texto-secundario">
        Cómo se estima: cada expediente ocupa max(1, ⌈anotaciones ÷ {p.parametros.anotacionesPorHoja}⌉) hojas, donde las anotaciones son el alta, los pases, las
        devoluciones y los cambios de estado de su historial ({p.anotaciones.toLocaleString("es-AR")} en el período). Que entran {p.parametros.anotacionesPorHoja} por hoja es
        un supuesto a confirmar con una ficha real (se cambia en <code>src/lib/dominio/metricas/papel.ts</code>). Además hay{" "}
        {textoCantidad(p.cargasHistoricas, "ficha transcripta", "fichas transcriptas")} de antes del sistema.
      </p>
    </Seccion>
  );
}
