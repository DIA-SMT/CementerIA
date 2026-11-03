import { join } from "node:path";
import { detectarTipoFoto } from "@/lib/imagenes/tipos";
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

/**
 * Las fotos del sitio público (30/10/2026; docs/api-dominio.md, sección 25.7),
 * en el mismo almacén que los adjuntos y con la misma configuración, pero
 * aparte: en el disco, la carpeta `sitio-publico/` dentro de `ADJUNTOS_DIR`
 * (entra en el mismo backup); en Supabase Storage, el bucket PRIVADO
 * `sitio-publico` (supabase/sql/45_storage.sql). Cada foto son dos WebP en
 * `fotos/<uuid>/960.webp` y `fotos/<uuid>/1920.webp`; los originales que sube
 * el navegador en Vercel pasan por `tmp/<uuid>` y se borran al confirmar.
 */
export const BUCKET_SITIO = "sitio-publico";
/** La carpeta dentro de ADJUNTOS_DIR. */
export const CARPETA_SITIO = "sitio-publico";
/** Las rutas definitivas de una foto: `fotos/<uuid>/960.webp` o `fotos/<uuid>/1920.webp`. */
export const RE_RUTA_FOTO = /^fotos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(960|1920)\.webp$/;

export function crearAlmacenFotosDesdeEntorno(fuente: Readonly<Record<string, string | undefined>> = process.env): AlmacenAdjuntos {
  const c = configAlmacen(fuente);
  if (c.tipo === "supabase") {
    return crearAlmacenSupabase({ url: c.url, clave: c.clave, bucket: BUCKET_SITIO, rutaValida: RE_RUTA_FOTO, tipoDe: detectarTipoFoto });
  }
  return crearAlmacenEnDisco(join(raizAdjuntos(fuente), CARPETA_SITIO), { rutaValida: RE_RUTA_FOTO });
}

/** Para los logs: qué almacén es, sin rutas de servidor ni URLs con claves. */
export function descripcionAlmacen(fuente: Readonly<Record<string, string | undefined>> = process.env): string {
  return configAlmacen(fuente).tipo;
}
