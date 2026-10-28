import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { clasePestana } from "@/components/pestanas";
import { CLASE_BOTON_SECUNDARIO } from "@/components/formulario";
import { PantallaConRecorrido } from "@/components/recorrido/proveedor";
import { exigirPantalla } from "@/lib/auth/sesion";
import { RUTA_SITIO_PUBLICO } from "@/lib/dominio/navegacion";
import { FOTOS_SITIO } from "@/lib/dominio/sitio";
import { sitio } from "@/lib/dominio/sitio/servidor";
import { PAGINAS_PUBLICAS, RUTA_VISTA_PUBLICA, type RutaInterna } from "@/lib/presentacion/sitio-publico";
import { PestanaCementerios, PestanaContacto, PestanaNovedades, PestanaPreguntas, PestanaRecorridos } from "./pestanas";

export const metadata: Metadata = { title: "Sitio público" };

/** Cada pestaña, con la página pública donde se ve lo que carga (las novedades, en el inicio: "Ver la página pública"). */
const PESTANAS: ReadonlyArray<{ id: string; etiqueta: string; pagina: RutaInterna | null }> = [
  { id: "cementerios", etiqueta: "Cementerios", pagina: "/cementerios" },
  { id: "recorridos", etiqueta: "Recorridos", pagina: "/recorridos" },
  { id: "novedades", etiqueta: "Novedades", pagina: null },
  { id: "contacto", etiqueta: "Contacto", pagina: "/contacto" },
  { id: "preguntas", etiqueta: "Preguntas frecuentes", pagina: "/contacto" },
];
type Pestana = (typeof PESTANAS)[number];

function leerPestana(v: string | string[] | undefined): Pestana {
  const x = Array.isArray(v) ? v[0] : v;
  return PESTANAS.find((p) => p.id === x) ?? PESTANAS[0];
}

/**
 * `/admin/sitio-publico` (28/10/2026; docs/api-dominio.md, sección 25): el
 * contenido de la página pública que carga la Dirección. Pestañas Cementerios
 * (domicilio, mapa, descripción, horarios de visita, foto y si se muestra),
 * Recorridos (con sus fechas), Novedades, Contacto (Mesa de Entradas) y
 * Preguntas frecuentes. La pestaña vive en la URL. Para la Dirección y el
 * admin (permiso `editar_sitio_publico`); cada cambio queda en
 * auditoria.cambios. "Ver la página pública" abre `/?vista=publica`, el inicio
 * igual que sin sesión, y cada pestaña ofrece además la página donde se ve lo
 * suyo (Recorridos, `/recorridos`; Contacto y Preguntas, `/contacto`). Las reglas son del dominio (src/lib/dominio/sitio/);
 * los formularios, de ./pestanas.tsx.
 */
export default async function PaginaSitioPublico(props: PageProps<"/admin/sitio-publico">) {
  const usuario = await exigirPantalla("sitio_publico");
  const { id: pestana, pagina } = leerPestana((await props.searchParams).pestana);
  const contenido = await sitio.contenidoAdmin(usuario);
  const fotos = FOTOS_SITIO.map((f) => ({ clave: f.clave, etiqueta: f.etiqueta }));
  const cementerios = contenido.cementerios.map((c) => ({ id: c.cementerioId, nombre: c.nombre }));

  return (
    <section aria-labelledby="titulo-sitio" className="space-y-4">
      <PantallaConRecorrido id="admin-sitio-publico" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 id="titulo-sitio" className="text-2xl font-semibold tracking-tight text-texto">
            Sitio público
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-texto-secundario">
            Lo que ve cualquier persona en la página de los cementerios: datos y horarios de cada cementerio, recorridos, novedades, contacto y
            preguntas frecuentes. Se muestra como texto, tal cual se escribe. Lo que queda vacío no aparece. Cada cambio queda en la auditoría.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-recorrido="sitio-ver">
          {pagina ? (
            <a href={pagina} target="_blank" rel="noopener" className={CLASE_BOTON_SECUNDARIO}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Ver «{PAGINAS_PUBLICAS[pagina].titulo}»<span className="sr-only"> en la página pública (se abre en otra pestaña)</span>
            </a>
          ) : null}
          <a href={RUTA_VISTA_PUBLICA} target="_blank" rel="noopener" className={CLASE_BOTON_SECUNDARIO}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Ver la página pública<span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </div>
      </div>
      <nav aria-label="Partes del sitio público" data-recorrido="sitio-pestanas">
        <ul className="flex flex-wrap gap-1 border-b border-borde">
          {PESTANAS.map((p) => (
            <li key={p.id}>
              <Link href={`${RUTA_SITIO_PUBLICO}?pestana=${p.id}`} aria-current={p.id === pestana ? "page" : undefined} className={clasePestana(p.id === pestana)}>
                {p.etiqueta}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div data-recorrido="sitio-contenido">
        {pestana === "cementerios" ? <PestanaCementerios filas={contenido.cementerios} fotos={fotos} /> : null}
        {pestana === "recorridos" ? <PestanaRecorridos filas={contenido.recorridos} cementerios={cementerios} fotos={fotos} /> : null}
        {pestana === "novedades" ? <PestanaNovedades filas={contenido.novedades} /> : null}
        {pestana === "contacto" ? <PestanaContacto contacto={contenido.contacto} /> : null}
        {pestana === "preguntas" ? <PestanaPreguntas filas={contenido.preguntas} /> : null}
      </div>
    </section>
  );
}
