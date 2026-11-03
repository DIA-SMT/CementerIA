import { createHmac } from "node:crypto";
import type { Escritor } from "@/lib/dominio/expedientes/dependencias";
import { log, resumenError } from "@/lib/log";

/**
 * El tope de consultas AL MODELO, por persona y por hora, y uno global
 * (docs/api-dominio.md, 26.4). Como El Sanmiguelino (src/lib/migue/tope.ts):
 * no es antiabuso sofisticado sino un techo de gasto, para que un mal día no
 * se lleve el presupuesto del mes.
 *
 * - **Persona**: en lo público, la IP; en lo interno, el usuario. Nunca en
 *   claro: un HMAC con SESSION_SECRET (sin sal, el espacio de IPs o de ids se
 *   recorre probando). La tabla no permite saber quién preguntó ni cruzarla con
 *   el registro.
 * - **Global**: entre todos, los dos canales juntos. Es el techo de verdad: si
 *   mil personas preguntan veinte veces, el tope individual no protege nada.
 * - **Atómico**: incrementa primero y pregunta después, en una sola sentencia
 *   (INSERT … ON CONFLICT DO UPDATE … RETURNING). Al revés —leer, decidir,
 *   escribir— dos pedidos simultáneos leen el mismo número y pasan los dos.
 * - **Pasarse no rompe a Migue**: sigue contestando con el buscador, que no
 *   cuesta nada.
 * - Si la base no responde, deja pasar (y lo anota): es una protección de
 *   costos, no de seguridad, y no vale que una caída apague a Migue.
 *
 * Solo cuenta lo que va al modelo: un saludo o un atajo no gastan nada.
 */

export type PersonaTope = { tipo: "ip"; ip: string | null } | { tipo: "usuario"; id: number };

export interface Topes {
  persona: number;
  global: number;
}

export interface EstadoTope {
  permitido: boolean;
  /** Por qué no, para el registro. */
  motivo?: "persona" | "global";
}

/** El HMAC de la persona, en base64url y recortado a 32 caracteres (el CHECK de consumo_migue). */
export function claveDeConsumo(secreto: string, persona: PersonaTope): string {
  const dato = persona.tipo === "ip" ? `ip:${persona.ip ?? "sin-ip"}` : `usuario:${persona.id}`;
  return createHmac("sha256", secreto).update(`migue:${dato}`).digest("base64url").slice(0, 32);
}

/** El comienzo de la hora en curso (en UTC: las horas de Tucumán empiezan al mismo tiempo). */
export function ventanaDe(ahora: Date): Date {
  const d = new Date(ahora);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** La decisión, dado lo que ya se contó (incluida esta consulta). Pura. */
export function decidirTope(cuenta: { persona: number; global: number }, topes: Topes): EstadoTope {
  if (cuenta.persona > topes.persona) return { permitido: false, motivo: "persona" };
  if (cuenta.global > topes.global) return { permitido: false, motivo: "global" };
  return { permitido: true };
}

export interface DependenciasTope {
  escribir: Escritor;
  secreto: string;
  topes: Topes;
  ahora?: () => Date;
}

/** El usuario con el que se firma la escritura: SISTEMA en lo público (no hay sesión). */
const SISTEMA_ID = 1;

/**
 * Cuenta una consulta al modelo y dice si estaba permitida. Con la base caída,
 * permitida.
 */
export async function contarConsulta(deps: DependenciasTope, persona: PersonaTope): Promise<EstadoTope> {
  const ventana = ventanaDe(deps.ahora?.() ?? new Date());
  const clave = claveDeConsumo(deps.secreto, persona);
  const actor = persona.tipo === "usuario" ? persona.id : SISTEMA_ID;
  try {
    const cuenta = await deps.escribir(actor, "Tope de consultas de Migue", async (tx) => {
      const [fila] = await tx.$queryRaw<Array<{ consultas: number }>>`
        INSERT INTO public.consumo_migue (clave, ventana, consultas) VALUES (${clave}, ${ventana}::timestamptz, 1)
        ON CONFLICT (clave, ventana) DO UPDATE SET consultas = consumo_migue.consultas + 1
        RETURNING consultas`;
      const personaCuenta = Number(fila?.consultas ?? 1);
      // El global se mira solo si la persona no se pasó: es una consulta más.
      if (personaCuenta > deps.topes.persona) return { persona: personaCuenta, global: 0 };
      const [total] = await tx.$queryRaw<Array<{ total: number }>>`
        SELECT coalesce(sum(consultas), 0)::int AS total FROM public.consumo_migue WHERE ventana = ${ventana}::timestamptz`;
      return { persona: personaCuenta, global: Number(total?.total ?? 0) };
    });
    return decidirTope(cuenta, deps.topes);
  } catch (error) {
    log.warn("migue.tope_sin_base", resumenError(error));
    return { permitido: true };
  }
}
