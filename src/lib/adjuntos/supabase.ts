import { randomUUID } from "node:crypto";
import { ArchivoMuyGrande, crearMedidor, RE_ID, RE_RUTA, TemporalAusente, type AlmacenAdjuntos, type ArchivoRecibido } from "./almacen";
import { detectarTipo } from "./tipos";

/**
 * Los adjuntos en Supabase Storage (ADJUNTOS_ALMACEN=supabase), para el
 * despliegue en Vercel, donde no hay disco persistente
 * (docs/despliegue-vercel.md). Misma interfaz que el disco
 * (./almacen.ts) y mismo ciclo: `tmp/<uuid>` → movimiento → `AAAA/MM/<uuid>`.
 *
 * Sin dependencias: la API REST de Storage con `fetch`, como la usa
 * `@supabase/storage-js` (StorageFileApi.ts):
 *
 *   POST   /storage/v1/object/{bucket}/{ruta}              subir (x-upsert: false)
 *   GET    /storage/v1/object/{bucket}/{ruta}              bajar (bucket privado: con la clave)
 *   POST   /storage/v1/object/upload/sign/{bucket}/{ruta}  URL firmada de subida → { url: "/object/upload/sign/…?token=…" }
 *   PUT    /storage/v1/object/upload/sign/{bucket}/{ruta}?token=…  la subida con esa URL (la hace el navegador)
 *   POST   /storage/v1/object/move                         { bucketId, sourceKey, destinationKey }
 *   DELETE /storage/v1/object/{bucket}                     { prefixes: [ruta, …] } (lo que no existe se ignora)
 *   POST   /storage/v1/object/list/{bucket}                { prefix, limit, offset, sortBy }
 *
 * La clave es SUPABASE_SECRET_KEY (`sb_secret_…`): solo existe en el servidor
 * y nunca va a un log ni a un mensaje de error. Las claves nuevas no son JWT y
 * Supabase pide mandarlas solo en `apikey`, no en `Authorization: Bearer`
 * (supabase.com/docs/guides/api/api-keys); una clave heredada `service_role`
 * (un JWT) va, como siempre, en los dos.
 *
 * El bucket `adjuntos` es PRIVADO y sin políticas para anon ni authenticated
 * (supabase/sql/45_storage.sql): nadie lo lee sin la clave del servidor, y la
 * lectura pasa siempre por la app (/adjuntos/[movimientoId]), que controla
 * permisos, pide el motivo y audita.
 */

export const BUCKET_ADJUNTOS = "adjuntos";
const TMP = "tmp";

/** Cuántos objetos pide el barrido por página y cuántos borra por llamada. */
const LIMITE_LISTA = 1000;
const LIMITE_BORRADO = 100;

export interface OpcionesSupabase {
  /** SUPABASE_URL: `https://<ref>.supabase.co`. */
  url: string;
  /** SUPABASE_SECRET_KEY. */
  clave: string;
  bucket?: string;
  /** Para los tests. */
  fetch?: typeof fetch;
  /** Límite de las operaciones que no transfieren el archivo (firmar, mover, borrar, listar). */
  timeoutMs?: number;
}

/** Una respuesta de Storage que no es la esperada. El mensaje no lleva la clave ni la URL firmada. */
export class ErrorStorage extends Error {
  constructor(
    readonly operacion: string,
    readonly status: number,
    readonly codigo: string | null,
  ) {
    super(`Supabase Storage: ${operacion} respondió ${status}${codigo ? ` (${codigo})` : ""}`);
    this.name = "ErrorStorage";
  }
}

/** ¿Es un JWT (una clave heredada `anon`/`service_role`) y no una clave nueva `sb_…`? */
function esJwt(clave: string): boolean {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(clave);
}

/** Los encabezados de autenticación del servidor ante Storage. */
export function encabezadosClave(clave: string): Record<string, string> {
  return esJwt(clave) ? { apikey: clave, Authorization: `Bearer ${clave}` } : { apikey: clave };
}

interface CuerpoError {
  statusCode?: string | number;
  error?: string;
  code?: string;
  message?: string;
}

async function cuerpoError(r: Response): Promise<CuerpoError> {
  try {
    const j: unknown = await r.json();
    return typeof j === "object" && j !== null ? (j as CuerpoError) : {};
  } catch {
    return {};
  }
}

/**
 * ¿"No existe"? Storage contesta 404, o (versiones anteriores) 400 con
 * `{ statusCode: "404", error: "not_found" }`.
 */
function esNoEncontrado(status: number, c: CuerpoError): boolean {
  return status === 404 || String(c.statusCode ?? "") === "404" || c.error === "not_found" || c.code === "NoSuchKey";
}

/** Segmentos de una ruta de objeto, codificados para la URL. */
function enUrl(ruta: string): string {
  return ruta.split("/").map(encodeURIComponent).join("/");
}

function temporal(id: string): string {
  if (!RE_ID.test(id)) throw new Error("Id de adjunto inválido");
  return `${TMP}/${id}`;
}

function definitivo(ruta: string): string {
  // La ruta sale de la base, pero igual se controla: nunca fuera de AAAA/MM/<uuid>.
  if (!RE_RUTA.test(ruta)) throw new Error("Ruta de adjunto inválida");
  return ruta;
}

/** Lee `contenido` con el medidor; si se pasa del máximo, cancela el resto. */
async function medir(contenido: ReadableStream<Uint8Array>, maxBytes: number, alPedazo?: (parte: Uint8Array) => void) {
  const medidor = crearMedidor(maxBytes);
  const lector = contenido.getReader();
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      medidor.agregar(value);
      alPedazo?.(value);
    }
  } catch (error) {
    await lector.cancel().catch(() => undefined);
    throw error;
  } finally {
    lector.releaseLock();
  }
  return medidor;
}

export function crearAlmacenSupabase(o: OpcionesSupabase): AlmacenAdjuntos {
  const base = `${o.url.replace(/\/+$/, "")}/storage/v1`;
  const bucket = o.bucket ?? BUCKET_ADJUNTOS;
  const pedir = o.fetch ?? globalThis.fetch;
  const timeoutMs = o.timeoutMs ?? 30_000;
  const clave = encabezadosClave(o.clave);

  /** Una operación de control (JSON de ida y vuelta, con límite de tiempo). */
  async function control(metodo: string, ruta: string, cuerpo?: unknown): Promise<Response> {
    return pedir(`${base}${ruta}`, {
      method: metodo,
      headers: { ...clave, ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  }

  async function exigirOk(operacion: string, r: Response): Promise<Response> {
    if (r.ok) return r;
    const c = await cuerpoError(r);
    throw new ErrorStorage(operacion, r.status, c.error ?? c.code ?? null);
  }

  async function borrarObjetos(rutas: string[]): Promise<number> {
    let borrados = 0;
    for (let i = 0; i < rutas.length; i += LIMITE_BORRADO) {
      const r = await exigirOk("borrar", await control("DELETE", `/object/${encodeURIComponent(bucket)}`, { prefixes: rutas.slice(i, i + LIMITE_BORRADO) }));
      const lista: unknown = await r.json().catch(() => []);
      borrados += Array.isArray(lista) ? lista.length : 0;
    }
    return borrados;
  }

  /**
   * Baja un objeto en streaming. `accept-encoding: identity`: que el
   * Content-Length sea el del archivo y no el de una versión comprimida.
   */
  async function bajar(ruta: string): Promise<Response | null> {
    const r = await pedir(`${base}/object/${encodeURIComponent(bucket)}/${enUrl(ruta)}`, {
      headers: { ...clave, "Accept-Encoding": "identity" },
      cache: "no-store",
    });
    if (r.ok) return r;
    const c = await cuerpoError(r);
    if (esNoEncontrado(r.status, c)) return null;
    throw new ErrorStorage("bajar", r.status, c.error ?? c.code ?? null);
  }

  function largo(r: Response): number | null {
    const n = Number(r.headers.get("content-length") ?? "");
    return r.headers.has("content-length") && Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  return {
    async recibir(contenido, maxBytes) {
      // Se junta en memoria (10 MB como máximo) para subirlo con su largo y su
      // tipo: el bucket solo acepta PDF, JPG y PNG por Content-Type. Este
      // camino es el del Route Handler de siempre; en Vercel el navegador
      // sube directo (prepararSubidaDirecta).
      const id = randomUUID();
      const partes: Uint8Array[] = [];
      const medidor = await medir(contenido, maxBytes, (p) => partes.push(p));
      const archivo = medidor.resultado(id);
      const tipo = detectarTipo(archivo.cabecera);
      // Vacío o de otro tipo: el dominio lo rechaza (y llama a descartar, que no falla).
      if (archivo.bytes === 0 || tipo === null) return archivo;
      const r = await pedir(`${base}/object/${encodeURIComponent(bucket)}/${enUrl(temporal(id))}`, {
        method: "POST",
        headers: { ...clave, "Content-Type": tipo.mime, "x-upsert": "false" },
        body: Buffer.concat(partes),
        cache: "no-store",
      });
      await exigirOk("subir", r);
      return archivo;
    },

    async confirmar(archivo, ruta) {
      await exigirOk(
        "mover",
        await control("POST", "/object/move", { bucketId: bucket, sourceKey: temporal(archivo.id), destinationKey: definitivo(ruta) }),
      );
    },

    async descartar(archivo) {
      await borrarObjetos([temporal(archivo.id)]);
    },

    async abrir(ruta) {
      const r = await bajar(definitivo(ruta));
      if (!r || !r.body) throw new Error("El adjunto no está en el almacenamiento");
      return { contenido: r.body as ReadableStream<Uint8Array>, bytes: largo(r) };
    },

    async borrar(ruta) {
      await borrarObjetos([definitivo(ruta)]);
    },

    async barrerTemporales(antesDe) {
      const viejos: string[] = [];
      for (let offset = 0; ; offset += LIMITE_LISTA) {
        const r = await exigirOk(
          "listar",
          await control("POST", `/object/list/${encodeURIComponent(bucket)}`, {
            prefix: TMP,
            limit: LIMITE_LISTA,
            offset,
            sortBy: { column: "created_at", order: "asc" },
          }),
        );
        const items: unknown = await r.json();
        if (!Array.isArray(items)) throw new ErrorStorage("listar", r.status, "respuesta_inesperada");
        for (const it of items as Array<{ name?: unknown; id?: unknown; created_at?: unknown; updated_at?: unknown }>) {
          // Las "carpetas" vienen con id null; solo cuentan los temporales con nombre de UUID.
          if (typeof it.name !== "string" || !RE_ID.test(it.name) || it.id === null) continue;
          const fecha = Date.parse(String(it.created_at ?? it.updated_at ?? ""));
          if (Number.isFinite(fecha) && fecha < antesDe.getTime()) viejos.push(temporal(it.name));
        }
        if (items.length < LIMITE_LISTA) break;
      }
      if (viejos.length === 0) return 0;
      await borrarObjetos(viejos);
      return viejos.length;
    },

    async prepararSubidaDirecta() {
      const id = randomUUID();
      // Sin x-upsert: con esa URL se puede crear tmp/<id>, nunca pisar un objeto existente.
      const r = await exigirOk("firmar", await control("POST", `/object/upload/sign/${encodeURIComponent(bucket)}/${enUrl(temporal(id))}`, {}));
      const datos = (await r.json().catch(() => ({}))) as { url?: unknown };
      if (typeof datos.url !== "string" || !datos.url.startsWith("/")) throw new ErrorStorage("firmar", r.status, "sin_url");
      const url = new URL(`${base}${datos.url}`);
      if (!url.searchParams.get("token")) throw new ErrorStorage("firmar", r.status, "sin_token");
      return { id, url: url.toString() };
    },

    async inspeccionarTemporal(id, maxBytes) {
      const ruta = temporal(id);
      const r = await bajar(ruta);
      if (!r || !r.body) throw new TemporalAusente();
      const descartarlo = () => borrarObjetos([ruta]).catch(() => 0);
      const n = largo(r);
      if (n !== null && n > maxBytes) {
        await r.body.cancel().catch(() => undefined);
        await descartarlo();
        throw new ArchivoMuyGrande(maxBytes);
      }
      let archivo: ArchivoRecibido;
      try {
        archivo = (await medir(r.body as ReadableStream<Uint8Array>, maxBytes)).resultado(id);
      } catch (error) {
        if (error instanceof ArchivoMuyGrande) await descartarlo();
        throw error;
      }
      return archivo;
    },
  };
}
