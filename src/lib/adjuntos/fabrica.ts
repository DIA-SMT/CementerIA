import { crearAlmacenEnDisco, raizAdjuntos, type AlmacenAdjuntos } from "./almacen";
import { configAlmacen } from "./config";
import { crearAlmacenSupabase } from "./supabase";

/**
 * El almacén de adjuntos de este proceso según ADJUNTOS_ALMACEN (./config.ts):
 * el disco (`ADJUNTOS_DIR`) o Supabase Storage (`SUPABASE_URL`,
 * `SUPABASE_SECRET_KEY`). Lo usan la app (src/lib/dominio/expedientes/servidor.ts),
 * el barrido de temporales (script y cron) y la semilla.
 */
export function crearAlmacenDesdeEntorno(fuente: Readonly<Record<string, string | undefined>> = process.env): AlmacenAdjuntos {
  const c = configAlmacen(fuente);
  if (c.tipo === "supabase") return crearAlmacenSupabase({ url: c.url, clave: c.clave });
  return crearAlmacenEnDisco(raizAdjuntos(fuente));
}

/** Para los logs: qué almacén es, sin rutas de servidor ni URLs con claves. */
export function descripcionAlmacen(fuente: Readonly<Record<string, string | undefined>> = process.env): string {
  return configAlmacen(fuente).tipo;
}
