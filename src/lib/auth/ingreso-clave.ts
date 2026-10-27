import type { Prisma } from "@/generated/prisma/client";
import type { Cliente, Transaccion } from "@/lib/db/crear-cliente";
import { cuilValido } from "@/lib/dominio/cuil";
import { formatearFechaHora } from "@/lib/fechas";
import { log, resumenError } from "@/lib/log";
import { hashearClave, LARGO_MAXIMO_CLAVE, problemasDeClave, verificarClave, type PoliticaClave } from "./clave";
import { SISTEMA_ID, type Escritor } from "./ingreso";
import { estaBloqueado, limiteIpDelProceso, siguienteFallo, type LimitePorIp } from "./limite-intentos";

/**
 * El login propio (27/10/2026; docs/api-dominio.md, sección 22): ingresar con
 * CUIL o correo y contraseña, y cambiar la contraseña. Lo que escribe en la
 * base va por `escribir` (conActor); recibe sus dependencias como ./ingreso.ts,
 * así se prueba sin base y sin Next.
 *
 * La sesión que se emite después es la de siempre (./sesion-token.ts): esto
 * solo decide si la persona entra y deja constancia.
 */

/**
 * La política de la contraseña nueva (CLAVE_POLITICA). Se lee del proceso y no
 * de entorno(), que exige SESSION_SECRET y otras variables que este módulo no
 * necesita (así se prueba sin ellas); el valor ya lo valida entorno.ts al
 * arrancar. Ante cualquier cosa que no sea `libre`, la estricta.
 */
export function politicaClave(fuente: Readonly<Record<string, string | undefined>> = process.env): PoliticaClave {
  return fuente.CLAVE_POLITICA?.trim() === "libre" ? "libre" : "estricta";
}

/** El único mensaje para un ingreso rechazado: no dice si el usuario existe, está inactivo o bloqueado. */
export const MENSAJE_INGRESO_RECHAZADO = "CUIL, correo o contraseña incorrectos";
/** El tope por IP no dice nada de ningún usuario: se puede explicar. */
export const MENSAJE_LIMITE_IP = "Hubo demasiados intentos fallidos desde esta conexión. Esperá 15 minutos y volvé a probar.";

/**
 * Lo que se le muestra a la persona por un rechazo: el mismo texto para
 * cualquier motivo, salvo el tope por IP.
 */
export function mensajeDeRechazo(motivo: MotivoRechazoClave): string {
  return motivo === "limite_ip" ? MENSAJE_LIMITE_IP : MENSAJE_INGRESO_RECHAZADO;
}

export interface DependenciasClave {
  /** Solo lecturas (el cliente global): las escrituras van por `escribir`. */
  leer: { usuario: Pick<Cliente["usuario"], "findUnique" | "findMany"> };
  /** Toda escritura: conActor(). */
  escribir: Escritor;
  ahora?: () => Date;
  /** El límite por IP; por defecto, el del proceso. */
  limiteIp?: LimitePorIp;
}

// ---------------------------------------------------------------------------
// Identificador
// ---------------------------------------------------------------------------

export type Identificador = { tipo: "cuil"; cuil: string } | { tipo: "correo"; correo: string } | { tipo: "invalido" };

/**
 * Lo que escribió la persona en "CUIL o correo": un CUIL de 11 dígitos con o
 * sin guiones, puntos o espacios, o un correo. Otra cosa es inválida (no se
 * busca).
 */
export function interpretarIdentificador(texto: string): Identificador {
  const t = texto.trim();
  if (/^[\d\s.-]+$/.test(t)) {
    const cuil = t.replace(/[\s.-]/g, "");
    return /^\d{11}$/.test(cuil) ? { tipo: "cuil", cuil } : { tipo: "invalido" };
  }
  if (t.length <= 200 && /^[^\s@]+@[^\s@]+$/.test(t)) return { tipo: "correo", correo: t.toLowerCase() };
  return { tipo: "invalido" };
}

const SELECCION = {
  id: true,
  cuil: true,
  activo: true,
  rol: true,
  claveHash: true,
  debeCambiarClave: true,
  bloqueadoHasta: true,
  sesionVersion: true,
} as const satisfies Prisma.UsuarioSelect;

type FilaClave = Prisma.UsuarioGetPayload<{ select: typeof SELECCION }>;

/**
 * El usuario de ese identificador. El correo no es único en la base: si dos
 * usuarios lo comparten no se elige ninguno (`ambiguo`), y se entra con el CUIL.
 */
async function buscar(deps: DependenciasClave, id: Identificador): Promise<{ fila: FilaClave | null; ambiguo: boolean }> {
  if (id.tipo === "cuil") return { fila: await deps.leer.usuario.findUnique({ where: { cuil: id.cuil }, select: SELECCION }), ambiguo: false };
  if (id.tipo === "invalido") return { fila: null, ambiguo: false };
  const filas = await deps.leer.usuario.findMany({
    where: { email: { equals: id.correo, mode: "insensitive" } },
    select: { ...SELECCION, email: true },
    take: 3,
  });
  // `insensitive` en PostgreSQL es ILIKE: se vuelve a comparar exacto para que
  // un "_" o un "%" del texto no funcionen como comodines.
  const exactas = filas.filter((f) => f.email?.toLowerCase() === id.correo);
  if (exactas.length > 1) return { fila: null, ambiguo: true };
  return { fila: exactas[0] ?? null, ambiguo: false };
}

// ---------------------------------------------------------------------------
// Ingreso
// ---------------------------------------------------------------------------

export type MotivoRechazoClave =
  /** La IP llegó al tope de fallos (no se busca a nadie ni se escribe en la base). */
  | "limite_ip"
  /** Ni CUIL de 11 dígitos ni correo. */
  | "identificador_invalido"
  | "sin_usuario"
  /** El correo lo tienen dos o más usuarios. */
  | "correo_ambiguo"
  /** Inactivo, o SISTEMA. */
  | "inactivo"
  /** Bloqueado por fallos seguidos (aunque la contraseña sea la correcta). */
  | "bloqueado"
  /** Sin contraseña (por ejemplo, dado de alta antes del login propio): un admin se la blanquea. */
  | "sin_clave"
  | "clave_incorrecta"
  /** El usuario cambió entre la lectura y la escritura (lo desactivaron, le blanquearon la contraseña). */
  | "carrera";

export interface UsuarioIngresado {
  id: number;
  rol: string;
  sesionVersion: number;
  debeCambiarClave: boolean;
}

export type ResultadoIngresoClave =
  | { ok: true; usuario: UsuarioIngresado }
  | { ok: false; motivo: MotivoRechazoClave; usuarioId: number | null; bloqueo: boolean };

export interface EntradaIngreso {
  identificador: string;
  clave: string;
}

/** Lo que se guarda del identificador en un rechazo: el tipo y, si es un CUIL válido, el CUIL. Nunca la contraseña. */
function detalleIdentificador(id: Identificador): Prisma.InputJsonObject {
  if (id.tipo === "cuil") return cuilValido(id.cuil) ? { identificador: "cuil", cuil: id.cuil } : { identificador: "cuil" };
  // Un texto cualquiera puede ser la contraseña escrita en el campo equivocado:
  // no se guarda. Del correo, tampoco (no aporta y puede ser de otra persona).
  return { identificador: id.tipo };
}

/**
 * Un fallo más para ese usuario, con su fila bloqueada (FOR UPDATE): dos
 * intentos simultáneos no pierden la cuenta. Si ya estaba bloqueado (otro
 * intento llegó antes), no suma. Devuelve si este fallo lo bloqueó.
 */
async function sumarFallo(tx: Transaccion, usuarioId: number, ahora: Date, ip: string | null, via: string): Promise<boolean> {
  const [fila] = await tx.$queryRaw<Array<{ intentos_fallidos: number; bloqueado_hasta: Date | null }>>`
    SELECT intentos_fallidos, bloqueado_hasta FROM public.usuarios WHERE id = ${usuarioId} FOR UPDATE`;
  if (!fila || estaBloqueado(fila.bloqueado_hasta, ahora)) return false;
  const siguiente = siguienteFallo(Number(fila.intentos_fallidos), ahora);
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: siguiente.intentosFallidos, bloqueadoHasta: siguiente.bloqueadoHasta },
  });
  if (siguiente.bloqueo) {
    await tx.auditoriaAcceso.create({
      data: { usuarioId, accion: "bloqueo", ip, detalle: { via, intentos: 5, hasta: siguiente.bloqueadoHasta?.toISOString() ?? null } },
    });
  }
  return siguiente.bloqueo;
}

/**
 * Deja constancia del rechazo (y, si fue una contraseña incorrecta, suma el
 * fallo). Lo firma SISTEMA: puede no haber usuario, y aunque lo haya no fue él
 * quien decidió. Si la base falla, el rechazo sigue en pie.
 */
async function rechazar(
  deps: DependenciasClave,
  ahora: Date,
  ip: string | null,
  motivo: MotivoRechazoClave,
  usuarioId: number | null,
  detalle: Prisma.InputJsonObject,
): Promise<ResultadoIngresoClave> {
  (deps.limiteIp ?? limiteIpDelProceso()).registrarFallo(ip);
  let bloqueo = false;
  try {
    bloqueo = await deps.escribir(SISTEMA_ID, "ingreso_rechazado", async (tx) => {
      await tx.auditoriaAcceso.create({
        data: { usuarioId, accion: "ingreso_rechazado", ip, detalle: { via: "clave", motivo, ...detalle } },
      });
      return motivo === "clave_incorrecta" && usuarioId !== null ? sumarFallo(tx, usuarioId, ahora, ip, "clave") : false;
    });
  } catch (error) {
    log.error("ingreso_clave.rechazo_sin_registrar", resumenError(error));
  }
  return { ok: false, motivo, usuarioId, bloqueo };
}

/**
 * Ingreso con CUIL (o correo) y contraseña.
 *
 * El cálculo de scrypt se hace SIEMPRE, exista o no el usuario, esté o no
 * activo o bloqueado: el tiempo de respuesta no dice nada. A la persona se le
 * muestra un único mensaje (MENSAJE_INGRESO_RECHAZADO); el motivo real queda en
 * auditoria.accesos (`ingreso_rechazado`, sin la contraseña).
 */
export async function ingresarConClave(deps: DependenciasClave, entrada: EntradaIngreso, ip: string | null): Promise<ResultadoIngresoClave> {
  const ahora = deps.ahora?.() ?? new Date();
  const limite = deps.limiteIp ?? limiteIpDelProceso();
  if (limite.bloqueada(ip)) {
    log.warn("ingreso_clave.limite_ip", { ip });
    return { ok: false, motivo: "limite_ip", usuarioId: null, bloqueo: false };
  }

  const id = interpretarIdentificador(entrada.identificador);
  const { fila, ambiguo } = await buscar(deps, id);
  // Siempre, aunque no haya usuario o no tenga contraseña (señuelo).
  const verificacion = await verificarClave(entrada.clave, fila?.claveHash ?? null);

  if (!fila) {
    const motivo: MotivoRechazoClave = id.tipo === "invalido" ? "identificador_invalido" : ambiguo ? "correo_ambiguo" : "sin_usuario";
    return rechazar(deps, ahora, ip, motivo, null, detalleIdentificador(id));
  }
  if (fila.id === SISTEMA_ID || !fila.activo) return rechazar(deps, ahora, ip, "inactivo", fila.id, {});
  if (estaBloqueado(fila.bloqueadoHasta, ahora)) return rechazar(deps, ahora, ip, "bloqueado", fila.id, {});
  if (!fila.claveHash) return rechazar(deps, ahora, ip, "sin_clave", fila.id, {});
  if (!verificacion.ok) return rechazar(deps, ahora, ip, "clave_incorrecta", fila.id, {});

  // Correcta. Si el hash es de parámetros viejos, se rehace con los actuales.
  const nuevoHash = verificacion.rehacer ? await hashearClave(entrada.clave) : null;
  const usuario = await deps.escribir(fila.id, "ingreso", async (tx) => {
    // La condición repite lo decidido: si entre la lectura y esta escritura lo
    // desactivaron, lo bloquearon o le cambiaron la contraseña, no entra.
    const { count } = await tx.usuario.updateMany({
      where: { id: fila.id, activo: true, claveHash: fila.claveHash, OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }] },
      data: { ultimoIngreso: ahora, intentosFallidos: 0, bloqueadoHasta: null, ...(nuevoHash ? { claveHash: nuevoHash } : {}) },
    });
    if (count !== 1) return null;
    await tx.auditoriaAcceso.create({
      data: {
        usuarioId: fila.id,
        accion: "ingreso",
        ip,
        detalle: { via: "clave", debe_cambiar_clave: fila.debeCambiarClave, ...(nuevoHash ? { hash_rehecho: true } : {}) },
      },
    });
    // Adentro de la transacción: la sesión nace con la versión vigente.
    return tx.usuario.findUniqueOrThrow({ where: { id: fila.id }, select: { id: true, rol: true, sesionVersion: true, debeCambiarClave: true } });
  });
  if (!usuario) return rechazar(deps, ahora, ip, "carrera", fila.id, {});
  return { ok: true, usuario };
}

// ---------------------------------------------------------------------------
// Cambio de contraseña
// ---------------------------------------------------------------------------

export interface EntradaCambioClave {
  actual: string;
  nueva: string;
  repetida: string;
}

export type CampoCambioClave = "actual" | "nueva" | "repetida";

export type ResultadoCambioClave =
  | { ok: true; sesionVersion: number }
  | {
      ok: false;
      mensaje: string;
      errores: Array<{ ruta: CampoCambioClave; mensaje: string }>;
      /** La sesión ya no vale (salió en otra PC, lo desactivaron): hay que volver a ingresar. */
      sesionCerrada: boolean;
    };

const SESION_CERRADA: ResultadoCambioClave = {
  ok: false,
  mensaje: "Tu sesión ya no es válida. Ingresá de nuevo.",
  errores: [],
  sesionCerrada: true,
};

function error(mensaje: string, errores: Array<{ ruta: CampoCambioClave; mensaje: string }> = []): ResultadoCambioClave {
  return { ok: false, mensaje, errores, sesionCerrada: false };
}

/**
 * Cambiar la propia contraseña: pide la actual (cuenta como un intento: cinco
 * incorrectas seguidas bloquean igual que en el ingreso) y la nueva dos veces,
 * con la política de REGLAS_CLAVE. Al cambiarla:
 *   - `debe_cambiar_clave` vuelve a no (queda en auditoria.cambios);
 *   - `sesion_version` + 1: se cierran TODAS las sesiones del usuario, y quien
 *     llama emite de nuevo la de esta PC con la versión que se devuelve;
 *   - queda `cambio_clave` en auditoria.accesos.
 *
 * `sesion` es la de la cookie: si la base ya tiene otra versión, la sesión se
 * cerró en otro lado y no se cambia nada.
 */
export async function cambiarClave(
  deps: Pick<DependenciasClave, "leer" | "escribir" | "ahora">,
  sesion: { usuarioId: number; sesionVersion: number },
  entrada: EntradaCambioClave,
  ip: string | null,
): Promise<ResultadoCambioClave> {
  const ahora = deps.ahora?.() ?? new Date();
  const { actual, nueva, repetida } = entrada;
  if (!actual) return error("Escribí tu contraseña actual.", [{ ruta: "actual", mensaje: "Escribí tu contraseña actual" }]);
  if (!nueva) return error("Escribí la contraseña nueva.", [{ ruta: "nueva", mensaje: "Escribí la contraseña nueva" }]);
  if (nueva !== repetida) {
    return error("La contraseña nueva y su repetición no coinciden.", [{ ruta: "repetida", mensaje: "No coincide con la contraseña nueva" }]);
  }

  const fila = await deps.leer.usuario.findUnique({
    where: { id: sesion.usuarioId },
    select: { id: true, cuil: true, apellido: true, activo: true, claveHash: true, debeCambiarClave: true, bloqueadoHasta: true, sesionVersion: true },
  });
  if (!fila || fila.id === SISTEMA_ID || !fila.activo || fila.sesionVersion !== sesion.sesionVersion) return SESION_CERRADA;
  if (estaBloqueado(fila.bloqueadoHasta, ahora)) {
    return error(
      `Tu usuario está bloqueado hasta ${formatearFechaHora(fila.bloqueadoHasta as Date)} por intentos fallidos. Probá después, o pedile a un administrador que lo desbloquee.`,
    );
  }

  const verificacion = await verificarClave(actual, fila.claveHash);
  if (!verificacion.ok) {
    let bloqueo = false;
    if (fila.claveHash) {
      bloqueo = await deps.escribir(SISTEMA_ID, "cambio_clave_rechazado", (tx) => sumarFallo(tx, fila.id, ahora, ip, "cambio_clave"));
    }
    return error(
      bloqueo
        ? "La contraseña actual no es correcta. Por los intentos fallidos seguidos, tu usuario quedó bloqueado 15 minutos."
        : fila.claveHash
          ? "La contraseña actual no es correcta."
          : "Tu usuario no tiene contraseña: pedile a un administrador que te la blanquee.",
      [{ ruta: "actual", mensaje: "No es tu contraseña actual" }],
    );
  }

  const problemas =
    nueva.length > LARGO_MAXIMO_CLAVE ? [`Tiene más de ${LARGO_MAXIMO_CLAVE} caracteres.`] : problemasDeClave(nueva, fila, politicaClave());
  if (nueva.normalize("NFC") === actual.normalize("NFC")) problemas.push("Tiene que ser distinta de la actual.");
  if (problemas.length > 0) {
    return error("La contraseña nueva no cumple las reglas.", problemas.map((mensaje) => ({ ruta: "nueva" as const, mensaje })));
  }

  const hash = await hashearClave(nueva);
  const nuevaVersion = await deps.escribir(fila.id, "Cambio de contraseña", async (tx) => {
    const { count } = await tx.usuario.updateMany({
      where: { id: fila.id, activo: true, sesionVersion: sesion.sesionVersion, claveHash: fila.claveHash },
      data: {
        claveHash: hash,
        debeCambiarClave: false,
        claveCambiadaEn: ahora,
        intentosFallidos: 0,
        bloqueadoHasta: null,
        sesionVersion: { increment: 1 },
      },
    });
    if (count !== 1) return null;
    await tx.auditoriaAcceso.create({
      data: { usuarioId: fila.id, accion: "cambio_clave", ip, detalle: { via: "usuario", obligatorio: fila.debeCambiarClave } },
    });
    const vigente = await tx.usuario.findUniqueOrThrow({ where: { id: fila.id }, select: { sesionVersion: true } });
    return vigente.sesionVersion;
  });
  if (nuevaVersion === null) return SESION_CERRADA;
  return { ok: true, sesionVersion: nuevaVersion };
}
