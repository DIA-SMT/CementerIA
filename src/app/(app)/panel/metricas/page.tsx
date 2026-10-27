import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Aviso } from "@/components/aviso";
import { BotonImprimir } from "@/components/boton-imprimir";
import { EncabezadoPagina } from "@/components/encabezado-pagina";
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_CASILLA, CLASE_CONTROL } from "@/components/formulario";
import { PantallaConRecorrido } from "@/components/recorrido/proveedor";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio } from "@/lib/dominio/expedientes/errores";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { metricas as servicioMetricas, type Metricas } from "@/lib/dominio/metricas/servidor";
import { formatearFecha, hoyEnTucuman } from "@/lib/fechas";
import { comparacion, leerFiltrosMetricas, textoDiasHabiles, textoNumero, textoPorcentaje } from "@/lib/presentacion/metricas";
import { textoCantidad } from "@/lib/presentacion/panel";
import { Cifra } from "./piezas";
import {
  SeccionCarga,
  SeccionDevoluciones,
  SeccionDim,
  SeccionFlujo,
  SeccionLineaBase,
  SeccionPapel,
  SeccionPasos,
  SeccionPuntaAPunta,
  SeccionRecepcion,
} from "./secciones";

export const metadata: Metadata = { title: "Métricas de gestión" };

/**
 * Métricas de gestión (`/panel/metricas`, Dirección y admin): cómo viene
 * funcionando el circuito. El panel dice qué hay que mirar hoy; esto mide
 * tiempos antes y después del sistema, volumen, carga y cuellos de botella.
 *
 * Arriba, pocas cifras con su comparación contra la línea de base; después,
 * cada sección con un gráfico simple (HTML y CSS, sin librerías: ./graficos.tsx)
 * y su tabla, que es lo que se exporta (`GET /panel/metricas/exportar`). Los
 * filtros viven en la URL (`@/lib/presentacion/metricas`). Los números que
 * tienen una búsqueda equivalente exacta llevan a ella. Se imprime con
 * `@media print` (sin filtros ni botones).
 */
export default async function PaginaMetricas(props: PageProps<"/panel/metricas">) {
  const usuario = await exigirPantalla("metricas");
  const { filtros, valores } = leerFiltrosMetricas(await props.searchParams);
  const opciones = await expedientes.opcionesBusqueda();
  let m: Metricas | null = null;
  let error: string | null = null;
  try {
    m = await servicioMetricas.metricas(usuario, filtros);
  } catch (e) {
    if (!(e instanceof ErrorDominio)) throw e;
    error = e.message;
  }
  const f = m?.filtros;
  const tipo = opciones.tiposTramite.find((t) => t.id === f?.tipoTramiteId);
  const plantilla = opciones.plantillas.find((p) => p.codigo === f?.plantillaCodigo);
  const cementerio = opciones.cementerios.find((c) => c.id === f?.cementerioId);
  const hoy = hoyEnTucuman();

  return (
    <section aria-labelledby="titulo-pantalla" className="@container space-y-6 print:space-y-4 print:text-[11px]">
      <PantallaConRecorrido id="metricas" />
      <EncabezadoPagina
        antetitulo="Panel"
        titulo="Métricas de gestión"
        volver={{ href: "/panel", texto: "Volver al panel" }}
        descripcion={
          f ? (
            <>
              Del {formatearFecha(f.desde)} al {formatearFecha(f.hasta)}
              {tipo ? ` · ${tipo.nombre}` : ""}
              {plantilla ? ` · ${plantilla.nombre}` : ""}
              {cementerio ? ` · ${cementerio.nombre}` : ""}
              {f.historicos === "incluir" ? " · con la carga histórica" : " · solo los dados de alta en el sistema"}. Tiempos en días hábiles, con la fecha efectiva de cada
              movimiento.
            </>
          ) : (
            "Cómo viene funcionando el circuito: tiempos, flujo, carga y devoluciones."
          )
        }
        acciones={<BotonImprimir />}
      />

      <Form action="/panel/metricas" className="tarjeta space-y-3 p-4 print:hidden" aria-label="Filtros de las métricas" data-recorrido="metricas-filtros">
        <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="metricas-desde" className="mb-1.5 block text-sm font-medium text-texto">
                Desde
              </label>
              <input id="metricas-desde" name="desde" type="date" max={hoy} defaultValue={f?.desde ?? valores.desde} className={CLASE_CONTROL} />
            </div>
            <div>
              <label htmlFor="metricas-hasta" className="mb-1.5 block text-sm font-medium text-texto">
                Hasta
              </label>
              <input id="metricas-hasta" name="hasta" type="date" max={hoy} defaultValue={f?.hasta ?? valores.hasta} className={CLASE_CONTROL} />
            </div>
          </div>
          <div>
            <label htmlFor="metricas-tramite" className="mb-1.5 block text-sm font-medium text-texto">
              Tipo de trámite
            </label>
            <select id="metricas-tramite" name="tramite" defaultValue={valores.tramite} className={CLASE_CONTROL}>
              <option value="">Todos</option>
              {opciones.tiposTramite.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="metricas-plantilla" className="mb-1.5 block text-sm font-medium text-texto">
              Plantilla
            </label>
            <select id="metricas-plantilla" name="plantilla" defaultValue={valores.plantilla} className={CLASE_CONTROL}>
              <option value="">Todas</option>
              {opciones.plantillas.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="metricas-cementerio" className="mb-1.5 block text-sm font-medium text-texto">
              Cementerio
            </label>
            <select id="metricas-cementerio" name="cementerio" defaultValue={valores.cementerio} className={CLASE_CONTROL}>
              <option value="">Todos</option>
              {opciones.cementerios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="metricas-agrupar" className="mb-1.5 block text-sm font-medium text-texto">
              Flujo
            </label>
            <select id="metricas-agrupar" name="agrupar" defaultValue={valores.agrupar} className={CLASE_CONTROL}>
              <option value="mes">Por mes</option>
              <option value="semana">Por semana (hasta 26)</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex max-w-2xl items-start gap-2 text-sm text-texto">
            <input type="checkbox" name="historicos" value="incluir" defaultChecked={valores.historicos === "incluir"} className={`${CLASE_CASILLA} mt-0.5`} />
            <span>
              Contar también los expedientes de carga histórica (transcriptos de la ficha de papel) como &quot;con el sistema&quot;
              <span className="block text-xs text-texto-secundario">Por defecto se miden solo los dados de alta en el sistema; los históricos son la línea de base.</span>
            </span>
          </label>
          <div className="flex gap-2">
            <button type="submit" className={CLASE_BOTON_PRIMARIO}>
              Aplicar
            </button>
            <Link href="/panel/metricas" className={CLASE_BOTON_SECUNDARIO}>
              Limpiar
            </Link>
          </div>
        </div>
      </Form>

      {error ? (
        <Aviso tono="error" role="alert" titulo="No se pudieron calcular las métricas">
          {error}
        </Aviso>
      ) : null}

      {m ? (
        <>
          <Resumen m={m} />
          <SeccionPuntaAPunta m={m} />
          <SeccionPasos m={m} />
          <SeccionFlujo m={m} />
          <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-2 print:grid-cols-1">
            <SeccionRecepcion m={m} />
            <SeccionDim m={m} />
          </div>
          <SeccionDevoluciones m={m} />
          <SeccionCarga m={m} />
          <SeccionLineaBase m={m} />
          <SeccionPapel m={m} />
        </>
      ) : null}
    </section>
  );
}

/** Las cifras clave, cada una con su comparación contra la línea de base o su contexto. */
function Resumen({ m }: { m: Metricas }) {
  const r = m.resumen;
  const lb = m.lineaBase;
  const p2p = r.puntaAPunta;
  const compMediana = comparacion(p2p.conSistema.mediana, p2p.antes.mediana);
  const compP90 = comparacion(p2p.conSistema.p90, p2p.antes.p90);
  const sinBase = p2p.antes.n === 0 ? "sin línea de base todavía" : null;
  const nBase = p2p.antes.n > 0 ? ` (antes: ${textoNumero(p2p.antes.mediana)}, n = ${p2p.antes.n}${p2p.antes.n < lb.minimo ? ", muestra chica" : ""})` : "";
  const meses = m.flujo.length;
  const tono = (c: ReturnType<typeof comparacion>) => (c?.mejora === true ? "mejor" : c?.mejora === false ? "peor" : "neutro");
  return (
    <section aria-labelledby="titulo-resumen" data-recorrido="metricas-resumen" className="break-inside-avoid space-y-3">
      <h2 id="titulo-resumen" className="titulo-seccion">
        Resumen
      </h2>
      <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 @4xl:grid-cols-4">
        <li>
          <Cifra
            rotulo="Ingresados"
            valor={r.ingresados.toLocaleString("es-AR")}
            busqueda={r.busquedaIngresados}
            detalle={meses > 1 && m.filtros.agrupar === "mes" ? `${textoNumero(Math.round((r.ingresados / meses) * 10) / 10)} por mes en promedio` : "en el período"}
          />
        </li>
        <li>
          <Cifra rotulo="Concluidos" valor={r.concluidos.toLocaleString("es-AR")} detalle="en el período" />
        </li>
        <li>
          <Cifra
            rotulo="En trámite hoy"
            valor={r.enTramiteHoy.toLocaleString("es-AR")}
            busqueda={r.busquedaEnTramiteHoy}
            detalle={`${textoCantidad(r.demoradosHoy, "demorado", "demorados")} según la alerta de cada paso`}
            tono={r.demoradosHoy > 0 ? "peor" : "neutro"}
          />
        </li>
        <li>
          <Cifra
            rotulo="Punta a punta: mediana"
            valor={textoNumero(p2p.conSistema.mediana)}
            unidad="días hábiles"
            detalle={compMediana ? `${compMediana.texto}${nBase}` : (sinBase ?? `n = ${p2p.conSistema.n}`)}
            tono={tono(compMediana)}
          />
        </li>
        <li>
          <Cifra
            rotulo="Punta a punta: percentil 90"
            valor={textoNumero(p2p.conSistema.p90)}
            unidad="días hábiles"
            detalle={compP90 ? compP90.texto : (sinBase ?? `n = ${p2p.conSistema.n}`)}
            tono={tono(compP90)}
          />
        </li>
        <li>
          <Cifra
            rotulo="Cuello de botella"
            textual
            valor={r.cuelloMediana ? r.cuelloMediana.paso : "—"}
            detalle={
              r.cuelloMediana
                ? `${r.cuelloMediana.area.nombre}: ${textoDiasHabiles(r.cuelloMediana.tiempos.mediana)} de mediana${r.cuelloAcumulado && r.cuelloAcumulado.clave !== r.cuelloMediana.clave ? ` · más días acumulados: ${r.cuelloAcumulado.paso}` : ""}`
                : "sin salidas en el período"
            }
          />
        </li>
        <li>
          <Cifra
            rotulo="Devoluciones"
            valor={textoPorcentaje(r.tasaDevolucion)}
            detalle={`${textoCantidad(r.devoluciones, "devolución", "devoluciones")} de ${r.salidas.toLocaleString("es-AR")} salidas de un paso`}
          />
        </li>
        <li>
          <Cifra
            rotulo="Fichas de papel reemplazadas"
            valor={r.fichasReemplazadas.toLocaleString("es-AR")}
            detalle={`≈ ${m.papel.hojasEstimadas.toLocaleString("es-AR")} hojas (estimado)`}
          />
        </li>
      </ul>
    </section>
  );
}
