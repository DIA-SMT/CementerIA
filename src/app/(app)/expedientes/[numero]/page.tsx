import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, EyeOff, FileClock, MessageCircle, Pencil, Printer, ShieldX, Square, SquareCheck } from "lucide-react";
import { Aviso } from "@/components/aviso";
import { EtiquetaEstado, EtiquetaSituacion } from "@/components/etiquetas";
import { CLASE_BOTON_COMPACTO, CLASE_BOTON_COMPACTO_PELIGRO, CLASE_ENLACE } from "@/components/formulario";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type DocumentoFicha, type Ficha, type PersonaFicha } from "@/lib/dominio/expedientes/servidor";
import { formatearFecha, formatearFechaHora, formatearSegunPrecision } from "@/lib/fechas";
import { AVISO_EDITADO } from "@/lib/presentacion/acciones";
import { enlaceWhatsapp, mensajeWhatsapp, rutaEditar, rutaFicha, rutaImprimir } from "@/lib/presentacion/enlaces";
import { mostrarPlazo, movimientoCorregible, textoUbicacion, type PlazoMostrado, type SubtareaConocida } from "@/lib/presentacion/estados";
import { contextoResumen } from "@/lib/presentacion/historial";
import { documentoDePersona, ETIQUETA_DOCUMENTO, ETIQUETA_FORMA_PAGO, etiquetaEstado, nombreCompleto } from "@/lib/presentacion/textos";
import { LineaDeTiempo } from "../linea-de-tiempo";
import { BarraEstado } from "./flujo/cambios-estado";
import { BotonFlujo, ProveedorFlujo } from "./flujo/contexto";
import { BarraAcciones, BotonesDocumento, BotonesSubtarea, ListaAdjuntos, PanelFaltan } from "./flujo/controles";
import { MenuCorregir } from "./flujo/correcciones";
import type { DatosFlujo } from "./flujo/tipos";
import { VerDatosCompletos } from "./ver-datos-completos";

export async function generateMetadata(props: PageProps<"/expedientes/[numero]">): Promise<Metadata> {
  const { numero } = await props.params;
  return { title: numero.toUpperCase() };
}

/**
 * Ficha digital (sección 5, `/expedientes/[numero]`). Abrirla registra
 * `ver_expediente`. El contacto llega enmascarado para quien no trabaja el
 * expediente (decisión 13), con "Ver datos completos".
 *
 * Semana 3: las acciones del flujo (confirmar recepción, dar pase con "Faltan
 * N", devolver, tildar, documentos y adjuntos) van en diálogos
 * (./flujo/), que reciben de acá lo que necesitan (`DatosFlujo`) y llaman a
 * las Server Actions de ../acciones.ts. Qué botón se muestra lo dice
 * `ficha.acciones`, con las mismas reglas que exige el dominio.
 *
 * Los enlaces a pantallas que registran accesos (ficha, edición, imprimibles)
 * van con `prefetch={false}`: un prefetch no tiene que quedar en
 * auditoria.accesos como si alguien hubiera abierto el expediente.
 */
export default async function PaginaFicha(props: PageProps<"/expedientes/[numero]">) {
  const usuario = await exigirPantalla("expedientes");
  const { numero } = await props.params;
  const { aviso } = await props.searchParams;

  let ficha: Ficha;
  try {
    ficha = await expedientes.obtenerFicha(usuario, numero, { ip: ipDeSolicitud(await headers()) });
  } catch (e) {
    if (e instanceof ErrorDominio && e.codigo === "no_encontrado") notFound();
    throw e;
  }

  const a = ficha.acciones;
  const puedeEditar = a.editarIdentificatorios.permitido || a.editarContacto.permitido || a.completarCamposExtra.permitido;
  const areaUsuario = usuario.area?.nombre ?? "Dirección de Cementerios";
  const contacto = ficha.personas.find((p) => p.esContacto);
  const whatsapp =
    ficha.datosCompletos && contacto?.contacto.telefonoWhatsapp && !contacto.contacto.enmascarado
      ? enlaceWhatsapp(contacto.contacto.telefono, mensajeWhatsapp(ficha.numero, areaUsuario))
      : null;
  const etiquetas = Object.fromEntries([...ficha.personas, ...ficha.personasHistoricas].map((p) => [p.rol, p.etiquetaRol]));
  const todasLasSubtareas = ficha.recorrido.flatMap((p) => p.subtareas);
  const documentos = [...ficha.documentacion.direccion, ...ficha.documentacion.concesionario];
  const resumen = contextoResumen([...ficha.personas, ...ficha.personasHistoricas], ficha.datosExtra, { subtareas: todasLasSubtareas, documentos });
  const activo = ficha.estado === "en_tramite" || ficha.estado === "espera_pago_dim";
  const pasoActual = ficha.recorrido.find((p) => p.situacion === "actual");
  // Semana 4: las plantillas para reiniciar o abrir el vinculado (solo si lo puede hacer).
  const usaPlantillas = a.reiniciar.permitido || a.archivarSinConcluir.permitido;
  const plantillas = usaPlantillas
    ? (await expedientes.opcionesAlta()).plantillas.map((p) => ({ id: p.id, nombre: p.nombre, version: p.version, tipoTramite: p.tipoTramite.nombre }))
    : [];
  const subtareasConocidas = new Map<string, SubtareaConocida>(todasLasSubtareas.map((s) => [s.clave, { nombre: s.nombre, dato: s.dato, valor: s.valor, hecha: s.hecha }]));
  const plazo = ficha.plazo ? mostrarPlazo(ficha.plazo) : null;
  const flujo: DatosFlujo = {
    numero: ficha.numero,
    version: ficha.version,
    rutaFicha: rutaFicha(ficha.numero),
    rutaEditar: rutaEditar(ficha.numero),
    paso: { orden: ficha.paso.orden, nombre: ficha.paso.nombre, esFinal: ficha.paso.esFinal, externo: ficha.areaActual.tipo === "externa" },
    areaActual: ficha.areaActual.nombre,
    sinConfirmar: ficha.situaciones.includes("sin_confirmar"),
    subtareas: pasoActual?.subtareas ?? [],
    documentos,
    pase: ficha.pase,
    devolucion: ficha.devolucion,
    nombresPasos: Object.fromEntries(ficha.recorrido.map((p) => [p.clave, p.nombre])),
    permisos: {
      confirmarRecepcion: a.confirmarRecepcion.permitido,
      tildarSubtarea: a.tildarSubtarea.permitido,
      marcarDocumento: a.marcarDocumento.permitido,
      adjuntar: a.adjuntar.permitido,
      darPase: a.darPase.permitido,
      devolver: a.devolver.permitido,
      completarCamposExtra: a.completarCamposExtra.permitido,
      concluir: a.concluir.permitido,
      archivar: a.archivar.permitido,
      archivarSinConcluir: a.archivarSinConcluir.permitido,
      desarchivar: a.desarchivar.permitido,
      anular: a.anular.permitido,
      reabrir: a.reabrir.permitido,
      reiniciar: a.reiniciar.permitido,
      cambiarUbicacionArchivo: a.cambiarUbicacionArchivo.permitido,
      nota: a.nota.permitido,
      suprimirPersona: a.suprimirPersona.permitido,
    },
    adjuntos: ficha.adjuntos,
    cantidadAdjuntos: ficha.cantidadAdjuntos,
    estado: ficha.estado,
    ubicacionArchivo: ficha.ubicacionArchivo,
    areaResponsable: ficha.areaResponsable.nombre,
    concluir: ficha.concluir,
    plantillas,
  };

  return (
    <ProveedorFlujo datos={flujo}>
      <article aria-labelledby="titulo-ficha" className="space-y-5">
        {aviso === AVISO_EDITADO ? (
          <Aviso tono="exito" role="status">
            <p>Cambios guardados.</p>
          </Aviso>
        ) : null}

        <header className="tarjeta overflow-hidden">
          {/* Número, estado y situaciones: el h1 y la etiqueta de estado van en el mismo contenedor. */}
          <div className="border-b border-borde px-4 pb-3.5 pt-4 sm:px-5">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-texto-secundario">
              Expediente · {ficha.tipoTramite.nombre}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 id="titulo-ficha" className="font-mono text-2xl font-semibold tracking-tight text-institucional">
                {ficha.numero}
              </h1>
              <span className="text-sm text-texto-secundario tabular-nums">({ficha.numeroCorto})</span>
              <EtiquetaEstado estado={ficha.estado} />
              {ficha.situaciones.map((s) => (
                <EtiquetaSituacion key={s} situacion={s} />
              ))}
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
            <Dato titulo="Paso actual" destacado>
              {ficha.paso.orden} de {ficha.paso.total}: {ficha.paso.nombre}
            </Dato>
            <Dato titulo="Área actual" destacado>
              {ficha.areaActual.nombre}
              {ficha.areaResponsable.id !== ficha.areaActual.id ? (
                <span className="block text-xs font-normal text-texto-secundario">Lo sigue: {ficha.areaResponsable.nombre}</span>
              ) : null}
            </Dato>
            <Dato titulo="En el área desde">
              {formatearSegunPrecision(ficha.enAreaDesde, ficha.enAreaDesdePrecision)}
              <span className={`block text-xs ${ficha.recibidoEn ? "text-texto-secundario" : "font-medium text-advertencia"}`}>
                {ficha.recibidoEn ? `Recibido el ${formatearSegunPrecision(ficha.recibidoEn, ficha.recibidoEnPrecision)}` : "Sin confirmar la recepción"}
              </span>
            </Dato>
            <Dato titulo="N° municipal">{ficha.numeroMunicipal ?? "—"}</Dato>
            <Dato titulo="Trámite">
              {ficha.tipoTramite.nombre}
              <span className="block text-xs text-texto-secundario">
                {ficha.plantilla.nombre} · v{ficha.plantilla.version}
                {ficha.plantilla.hayVersionNueva ? (
                  <span className="insignia ml-1 bg-advertencia-fondo text-advertencia ring-1 ring-inset ring-advertencia-borde">hay v{ficha.plantilla.versionPublicada}</span>
                ) : null}
              </span>
            </Dato>
            {ficha.enlaces.anterior || ficha.enlaces.siguientes.length > 0 ? (
              <Dato titulo="Relacionados">
                {ficha.enlaces.anterior ? (
                  <span className="block">
                    {ficha.enlaces.anterior.vinculo === "vinculado" ? "Vinculado a " : "Reinicio de "}
                    <Link href={rutaFicha(ficha.enlaces.anterior.numero)} prefetch={false} className={CLASE_ENLACE}>
                      {ficha.enlaces.anterior.numero}
                    </Link>
                    <span className="text-texto-secundario">
                      {" "}
                      ({ficha.enlaces.anterior.plantilla}, {etiquetaEstado(ficha.enlaces.anterior.estado).toLowerCase()})
                    </span>
                  </span>
                ) : null}
                {ficha.enlaces.siguientes.map((n) => (
                  <span key={n.numero} className="block">
                    {n.vinculo === "vinculado" ? "Sigue (vinculado) en " : "Reiniciado en "}
                    <Link href={rutaFicha(n.numero)} prefetch={false} className={CLASE_ENLACE}>
                      {n.numero}
                    </Link>
                    <span className="text-texto-secundario">
                      {" "}
                      ({n.plantilla}, {etiquetaEstado(n.estado).toLowerCase()})
                    </span>
                  </span>
                ))}
              </Dato>
            ) : null}
            {plazo ? (
              <Dato titulo="Plazo DIM">
                <EtiquetaPlazo plazo={plazo} />
              </Dato>
            ) : null}
          </dl>

          {/* Acciones agrupadas: lo del paso (recepción, pase, devolución), el
              estado del expediente y, aparte, editar, imprimir y contactar. */}
          <div className="space-y-3 border-t border-borde bg-fondo/70 px-4 py-3.5 sm:px-5 print:hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 empty:hidden">
              <BarraAcciones />
              <BarraEstado />
            </div>
            <div className="flex flex-wrap gap-2">
              {puedeEditar ? (
                <Link href={rutaEditar(ficha.numero)} prefetch={false} className={CLASE_BOTON_COMPACTO}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Editar
                </Link>
              ) : null}
              {a.imprimir.permitido ? (
                <>
                  <Link href={rutaImprimir(ficha.numero, "caratula")} prefetch={false} className={CLASE_BOTON_COMPACTO}>
                    <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                    Imprimir carátula
                  </Link>
                  <Link href={rutaImprimir(ficha.numero, "historial")} prefetch={false} className={CLASE_BOTON_COMPACTO}>
                    <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                    Imprimir historial
                  </Link>
                </>
              ) : null}
              {a.transcribir.permitido ? (
                <Link href={`${rutaFicha(ficha.numero)}/transcribir`} prefetch={false} className={CLASE_BOTON_COMPACTO}>
                  <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
                  Transcribir la ficha de papel
                </Link>
              ) : null}
              {whatsapp ? (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={CLASE_BOTON_COMPACTO}>
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  WhatsApp al contacto
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              ) : null}
            </div>
          </div>
        </header>

        {activo && !ficha.cargaHistorica ? <PanelFaltan /> : null}

        <Bloque titulo="Datos del expediente">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Dato titulo="Cementerio">{ficha.cementerio.nombre}</Dato>
            <Dato titulo="Tipo de monumento">{ficha.tipoMonumento.nombre}</Dato>
            <Dato titulo="Ubicación">
              {ficha.ubicacion.filter((u) => u.valor !== null).length > 0
                ? ficha.ubicacion
                    .filter((u) => u.valor !== null)
                    .map((u) => `${u.etiqueta} ${u.valor}`)
                    .join(" · ")
                : "—"}
            </Dato>
            <Dato titulo="Padrón">{ficha.padron ?? "—"}</Dato>
            <Dato titulo="Forma de pago">{ficha.formaPago ? (ETIQUETA_FORMA_PAGO[ficha.formaPago] ?? ficha.formaPago) : "—"}</Dato>
            <Dato titulo="Fecha de inicio">
              {formatearFecha(ficha.fechaInicio)}
              {ficha.cargaHistorica ? <span className="block text-texto-secundario">Iniciado antes del sistema</span> : null}
            </Dato>
            <Dato titulo="Alta">
              {formatearFechaHora(ficha.creadoEn)} por {ficha.creadoPor.corto}
            </Dato>
            {ficha.ubicacionArchivo ? <Dato titulo="Ubicación en el archivo">{textoUbicacion(ficha.ubicacionArchivo)}</Dato> : null}
          </dl>
          {ficha.observaciones ? (
            <div className="mt-3 text-sm">
              <p className="text-texto-secundario">Observaciones</p>
              <p className="whitespace-pre-line text-texto">{ficha.observaciones}</p>
            </div>
          ) : null}
        </Bloque>

        <Bloque titulo="Recorrido">
          {/* El recorrido de la plantilla como línea de pasos: cumplidos en verde, el actual destacado en azul, los pendientes en gris. */}
          <ol>
            {ficha.recorrido.map((p, i) => {
              const actual = p.situacion === "actual";
              const ultimo = i === ficha.recorrido.length - 1;
              return (
                <li key={p.clave} aria-current={actual ? "step" : undefined} className="relative flex gap-3 pb-3 last:pb-0">
                  {!ultimo ? (
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0 left-3 top-7 w-0.5 -translate-x-1/2 ${p.situacion === "cumplido" ? "bg-exito-borde" : "bg-borde"}`}
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={`relative z-[1] mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                      p.situacion === "cumplido"
                        ? "bg-exito-solido text-white"
                        : actual
                          ? "bg-primario text-white ring-4 ring-superficie-azul"
                          : "border-2 border-borde-control bg-white text-texto-secundario"
                    }`}
                  >
                    {p.situacion === "cumplido" ? <Check className="h-3.5 w-3.5" /> : p.orden}
                  </span>
                  <div className={`min-w-0 flex-1 text-sm ${actual ? "rounded-control bg-superficie-azul/60 px-3 py-2 ring-1 ring-inset ring-info-borde" : "py-1"}`}>
                    <p>
                      <span className={actual ? "font-semibold text-institucional" : p.situacion === "cumplido" ? "font-medium text-texto" : "font-medium text-texto-secundario"}>
                        {p.orden}. {p.nombre}
                      </span>
                      <span className="text-texto-secundario">
                        {" "}
                        · {p.area?.nombre ?? p.areaDefinida}
                        {p.custodia ? ` (lo sigue ${p.custodia.nombre})` : ""}
                      </span>
                      {actual ? <span className="insignia ml-2 bg-primario text-white">Paso actual</span> : null}
                      <span className="sr-only">
                        {p.situacion === "cumplido" ? " (cumplido)" : actual ? "" : " (pendiente)"}
                      </span>
                    </p>
                    {p.instrucciones ? <p className="text-xs text-texto-secundario">{p.instrucciones}</p> : null}
                    {p.subtareas.length > 0 ? (
                      <ul className="mt-1.5 space-y-1">
                        {p.subtareas.map((s) => (
                          <li key={s.clave} className="flex flex-wrap items-start gap-1.5 text-xs text-texto">
                            {s.hecha ? (
                              <SquareCheck className="mt-px h-3.5 w-3.5 shrink-0 text-exito" aria-hidden="true" />
                            ) : (
                              <Square className="mt-px h-3.5 w-3.5 shrink-0 text-texto-secundario" aria-hidden="true" />
                            )}
                            <span className="min-w-0 flex-1">
                              {s.nombre}
                              {s.obligatoria ? "" : <span className="text-texto-secundario"> (opcional)</span>}
                              {s.hecha && s.valor ? `: ${s.dato === "fecha" ? formatearFecha(s.valor) : s.valor}` : ""}
                              {s.reiniciadaPorMovimientoId && !s.hecha ? <span className="font-medium text-error"> · hay que rehacerla (devolución)</span> : null}
                              <span className="sr-only">{s.hecha ? " (hecha)" : " (pendiente)"}</span>
                            </span>
                            {actual && activo ? (
                              <span className="ml-auto shrink-0">
                                <BotonesSubtarea clave={s.clave} nombre={s.nombre} hecha={s.hecha} conDato={s.dato !== null} />
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {ficha.plazo && plazo ? (
            <div className="mt-3 space-y-1 border-t border-borde pt-3 text-sm text-texto">
              <p>
                Plazo de {ficha.plazo.diasHabiles} días hábiles
                {ficha.plazo.desde ? ` desde el ${formatearFecha(ficha.plazo.desde)} (notificación)` : ""}
                {ficha.plazo.vence ? `; vence el ${formatearFecha(ficha.plazo.vence)}` : ""}.
              </p>
              <EtiquetaPlazo plazo={plazo} />
            </div>
          ) : null}
        </Bloque>

        <Bloque titulo="Documentación">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <ListaDocumentos titulo="Dirección" documentos={ficha.documentacion.direccion} />
            <ListaDocumentos titulo="Concesionario" documentos={ficha.documentacion.concesionario} />
          </div>
        </Bloque>

        <Bloque titulo="Adjuntos">
          <ListaAdjuntos />
        </Bloque>

        <Bloque titulo="Personas">
          {!ficha.datosCompletos ? (
            <p className="mb-3 text-sm text-texto-secundario">El teléfono, el correo y el domicilio se ven enmascarados porque tu área no trabaja este expediente.</p>
          ) : null}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {ficha.personas.map((p) => (
              <li key={p.id}>
                <TarjetaPersona persona={p} suprimir={a.suprimirPersona.permitido} />
              </li>
            ))}
          </ul>
          {a.verDatosCompletos.permitido && a.verDatosCompletos.requiereMotivo ? (
            <div className="mt-3">
              <VerDatosCompletos numero={ficha.numero} area={areaUsuario} etiquetas={etiquetas} />
            </div>
          ) : null}
          {ficha.personasHistoricas.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-texto">Versiones anteriores y bajas ({ficha.personasHistoricas.length})</summary>
              <ul className="mt-2 space-y-1 text-texto-secundario">
                {ficha.personasHistoricas.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {p.etiquetaRol}: {p.suprimida ? "(datos suprimidos)" : nombreCompleto(p)}
                      {documentoDePersona(p) ? ` · ${documentoDePersona(p)}` : ""}
                      {p.reemplazadaPorId ? " · reemplazada por una versión nueva" : " · dada de baja"}
                    </span>
                    {a.suprimirPersona.permitido && !p.suprimida ? <BotonSuprimir persona={p} /> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Bloque>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Bloque titulo="Conceptos a liquidar">
            {ficha.conceptos.length === 0 ? (
              <p className="text-sm text-texto-secundario">Ninguno.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {ficha.conceptos.map((c) => (
                  <li key={c.clave}>
                    <span className="text-texto">{c.nombre}</span>
                    <span className="text-texto-secundario">
                      {" "}
                      · {c.via === "plan_dim" ? "plan de pagos en la DIM" : "boleta"} · en {c.paso.nombre}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Bloque>
          <Bloque titulo="Datos del trámite">
            {ficha.datosExtra.length === 0 ? (
              <p className="text-sm text-texto-secundario">Este trámite no tiene datos propios.</p>
            ) : (
              <dl className="space-y-1.5 text-sm">
                {ficha.datosExtra.map((c) => (
                  <div key={c.clave}>
                    <dt className="text-texto-secundario">{c.etiqueta}</dt>
                    <dd className="text-texto">
                      {c.valorTexto === null ? "—" : c.tipo === "fecha" && typeof c.valor === "string" ? formatearFecha(c.valor) : c.valorTexto}
                      {c.obligatorio && c.valorTexto === null ? (
                        <span className="text-texto-secundario"> (se pide {c.exigirAlSalirDe ? `al salir de ${c.exigirAlSalirDe.nombre}` : "para concluir"})</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Bloque>
        </div>

        <Bloque titulo="Historial">
          <LineaDeTiempo
            historial={ficha.historial}
            contexto={resumen}
            acciones={(m) => (m.correcciones.length > 0 ? <MenuCorregir movimiento={movimientoCorregible(m, subtareasConocidas)} /> : null)}
          />
        </Bloque>
      </article>
    </ProveedorFlujo>
  );
}

function Bloque({ titulo, children, aside }: { titulo: string; children: React.ReactNode; aside?: React.ReactNode }) {
  const id = `bloque-${titulo.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="tarjeta px-4 pb-4 pt-3.5 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-borde pb-2.5">
        <h2 id={id} className="titulo-seccion">
          {titulo}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Dato({ titulo, destacado = false, children }: { titulo: string; destacado?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-texto-secundario">{titulo}</dt>
      <dd className={destacado ? "mt-0.5 font-semibold text-institucional" : "mt-0.5 text-texto"}>{children}</dd>
    </div>
  );
}

function ListaDocumentos({ titulo, documentos }: { titulo: string; documentos: DocumentoFicha[] }) {
  const presentados = documentos.filter((d) => d.estado !== "pendiente").length;
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 flex items-center justify-between gap-2 text-sm font-semibold text-texto">
        {titulo}
        {documentos.length > 0 ? (
          <span className="text-xs font-normal text-texto-secundario tabular-nums">
            {presentados} de {documentos.length}
            <span className="sr-only"> resueltos</span>
          </span>
        ) : null}
      </h3>
      {documentos.length === 0 ? (
        <p className="text-sm text-texto-secundario">Ninguno.</p>
      ) : (
        <ul className="divide-y divide-borde text-sm">
          {documentos.map((d) => (
            <li key={d.clave} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <span className="text-texto">
                  {d.nombre}
                  {d.obligatorio ? "" : <span className="text-texto-secundario"> (opcional)</span>}
                </span>
                <span
                  className={`insignia ring-1 ring-inset ${
                    d.estado === "pendiente"
                      ? "bg-advertencia-fondo text-advertencia ring-advertencia-borde"
                      : d.estado === "presentado" || d.estado === "historico"
                        ? "bg-exito-fondo text-exito ring-exito-borde"
                        : "bg-fondo text-texto-secundario ring-borde"
                  }`}
                >
                  {ETIQUETA_DOCUMENTO[d.estado] ?? d.estado}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
                <div className="min-w-0 text-xs text-texto-secundario">
                  {d.obligatorio && d.estado === "pendiente" ? <p>Se exige {d.exigirAlSalirDe ? `al salir de ${d.exigirAlSalirDe.nombre}` : "para concluir"}</p> : null}
                  {d.obs ? <p>{d.obs}</p> : null}
                  {d.cantidadAdjuntos > 0 || d.adjunto === "obligatorio" ? (
                    <p>{d.cantidadAdjuntos > 0 ? (d.cantidadAdjuntos === 1 ? "1 adjunto" : `${d.cantidadAdjuntos} adjuntos`) : "Lleva adjunto"}</p>
                  ) : null}
                </div>
                <BotonesDocumento clave={d.clave} nombre={d.nombre} adjunto={d.adjunto} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** El semáforo del plazo DIM (3.6): la etiqueta de color con su texto, el vencimiento y si es provisorio. */
function EtiquetaPlazo({ plazo }: { plazo: PlazoMostrado }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`insignia ring-1 ring-inset ${plazo.clase}`}>{plazo.etiqueta}</span>
      <span>{plazo.texto}</span>
      {plazo.aviso ? <span className="block w-full text-xs text-texto-secundario">{plazo.aviso}</span> : null}
    </span>
  );
}

/** Suprimir los datos de una persona (Ley 25.326): solo el admin; el diálogo pide motivo y confirmación. */
function BotonSuprimir({ persona: p }: { persona: PersonaFicha }) {
  return (
    <BotonFlujo
      dialogo={{ tipo: "suprimir", persona: { id: p.id, texto: `${p.etiquetaRol}: ${nombreCompleto(p)}` } }}
      className={`${CLASE_BOTON_COMPACTO_PELIGRO} print:hidden`}
      etiqueta={`Suprimir los datos de ${p.etiquetaRol} (Ley 25.326)`}
    >
      <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />
      Suprimir datos
    </BotonFlujo>
  );
}

function TarjetaPersona({ persona: p, suprimir }: { persona: PersonaFicha; suprimir: boolean }) {
  const c = p.contacto;
  return (
    <div className="h-full rounded-control border border-borde bg-fondo/70 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-texto-secundario">
        {p.etiquetaRol}
        {p.esContacto ? <span className="insignia bg-info-fondo normal-case tracking-normal text-info ring-1 ring-inset ring-info-borde">Contacto</span> : null}
      </p>
      <p className="mt-0.5 font-semibold text-texto">{p.suprimida ? "(datos suprimidos)" : nombreCompleto(p)}</p>
      <p className="text-texto">
        {p.tipo === "juridica" ? "Persona jurídica · " : ""}
        {documentoDePersona(p) || (p.tipo === "juridica" ? "Sin CUIT" : "Sin DNI")}
        {p.fallecido ? ` · Fallecido${p.fechaDefuncion ? ` el ${formatearFecha(p.fechaDefuncion)}` : ""}` : ""}
        {p.vinculo ? ` · Vínculo: ${p.vinculo}` : ""}
      </p>
      {!p.fallecido && (c.telefono || c.email || c.domicilio) ? (
        <dl className="mt-1.5 space-y-0.5 text-texto">
          {c.telefono ? (
            <div>
              <dt className="inline text-texto-secundario">Teléfono: </dt>
              <dd className="inline">
                {c.telefono}
                {c.telefonoWhatsapp ? " (WhatsApp)" : ""}
              </dd>
            </div>
          ) : null}
          {c.email ? (
            <div>
              <dt className="inline text-texto-secundario">Correo: </dt>
              <dd className="inline break-all">{c.email}</dd>
            </div>
          ) : null}
          {c.domicilio ? (
            <div>
              <dt className="inline text-texto-secundario">Domicilio: </dt>
              <dd className="inline">{c.domicilio}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {c.enmascarado && (c.telefono || c.email || c.domicilio) ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-texto-secundario">
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          Enmascarado
        </p>
      ) : null}
      {suprimir && !p.suprimida ? (
        <div className="mt-2">
          <BotonSuprimir persona={p} />
        </div>
      ) : null}
    </div>
  );
}
