import { z } from "zod";
import { colapsarEspacios } from "../normalizar";
import { ErrorDominio, type ErrorCampo } from "./errores";

/**
 * Ubicación dinámica por cementerio (docs/propuesta-mvp.md, 2.2 y 2.13(d)).
 *
 * `cementerios.campos_ubicacion` define los campos; el formulario y el esquema
 * zod se arman con eso en tiempo de ejecución. Los valores se guardan
 * normalizados en `expedientes.ubicacion`: trim, mayúsculas y, en los campos
 * `entero`, sin ceros a la izquierda ("012" = "12"). Solo se guardan las
 * claves con valor.
 */

/** Un elemento de `cementerios.campos_ubicacion`. */
export const CampoUbicacion = z.object({
  clave: z.string().regex(/^[a-z][a-z0-9_]*$/),
  etiqueta: z.string().min(1),
  tipo: z.enum(["texto", "entero"]),
  obligatorio: z.boolean(),
  /** Expresión regular que tiene que cumplir el valor YA normalizado, entero (se ancla con ^…$). */
  patron: z.string().nullable(),
  activo: z.boolean(),
});
export type CampoUbicacion = z.infer<typeof CampoUbicacion>;

/** Valores de ubicación por clave, ya normalizados. */
export type Ubicacion = Record<string, string>;

/**
 * Lee `campos_ubicacion` de la base. Si la configuración está rota (la cargó
 * alguien a mano), es un error de configuración y no del usuario.
 */
export function leerCamposUbicacion(valor: unknown, cementerio: string): CampoUbicacion[] {
  const r = z.array(CampoUbicacion).safeParse(valor);
  if (!r.success) {
    throw new ErrorDominio(
      "configuracion_incompleta",
      `La nomenclatura del cementerio ${cementerio} está mal configurada: revisala en Catálogos`,
    );
  }
  return r.data;
}

/** El patrón del campo, anclado al valor entero. `null` si no tiene. */
function expresionDe(campo: CampoUbicacion): RegExp | null {
  if (campo.patron === null || campo.patron.trim() === "") return null;
  try {
    return new RegExp(`^(?:${campo.patron})$`, "u");
  } catch {
    throw new ErrorDominio(
      "configuracion_incompleta",
      `El patrón del campo "${campo.etiqueta}" del cementerio no es una expresión regular válida: revisalo en Catálogos`,
    );
  }
}

/**
 * Normaliza un valor sin validarlo: trim, espacios colapsados y mayúsculas; en
 * un campo `entero` con solo dígitos, sin ceros a la izquierda. Sirve también
 * para los filtros de búsqueda, que no validan.
 */
export function normalizarValorUbicacion(campo: Pick<CampoUbicacion, "tipo">, valor: string): string {
  const v = colapsarEspacios(valor).toUpperCase();
  if (campo.tipo === "entero" && /^\d+$/.test(v)) return v.replace(/^0+(?=\d)/, "");
  return v;
}

/** El mensaje de error de un valor ya normalizado, o `null` si está bien. */
export function errorDeValorUbicacion(campo: CampoUbicacion, normalizado: string): string | null {
  if (campo.tipo === "entero" && !/^\d+$/.test(normalizado)) return `${campo.etiqueta}: tiene que ser un número entero`;
  const re = expresionDe(campo);
  if (re && !re.test(normalizado)) return `${campo.etiqueta}: el formato no es válido`;
  return null;
}

export interface OpcionesUbicacion {
  /** `definicion.ubicacion_obligatoria` de la plantilla: si es false, ningún campo es obligatorio. */
  obligatoria: boolean;
  /**
   * Lo que el expediente ya tenía (en la edición): los valores de campos que
   * después se desactivaron se conservan y no se pueden cambiar (2.13(d)).
   */
  anterior?: Ubicacion;
}

export type ResultadoUbicacion = { ok: true; ubicacion: Ubicacion } | { ok: false; errores: ErrorCampo[] };

/**
 * Valida y normaliza la ubicación ingresada contra los campos del cementerio.
 * - Solo se aceptan claves de campos activos (más las inactivas que ya tenía,
 *   sin cambiarlas).
 * - Si la plantilla dice `ubicacion_obligatoria`, los campos obligatorios tienen
 *   que tener valor.
 * - Los valores vacíos no se guardan.
 */
export function validarUbicacion(
  campos: readonly CampoUbicacion[],
  entrada: Readonly<Record<string, string | null | undefined>>,
  opciones: OpcionesUbicacion,
): ResultadoUbicacion {
  const errores: ErrorCampo[] = [];
  const ubicacion: Ubicacion = {};
  const anterior = opciones.anterior ?? {};
  const porClave = new Map(campos.map((c) => [c.clave, c]));

  for (const [clave, crudo] of Object.entries(entrada)) {
    const campo = porClave.get(clave);
    const valor = crudo ?? "";
    if (!campo) {
      if (valor.trim() !== "") errores.push({ ruta: `ubicacion.${clave}`, mensaje: `El cementerio no tiene el campo "${clave}"` });
      continue;
    }
    if (!campo.activo) {
      const normalizado = normalizarValorUbicacion(campo, valor);
      if (normalizado !== (anterior[clave] ?? "")) {
        errores.push({ ruta: `ubicacion.${clave}`, mensaje: `${campo.etiqueta}: el campo ya no se usa y no se puede cambiar` });
      }
    }
  }

  for (const campo of campos) {
    const ruta = `ubicacion.${campo.clave}`;
    if (!campo.activo) {
      // Se conserva lo que ya estaba, aunque el campo se haya desactivado.
      const viejo = anterior[campo.clave];
      if (viejo !== undefined && viejo !== "") ubicacion[campo.clave] = viejo;
      continue;
    }
    const normalizado = normalizarValorUbicacion(campo, entrada[campo.clave] ?? "");
    if (normalizado === "") {
      if (opciones.obligatoria && campo.obligatorio) errores.push({ ruta, mensaje: `${campo.etiqueta}: es obligatorio` });
      continue;
    }
    const error = errorDeValorUbicacion(campo, normalizado);
    if (error) errores.push({ ruta, mensaje: error });
    else ubicacion[campo.clave] = normalizado;
  }

  return errores.length > 0 ? { ok: false, errores } : { ok: true, ubicacion };
}

/**
 * Lo que arma el trigger `expedientes_preparar` en `ubicacion_clave`: pares
 * `clave=valor` no vacíos, por clave en orden de bytes, separados por `;`.
 * `null` si no hay valores. Sirve para buscar duplicados ANTES de grabar.
 */
export function claveDeUbicacion(ubicacion: Readonly<Record<string, string>>): string | null {
  const pares = Object.entries(ubicacion)
    .map(([clave, valor]) => [clave, valor.trim()] as const)
    .filter(([, valor]) => valor !== "")
    // Orden de bytes, como `ORDER BY key COLLATE "C"`: las claves son [a-z0-9_].
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([clave, valor]) => `${clave}=${valor}`);
  return pares.length === 0 ? null : pares.join(";");
}

/**
 * `ubicacion_texto`: "Sección 3 · Cuadro B · Lote 12 · N° 45", en el orden de
 * los campos del cementerio. Las claves que ya no son campos del cementerio se
 * muestran al final con su clave, para no perder el dato.
 */
export function textoDeUbicacion(campos: readonly CampoUbicacion[], ubicacion: Readonly<Record<string, string>>): string {
  const partes: string[] = [];
  const vistas = new Set<string>();
  for (const campo of campos) {
    const valor = ubicacion[campo.clave];
    vistas.add(campo.clave);
    if (valor !== undefined && valor !== "") partes.push(`${campo.etiqueta} ${valor}`);
  }
  for (const [clave, valor] of Object.entries(ubicacion)) {
    if (!vistas.has(clave) && valor !== "") partes.push(`${clave} ${valor}`);
  }
  return partes.join(" · ");
}
