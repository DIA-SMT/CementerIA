import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { conexionPg } from "./tls";

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
    // Con DATABASE_CA_FILE o DATABASE_CA_PEM (Supabase): TLS con la CA
    // explícita, verificando la cadena y el host (./tls.ts).
    ...conexionPg(url),
    // `pg-pool` lee `max`; el `connection_limit` en la URL era del motor viejo
    // de Prisma y con los driver adapters no lo lee nadie.
    max: Number(process.env.DB_POOL_MAX ?? 5),
    // Las sesiones de Prisma van en UTC. @prisma/adapter-pg manda un Date como
    // "AAAA-MM-DD HH:MM:SS" con la hora UTC y SIN zona, y al leer un
    // timestamptz le cambia el offset por +00:00: da por hecho que la sesión
    // está en UTC. La base tiene timezone = America/Argentina/Tucuman (para
    // psql y los scripts), y con eso cada timestamptz escrito o leído por
    // Prisma se corría 3 horas (tests/integracion/fechas.test.ts). Los
    // triggers no dependen de la zona de la sesión: usan AT TIME ZONE
    // explícito.
    // En Supabase el pooler (Supavisor) no le pasa al servidor las opciones de
    // inicio, así que esto no llega: ahí la sesión sale en UTC porque el rol
    // cementeria_app tiene `timezone = 'UTC'` (scripts/supabase/sql/roles.sql).
    options: "-c TimeZone=UTC",
  });
  return new PrismaClient({ adapter });
}
