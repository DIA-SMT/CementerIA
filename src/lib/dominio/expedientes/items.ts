import { z } from "zod";

/**
 * `expedientes.items` (docs/propuesta-mvp.md, 2.6): el estado de subtareas,
 * documentos y adjuntos, por clave. Los `mov` son ids de `movimientos` (el que
 * dejó ese estado), como número.
 *
 * Una clave que no está en `items` está en su estado inicial: subtarea sin
 * hacer, documento pendiente. Por eso el alta solo escribe los documentos que
 * se recibieron.
 */

export const ESTADOS_DOCUMENTO = ["pendiente", "presentado", "no_corresponde", "historico"] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

const IdMovimiento = z.union([z.number(), z.string()]).nullable();

export const ItemSubtarea = z.object({
  hecha: z.boolean(),
  dato: z.string().nullable().default(null),
  mov: IdMovimiento.default(null),
  reiniciada_por_mov: IdMovimiento.default(null),
  historica: z.boolean().default(false),
});

export const ItemDocumento = z.object({
  estado: z.enum(ESTADOS_DOCUMENTO),
  obs: z.string().nullable().default(null),
  mov: IdMovimiento.default(null),
  adjuntos: z.array(z.union([z.number(), z.string()])).default([]),
});

export const ItemAdjunto = z.object({
  documento: z.string().nullable(),
  /** false: retirado por una corrección (el archivo se conserva y deja de verse). */
  vigente: z.boolean(),
  /** Semana 4: la purga del admin (Ley 25.326) borró el archivo del disco. */
  purgado: z.boolean().default(false),
});

export const ItemsExpediente = z.object({
  subtareas: z.record(z.string(), ItemSubtarea).default({}),
  documentos: z.record(z.string(), ItemDocumento).default({}),
  adjuntos: z.record(z.string(), ItemAdjunto).default({}),
});

export type ItemSubtarea = z.infer<typeof ItemSubtarea>;
export type ItemDocumento = z.infer<typeof ItemDocumento>;
export type ItemAdjunto = z.infer<typeof ItemAdjunto>;
export type ItemsExpediente = z.infer<typeof ItemsExpediente>;

/**
 * Lee `items` de la base. Si no tiene la forma esperada es un defecto del
 * código que lo escribió, no algo que el usuario pueda arreglar: se tira.
 */
export function leerItems(valor: unknown): ItemsExpediente {
  return ItemsExpediente.parse(valor ?? {});
}

/** `items` de un expediente recién creado: los documentos recibidos en el alta, presentados. */
export function itemsIniciales(documentosRecibidos: readonly string[], movAlta: bigint): ItemsExpediente {
  const mov = Number(movAlta);
  return {
    subtareas: {},
    documentos: Object.fromEntries(
      documentosRecibidos.map((clave) => [clave, { estado: "presentado" as const, obs: null, mov, adjuntos: [] }]),
    ),
    adjuntos: {},
  };
}
