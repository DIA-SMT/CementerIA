import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/**
 * Fábrica del cliente de Prisma, sin `server-only`.
 *
 * La app no la usa directamente: usa `prisma` de `./cliente`, que es el
 * singleton y está marcado `server-only`. Esta fábrica existe para lo que corre
 * fuera de Next (la semilla con tsx, los scripts y los tests de integración),
 * donde importar `server-only` tira error.
 */

export type Cliente = PrismaClient;

/** El cliente que recibe la función de `conActor`: no tiene `$transaction`. */
export type Transaccion = Prisma.TransactionClient;

/**
 * @param url Cadena de conexión. Por defecto `DATABASE_URL`, que es la del rol
 *   `cementeria_app`: la app nunca se conecta como owner.
 */
export function crearCliente(url: string | undefined = process.env.DATABASE_URL): Cliente {
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL (rol cementeria_app). En local: copiá .env.example a .env.local y corré npm run db:local.",
    );
  }
  const adapter = new PrismaPg({
    connectionString: url,
    // `pg-pool` lee `max`; el `connection_limit` en la URL era del motor viejo
    // de Prisma y con los driver adapters no lo lee nadie.
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });
  return new PrismaClient({ adapter });
}
