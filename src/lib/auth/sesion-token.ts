import { errors, jwtVerify, SignJWT, type JWTPayload } from "jose";

/**
 * El token de la cookie `cem_sesion`: emitirlo, verificarlo y renovarlo.
 *
 * Es la parte pura de la sesión (sin `server-only`, sin `next/headers`, sin
 * base): la usan el proxy, que no debe tocar la base ni arrastrar código de
 * render, los Route Handlers que emiten la cookie, y los tests. La sesión de
 * verdad —la que carga el usuario y decide— es `getUsuarioActual()` de
 * ./sesion.ts.
 *
 * Lleva solo lo mínimo para encontrar al usuario y saber si la sesión sigue
 * viva: `{sub, sv, iat, inicio}` más `exp` y `aud`. El rol y el área NO viajan
 * en el token: un permiso firmado no se puede revocar ni auditar, así que se
 * leen de la base en cada request (sección 6, "Autorización").
 */

export const COOKIE_SESION = "cem_sesion";

/** Sin actividad durante este tiempo, la sesión muere. [C] */
export const INACTIVIDAD_MAXIMA_SEG = 60 * 60;
/** Ni con actividad una sesión dura más que esto desde el ingreso. [C] */
export const DURACION_MAXIMA_SEG = 10 * 60 * 60;
/** Margen para relojes apenas desfasados entre procesos. */
const TOLERANCIA_RELOJ_SEG = 60;

const ALGORITMO = "HS256";
/**
 * Audiencias distintas para cada token firmado con SESSION_SECRET: así el de
 * /sin-acceso (que lleva CUIL y nombre de alguien SIN alta) nunca pasa por una
 * sesión, aunque los firme la misma clave.
 */
const AUD_SESION = "cementeria:sesion";
const AUD_SIN_ACCESO = "cementeria:sin-acceso";

export interface Sesion {
  usuarioId: number;
  /** `usuarios.sesion_version` al emitirla: si la base tiene otra, la sesión se cerró. */
  sesionVersion: number;
  /** Última emisión (segundos epoch). La renovación deslizante la corre. */
  emitidaEn: number;
  /** Ingreso original (segundos epoch). No cambia al renovar. */
  inicio: number;
}

export type MotivoSesionInvalida = "firma" | "forma" | "inactividad" | "duracion" | "futuro";

export type VerificacionSesion = { ok: true; sesion: Sesion } | { ok: false; motivo: MotivoSesionInvalida };

export interface TokenEmitido {
  token: string;
  /** Segundos que la cookie tiene que vivir: lo que le queda a la sesión. */
  maxAge: number;
}

export function segundosAhora(): number {
  return Math.floor(Date.now() / 1000);
}

function clave(secreto: string): Uint8Array {
  // Un secreto corto en HS256 se rompe por fuerza bruta; el entorno ya lo exige,
  // esto evita que un llamador lo saltee.
  if (secreto.length < 32) throw new Error("SESSION_SECRET tiene que tener al menos 32 caracteres");
  return new TextEncoder().encode(secreto);
}

/**
 * Vencimiento de una emisión hecha `ahora`: lo que llegue primero entre la
 * inactividad y el tope desde el ingreso.
 */
function vencimiento(inicio: number, ahora: number): number {
  return Math.min(ahora + INACTIVIDAD_MAXIMA_SEG, inicio + DURACION_MAXIMA_SEG);
}

/**
 * Firma una sesión. Para un ingreso nuevo, `inicio = ahora`; para renovar, el
 * `inicio` original.
 *
 * @returns `null` si la sesión ya superó su duración máxima: no se renueva.
 */
export async function emitirSesion(
  datos: { usuarioId: number; sesionVersion: number; inicio: number },
  secreto: string,
  ahora: number = segundosAhora(),
): Promise<TokenEmitido | null> {
  const { usuarioId, sesionVersion, inicio } = datos;
  if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) throw new Error("emitirSesion: usuarioId inválido");
  if (!Number.isSafeInteger(sesionVersion) || sesionVersion < 0) {
    throw new Error("emitirSesion: sesionVersion inválida");
  }
  const exp = vencimiento(inicio, ahora);
  if (exp <= ahora || inicio > ahora + TOLERANCIA_RELOJ_SEG) return null;

  const token = await new SignJWT({ sv: sesionVersion, inicio })
    .setProtectedHeader({ alg: ALGORITMO, typ: "JWT" })
    .setSubject(String(usuarioId))
    .setAudience(AUD_SESION)
    .setIssuedAt(ahora)
    .setExpirationTime(exp)
    .sign(clave(secreto));
  return { token, maxAge: exp - ahora };
}

function entero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isSafeInteger(valor);
}

type Firma = { valida: true; payload: JWTPayload } | { valida: false; vencida: JWTPayload | null };

async function verificarFirma(token: string, secreto: string, audiencia: string, ahora: number): Promise<Firma> {
  try {
    const { payload } = await jwtVerify(token, clave(secreto), {
      algorithms: [ALGORITMO],
      audience: audiencia,
      currentDate: new Date(ahora * 1000),
      requiredClaims: ["iat", "exp"],
    });
    return { valida: true, payload };
  } catch (error) {
    // jose verifica la firma ANTES que los claims: si lo que falló es `exp`, el
    // token es nuestro y solo venció. Se distingue para el mensaje de /login.
    return { valida: false, vencida: error instanceof errors.JWTExpired ? error.payload : null };
  }
}

/**
 * Verifica firma, forma y vencimientos. No toca la base: que el usuario siga
 * activo y con la misma `sesion_version` lo decide `getUsuarioActual()`.
 *
 * Los vencimientos se recalculan desde `iat` e `inicio` además del `exp`:
 * un token emitido con otras constantes (una versión anterior) no estira la
 * sesión más de lo que dicen las de ahora.
 */
export async function verificarSesion(
  token: string,
  secreto: string,
  ahora: number = segundosAhora(),
): Promise<VerificacionSesion> {
  const firma = await verificarFirma(token, secreto, AUD_SESION, ahora);
  if (!firma.valida) {
    if (!firma.vencida) return { ok: false, motivo: "firma" };
    const { inicio } = firma.vencida as { inicio?: unknown };
    return { ok: false, motivo: entero(inicio) && ahora - inicio >= DURACION_MAXIMA_SEG ? "duracion" : "inactividad" };
  }
  const payload = firma.payload;

  // Proyección explícita: un campo que nadie validó no entra a la sesión.
  const { sub, sv, iat, inicio } = payload as JWTPayload & { sv?: unknown; inicio?: unknown };
  if (typeof sub !== "string" || !/^[1-9]\d{0,9}$/.test(sub) || !entero(sv) || sv < 0) {
    return { ok: false, motivo: "forma" };
  }
  if (!entero(iat) || !entero(inicio) || inicio > iat) return { ok: false, motivo: "forma" };
  if (iat > ahora + TOLERANCIA_RELOJ_SEG) return { ok: false, motivo: "futuro" };
  if (ahora - inicio >= DURACION_MAXIMA_SEG) return { ok: false, motivo: "duracion" };
  if (ahora - iat >= INACTIVIDAD_MAXIMA_SEG) return { ok: false, motivo: "inactividad" };

  return { ok: true, sesion: { usuarioId: Number(sub), sesionVersion: sv, emitidaEn: iat, inicio } };
}

/**
 * Renovación deslizante (la hace el proxy en cada request): misma sesión,
 * `iat` nuevo. `null` si ya no se puede renovar.
 */
export function renovarSesion(sesion: Sesion, secreto: string, ahora: number = segundosAhora()) {
  return emitirSesion(
    { usuarioId: sesion.usuarioId, sesionVersion: sesion.sesionVersion, inicio: sesion.inicio },
    secreto,
    ahora,
  );
}

// ---------------------------------------------------------------------------
// /sin-acceso
// ---------------------------------------------------------------------------

export const COOKIE_SIN_ACCESO = "cem_sin_acceso";
export const VIDA_SIN_ACCESO_SEG = 10 * 60;

/**
 * Lo que /sin-acceso le muestra a quien Cidituc reconoció pero CementerIA no
 * deja entrar: su nombre y CUIL según Cidituc, para que pida el alta. Viaja
 * firmado en una cookie y no en la URL: es un dato personal (sección 6, nada de
 * datos personales en la URL).
 */
export interface DatosSinAcceso {
  cuil: string;
  nombre: string;
  apellido: string;
  motivo: "sin_alta" | "inactivo";
}

export async function firmarSinAcceso(
  datos: DatosSinAcceso,
  secreto: string,
  ahora: number = segundosAhora(),
): Promise<string> {
  return new SignJWT({ cuil: datos.cuil, nombre: datos.nombre, apellido: datos.apellido, motivo: datos.motivo })
    .setProtectedHeader({ alg: ALGORITMO, typ: "JWT" })
    .setAudience(AUD_SIN_ACCESO)
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + VIDA_SIN_ACCESO_SEG)
    .sign(clave(secreto));
}

export async function verificarSinAcceso(
  token: string,
  secreto: string,
  ahora: number = segundosAhora(),
): Promise<DatosSinAcceso | null> {
  const firma = await verificarFirma(token, secreto, AUD_SIN_ACCESO, ahora);
  if (!firma.valida) return null;
  const { cuil, nombre, apellido, motivo } = firma.payload as Record<string, unknown>;
  if (typeof cuil !== "string" || !/^\d{11}$/.test(cuil)) return null;
  if (typeof nombre !== "string" || typeof apellido !== "string") return null;
  if (motivo !== "sin_alta" && motivo !== "inactivo") return null;
  return { cuil, nombre, apellido, motivo };
}
