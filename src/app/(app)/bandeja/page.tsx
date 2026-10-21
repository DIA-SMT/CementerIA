import type { Metadata } from "next";
import Link from "next/link";
import { exigirPantalla } from "@/lib/auth/sesion";
import { AREA_MESA_ENTRADAS } from "@/lib/dominio/permisos";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { ETIQUETA_PESTANA, leerPestana, PESTANAS, pestanaPorDefecto, pestanasVisibles, rutaBandeja } from "@/lib/presentacion/flujo";
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="titulo-bandeja" className="text-xl font-semibold text-slate-900">
          Bandeja
        </h1>
        <p className="text-sm text-slate-600">{usuario.area?.nombre}</p>
      </div>

      <nav aria-label="Pestañas de la bandeja">
        <ul className="flex flex-wrap gap-1 border-b border-slate-300">
          {visibles.map((p) => {
            const actual = p === pestana;
            return (
              <li key={p}>
                <Link
                  href={rutaBandeja(p)}
                  aria-current={actual ? "page" : undefined}
                  className={`-mb-px inline-flex items-center gap-2 rounded-t border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 ${
                    actual ? "border-slate-300 border-b-white bg-white font-medium text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {ETIQUETA_PESTANA[p]}
                  <span className={`rounded-full px-1.5 text-xs ${cantidad(p) > 0 ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-700"}`}>
                    {cantidad(p)}
                    <span className="sr-only"> expedientes</span>
                  </span>
                  {p === "plazos" && contadores.plazosAlerta > 0 ? (
                    <span className="rounded-full bg-amber-600 px-1.5 text-xs font-semibold text-white">
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

      <p className="text-sm text-slate-700">
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
      </p>

      <TablaBandeja pestana={pestana} filas={bandeja.filas} />

      {bandeja.hayMas ? (
        <p className="text-sm text-slate-700">
          Se muestran los primeros {bandeja.filas.length}. Para encontrar el resto, usá la{" "}
          <Link href="/expedientes" className="underline underline-offset-2">
            búsqueda
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
