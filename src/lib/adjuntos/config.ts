/**
 * Qué almacén de adjuntos usa este despliegue (ADJUNTOS_ALMACEN) y si su
 * configuración sirve. Puro y sin módulos de Node: lo lee la validación del
 * arranque (src/lib/entorno.ts, que también importa el proxy), la página de
 * la ficha (para decirle al navegador cómo subir) y la fábrica (./fabrica.ts).
 *
 *   disco     (por defecto) el servidor municipal: ADJUNTOS_DIR, en producción
 *             obligatoria y absoluta (docs/despliegue.md).
 *   supabase  Supabase Storage, bucket privado `adjuntos`: SUPABASE_URL y
 *             SUPABASE_SECRET_KEY (docs/despliegue-vercel.md). En Vercel es
 *             la única opción: no hay disco persistente.
 */

type Fuente = Readonly<Record<string, string | undefined>>;

export type TipoAlmacen = "disco" | "supabase";

export type ConfigAlmacen = { tipo: "disco" } | { tipo: "supabase"; url: string; clave: string };

/** ¿Corre en Vercel? Vercel define VERCEL=1 en el build y en las funciones. */
export function enVercel(fuente: Fuente = process.env): boolean {
  return fuente.VERCEL?.trim() === "1";
}

/** El tipo pedido; lo que no es `supabase` es el disco (la validación avisa si es otra cosa). */
export function tipoDeAlmacen(fuente: Fuente = process.env): TipoAlmacen {
  return fuente.ADJUNTOS_ALMACEN?.trim().toLowerCase() === "supabase" ? "supabase" : "disco";
}

/**
 * Cómo sube el navegador: por la app (`app`, el Route Handler en streaming
 * hacia el disco) o directo al almacén con una URL firmada (`directa`).
 */
export function modoDeSubida(fuente: Fuente = process.env): "app" | "directa" {
  return tipoDeAlmacen(fuente) === "supabase" ? "directa" : "app";
}

/** @throws Error si falta lo que necesita (la validación del arranque ya lo avisó). */
export function configAlmacen(fuente: Fuente = process.env): ConfigAlmacen {
  if (tipoDeAlmacen(fuente) === "disco") return { tipo: "disco" };
  const url = fuente.SUPABASE_URL?.trim();
  const clave = fuente.SUPABASE_SECRET_KEY?.trim();
  if (!url || !clave) throw new Error("ADJUNTOS_ALMACEN=supabase: faltan SUPABASE_URL o SUPABASE_SECRET_KEY");
  return { tipo: "supabase", url, clave };
}

/** Absoluta en POSIX (`/var/…`) o en Windows (`C:\…`), sin node:path. */
function absoluta(ruta: string): boolean {
  return /^(\/|[A-Za-z]:[\\/])/.test(ruta);
}

/**
 * Los problemas de la configuración del almacén, nombrando la variable y la
 * regla, nunca el valor (la clave es un secreto y esto termina en un log).
 */
export function problemasAlmacen(fuente: Fuente, produccion: boolean): string[] {
  const problemas: string[] = [];
  const pedido = fuente.ADJUNTOS_ALMACEN?.trim().toLowerCase();
  if (pedido && pedido !== "disco" && pedido !== "supabase") {
    return ["ADJUNTOS_ALMACEN: tiene que ser disco o supabase"];
  }

  if (tipoDeAlmacen(fuente) === "disco") {
    if (produccion && enVercel(fuente)) {
      return ["ADJUNTOS_ALMACEN: en Vercel no hay disco persistente; tiene que ser supabase (docs/despliegue-vercel.md)"];
    }
    // Los adjuntos van a una carpeta fuera del webroot (sección 6, "Adjuntos").
    // En desarrollo hay un valor por defecto (./.data/adjuntos); en producción
    // se exige al arrancar y no en la primera subida.
    const dir = fuente.ADJUNTOS_DIR?.trim();
    if (produccion && !dir) {
      problemas.push("ADJUNTOS_DIR: falta (carpeta de los adjuntos, fuera del webroot, por ejemplo /var/lib/cementeria/adjuntos)");
    } else if (produccion && dir && !absoluta(dir)) {
      problemas.push("ADJUNTOS_DIR: en producción tiene que ser una ruta absoluta");
    }
    return problemas;
  }

  // Supabase Storage: ADJUNTOS_DIR no hace falta.
  const url = fuente.SUPABASE_URL?.trim();
  if (!url) {
    problemas.push("SUPABASE_URL: falta con ADJUNTOS_ALMACEN=supabase (https://<ref>.supabase.co)");
  } else {
    let u: URL | null = null;
    try {
      u = new URL(url);
    } catch {
      u = null;
    }
    if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) problemas.push("SUPABASE_URL: tiene que ser una URL http(s)");
    else if (produccion && u.protocol !== "https:") problemas.push("SUPABASE_URL: en producción tiene que ser https (la clave viaja en cada pedido)");
    else if (u.pathname !== "/" && u.pathname !== "") problemas.push("SUPABASE_URL: va solo el origen (https://<ref>.supabase.co), sin /storage/v1");
  }
  const clave = fuente.SUPABASE_SECRET_KEY?.trim();
  if (!clave) {
    problemas.push("SUPABASE_SECRET_KEY: falta con ADJUNTOS_ALMACEN=supabase (Settings → API Keys → Secret keys)");
  } else if (clave.startsWith("sb_publishable_")) {
    problemas.push("SUPABASE_SECRET_KEY: es la clave publicable (sb_publishable_…); hace falta una secreta (sb_secret_…)");
  } else if (!clave.startsWith("sb_secret_") && !/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(clave)) {
    problemas.push("SUPABASE_SECRET_KEY: no parece una clave secreta de Supabase (sb_secret_…)");
  }
  return problemas;
}
