import { log } from "@/lib/log";
import { getDeCidituc, motivoDeFallo, type RespuestaCidituc } from "./https";

/**
 * Validación del token de Cidituc y lectura de la persona (sección 6,
 * "Autenticación", punto 2).
 *
 * La consulta al backend ES la validación: el backend verifica la firma. No
 * pedimos la clave de firma y no conviene tenerla: es HS256, así que quien la
 * tiene puede fabricar tokens válidos para cualquier `id_persona` de cualquier
 * app del municipio.
 *
 * Se consulta `/usuarios/authStatusIA`, el endpoint de EMPLEADOS municipales,
 * que responde 401 a cualquier vecino. `/usuarios/authStatus` (el que usan
 * UrbanIA y DiarioDigital) es el de ciudadanos y dejaría pasar a cualquiera con
 * cuenta de Cidituc hasta la tabla `usuarios`.
 */

export const RUTA_AUTH_STATUS = "/usuarios/authStatusIA";
export const TIMEOUT_MS = 10_000;

/** Una persona tal como la conoce Cidituc, ya normalizada. */
export interface PersonaCidituc {
  /** `id_persona` como texto: el identificador estable entre apps del municipio. */
  ciditucId: string;
  /** CUIL, 11 dígitos. Es la clave con la que se busca en `usuarios`. */
  cuil: string;
  nombre: string;
  apellido: string;
  email: string | null;
}

/**
 * Por qué no se pudo validar. Cada código se arregla en un lugar distinto:
 * - `sin_configurar`: el entorno (CIDITUC_API_URL).
 * - `token_invalido`: el backend contestó 401/403, o el token no tiene forma de
 *   token. Es también lo que recibe un vecino sin cuenta de empleado.
 * - `sin_conexion`: no hubo respuesta: DNS, firewall de salida, certificado o
 *   timeout. Se arregla con Sistemas.
 * - `no_disponible`: hubo respuesta HTTP pero de error (404 = la URL apunta a
 *   un host que no sirve ese endpoint; 5xx = el backend falla).
 * - `respuesta_inesperada`: 2xx con algo que no sabemos leer.
 * - `cuenta_inactiva`: Cidituc dice que la cuenta está dada de baja.
 */
export type ErrorValidacion =
  | "sin_configurar"
  | "token_invalido"
  | "sin_conexion"
  | "no_disponible"
  | "respuesta_inesperada"
  | "cuenta_inactiva";

export type ResultadoValidacion = { ok: true; persona: PersonaCidituc } | { ok: false; error: ErrorValidacion };

/** Lo que hace la consulta HTTP. Los tests lo reemplazan por uno simulado. */
export type TransporteCidituc = (url: string, token: string, timeoutMs: number) => Promise<RespuestaCidituc>;

export interface OpcionesValidacion {
  /** Base del backend, sin barra final (CIDITUC_API_URL). */
  apiUrl: string | null | undefined;
  transporte?: TransporteCidituc;
}

/**
 * Un token de Cidituc es un JWT: largo y sin espacios. Solo ASCII visible,
 * porque va crudo en un header: un salto de línea ahí sería inyección de
 * headers, y un "Bearer …" pegado de algún lado tiene espacio y no se reenvía.
 */
function formaPlausible(token: string): boolean {
  return token.length >= 20 && token.length <= 4096 && /^[\x21-\x7e]+$/.test(token);
}

/**
 * El backend hace `SELECT p.*` sobre MySQL: un campo con columna numérica llega
 * como número y una columna vacía llega como null. Exigir string descartaba
 * personas válidas en silencio (UrbanIA, 2026-08): el parseo entero fallaba y la
 * persona veía "no disponible" con el backend andando perfecto.
 */
function texto(valor: unknown): string | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : null;
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

/** Valores con los que Cidituc podría decir que sí o que no. Se decide por valor
 *  conocido y no por conversión: ver `bandera()`. */
const POSITIVOS = new Set([
  "true", "1", "si", "sí", "s", "y", "yes",
  "activo", "activa", "habilitado", "habilitada", "validado", "validada",
]);
const NEGATIVOS = new Set([
  "false", "0", "no", "n",
  "baja", "inactivo", "inactiva", "deshabilitado", "deshabilitada", "anulado", "anulada",
]);

/** Un valor raro se avisa una vez por proceso, no en cada ingreso. */
const desconocidosAvisados = new Set<string>();

/**
 * ¿`validado` / `habilita` dicen que sí, que no, o no dicen nada?
 *
 * Nadie sabe con certeza el tipo real de esas columnas. Lo desconocido devuelve
 * `null` y no rechaza: solo se rechaza la baja EXPLÍCITA, porque pueden no venir
 * y algunas cuentas históricas usan valores positivos distintos de 1. Convertir
 * con `Number()` y tratar como baja lo que no parsea (como UrbanIA) dejaría
 * afuera a todos si la columna fuera ENUM('SI','NO').
 */
function bandera(campo: string, valor: unknown): boolean | null {
  if (valor == null) return null;
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor > 0 : null;
  if (typeof valor !== "string") return avisarDesconocido(campo, `(${Array.isArray(valor) ? "array" : typeof valor})`);

  const normal = valor.trim().toLowerCase();
  if (normal === "") return null;
  if (POSITIVOS.has(normal)) return true;
  if (NEGATIVOS.has(normal)) return false;
  const numero = Number(normal);
  if (Number.isFinite(numero)) return numero > 0;
  return avisarDesconocido(campo, normal);
}

function avisarDesconocido(campo: string, valor: string): null {
  const clave = `${campo}=${valor.slice(0, 20)}`;
  if (!desconocidosAvisados.has(clave)) {
    desconocidosAvisados.add(clave);
    log.warn("cidituc.bandera_desconocida", { campo, valor: valor.slice(0, 20) });
  }
  return null;
}

/**
 * Cada endpoint envuelve distinto: `/usuarios/authStatusIA` devuelve
 * `{ user: {...} }` y `/usuarios/authStatus`, `{ usuarioSinContraseña: {...} }`.
 * Se aceptan los dos y también la forma plana, por si el backend cambia.
 */
function desenvolver(cuerpo: unknown): Record<string, unknown> | null {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return null;
  const contenedor = cuerpo as Record<string, unknown>;
  const adentro = contenedor["user"] ?? contenedor["usuarioSinContraseña"] ?? contenedor;
  return adentro && typeof adentro === "object" && !Array.isArray(adentro) ? (adentro as Record<string, unknown>) : null;
}

/**
 * CUIL normalizado (sección 6, punto 3): solo dígitos y completado a 11 con
 * ceros a la izquierda, por si una columna numérica se comió los ceros.
 * `null` si no hay forma de que sea un CUIL.
 */
export function normalizarCuil(valor: unknown): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const digitos = String(valor).replace(/\D/g, "");
  if (digitos.length === 0 || digitos.length > 11) return null;
  const cuil = digitos.padStart(11, "0");
  // Todo ceros es el CUIL del usuario técnico SISTEMA: nadie ingresa con él.
  return /^0+$/.test(cuil) ? null : cuil;
}

function hostDe(apiUrl: string): string {
  try {
    return new URL(apiUrl).host;
  } catch {
    return "(CIDITUC_API_URL inválida)";
  }
}

/**
 * Valida el token contra el backend municipal y devuelve la persona.
 *
 * El token nunca se loguea. Se registran el host y el status, que es lo que
 * distingue "la URL apunta a otro lado" de "el backend está caído" de "el
 * certificado no valida": un "no disponible" mudo no se diagnostica.
 */
export async function validarTokenCidituc(
  tokenCrudo: string,
  { apiUrl, transporte = getDeCidituc }: OpcionesValidacion,
): Promise<ResultadoValidacion> {
  if (!apiUrl) return { ok: false, error: "sin_configurar" };

  const token = tokenCrudo.trim();
  if (!formaPlausible(token)) return { ok: false, error: "token_invalido" };

  const host = hostDe(apiUrl);
  const inicio = Date.now();
  let respuesta: RespuestaCidituc;
  try {
    respuesta = await transporte(`${apiUrl.replace(/\/+$/, "")}${RUTA_AUTH_STATUS}`, token, TIMEOUT_MS);
  } catch (error) {
    // DNS, timeout, TLS o un firewall que no deja salir hacia ese host desde la
    // VM (sección 6, "Hosting": esa regla se pide a Sistemas). Si el error no
    // trae `code`, el motivo es su mensaje: se le borra el token por si algún
    // día una librería decide citar el header que mandó.
    const motivo = motivoDeFallo(error).split(token).join("[token]");
    log.error("cidituc.sin_conexion", { host, ruta: RUTA_AUTH_STATUS, motivo });
    return { ok: false, error: "sin_conexion" };
  }

  const { status } = respuesta;
  log.info("cidituc.respuesta", { host, ruta: RUTA_AUTH_STATUS, status, ms: Date.now() - inicio });

  if (status === 401 || status === 403) return { ok: false, error: "token_invalido" };
  if (status < 200 || status >= 300) {
    log.error("cidituc.status_inesperado", {
      host,
      ruta: RUTA_AUTH_STATUS,
      status,
      pista: status === 404 ? "CIDITUC_API_URL apunta a un host que no sirve ese endpoint" : null,
    });
    return { ok: false, error: "no_disponible" };
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(respuesta.body);
  } catch {
    log.error("cidituc.respuesta_inesperada", { host, problema: "el cuerpo no es JSON" });
    return { ok: false, error: "respuesta_inesperada" };
  }

  const datos = desenvolver(cuerpo);
  if (!datos) {
    log.error("cidituc.respuesta_inesperada", { host, problema: "JSON sin la persona adentro" });
    return { ok: false, error: "respuesta_inesperada" };
  }

  const ciditucId = texto(datos["id_persona"]);
  const cuil = normalizarCuil(datos["documento_persona"]);
  if (!ciditucId || ciditucId.length > 64 || !cuil) {
    // Solo los NOMBRES de los campos con problema: el cuerpo trae datos de una
    // persona y no tiene por qué quedar en los logs.
    log.error("cidituc.respuesta_inesperada", {
      host,
      problema: "faltan campos mínimos o no tienen forma",
      campos: [!ciditucId || ciditucId.length > 64 ? "id_persona" : null, !cuil ? "documento_persona" : null]
        .filter(Boolean)
        .join(","),
    });
    return { ok: false, error: "respuesta_inesperada" };
  }

  const digitosOriginales = String(datos["documento_persona"]).replace(/\D/g, "").length;
  if (digitosOriginales !== 11) {
    // Se completó con ceros. Se loguea el largo, nunca el documento: si aparece
    // seguido, la columna no es un CUIL y hay que revisar la normalización.
    log.warn("cidituc.cuil_completado", { digitos: digitosOriginales });
  }

  // El login de Cidituc ya impide emitir un token para una cuenta dada de baja;
  // esto es la segunda línea, y solo frena la baja explícita.
  if (bandera("validado", datos["validado"]) === false || bandera("habilita", datos["habilita"]) === false) {
    return { ok: false, error: "cuenta_inactiva" };
  }

  return {
    ok: true,
    persona: {
      ciditucId,
      cuil,
      nombre: texto(datos["nombre_persona"]) ?? "",
      apellido: texto(datos["apellido_persona"]) ?? "",
      email: texto(datos["email_persona"])?.toLowerCase() ?? null,
    },
  };
}
