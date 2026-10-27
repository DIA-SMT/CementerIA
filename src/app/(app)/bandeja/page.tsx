import type { Metadata } from "next";
import Link from "next/link";
import { Info, TriangleAlert } from "lucide-react";
import { EncabezadoPagina } from "@/components/encabezado-pagina";
import { CLASE_ENLACE } from "@/components/formulario";
import { clasePestana } from "@/components/pestanas";
import { exigirPantalla } from "@/lib/auth/sesion";
import { AREA_MESA_ENTRADAS } from "@/lib/dominio/permisos";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { ETIQUETA_PESTANA, leerPestana, PESTANAS, pestanaPorDefecto, pestanasVisibles, rutaBandeja } from "@/lib/presentacion/flujo";
import { PantallaConRecorrido } from "@/components/recorrido/proveedor";
import { TablaBandeja } from "./tabla-bandeja";

export const metadata: Metadata = { title: "Bandeja" };

/**
 * Bandeja (sección 5, `/bandeja`): el trabajo diario del área. Pestañas Por
 * confirmar, En mi área y Afuera; semana 4: Plazos (lo que está en la DIM con
 * su vencimiento y semáforo; la ve el área que lo custodia, Tributario, y Mesa
 * de Entradas) y Carga histórica (Mesa de Entradas, con el enlace a
 * transcribir). Sin `?pestana=` se abre la que tiene trabajo. Leer la bandeja no
 * registra accesos: abrir la ficha sí (por eso los enlaces van sin prefetch).
 */
export default async function PaginaBandeja(props: PageProps<"/bandeja">) {
  const usuario = await exigirPantalla("bandeja");
  const { pestana: pedida } = await props.searchParams;
  const contadores = await expedientes.contadoresBandeja(usuario);
  const pestana = pestanaPorDefecto(contadores, leerPestana(pedida));
  const bandeja = await expedientes.bandeja(usuario, pestana);
  const cantidad = (p: (typeof PESTANAS)[number]) => contadores[p];
  const esMesa = usuario.area?.codigo === AREA_MESA_ENTRADAS;
  const visibles = pestanasVisibles(contadores, { esMesa, abierta: pestana });

  return (
    <section aria-labelledby="titulo-bandeja" className="space-y-4">
      <PantallaConRecorrido id="bandeja" />
      <EncabezadoPagina id="titulo-bandeja" titulo="Bandeja" antetitulo={usuario.area?.nombre} />

      <nav
        aria-label="Pestañas de la bandeja"
        data-recorrido="bandeja-pestanas"
        className="relative -mx-4 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 sm:[mask-image:none]"
      >
        <ul className="flex min-w-max gap-1 border-b border-borde">
          {visibles.map((p) => {
            const actual = p === pestana;
            const n = cantidad(p);
            return (
              <li key={p}>
                <Link
                  href={rutaBandeja(p)}
                  aria-current={actual ? "page" : undefined}
                  data-recorrido={`bandeja-pestana-${p}`}
                  className={clasePestana(actual)}
                >
                  {ETIQUETA_PESTANA[p]}
                  <span
                    className={`min-w-6 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${
                      n === 0 ? "bg-fondo text-texto-secundario ring-1 ring-inset ring-borde" : actual ? "bg-primario text-white" : "bg-superficie-azul text-primario-oscuro"
                    }`}
                  >
                    {n}
                    <span className="sr-only"> expedientes</span>
                  </span>
                  {p === "plazos" && contadores.plazosAlerta > 0 ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amarillo px-1.5 text-xs font-semibold text-institucional tabular-nums">
                      <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                      {contadores.plazosAlerta}
                      <span className="sr-only"> por vencer o vencidos</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="flex items-start gap-2 text-sm text-texto-secundario">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primario-oscuro" aria-hidden="true" />
        <span>
          {pestana === "por_confirmar"
            ? "Expedientes que llegaron a tu área y nadie confirmó todavía. Confirmá cuando tengas el papel."
            : pestana === "en_mi_area"
              ? "Expedientes que tu área tiene que trabajar, del que llegó antes al más nuevo."
              : pestana === "plazos"
                ? "Expedientes en un paso con plazo (la DIM: 30 días hábiles desde la notificación), del que vence antes al último. Ámbar: faltan 5 días hábiles o menos; rojo: vencido."
                : pestana === "carga_historica"
                  ? "Expedientes iniciados antes del sistema con la carga histórica abierta: transcribí la ficha de papel y terminá la carga para que sigan el circuito normal."
                  : esMesa
                    ? "Expedientes en un área externa (la DIM, un cementerio). Los que no custodia Mesa de Entradas se ven como consulta."
                    : "Expedientes en un área externa (la DIM, un cementerio) que custodia tu área."}
        </span>
      </p>

      <TablaBandeja pestana={pestana} filas={bandeja.filas} />

      {bandeja.hayMas ? (
        <p className="text-sm text-texto-secundario">
          Se muestran los primeros {bandeja.filas.length}. Para encontrar el resto, usá la{" "}
          <Link href="/expedientes" className={CLASE_ENLACE}>
            búsqueda
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
