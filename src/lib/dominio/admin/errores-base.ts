import { ErrorDominio } from "../expedientes/errores";

/**
 * Los rechazos de la base, legibles (semana 5). La administración controla
 * antes lo que puede (un área externa para un usuario, un código repetido, el
 * tipo de un área con usuarios), pero los triggers de coherencia
 * (`usuarios_area_interna`, `cementerios_area_externa`, `areas_tipo_coherente`,
 * `plantillas_congelar`) y los índices únicos siguen siendo la barrera: si dos
 * administradores cambian lo mismo a la vez, el segundo llega acá. En vez de un
 * error 500, el mensaje del trigger se muestra como error del formulario.
 */

interface CausaAdaptador {
  originalCode?: unknown;
  originalMessage?: unknown;
  kind?: unknown;
  constraint?: { fields?: unknown };
}

/** La causa que deja `@prisma/adapter-pg` en `meta.driverAdapterError.cause`. */
function causaDe(e: unknown): CausaAdaptador | null {
  if (typeof e !== "object" || e === null || !("meta" in e)) return null;
  const meta = (e as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return null;
  const adaptador = (meta as { driverAdapterError?: unknown }).driverAdapterError;
  if (typeof adaptador !== "object" || adaptador === null) return null;
  const causa = (adaptador as { cause?: unknown }).cause;
  return typeof causa === "object" && causa !== null ? (causa as CausaAdaptador) : null;
}

/** Los mensajes de los triggers, reescritos para quien administra (sin ids internos). */
const TRADUCCIONES: ReadonlyArray<[RegExp, (m: RegExpExecArray) => string]> = [
  [/Un usuario no puede pertenecer a un área externa/, () => "El área elegida es externa (la DIM o un cementerio): un usuario solo puede ser de un área interna"],
  [/El área de un cementerio tiene que ser externa/, () => "El área de un cementerio tiene que ser externa"],
  [/El área (\S+) tiene usuarios: no puede pasar a externa/, (m) => `El área ${m[1]} tiene usuarios: cambialos de área antes de pasarla a externa`],
  [/El área (\S+) es la de un cementerio/, (m) => `El área ${m[1]} es la de un cementerio: tiene que seguir siendo externa`],
];

/**
 * El error de la base como `ErrorDominio`, o `null` si no es un rechazo
 * esperable (ese se deja subir: es un defecto).
 * - Trigger (`RAISE EXCEPTION`, P0001) o CHECK (23514): `validacion` con el mensaje.
 * - Índice único (P2002): `ya_existe`.
 */
export function traducirErrorBase(e: unknown, queYaExiste = "Ya existe un registro con ese código"): ErrorDominio | null {
  if (typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "P2002") {
    return new ErrorDominio("ya_existe", queYaExiste);
  }
  const causa = causaDe(e);
  if (!causa) return null;
  const codigo = typeof causa.originalCode === "string" ? causa.originalCode : null;
  const mensaje = typeof causa.originalMessage === "string" ? causa.originalMessage : null;
  if (codigo === "23505") return new ErrorDominio("ya_existe", queYaExiste);
  if ((codigo === "P0001" || codigo === "23514") && mensaje) {
    for (const [re, texto] of TRADUCCIONES) {
      const m = re.exec(mensaje);
      if (m) return new ErrorDominio("validacion", texto(m));
    }
    return new ErrorDominio("validacion", mensaje);
  }
  return null;
}

/** Corre `fn` y, si la base rechaza algo esperable, lo devuelve como `ErrorDominio`. */
export async function conErroresLegibles<T>(fn: () => Promise<T>, queYaExiste?: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const traducido = traducirErrorBase(e, queYaExiste);
    if (traducido) throw traducido;
    throw e;
  }
}
