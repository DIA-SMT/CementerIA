import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CLASE_ENLACE } from "@/components/formulario";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type Caratula, type HojaHistorial, type PersonaCaratula, type ResultadoIntegridad } from "@/lib/dominio/expedientes/servidor";
import { entorno } from "@/lib/entorno";
import { formatearFecha } from "@/lib/fechas";
import { leerHoja, origenPublico, rutaFicha, urlAbsoluta } from "@/lib/presentacion/enlaces";
import { contextoResumen, textoIntegridad } from "@/lib/presentacion/historial";
import { svgQr } from "@/lib/presentacion/qr";
import { documentoDePersona, etiquetaEstado, nombreCompleto } from "@/lib/presentacion/textos";
import { LineaDeTiempo } from "../../linea-de-tiempo";
import { BotonImprimir } from "@/components/boton-imprimir";

export async function generateMetadata(props: PageProps<"/expedientes/[numero]/imprimir">): Promise<Metadata> {
  const { numero } = await props.params;
  const hoja = leerHoja((await props.searchParams).hoja);
  return { title: `${hoja === "historial" ? "Historial" : "Carátula"} ${numero.toUpperCase()}` };
}

/**
 * Imprimibles (sección 5): `?hoja=caratula` (predeterminada) e
 * `?hoja=historial`. CSS de impresión, A4, sin librería de PDF. Pedir una hoja
 * registra `imprimir` en auditoria.accesos (lo hace el dominio).
 */
export default async function PaginaImprimir(props: PageProps<"/expedientes/[numero]/imprimir">) {
  const usuario = await exigirPantalla("expedientes");
  const { numero } = await props.params;
  const hoja = leerHoja((await props.searchParams).hoja);
  const h = await headers();
  const ip = ipDeSolicitud(h);

  type Datos = { hoja: "caratula"; caratula: Caratula; url: string; qr: string } | { hoja: "historial"; historial: HojaHistorial };
  let datos: Datos;
  try {
    if (hoja === "caratula") {
      const c = await expedientes.datosCaratula(usuario, numero, { ip });
      const origen = origenPublico({ appUrl: entorno().appUrl, host: h.get("host"), protocoloReenviado: h.get("x-forwarded-proto") });
      const url = urlAbsoluta(c.rutaFicha, origen);
      datos = { hoja, caratula: c, url, qr: await svgQr(url, `Código QR de la ficha del expediente ${c.numero}`) };
    } else {
      datos = { hoja, historial: await expedientes.datosHistorial(usuario, numero, { ip }) };
    }
  } catch (e) {
    if (e instanceof ErrorDominio && e.codigo === "no_encontrado") notFound();
    throw e;
  }
  const numeroCanonico = datos.hoja === "caratula" ? datos.caratula.numero : datos.historial.numero;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <BotonImprimir />
        <Link href={rutaFicha(numeroCanonico)} prefetch={false} className={CLASE_ENLACE}>
          Volver a la ficha
        </Link>
        <span className="text-sm text-slate-600">Hoja A4. En el diálogo de impresión, desactivá encabezados y pies de página del navegador.</span>
      </div>
      <div className="mx-auto max-w-[210mm] bg-white p-[12mm] text-slate-900 shadow-sm ring-1 ring-slate-300 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        {datos.hoja === "caratula" ? (
          <HojaCaratula caratula={datos.caratula} url={datos.url} qr={datos.qr} />
        ) : (
          <HojaDelHistorial hoja={datos.historial} />
        )}
      </div>
    </div>
  );
}

function Encabezado() {
  return (
    <p className="text-xs uppercase tracking-wide text-slate-700">Municipalidad de San Miguel de Tucumán · Dirección de Cementerios</p>
  );
}

function Fila({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-300">
      <th scope="row" className="w-40 py-1 pr-3 text-left align-top font-normal text-slate-700">
        {titulo}
      </th>
      <td className="py-1 align-top">{children}</td>
    </tr>
  );
}

function personas(lista: PersonaCaratula[]): React.ReactNode {
  if (lista.length === 0) return "—";
  return lista.map((p, i) => (
    <span key={i} className="block">
      {nombreCompleto(p)}
      {documentoDePersona(p) ? ` · ${documentoDePersona(p)}` : ""}
      {p.fallecido ? " · fallecido" : ""}
      {p.vinculo ? ` · ${p.vinculo}` : ""}
    </span>
  ));
}

function HojaCaratula({ caratula: c, url, qr }: { caratula: Caratula; url: string; qr: string }) {
  return (
    <article aria-label={`Carátula del expediente ${c.numero}`} className="space-y-5 text-sm">
      <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-4">
        <div className="space-y-1">
          <Encabezado />
          <h1 className="font-mono text-5xl font-bold tracking-tight">{c.numero}</h1>
          <p className="text-lg">
            N° interno corto: <strong>{c.numeroCorto}</strong>
          </p>
          <p className="text-lg">
            N° municipal: <strong>{c.numeroMunicipal ?? "________________"}</strong>
          </p>
        </div>
        <figure className="w-36 shrink-0 text-center">
          <div className="h-36 w-36" dangerouslySetInnerHTML={{ __html: qr }} />
          <figcaption className="mt-1 break-all text-[9px] leading-tight text-slate-700">{url}</figcaption>
        </figure>
      </header>

      <table className="w-full border-collapse">
        <tbody>
          <Fila titulo="Trámite">
            {c.tramite.tipo} — {c.tramite.plantilla} (v{c.tramite.version})
          </Fila>
          <Fila titulo="Cementerio">{c.cementerio}</Fila>
          <Fila titulo="Tipo de monumento">{c.tipoMonumento}</Fila>
          <Fila titulo="Ubicación">{c.ubicacion.length > 0 ? c.ubicacion.map((u) => `${u.etiqueta} ${u.valor}`).join(" · ") : "—"}</Fila>
          <Fila titulo="Padrón">{c.padron ?? "—"}</Fila>
          <Fila titulo="Fecha de inicio">
            {formatearFecha(c.fechaInicio)}
            {c.cargaHistorica ? " (iniciado antes del sistema)" : ""}
          </Fila>
          <Fila titulo={c.titulares.length > 1 ? "Titulares" : "Titular"}>{personas(c.titulares)}</Fila>
          {c.solicitantes.length > 0 ? <Fila titulo={c.solicitantes.length > 1 ? "Solicitantes" : "Solicitante"}>{personas(c.solicitantes)}</Fila> : null}
        </tbody>
      </table>

      <section aria-labelledby="titulo-recorrido">
        <h2 id="titulo-recorrido" className="mb-2 text-base font-semibold">
          Recorrido previsto
        </h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              <th scope="col" className="w-6 py-1 pr-2">
                N°
              </th>
              <th scope="col" className="py-1 pr-2">
                Paso y área
              </th>
              <th scope="col" className="w-24 py-1 pr-2">
                Fecha de entrada
              </th>
              <th scope="col" className="w-24 py-1 pr-2">
                Fecha de salida
              </th>
              <th scope="col" className="w-36 py-1">
                Firma y sello
              </th>
            </tr>
          </thead>
          <tbody>
            {c.recorrido.map((p) => (
              <tr key={p.clave} className="break-inside-avoid border-b border-slate-400 align-top">
                <td className="py-1.5 pr-2">{p.orden}</td>
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{p.nombre}</span> · {p.area}
                  {p.custodia ? ` (lo sigue ${p.custodia})` : ""}
                  {p.subtareas.length > 0 ? (
                    <ul className="mt-0.5 space-y-0.5 text-[11px] text-slate-800">
                      {p.subtareas.map((s) => (
                        <li key={s.clave}>
                          <span aria-hidden="true">☐ </span>
                          {s.nombre}
                          {s.obligatoria ? "" : " (opcional)"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="border-l border-slate-300 py-1.5 pr-2">
                  <span className="sr-only">Para anotar a mano</span>
                </td>
                <td className="border-l border-slate-300 py-1.5 pr-2" />
                <td className="h-12 border-l border-slate-300 py-1.5" />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="space-y-1 border-t border-slate-400 pt-2 text-xs text-slate-700">
        <p>
          Emitida el {formatearFecha(c.emitidaEl)}. Esta carátula se abrocha al expediente de papel y reemplaza la ficha de pases. El código QR
          abre la ficha digital (pide ingresar).
        </p>
        <Huella integridad={c.integridad} />
      </footer>
    </article>
  );
}

/**
 * La huella de la cadena de hash del historial al emitir la hoja (26/10/2026):
 * los primeros 16 caracteres del hash del último movimiento y cuántos había.
 * Liga el papel con el estado digital: "Verificar integridad" en la ficha
 * muestra el hash actual para cotejarlo.
 */
function Huella({ integridad: r }: { integridad: ResultadoIntegridad }) {
  if (!r.huella) return null;
  return (
    <p>
      Huella del historial: <span className="font-mono font-semibold tracking-wide text-slate-900">{r.huella}</span> (hash del movimiento{" "}
      {r.movimientos}, el último registrado al emitir){r.integra ? "." : null}
      {r.integra ? null : (
        <strong className="text-slate-900"> · ATENCIÓN: {textoIntegridad(r)}</strong>
      )}
    </p>
  );
}

function HojaDelHistorial({ hoja: d }: { hoja: HojaHistorial }) {
  return (
    <article aria-label={`Historial del expediente ${d.numero}`} className="space-y-4 text-sm">
      <header className="space-y-1 border-b-2 border-slate-900 pb-3">
        <Encabezado />
        <h1 className="text-2xl font-bold">
          Historial del expediente <span className="font-mono">{d.numero}</span> ({d.numeroCorto})
        </h1>
        <p>
          N° municipal: {d.numeroMunicipal ?? "—"} · {d.tipoTramite} · {d.tramite}
        </p>
        <p>
          {d.cementerio}
          {d.ubicacionTexto ? ` · ${d.ubicacionTexto}` : ""}
          {d.padron ? ` · Padrón ${d.padron}` : ""}
        </p>
        <p>
          Estado: {etiquetaEstado(d.estado)} · Paso {d.paso.orden} de {d.paso.total}: {d.paso.nombre} · {d.areaActual} · Inicio{" "}
          {formatearFecha(d.fechaInicio)}
          {d.cargaHistorica ? " (antes del sistema)" : ""}
        </p>
        <p>
          Personas:{" "}
          {d.personas
            .filter((p) => p.vigente)
            .map((p) => `${p.etiquetaRol} ${p.suprimida ? "(datos suprimidos)" : nombreCompleto(p)}${documentoDePersona(p) ? ` (${documentoDePersona(p)})` : ""}`)
            .join(" · ") || "—"}
        </p>
      </header>
      <LineaDeTiempo historial={d.historial} tramos={d.tramos} nivelTitulos={2} contexto={contextoResumen(d.personas, d.camposExtra, { subtareas: d.subtareas, documentos: d.documentos })} />
      <footer className="space-y-1 border-t border-slate-400 pt-2 text-xs text-slate-700">
        <p>
          Emitido el {formatearFecha(d.emitidaEl)}. Agrupado por paso, con los días hábiles en cada área. Fechas: la efectiva (cuándo pasó) y la
          de carga (cuándo se registró), si es otra. Lo tachado fue corregido después.
        </p>
        <Huella integridad={d.integridad} />
      </footer>
    </article>
  );
}
