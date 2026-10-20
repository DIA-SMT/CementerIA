import "server-only";
import { crearCliente, type Cliente } from "./crear-cliente";

/**
 * El cliente de Prisma de la aplicación, uno por proceso.
 *
 * Solo para LEER. Toda escritura va dentro de `conActor()` (./transaccion.ts).
 * En movimientos, expedientes, personas y la configuración auditada los
 * triggers exigen `app.usuario_id` y una escritura suelta falla en la base; en
 * auditoria.accesos y en las columnas de ingreso de usuarios no hay trigger y
 * lo único que la frena es la regla de ESLint (ver eslint.config.mjs).
 *
 * En desarrollo va colgado de `globalThis`: el hot reload re-evalúa los módulos
 * y sin esto cada guardado abriría un pool nuevo hasta agotar las conexiones.
 *
 * Se construye perezoso, en el primer uso y no al importar: `next build`
 * importa los módulos del servidor y no tiene por qué tener DATABASE_URL.
 */

const global = globalThis as typeof globalThis & { __cementeriaPrisma?: Cliente };
let instancia: Cliente | undefined;

function obtener(): Cliente {
  instancia ??= global.__cementeriaPrisma ?? crearCliente();
  if (process.env.NODE_ENV !== "production") {
    global.__cementeriaPrisma = instancia;
  }
  return instancia;
}

export const prisma: Cliente = new Proxy({} as Cliente, {
  get(_destino, propiedad) {
    const cliente = obtener();
    const valor: unknown = Reflect.get(cliente, propiedad, cliente);
    // Los métodos ($transaction, $queryRaw…) se atan al cliente real: llamados
    // a través del Proxy, `this` sería el Proxy y no el cliente.
    return typeof valor === "function"
      ? (valor as (...args: unknown[]) => unknown).bind(cliente)
      : valor;
  },
});
