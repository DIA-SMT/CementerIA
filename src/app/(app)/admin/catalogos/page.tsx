import type { Metadata } from "next";
import Link from "next/link";
import { clasePestana } from "@/components/pestanas";
import { exigirPantalla } from "@/lib/auth/sesion";
import { admin } from "@/lib/dominio/admin/servidor";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { anioEnTucuman, formatearFechaHora } from "@/lib/fechas";
import { PestanaAreas, PestanaCementerios, PestanaSimple } from "./catalogos";
import { PestanaFeriados } from "./feriados";

export const metadata: Metadata = { title: "Catálogos" };

const PESTANAS = [
  { id: "areas", etiqueta: "Áreas" },
  { id: "cementerios", etiqueta: "Cementerios" },
  { id: "monumentos", etiqueta: "Tipos de monumento" },
  { id: "tramites", etiqueta: "Tipos de trámite" },
  { id: "feriados", etiqueta: "Feriados" },
] as const;
type Pestana = (typeof PESTANAS)[number]["id"];

function leerPestana(v: string | string[] | undefined): Pestana {
  const x = Array.isArray(v) ? v[0] : v;
  return PESTANAS.find((p) => p.id === x)?.id ?? "areas";
}

/**
 * `/admin/catalogos` (sección 5): áreas, cementerios (nomenclatura y tipos de
 * monumento habilitados), tipos de monumento, tipos de trámite y feriados
 * (con "Cerrar año"). La pestaña y el año viven en la URL. Las reglas (código
 * fijo, claves de ubicación usadas, coherencia de áreas y cementerios) son del
 * dominio; las pestañas están en ./catalogos.tsx y ./feriados.tsx.
 */
export default async function PaginaCatalogos(props: PageProps<"/admin/catalogos">) {
  const usuario = await exigirPantalla("admin");
  const parametros = await props.searchParams;
  const pestana = leerPestana(parametros.pestana);
  const catalogos = await admin.listarCatalogos(usuario);

  let feriados = null;
  if (pestana === "feriados") {
    const anios = await expedientes.aniosDeFeriados();
    const pedido = Number(Array.isArray(parametros.anio) ? parametros.anio[0] : parametros.anio);
    const anio = Number.isInteger(pedido) && pedido >= 1950 && pedido <= 2100 ? pedido : (anios.find((a) => !a.cerrado)?.anio ?? anioEnTucuman());
    const datos = await expedientes.listarFeriados(anio);
    feriados = {
      anio,
      anios: [...new Set([...anios.map((a) => a.anio), anio, anioEnTucuman() + 1])].sort((a, b) => a - b).map((a) => ({ anio: a, cerrado: anios.find((x) => x.anio === a)?.cerrado ?? false })),
      cerrado: datos.cerrado,
      cerradoTexto: datos.cerradoEn ? `${formatearFechaHora(datos.cerradoEn)}${datos.cerradoPor ? ` por ${datos.cerradoPor.nombre} ${datos.cerradoPor.apellido}` : ""}` : null,
      feriados: datos.feriados,
    };
  }

  return (
    <section aria-labelledby="titulo-catalogos" className="space-y-4">
      <h1 id="titulo-catalogos" className="text-2xl font-semibold tracking-tight text-texto">
        Catálogos
      </h1>
      <nav aria-label="Catálogos">
        <ul className="flex flex-wrap gap-1 border-b border-borde">
          {PESTANAS.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/catalogos?pestana=${p.id}`}
                aria-current={p.id === pestana ? "page" : undefined}
                className={clasePestana(p.id === pestana)}
              >
                {p.etiqueta}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {pestana === "areas" ? <PestanaAreas areas={catalogos.areas} /> : null}
      {pestana === "cementerios" ? (
        <PestanaCementerios
          cementerios={catalogos.cementerios}
          areasExternas={catalogos.areas.filter((a) => a.tipo === "externa").map((a) => ({ id: a.id, nombre: a.nombre, activa: a.activa, cementerio: a.cementerio }))}
          tiposMonumento={catalogos.tiposMonumento.map((t) => ({ codigo: t.codigo, nombre: t.nombre, activo: t.activo }))}
        />
      ) : null}
      {pestana === "monumentos" ? (
        <PestanaSimple
          catalogo="tipo_monumento"
          titulo="Tipos de monumento"
          descripcion="Cada cementerio habilita los suyos (pestaña Cementerios). Desactivar uno lo saca del alta en todos."
          ayudaCodigo="Mayúsculas y _ (ej. NICHO)"
          filas={catalogos.tiposMonumento.map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, activo: t.activo, uso: [t.cementerios.length > 0 ? `Habilitado en ${t.cementerios.join(", ")}` : "Ningún cementerio lo habilita", `${t.expedientes} expedientes`].join(" · ") }))}
        />
      ) : null}
      {pestana === "tramites" ? (
        <PestanaSimple
          catalogo="tipo_tramite"
          titulo="Tipos de trámite"
          descripcion="Agrupan las plantillas (todas las versiones de un código son del mismo tipo). Desactivar uno no retira sus plantillas: eso se hace en Plantillas."
          ayudaCodigo="Mayúsculas, números y _ (ej. TRANSFERENCIA)"
          filas={catalogos.tiposTramite.map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, activo: t.activo, uso: t.plantillas.length > 0 ? `Plantillas: ${t.plantillas.join(", ")}` : "Sin plantillas" }))}
        />
      ) : null}
      {pestana === "feriados" && feriados ? <PestanaFeriados {...feriados} /> : null}
    </section>
  );
}
