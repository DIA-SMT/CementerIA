import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Circle, CircleCheck, CircleDot, MessageCircle, Pencil, Printer } from "lucide-react";
import { EtiquetaEstado, EtiquetaSituacion } from "@/components/etiquetas";
import { CLASE_BOTON_SECUNDARIO, CLASE_ENLACE } from "@/components/formulario";
import { ipDeSolicitud } from "@/lib/auth/red";
import { exigirPantalla } from "@/lib/auth/sesion";
import { ErrorDominio, expedientes, type DocumentoFicha, type Ficha, type PersonaFicha } from "@/lib/dominio/expedientes/servidor";
import { formatearFecha, formatearFechaHora } from "@/lib/fechas";
import { AVISO_EDITADO } from "@/lib/presentacion/acciones";
import { enlaceWhatsapp, mensajeWhatsapp, rutaEditar, rutaFicha, rutaImprimir } from "@/lib/presentacion/enlaces";
import { contextoResumen } from "@/lib/presentacion/historial";
import { ETIQUETA_DOCUMENTO, ETIQUETA_FORMA_PAGO, formatearDni, nombreCompleto } from "@/lib/presentacion/textos";
import { LineaDeTiempo } from "../linea-de-tiempo";
import { VerDatosCompletos } from "./ver-datos-completos";

export async function generateMetadata(props: PageProps<"/expedientes/[numero]">): Promise<Metadata> {
  const { numero } = await props.params;
  return { title: numero.toUpperCase() };
}

/**
 * Ficha digital (sección 5, `/expedientes/[numero]`), de solo lectura en la
 * semana 2. Abrirla registra `ver_expediente`. El contacto llega enmascarado
 * para quien no trabaja el expediente (decisión 13), con "Ver datos
 * completos". Las acciones del flujo (pase, devolución, tildar…) son de la
 * semana 3: no hay botones para ellas.
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
  const resumen = contextoResumen([...ficha.personas, ...ficha.personasHistoricas], ficha.datosExtra);

  return (
    <article aria-labelledby="titulo-ficha" className="space-y-6">
      {aviso === AVISO_EDITADO ? (
        <p role="status" className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Check className="h-4 w-4" aria-hidden="true" />
          Cambios guardados.
        </p>
      ) : null}

      <header className="space-y-3 rounded border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 id="titulo-ficha" className="font-mono text-2xl font-semibold tracking-tight text-slate-900">
            {ficha.numero}
          </h1>
          <span className="text-sm text-slate-600">({ficha.numeroCorto})</span>
          <EtiquetaEstado estado={ficha.estado} />
          {ficha.situaciones.map((s) => (
            <EtiquetaSituacion key={s} situacion={s} />
          ))}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Dato titulo="N° municipal">{ficha.numeroMunicipal ?? "—"}</Dato>
          <Dato titulo="Trámite">
            {ficha.tipoTramite.nombre}
            <span className="block text-slate-700">
              {ficha.plantilla.nombre} · v{ficha.plantilla.version}
              {ficha.plantilla.hayVersionNueva ? (
                <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">hay v{ficha.plantilla.versionPublicada}</span>
              ) : null}
            </span>
          </Dato>
          <Dato titulo="Paso actual">
            {ficha.paso.orden} de {ficha.paso.total}: {ficha.paso.nombre}
          </Dato>
          <Dato titulo="Área actual">
            {ficha.areaActual.nombre}
            {ficha.areaResponsable.id !== ficha.areaActual.id ? (
              <span className="block text-slate-700">Lo sigue: {ficha.areaResponsable.nombre}</span>
            ) : null}
          </Dato>
          <Dato titulo="En el área desde">
            {formatearFechaHora(ficha.enAreaDesde)}
            <span className="block text-slate-700">
              {ficha.recibidoEn ? `Recibido el ${formatearFechaHora(ficha.recibidoEn)}` : "Sin confirmar la recepción"}
            </span>
          </Dato>
          {ficha.expedienteAnterior || ficha.expedientesSiguientes.length > 0 ? (
            <Dato titulo="Relacionados">
              {ficha.expedienteAnterior ? (
                <span className="block">
                  Viene de{" "}
                  <Link href={rutaFicha(ficha.expedienteAnterior)} prefetch={false} className={CLASE_ENLACE}>
                    {ficha.expedienteAnterior}
                  </Link>
                </span>
              ) : null}
              {ficha.expedientesSiguientes.map((n) => (
                <span key={n} className="block">
                  Siguió en{" "}
                  <Link href={rutaFicha(n)} prefetch={false} className={CLASE_ENLACE}>
                    {n}
                  </Link>
                </span>
              ))}
            </Dato>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          {puedeEditar ? (
            <Link href={rutaEditar(ficha.numero)} prefetch={false} className={CLASE_BOTON_SECUNDARIO}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar
            </Link>
          ) : null}
          {a.imprimir.permitido ? (
            <>
              <Link href={rutaImprimir(ficha.numero, "caratula")} prefetch={false} className={CLASE_BOTON_SECUNDARIO}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Imprimir carátula
              </Link>
              <Link href={rutaImprimir(ficha.numero, "historial")} prefetch={false} className={CLASE_BOTON_SECUNDARIO}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Imprimir historial
              </Link>
            </>
          ) : null}
          {whatsapp ? (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={CLASE_BOTON_SECUNDARIO}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp al contacto
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          ) : null}
        </div>
      </header>

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
            {ficha.cargaHistorica ? <span className="block text-slate-700">Iniciado antes del sistema</span> : null}
          </Dato>
          <Dato titulo="Alta">
            {formatearFechaHora(ficha.creadoEn)} por {ficha.creadoPor.corto}
          </Dato>
          {ficha.ubicacionArchivo ? <Dato titulo="Ubicación en el archivo">{ficha.ubicacionArchivo}</Dato> : null}
        </dl>
        {ficha.observaciones ? (
          <div className="mt-3 text-sm">
            <p className="text-slate-600">Observaciones</p>
            <p className="whitespace-pre-line text-slate-900">{ficha.observaciones}</p>
          </div>
        ) : null}
      </Bloque>

      <Bloque titulo="Recorrido">
        <ol className="space-y-3">
          {ficha.recorrido.map((p) => (
            <li key={p.clave} aria-current={p.situacion === "actual" ? "step" : undefined} className={p.situacion === "actual" ? "rounded bg-sky-50 p-2 ring-1 ring-sky-200" : "px-2"}>
              <div className="flex items-start gap-2 text-sm">
                {p.situacion === "cumplido" ? (
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                ) : p.situacion === "actual" ? (
                  <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" aria-hidden="true" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                )}
                <div>
                  <p>
                    <span className="font-medium text-slate-900">
                      {p.orden}. {p.nombre}
                    </span>
                    <span className="text-slate-700">
                      {" "}
                      · {p.area?.nombre ?? p.areaDefinida}
                      {p.custodia ? ` (lo sigue ${p.custodia.nombre})` : ""}
                    </span>
                    <span className="sr-only">
                      {p.situacion === "cumplido" ? " (cumplido)" : p.situacion === "actual" ? " (paso actual)" : " (pendiente)"}
                    </span>
                  </p>
                  {p.instrucciones ? <p className="text-xs text-slate-600">{p.instrucciones}</p> : null}
                  {p.subtareas.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {p.subtareas.map((s) => (
                        <li key={s.clave} className="flex items-start gap-1.5 text-xs text-slate-700">
                          <span aria-hidden="true">{s.hecha ? "☑" : "☐"}</span>
                          <span>
                            {s.nombre}
                            {s.obligatoria ? "" : " (opcional)"}
                            {s.hecha && s.valor ? `: ${s.valor}` : ""}
                            <span className="sr-only">{s.hecha ? " (hecha)" : " (pendiente)"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
        {ficha.plazo ? (
          <p className="mt-3 text-sm text-slate-800">
            Plazo: {ficha.plazo.diasHabiles} días hábiles
            {ficha.plazo.vence ? `, vence el ${formatearFecha(ficha.plazo.vence)}` : ", todavía no empezó"}
            {ficha.plazo.cumplidoEn ? ` (cumplido el ${formatearFecha(ficha.plazo.cumplidoEn)})` : ""}
            {ficha.plazo.faltan !== null && !ficha.plazo.cumplidoEn
              ? ficha.plazo.faltan >= 0
                ? ` · faltan ${ficha.plazo.faltan} días hábiles`
                : ` · vencido hace ${-ficha.plazo.faltan} días hábiles`
              : ""}
          </p>
        ) : null}
      </Bloque>

      <Bloque titulo="Documentación">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ListaDocumentos titulo="Dirección" documentos={ficha.documentacion.direccion} />
          <ListaDocumentos titulo="Concesionario" documentos={ficha.documentacion.concesionario} />
        </div>
      </Bloque>

      <Bloque titulo="Personas">
        {!ficha.datosCompletos ? (
          <p className="mb-3 text-sm text-slate-700">El teléfono, el correo y el domicilio se ven enmascarados porque tu área no trabaja este expediente.</p>
        ) : null}
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ficha.personas.map((p) => (
            <li key={p.id}>
              <TarjetaPersona persona={p} />
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
            <summary className="cursor-pointer text-slate-800">Versiones anteriores y bajas ({ficha.personasHistoricas.length})</summary>
            <ul className="mt-2 space-y-1 text-slate-700">
              {ficha.personasHistoricas.map((p) => (
                <li key={p.id}>
                  {p.etiquetaRol}: {p.suprimida ? "(datos suprimidos)" : nombreCompleto(p)}
                  {p.dni ? ` · DNI ${formatearDni(p.dni)}` : ""}
                  {p.reemplazadaPorId ? " · reemplazada por una versión nueva" : " · dada de baja"}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Bloque>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Bloque titulo="Conceptos a liquidar">
          {ficha.conceptos.length === 0 ? (
            <p className="text-sm text-slate-600">Ninguno.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {ficha.conceptos.map((c) => (
                <li key={c.clave}>
                  <span className="text-slate-900">{c.nombre}</span>
                  <span className="text-slate-700">
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
            <p className="text-sm text-slate-600">Este trámite no tiene datos propios.</p>
          ) : (
            <dl className="space-y-1.5 text-sm">
              {ficha.datosExtra.map((c) => (
                <div key={c.clave}>
                  <dt className="text-slate-600">{c.etiqueta}</dt>
                  <dd className="text-slate-900">
                    {c.valorTexto === null ? "—" : c.tipo === "fecha" && typeof c.valor === "string" ? formatearFecha(c.valor) : c.valorTexto}
                    {c.obligatorio && c.valorTexto === null ? (
                      <span className="text-slate-600"> (se pide {c.exigirAlSalirDe ? `al salir de ${c.exigirAlSalirDe.nombre}` : "para concluir"})</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Bloque>
      </div>

      <Bloque titulo="Historial">
        <LineaDeTiempo historial={ficha.historial} contexto={resumen} />
      </Bloque>
    </article>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const id = `bloque-${titulo.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="rounded border border-slate-300 bg-white p-4">
      <h2 id={id} className="mb-3 text-base font-semibold text-slate-900">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-600">{titulo}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

function ListaDocumentos({ titulo, documentos }: { titulo: string; documentos: DocumentoFicha[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{titulo}</h3>
      {documentos.length === 0 ? (
        <p className="text-sm text-slate-600">Ninguno.</p>
      ) : (
        <ul className="divide-y divide-slate-200 text-sm">
          {documentos.map((d) => (
            <li key={d.clave} className="py-1.5">
              <div className="flex justify-between gap-3">
                <span className="text-slate-900">
                  {d.nombre}
                  {d.obligatorio ? "" : <span className="text-slate-600"> (opcional)</span>}
                </span>
                <span className={d.estado === "pendiente" ? "font-medium text-amber-900" : "text-slate-800"}>
                  {ETIQUETA_DOCUMENTO[d.estado] ?? d.estado}
                </span>
              </div>
              {d.obligatorio && d.estado === "pendiente" ? (
                <p className="text-xs text-slate-600">Se exige {d.exigirAlSalirDe ? `al salir de ${d.exigirAlSalirDe.nombre}` : "para concluir"}</p>
              ) : null}
              {d.obs ? <p className="text-xs text-slate-600">{d.obs}</p> : null}
              {d.cantidadAdjuntos > 0 ? <p className="text-xs text-slate-600">{d.cantidadAdjuntos} adjunto(s)</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TarjetaPersona({ persona: p }: { persona: PersonaFicha }) {
  const c = p.contacto;
  return (
    <div className="h-full rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-slate-600">
        {p.etiquetaRol}
        {p.esContacto ? <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-white">Contacto</span> : null}
      </p>
      <p className="font-medium text-slate-900">{p.suprimida ? "(datos suprimidos)" : nombreCompleto(p)}</p>
      <p className="text-slate-800">
        {p.dni ? `DNI ${formatearDni(p.dni)}` : "Sin DNI"}
        {p.fallecido ? ` · Fallecido${p.fechaDefuncion ? ` el ${formatearFecha(p.fechaDefuncion)}` : ""}` : ""}
        {p.vinculo ? ` · Vínculo: ${p.vinculo}` : ""}
      </p>
      {!p.fallecido && (c.telefono || c.email || c.domicilio) ? (
        <dl className="mt-1 space-y-0.5 text-slate-800">
          {c.telefono ? (
            <div>
              <dt className="inline text-slate-600">Teléfono: </dt>
              <dd className="inline">
                {c.telefono}
                {c.telefonoWhatsapp ? " (WhatsApp)" : ""}
              </dd>
            </div>
          ) : null}
          {c.email ? (
            <div>
              <dt className="inline text-slate-600">Correo: </dt>
              <dd className="inline">{c.email}</dd>
            </div>
          ) : null}
          {c.domicilio ? (
            <div>
              <dt className="inline text-slate-600">Domicilio: </dt>
              <dd className="inline">{c.domicilio}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {c.enmascarado && (c.telefono || c.email || c.domicilio) ? <p className="mt-1 text-xs text-slate-600">Enmascarado</p> : null}
    </div>
  );
}
