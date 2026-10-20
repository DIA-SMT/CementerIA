// Ayudas para escribir tests contra la base efímera. Ver README.md.

import pg from "pg";
import { inject } from "vitest";
import { crearCliente, type Cliente } from "@/lib/db/crear-cliente";
import type { BaseIntegracion } from "./contexto";

/** Id del usuario técnico SISTEMA (lo inserta la migración reglas_base). */
export const SISTEMA = 1;

/**
 * - `app`: cementeria_app, el rol de la aplicación. Es el que importa para
 *   probar privilegios y triggers.
 * - `owner`: cementeria_deploy, que al conectarse es cementeria_owner (dueño de
 *   todo). Para mostrar que los triggers ENABLE ALWAYS frenan incluso al dueño.
 * - `superusuario`: `postgres`. Para crear roles de prueba, GRANT SET sobre
 *   parámetros, mirar catálogos. No usarlo para probar reglas de negocio.
 */
export type Rol = "app" | "owner" | "superusuario";

export function base(): BaseIntegracion {
  return inject("baseIntegracion");
}

export function urlDe(rol: Rol): string {
  const b = base();
  return rol === "app" ? b.urlApp : rol === "owner" ? b.urlDeploy : b.urlSuperusuario;
}

/** Un cliente pg conectado con ese rol. Cerrarlo con `.end()` (o usar conPg). */
export async function clientePg(rol: Rol): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: urlDe(rol) });
  await cliente.connect();
  return cliente;
}

/** Abre un cliente, corre `fn` y lo cierra pase lo que pase. */
export async function conPg<T>(rol: Rol, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const cliente = await clientePg(rol);
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

/**
 * Corre `fn` dentro de una transacción que SIEMPRE se revierte: el test no deja
 * filas y no depende del orden de los demás. Es la forma recomendada.
 * Ojo: las identity no retroceden (los id saltan), y `now()` es el inicio de
 * esta transacción.
 */
export async function enTransaccion<T>(rol: Rol, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  return conPg(rol, async (c) => {
    await c.query("BEGIN");
    try {
      return await fn(c);
    } finally {
      await c.query("ROLLBACK");
    }
  });
}

/**
 * Fija el actor como lo hace conActor(): solo para la transacción en curso, así
 * que hay que estar dentro de una (enTransaccion).
 */
export async function fijarActor(c: pg.Client, usuarioId: number, motivo: string | null = null): Promise<void> {
  await c.query("SELECT set_config('app.usuario_id', $1, true), set_config('app.motivo', $2, true)", [
    String(usuarioId),
    motivo ?? "",
  ]);
}

export type Resultado<F> = { ok: true; filas: F[] } | { ok: false; error: string; codigo?: string };

/**
 * Corre una sentencia que puede fallar sin arruinar la transacción del test:
 * va dentro de un SAVEPOINT y, si falla, se vuelve a él. Para afirmar que algo
 * se rechaza: `expect(await intentar(c, sql)).toMatchObject({ ok: false })`.
 */
export async function intentar<F extends pg.QueryResultRow = pg.QueryResultRow>(
  c: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<Resultado<F>> {
  await c.query("SAVEPOINT intento");
  try {
    const r = await c.query<F>(sql, params);
    await c.query("RELEASE SAVEPOINT intento");
    return { ok: true, filas: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    const error = e as Error & { code?: string };
    return { ok: false, error: error.message, codigo: error.code };
  }
}

/** Cliente de Prisma con el rol de la app, para probar código de src/lib/db. */
export function clientePrisma(): Cliente {
  return crearCliente(base().urlApp);
}

/** Un sufijo para códigos únicos entre tests (CHECKs: solo [A-Z0-9_]). */
export function unico(prefijo: string): string {
  return `${prefijo}_${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e6)}`;
}
