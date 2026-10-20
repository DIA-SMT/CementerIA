import type { Prisma } from "@/generated/prisma/client";
import type { Cliente, Transaccion } from "@/lib/db/crear-cliente";
import { log, resumenError } from "@/lib/log";
import type { PersonaCidituc } from "./cidituc/validar";

/**
 * Lo que el ingreso, el login simulado y la salida escriben en la base
 * (sección 6, "Autenticación", puntos 3 y 6).
 *
 * Recibe sus dependencias en vez de importarlas: la app le pasa el cliente
 * global y `conActor()` (src/lib/db), los tests unos simulados. Así este módulo
 * no arrastra `server-only` y la lógica se prueba sin base.
 */

/** Usuario técnico de la migración reglas_base: firma lo que no tiene autor humano. */
export const SISTEMA_ID = 1;

/** La firma de `conActor()` de src/lib/db/transaccion.ts. */
export type Escritor = <T>(usuarioId: number, motivo: string | null, fn: (tx: Transaccion) => Promise<T>) => Promise<T>;

export interface DependenciasIngreso {
  /**
   * Solo lecturas: el cliente global de la app, tipado con lo único que se lee
   * para que por acá no se pueda escribir fuera de conActor().
   */
  leer: { usuario: Pick<Cliente["usuario"], "findUnique"> };
  /** Toda escritura: conActor(). */
  escribir: Escritor;
  ahora?: () => Date;
}

export type RechazoIngreso = "sin_alta" | "inactivo" | "cidituc_distinto";

export type ResultadoIngreso =
  | { ok: true; usuario: { id: number; rol: string; sesionVersion: number }; primerIngreso: boolean }
  | { ok: false; motivo: RechazoIngreso; usuarioId: number | null };

export interface UsuarioIngreso {
  id: number;
  activo: boolean;
  ciditucId: string | null;
  nombre: string;
  apellido: string;
  email: string | null;
}

const SELECCION = {
  id: true,
  activo: true,
  ciditucId: true,
  nombre: true,
  apellido: true,
  email: true,
} as const satisfies Prisma.UsuarioSelect;

export type DecisionIngreso = { aceptar: true; vincular: boolean } | { aceptar: false; motivo: RechazoIngreso };

/**
 * Cidituc dice quién es; esto decide si entra.
 *
 * - Sin fila en `usuarios` para su CUIL: no tiene alta.
 * - SISTEMA (id 1) está inactivo por CHECK, pero se lo nombra igual: nadie
 *   ingresa con él aunque alguien lo active por error.
 * - `cidituc_id` se vincula en el primer ingreso; después tiene que coincidir.
 *   Si no coincide, el CUIL de la fila es de otra cuenta de Cidituc: o el alta
 *   se cargó con un CUIL equivocado, o alguien usa una cuenta ajena.
 */
export function decidirIngreso(usuario: UsuarioIngreso | null, persona: PersonaCidituc): DecisionIngreso {
  if (!usuario) return { aceptar: false, motivo: "sin_alta" };
  if (usuario.id === SISTEMA_ID || !usuario.activo) return { aceptar: false, motivo: "inactivo" };
  if (usuario.ciditucId !== null && usuario.ciditucId !== persona.ciditucId) {
    return { aceptar: false, motivo: "cidituc_distinto" };
  }
  return { aceptar: true, vincular: usuario.ciditucId === null };
}

function esViolacionDeUnicidad(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Deja constancia de un ingreso rechazado. Lo firma SISTEMA: puede no haber
 * usuario (CUIL sin alta), y aunque lo haya, no fue él quien decidió.
 *
 * Si la base falla acá, el rechazo sigue en pie: perder la fila de auditoría no
 * puede convertirse en dejar entrar a alguien.
 */
async function registrarRechazo(
  deps: DependenciasIngreso,
  usuarioId: number | null,
  ip: string | null,
  detalle: Prisma.InputJsonObject,
): Promise<void> {
  try {
    await deps.escribir(SISTEMA_ID, "ingreso_rechazado", (tx) =>
      tx.auditoriaAcceso.create({ data: { usuarioId, accion: "ingreso_rechazado", ip, detalle } }),
    );
  } catch (error) {
    log.error("ingreso.rechazo_sin_registrar", resumenError(error));
  }
}

/**
 * Ingreso por Cidituc: busca por CUIL, decide, y si entra vincula `cidituc_id`
 * (primer ingreso), actualiza nombre, email y `ultimo_ingreso` y registra el
 * `ingreso`, todo en una transacción con el usuario como actor. Esas columnas
 * no se auditan en auditoria.cambios (el trigger mira solo cuil, área, rol y
 * activo).
 */
export async function ingresarConCidituc(
  deps: DependenciasIngreso,
  persona: PersonaCidituc,
  ip: string | null,
): Promise<ResultadoIngreso> {
  const usuario = await deps.leer.usuario.findUnique({ where: { cuil: persona.cuil }, select: SELECCION });
  const decision = decidirIngreso(usuario, persona);

  if (!decision.aceptar) {
    const detalle: Prisma.InputJsonObject =
      decision.motivo === "sin_alta"
        ? // El CUIL es lo único que permite saber quién pidió entrar sin alta.
          { via: "cidituc", motivo: decision.motivo, cuil: persona.cuil }
        : decision.motivo === "cidituc_distinto"
          ? { via: "cidituc", motivo: decision.motivo, cidituc_id: persona.ciditucId }
          : { via: "cidituc", motivo: decision.motivo };
    await registrarRechazo(deps, usuario?.id ?? null, ip, detalle);
    return { ok: false, motivo: decision.motivo, usuarioId: usuario?.id ?? null };
  }

  const fila = usuario as UsuarioIngreso;
  const ahora = deps.ahora?.() ?? new Date();
  try {
    return await deps.escribir(fila.id, "ingreso", async (tx) => {
      // La condición repite la decisión: si entre la lectura y esta escritura
      // alguien desactivó al usuario o vinculó otra cuenta, no se pisa nada.
      const { count } = await tx.usuario.updateMany({
        where: { id: fila.id, activo: true, OR: [{ ciditucId: null }, { ciditucId: persona.ciditucId }] },
        data: {
          ciditucId: persona.ciditucId,
          // Cidituc admite nombre y apellido vacíos: se conserva lo que había.
          nombre: persona.nombre || fila.nombre,
          apellido: persona.apellido || fila.apellido,
          email: persona.email ?? fila.email,
          ultimoIngreso: ahora,
        },
      });
      if (count !== 1) throw new Error("El usuario cambió mientras ingresaba; reintentar.");

      await tx.auditoriaAcceso.create({
        data: {
          usuarioId: fila.id,
          accion: "ingreso",
          ip,
          detalle: { via: "cidituc", primer_ingreso: decision.vincular },
        },
      });
      // Se lee adentro de la transacción: la sesión tiene que nacer con la
      // versión vigente, no con una que una salida concurrente ya invalidó.
      const vigente = await tx.usuario.findUniqueOrThrow({
        where: { id: fila.id },
        select: { id: true, rol: true, sesionVersion: true },
      });
      return { ok: true, usuario: vigente, primerIngreso: decision.vincular } as const;
    });
  } catch (error) {
    // Otra fila ya tiene este cidituc_id (índice único): la cuenta de Cidituc
    // está vinculada a otro CUIL.
    if (!esViolacionDeUnicidad(error)) throw error;
    await registrarRechazo(deps, fila.id, ip, {
      via: "cidituc",
      motivo: "cidituc_en_otro_usuario",
      cidituc_id: persona.ciditucId,
    });
    return { ok: false, motivo: "cidituc_distinto", usuarioId: fila.id };
  }
}

/**
 * Login simulado (/dev/login): registra el ingreso como cualquier otro, con
 * `via: dev_login`, así en staging queda igual de auditado.
 */
export async function ingresarSimulado(
  deps: DependenciasIngreso,
  usuarioId: number,
  ip: string | null,
): Promise<ResultadoIngreso> {
  if (usuarioId === SISTEMA_ID) return { ok: false, motivo: "inactivo", usuarioId };
  const ahora = deps.ahora?.() ?? new Date();
  return deps.escribir(usuarioId, "ingreso", async (tx) => {
    const { count } = await tx.usuario.updateMany({
      where: { id: usuarioId, activo: true },
      data: { ultimoIngreso: ahora },
    });
    if (count !== 1) return { ok: false, motivo: "inactivo", usuarioId } as const;
    await tx.auditoriaAcceso.create({
      data: { usuarioId, accion: "ingreso", ip, detalle: { via: "dev_login" } },
    });
    const vigente = await tx.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { id: true, rol: true, sesionVersion: true },
    });
    return { ok: true, usuario: vigente, primerIngreso: false } as const;
  });
}

/**
 * Salida: incrementa `sesion_version`, lo que cierra TODAS las sesiones del
 * usuario (otras PC incluidas), y registra la `salida`.
 *
 * Solo si la versión sigue siendo la de la cookie: una cookie ya invalidada no
 * tiene sesión que cerrar.
 *
 * @returns si había una sesión vigente que cerrar.
 */
export async function cerrarSesion(
  deps: DependenciasIngreso,
  usuarioId: number,
  sesionVersion: number,
  ip: string | null,
): Promise<boolean> {
  return deps.escribir(usuarioId, "salida", async (tx) => {
    const { count } = await tx.usuario.updateMany({
      where: { id: usuarioId, sesionVersion },
      data: { sesionVersion: { increment: 1 } },
    });
    if (count !== 1) return false;
    await tx.auditoriaAcceso.create({ data: { usuarioId, accion: "salida", ip, detalle: {} } });
    return true;
  });
}
