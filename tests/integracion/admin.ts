// Ayudas para los tests de la administración (semana 5).
//
// La administración cambia configuración que comparten todos los tests (la
// plantilla publicada de RENOV_CONTADO, los administradores activos, los años
// de feriados): si quedara confirmada, otros archivos verían "v2" o un año
// cerrado según el orden de la corrida. `conServiciosQueSeDeshacen()` corre
// los servicios del dominio sobre UNA transacción que se revierte al final:
// sus lecturas ven lo que escribieron, y nada queda en la base. Cada escritura
// del dominio va en un SAVEPOINT, así un rechazo de la base (un trigger) no
// aborta la transacción del test.
//
// Lo que no molesta a nadie (una plantilla con código único) se puede probar
// confirmado con `servicioAdmin(prisma)`.

import { randomInt } from "node:crypto";
import { conActorEn } from "@/lib/db/actor";
import type { Cliente, Transaccion } from "@/lib/db/crear-cliente";
import { crearServicioAdmin, type ServicioAdmin } from "@/lib/dominio/admin";
import { digitoVerificadorCuil } from "@/lib/dominio/cuil";
import { crearServicioExpedientes, type Escritor, type ServicioExpedientes } from "@/lib/dominio/expedientes";
import { esRol, type UsuarioPermisos } from "@/lib/dominio/permisos";

export function servicioAdmin(prisma: Cliente, ahora?: () => Date): ServicioAdmin {
  return crearServicioAdmin({ leer: prisma, escribir: (u, m, fn) => conActorEn(prisma, u, m, fn), ahora });
}

class Deshacer extends Error {}

export interface ServiciosEnTransaccion {
  admin: ServicioAdmin;
  expedientes: ServicioExpedientes;
  /** Para mirar (y preparar) dentro de la misma transacción. */
  tx: Transaccion;
  /** Fija el actor para escribir directo con `tx` (lo que hace conActor). */
  comoActor: (usuarioId: number, motivo?: string | null) => Promise<void>;
  /** El `conActor` de esta transacción (cada llamada en su SAVEPOINT), para armar otros servicios del dominio. */
  escribir: Escritor;
}

/** Corre `fn` con los servicios sobre una transacción que se deshace al final; devuelve lo que devuelva `fn`. */
export async function conServiciosQueSeDeshacen<T>(prisma: Cliente, fn: (s: ServiciosEnTransaccion) => Promise<T>): Promise<T> {
  let resultado: { valor: T } | undefined;
  await prisma
    .$transaction(
      async (tx) => {
        let n = 0;
        const comoActor = async (usuarioId: number, motivo: string | null = null) => {
          await tx.$executeRaw`SELECT set_config('app.usuario_id', ${String(usuarioId)}, true), set_config('app.motivo', ${motivo?.trim() ?? ""}, true)`;
        };
        const escribir: Escritor = async (usuarioId, motivo, f) => {
          n += 1;
          const punto = `sp_admin_${n}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
          try {
            await comoActor(usuarioId, motivo);
            const r = await f(tx);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
            return r;
          } catch (e) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
            throw e;
          }
        };
        const admin = crearServicioAdmin({ leer: tx, escribir });
        const expedientes = crearServicioExpedientes({ leer: tx, escribir });
        resultado = { valor: await fn({ admin, expedientes, tx, comoActor, escribir }) };
        throw new Deshacer();
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
    .catch((e: unknown) => {
      if (!(e instanceof Deshacer)) throw e;
    });
  if (!resultado) throw new Error("La transacción del test no llegó al final");
  return resultado.valor;
}

/** El usuario como lo da getUsuarioActual(), leído con el cliente que se pase (también un `tx`). */
export async function comoUsuario(lector: Pick<Transaccion, "usuario">, id: number): Promise<UsuarioPermisos> {
  const f = await lector.usuario.findUniqueOrThrow({ where: { id }, select: { id: true, rol: true, activo: true, area: { select: { id: true, codigo: true } } } });
  if (!esRol(f.rol)) throw new Error(`Rol desconocido: ${f.rol}`);
  return { id: f.id, rol: f.rol, activo: f.activo, area: f.area };
}

/** Un CUIL ficticio válido (prefijo 20, DNI 9x.xxx.xxx), distinto en cada llamada. */
export function cuilFicticio(): string {
  for (;;) {
    const base = `209${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
    const d = digitoVerificadorCuil(base);
    if (d !== null) return `${base}${d}`;
  }
}

/** Código único para plantillas y catálogos de prueba (solo [A-Z_], vale también para tipos de monumento). */
export function codigoUnico(prefijo: string): string {
  const letras = Date.now().toString(36).toUpperCase().replace(/[0-9]/g, (d) => "QWERTYUIOP"[Number(d)]);
  return `${prefijo}_${letras}_${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[randomInt(0, 26)]}${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[randomInt(0, 26)]}`;
}
