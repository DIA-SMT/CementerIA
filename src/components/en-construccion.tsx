import { Construction } from "lucide-react";

/**
 * Lugar reservado para una pantalla que llega en una semana posterior del plan
 * (sección 6, "Plan tentativo"). Existe para que la navegación por rol se pueda
 * recorrer entera desde la semana 1 sin enlaces rotos.
 */
export function EnConstruccion({
  titulo,
  semana,
  children,
}: {
  titulo: string;
  semana: number;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="titulo-pantalla" className="space-y-4">
      <h1 id="titulo-pantalla" className="text-xl font-semibold text-slate-900">
        {titulo}
      </h1>
      <div className="flex items-start gap-3 rounded border border-dashed border-slate-400 bg-white px-4 py-5 text-slate-700">
        <Construction className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-slate-900">En construcción (semana {semana})</p>
          {children}
        </div>
      </div>
    </section>
  );
}
