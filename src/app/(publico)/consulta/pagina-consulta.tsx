import { ShieldCheck } from "lucide-react";
import { PaginaInterna } from "@/components/publico";
import { PASOS_CONSULTA } from "@/lib/presentacion/sitio-publico";
import { FormularioConsulta } from "./formulario-consulta";

/**
 * El cuerpo de `/consulta` y `/consulta/[numero]` (28/10/2026): la página
 * interna "Consultá tu trámite", en dos columnas: los tres pasos (los mismos
 * de la banda del inicio, PASOS_CONSULTA) y, a la derecha, la tarjeta con el
 * formulario y la nota de privacidad. Server Component; el único JavaScript
 * es el del formulario (y el botón del modo, en la barra).
 */
export function PaginaConsulta({ numeroInicial, leerFragmento }: { numeroInicial: string; leerFragmento: boolean }) {
  return (
    <PaginaInterna ruta="/consulta">
      <section aria-labelledby="titulo-pasos" className="grid items-start gap-8 min-[900px]:grid-cols-[1fr_minmax(0,440px)] min-[900px]:gap-12">
        <div className="min-[900px]:pt-2">
          <p className="antetitulo-publico">Seguimiento en línea</p>
          <h2 id="titulo-pasos" className="mt-1.5 text-[1.5rem] font-extrabold tracking-tight text-pub-titulo sm:text-[1.875rem]">
            Cómo funciona
          </h2>
          <ol className="mt-6 grid gap-3">
            {PASOS_CONSULTA.map((p, i) => (
              <li key={p.titulo} className="flex items-start gap-3.5 rounded-2xl border border-pub-borde bg-pub-superficie p-4 shadow-pub">
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primario font-mono text-lg font-extrabold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <strong className="block text-pub-titulo">{p.titulo}</strong>
                  <span className="text-[0.9375rem] text-pub-texto-secundario">{p.texto}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 rounded-[18px] border border-pub-borde border-t-4 border-t-primario bg-pub-superficie p-5 text-pub-texto shadow-pub-elevada sm:p-6">
          <FormularioConsulta numeroInicial={numeroInicial} leerFragmento={leerFragmento} titulo="Datos del comprobante" />
          <p className="mt-4 flex gap-2 text-[0.8125rem] leading-relaxed text-pub-texto-secundario">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-pub-enlace" aria-hidden="true" />
            <span>
              Solo se muestra en qué anda el trámite, ningún dato de las personas. Información orientativa: el expediente oficial es el de papel.
              Después de varios intentos fallidos hay que esperar 15 minutos. Las consultas quedan registradas.
            </span>
          </p>
        </div>
      </section>
    </PaginaInterna>
  );
}
