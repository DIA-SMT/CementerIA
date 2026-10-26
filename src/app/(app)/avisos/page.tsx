import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { BellOff, Check, ChevronLeft, ChevronRight, CheckCheck, Mail, MailOpen } from "lucide-react";
import { EncabezadoPagina } from "@/components/encabezado-pagina";
import { EstadoVacio } from "@/components/estado-vacio";
import { IconoAviso } from "@/components/icono-aviso";
import {
  CLASE_BOTON_COMPACTO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CASILLA,
  CLASE_CONTROL,
  CLASE_ENLACE,
  CLASE_FOCO,
} from "@/components/formulario";
import { exigirUsuario } from "@/lib/auth/sesion";
import { avisos, ETIQUETA_TIPO_AVISO, recibeAvisos, TIPOS_AVISO } from "@/lib/dominio/avisos/servidor";
import { AREA_MESA_ENTRADAS } from "@/lib/dominio/permisos";
import { formatearFechaHora } from "@/lib/fechas";
import { haceCuanto, leerFiltrosAvisos, rutaAvisos } from "@/lib/presentacion/avisos";
import { accionMarcarAviso, accionMarcarTodosDesdePagina, accionPreferencia } from "./acciones";
import { EnlaceAviso } from "./enlace-aviso";

export const metadata: Metadata = { title: "Avisos" };

/** Pastilla de filtro (como los filtros del historial): `aria-current` en la elegida. */
function clasePastilla(actual: boolean): string {
  return `inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors duration-150 ${CLASE_FOCO} ${
    actual ? "border-primario-oscuro bg-superficie-azul text-primario-oscuro" : "border-borde-control bg-white text-texto hover:border-primario hover:text-primario-oscuro"
  }`;
}

/**
 * /avisos (docs/api-dominio.md, 21.5): la lista completa de los avisos del
 * usuario, del más nuevo al más viejo, de a 25, con los filtros en la URL
 * (`?estado=no_leidos&tipo=devuelto&pagina=2`). Cada aviso enlaza a la ficha
 * (abrirlo lo marca leído) y se puede marcar como leído o no leído. Mesa de
 * Entradas puede apagar "Concluido o archivado". Para quien no recibe avisos
 * (Dirección, el admin) la pantalla lo dice: la campana no les aparece.
 */
export default async function PaginaAvisos(props: PageProps<"/avisos">) {
  const usuario = await exigirUsuario();
  const parametros = await props.searchParams;
  const filtros = leerFiltrosAvisos(parametros);

  if (!recibeAvisos(usuario)) {
    return (
      <section aria-labelledby="titulo-avisos" className="space-y-4">
        <EncabezadoPagina id="titulo-avisos" titulo="Avisos" />
        <EstadoVacio icono={BellOff} titulo="Los avisos son para las áreas que trabajan los expedientes.">
          <p>Dirección y la administración siguen el circuito desde el panel.</p>
        </EstadoVacio>
      </section>
    );
  }

  const lista = await avisos.listar(usuario, { soloNoLeidos: filtros.soloNoLeidos, tipo: filtros.tipo, pagina: filtros.pagina });
  const preferencias = usuario.area?.codigo === AREA_MESA_ENTRADAS ? await avisos.preferencias(usuario) : [];
  const ahora = new Date();
  const hayFiltros = filtros.soloNoLeidos || filtros.tipo !== null;

  return (
    <section aria-labelledby="titulo-avisos" className="space-y-4">
      <EncabezadoPagina
        id="titulo-avisos"
        titulo="Avisos"
        antetitulo={usuario.area?.nombre}
        descripcion={lista.noLeidos === 0 ? "No tenés avisos sin leer." : lista.noLeidos === 1 ? "Tenés 1 aviso sin leer." : `Tenés ${lista.noLeidos} avisos sin leer.`}
        acciones={
          lista.noLeidos > 0 ? (
            <form action={accionMarcarTodosDesdePagina}>
              <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                Marcar todos como leídos
              </button>
            </form>
          ) : null
        }
      />

      {/* Filtros: leídos o no (enlaces) y el tipo (formulario GET, sin JavaScript). */}
      <div className="tarjeta flex flex-wrap items-end gap-x-6 gap-y-3 px-4 py-3">
        <nav aria-label="Mostrar">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-texto-secundario">Mostrar</p>
          <ul className="flex gap-2">
            <li>
              <Link href={rutaAvisos({ tipo: filtros.tipo })} aria-current={!filtros.soloNoLeidos ? "page" : undefined} className={clasePastilla(!filtros.soloNoLeidos)}>
                {!filtros.soloNoLeidos ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                Todos
              </Link>
            </li>
            <li>
              <Link
                href={rutaAvisos({ tipo: filtros.tipo, soloNoLeidos: true })}
                aria-current={filtros.soloNoLeidos ? "page" : undefined}
                className={clasePastilla(filtros.soloNoLeidos)}
              >
                {filtros.soloNoLeidos ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                No leídos
              </Link>
            </li>
          </ul>
        </nav>
        <Form action="/avisos" className="flex flex-wrap items-end gap-2">
          {filtros.soloNoLeidos ? <input type="hidden" name="estado" value="no_leidos" /> : null}
          {/* El ancho va en el contenedor: sumarle `w-auto` a CLASE_CONTROL no le gana a su `w-full` (docs/diseno.md). */}
          <div className="w-64 max-w-full">
            <label htmlFor="filtro-tipo" className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-texto-secundario">
              Tipo
            </label>
            <select id="filtro-tipo" name="tipo" defaultValue={filtros.tipo ?? ""} className={CLASE_CONTROL}>
              <option value="">Todos los tipos</option>
              {TIPOS_AVISO.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETA_TIPO_AVISO[t]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
            Filtrar
          </button>
        </Form>
        {hayFiltros ? (
          <Link href="/avisos" className={`${CLASE_ENLACE} text-sm`}>
            Quitar filtros
          </Link>
        ) : null}
      </div>

      <p aria-live="polite" className="text-sm text-texto-secundario">
        {lista.total === 0
          ? hayFiltros
            ? "No hay avisos con esos filtros."
            : "Todavía no tenés avisos."
          : `${lista.total === 1 ? "1 aviso" : `${lista.total} avisos`}${lista.paginas > 1 ? ` · página ${lista.pagina} de ${lista.paginas}` : ""}`}
      </p>

      {lista.filas.length > 0 ? (
        <ul aria-label="Avisos" className="tarjeta divide-y divide-borde overflow-hidden">
          {lista.filas.map((a) => {
            const noLeido = a.leidoEn === null;
            const alta = a.prioridad === "alta";
            return (
              <li key={a.id} className={`flex flex-col gap-3 border-l-4 px-4 py-3 sm:flex-row sm:items-start ${alta ? "border-error" : "border-transparent"} ${noLeido ? "bg-superficie-azul/40" : "bg-white"}`}>
                <div className="flex min-w-0 flex-1 gap-3">
                  <IconoAviso tipo={a.tipo} />
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <EnlaceAviso id={a.id} href={a.enlace} noLeido={noLeido} className={`${CLASE_ENLACE} text-sm ${noLeido ? "font-semibold" : "font-medium"}`}>
                        {noLeido ? <span className="sr-only">Sin leer: </span> : null}
                        {a.titulo}
                      </EnlaceAviso>
                      {alta ? <span className="insignia bg-error-fondo text-error ring-1 ring-inset ring-error-borde">Prioridad alta</span> : null}
                      {noLeido ? (
                        <span className="insignia bg-info-fondo text-info ring-1 ring-inset ring-info-borde" aria-hidden="true">
                          Sin leer
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-texto">{a.texto}</p>
                    <p className="text-xs text-texto-secundario">
                      {ETIQUETA_TIPO_AVISO[a.tipo]} ·{" "}
                      <time dateTime={a.creadoEn} title={formatearFechaHora(new Date(a.creadoEn))}>
                        {haceCuanto(a.creadoEn, ahora)}
                      </time>
                    </p>
                  </div>
                </div>
                <form action={accionMarcarAviso.bind(null, a.id, noLeido)} className="shrink-0 sm:pl-2">
                  <button type="submit" className={CLASE_BOTON_COMPACTO} aria-label={`${noLeido ? "Marcar como leído" : "Marcar como no leído"}: ${a.titulo}`}>
                    {noLeido ? <MailOpen className="h-4 w-4" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                    {noLeido ? "Marcar como leído" : "Marcar como no leído"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}

      {lista.paginas > 1 ? (
        <nav aria-label="Páginas de avisos" className="flex items-center justify-between gap-2">
          {lista.pagina > 1 ? (
            <Link href={rutaAvisos({ ...filtros, pagina: lista.pagina - 1 })} className={CLASE_BOTON_COMPACTO}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-texto-secundario tabular-nums">
            Página {lista.pagina} de {lista.paginas}
          </span>
          {lista.pagina < lista.paginas ? (
            <Link href={rutaAvisos({ ...filtros, pagina: lista.pagina + 1 })} className={CLASE_BOTON_COMPACTO}>
              Siguiente
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      {preferencias.length > 0 ? (
        <section aria-labelledby="titulo-preferencias" className="tarjeta space-y-3 px-4 py-4">
          <h2 id="titulo-preferencias" className="titulo-seccion">
            Preferencias
          </h2>
          {preferencias.map((p) => (
            <form key={p.tipo} action={accionPreferencia.bind(null, p.tipo)} className="flex flex-wrap items-center gap-3">
              <label className="flex items-start gap-2 text-sm text-texto">
                <input type="checkbox" name="activo" value="si" defaultChecked={p.activo} className={`${CLASE_CASILLA} mt-0.5`} />
                <span>
                  Avisarme cuando un expediente se concluye o se archiva
                  <span className="block text-xs text-texto-secundario">
                    Informativo. Los demás avisos son parte del trabajo del área y no se apagan.
                  </span>
                </span>
              </label>
              <button type="submit" className={CLASE_BOTON_COMPACTO}>
                Guardar
              </button>
            </form>
          ))}
        </section>
      ) : null}
    </section>
  );
}
