"use client";

import { useState } from "react";
import { CLASE_CONTROL } from "@/components/formulario";
import type { CampoUbicacion } from "@/lib/dominio/expedientes/ubicacion";
import { PREFIJO_UBICACION } from "@/lib/presentacion/busqueda";

export interface CementerioDelFiltro {
  id: number;
  nombre: string;
  activo: boolean;
  camposUbicacion: CampoUbicacion[];
}

/**
 * El filtro de cementerio con sus campos de ubicación, que cambian según el
 * cementerio elegido (2.13(d)). Son controles comunes de un formulario GET:
 * viajan como `cementerio` y `u.<clave>`.
 */
export function FiltroCementerio({
  cementerios,
  cementerio,
  ubicacion,
}: {
  cementerios: CementerioDelFiltro[];
  cementerio: string;
  ubicacion: Record<string, string>;
}) {
  const [elegido, setElegido] = useState(cementerio);
  const campos = cementerios.find((c) => String(c.id) === elegido)?.camposUbicacion ?? [];

  return (
    <div className="space-y-3 sm:col-span-2">
      <div>
        <label htmlFor="filtro-cementerio" className="mb-1.5 block text-sm font-medium text-texto">
          Cementerio
        </label>
        <select
          id="filtro-cementerio"
          name="cementerio"
          value={elegido}
          onChange={(e) => setElegido(e.target.value)}
          className={CLASE_CONTROL}
        >
          <option value="">Todos</option>
          {cementerios.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {c.activo ? "" : " (inactivo)"}
            </option>
          ))}
        </select>
      </div>
      {campos.length > 0 ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-texto">Ubicación</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {campos.map((c) => (
              <div key={`${elegido}-${c.clave}`}>
                <label htmlFor={`filtro-u-${c.clave}`} className="mb-1 block text-xs font-medium text-texto-secundario">
                  {c.etiqueta}
                </label>
                <input
                  id={`filtro-u-${c.clave}`}
                  name={`${PREFIJO_UBICACION}${c.clave}`}
                  type="text"
                  inputMode={c.tipo === "entero" ? "numeric" : undefined}
                  autoComplete="off"
                  defaultValue={elegido === cementerio ? (ubicacion[c.clave] ?? "") : ""}
                  className={CLASE_CONTROL}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-xs text-texto-secundario">Elegí un cementerio para filtrar por sección, cuadro, lote…</p>
      )}
    </div>
  );
}
