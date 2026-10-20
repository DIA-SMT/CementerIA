import { ErrorDominio, type ErrorCampo } from "@/lib/dominio/expedientes/errores";
import { PermisoDenegado } from "@/lib/dominio/permisos";
import { TEXTO_DENEGACION } from "./textos";

/**
 * El estado que devuelven las Server Actions de los formularios (para
 * `useActionState`) y cómo se muestran sus errores junto a cada campo. Puro.
 */

export type { ErrorCampo };

export interface EstadoError {
  ok: false;
  /** `codigo` de ErrorDominio, o `permiso`. */
  codigo: string;
  /** Escrito para el usuario: se muestra tal cual. */
  mensaje: string;
  errores: ErrorCampo[];
}

/** `null` antes de enviar; un error mientras no se guarde (si se guarda, la acción navega). */
export type EstadoFormulario = EstadoError | null;

/**
 * Un error del dominio como estado serializable. Lo que no es ErrorDominio ni
 * PermisoDenegado es un defecto y se deja subir (lo muestra error.tsx).
 */
export function estadoDeError(e: unknown): EstadoError {
  if (e instanceof ErrorDominio) return { ok: false, codigo: e.codigo, mensaje: e.message, errores: [...e.errores] };
  if (e instanceof PermisoDenegado) {
    return { ok: false, codigo: "permiso", mensaje: `No podés hacer esto. ${TEXTO_DENEGACION[e.motivo]}`, errores: [] };
  }
  throw e;
}

/** Los mensajes de cada ruta (`personas[1].dni` → ["DNI: …"]). */
export function erroresPorRuta(errores: readonly ErrorCampo[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const e of errores) mapa.set(e.ruta, [...(mapa.get(e.ruta) ?? []), e.mensaje]);
  return mapa;
}

/** El `id` del control de un campo a partir de su ruta: `personas[1].dni` → `campo-personas-1-dni`. */
export function idDeCampo(ruta: string): string {
  const limpio = ruta.replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
  return limpio === "" ? "campo-formulario" : `campo-${limpio}`;
}

/** El `id` del mensaje de error de un campo (para `aria-describedby`). */
export function idDeError(ruta: string): string {
  return `${idDeCampo(ruta)}-error`;
}
