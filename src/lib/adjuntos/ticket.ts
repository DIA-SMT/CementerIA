import { createHmac, timingSafeEqual } from "node:crypto";
import { RE_ID } from "./almacen";

/**
 * El "ticket" de una subida directa (docs/despliegue-vercel.md, "Adjuntos").
 *
 * Entre las dos llamadas (autorizar y confirmar) el navegador guarda el UUID
 * del temporal que le tocó. Para que no pueda confirmar OTRO temporal (uno que
 * subió alguien más, u otro suyo de otro expediente), el servidor se lo da
 * firmado con HMAC-SHA256 y atado a quién lo pidió, para qué expediente y con
 * qué comando, y con vencimiento (el de la URL firmada de Supabase: 2 horas).
 * La clave es SESSION_SECRET, con un prefijo propio para que esta firma no
 * sirva para otra cosa.
 *
 * Formato: `<uuid>.<vence, segundos epoch>.<firma base64url>`.
 */

/** Lo que dura una URL firmada de subida de Supabase Storage. */
export const VIGENCIA_TICKET_MS = 2 * 60 * 60 * 1000;

const PREFIJO = "cementeria:subida-adjunto:v1";

export interface DestinoTicket {
  usuarioId: number;
  numero: string;
  comando: string;
}

function firma(secreto: string, d: DestinoTicket, id: string, vence: number): Buffer {
  const datos = [PREFIJO, d.usuarioId, d.numero.trim().toUpperCase(), d.comando.trim().toLowerCase(), id, vence].join("\n");
  return createHmac("sha256", secreto).update(datos).digest();
}

export function firmarTicket(secreto: string, d: DestinoTicket, id: string, ahora: number = Date.now(), vigenciaMs: number = VIGENCIA_TICKET_MS): string {
  if (!RE_ID.test(id)) throw new Error("Id de adjunto inválido");
  const vence = Math.floor((ahora + vigenciaMs) / 1000);
  return `${id}.${vence}.${firma(secreto, d, id, vence).toString("base64url")}`;
}

export type TicketVerificado = { ok: true; id: string } | { ok: false; motivo: "invalido" | "vencido" };

/** Comprueba la firma (en tiempo constante) y el vencimiento. */
export function verificarTicket(secreto: string, ticket: string, d: DestinoTicket, ahora: number = Date.now()): TicketVerificado {
  const partes = ticket.split(".");
  if (partes.length !== 3) return { ok: false, motivo: "invalido" };
  const [id, venceTexto, firmaTexto] = partes;
  if (!RE_ID.test(id) || !/^\d{1,12}$/.test(venceTexto)) return { ok: false, motivo: "invalido" };
  const vence = Number(venceTexto);
  const esperada = firma(secreto, d, id, vence);
  const recibida = Buffer.from(firmaTexto, "base64url");
  // Solo la codificación canónica (Buffer ignora caracteres raros y bits de relleno).
  if (recibida.toString("base64url") !== firmaTexto) return { ok: false, motivo: "invalido" };
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return { ok: false, motivo: "invalido" };
  if (ahora / 1000 > vence) return { ok: false, motivo: "vencido" };
  return { ok: true, id };
}
