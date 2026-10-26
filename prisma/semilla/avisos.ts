// Los avisos de la semilla de desarrollo (26/10/2026; docs/api-dominio.md,
// sección 21).
//
// Los crea el dominio solo: cada pase, devolución y cierre de los escenarios
// deja los suyos, y al final corre la generación por tiempo (prisma/seed.ts).
// Pero los escenarios recorren en minutos lo que en la realidad llevó semanas:
// Cómputo recibiría como "sin leer" los 30 y pico de pases que le llegaron a lo
// largo de todo el circuito, aunque esos expedientes hace rato que siguieron.
// Para que cada área vea lo que una persona vería hoy, los "llegó" y "te
// devolvieron" de un paso que el expediente ya dejó (o de un expediente que ya
// no está en trámite) quedan LEÍDOS; los de donde el expediente está ahora, los
// de tiempo (plazo, sin confirmar, demorado) y los de cierre, sin leer.
//
// Un aviso es "de ahora" si su movimiento es el que dejó el papel donde está:
// misma fecha que `en_area_desde` y mismo destino que `area_actual_id` (un pase
// revertido ya no lo es: la proyección volvió a la llegada anterior).
// Idempotente: solo toca los que siguen sin leer.

import { SISTEMA_ID } from "../../src/lib/auth/ingreso";
import { conActorEn } from "../../src/lib/db/actor";
import type { Cliente } from "../../src/lib/db/crear-cliente";

/** Marca como leídos los avisos de llegada de pasos ya dejados. Devuelve cuántos. */
export async function leerAvisosViejos(cliente: Cliente): Promise<number> {
  return conActorEn(cliente, SISTEMA_ID, "Semilla: avisos de pasos ya dejados", (tx) =>
    tx.$executeRaw`
      UPDATE public.avisos av
         SET leido_en = av.creado_en
        FROM public.expedientes e, public.movimientos m
       WHERE e.id = av.expediente_id
         AND m.id = av.movimiento_id
         AND av.leido_en IS NULL
         AND av.tipo IN ('llego', 'devuelto')
         AND (e.estado NOT IN ('en_tramite', 'espera_pago_dim')
              OR m.fecha_efectiva <> e.en_area_desde
              OR m.area_destino_id IS DISTINCT FROM e.area_actual_id)`,
  );
}
