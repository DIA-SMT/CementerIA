import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Un Supabase Storage falso, en memoria, para los tests del almacén
 * (src/lib/adjuntos/supabase.ts) y del flujo de dos fases. Imita los
 * endpoints que usa la app, con las respuestas de la API real
 * (supabase/storage; @supabase/storage-js StorageFileApi.ts):
 *
 *   POST   /storage/v1/object/{bucket}/{ruta}                  subir (409 si existe)
 *   GET    /storage/v1/object/{bucket}/{ruta}                  bajar (404 → 400 {statusCode:"404"} con `noEncontrado400`)
 *   POST   /storage/v1/object/upload/sign/{bucket}/{ruta}      → { url: "/object/upload/sign/{bucket}/{ruta}?token=…" }
 *   PUT    /storage/v1/object/upload/sign/{bucket}/{ruta}?token=…   la subida firmada (sin clave)
 *   POST   /storage/v1/object/move                             { bucketId, sourceKey, destinationKey }
 *   DELETE /storage/v1/object/{bucket}                         { prefixes } → los borrados
 *   POST   /storage/v1/object/list/{bucket}                    { prefix, limit, offset } → un nivel de "carpeta"
 *
 * Como el bucket real: tamaño máximo y tipos permitidos por Content-Type. Todo
 * lo que no es la subida firmada exige `apikey` igual a la clave.
 */

export interface ObjetoFalso {
  datos: Buffer;
  tipo: string;
  creado: Date;
}

export interface OpcionesStorageFalso {
  clave?: string;
  bucket?: string;
  limiteBytes?: number;
  tipos?: string[];
  /** Responder "no existe" como las versiones viejas: 400 con statusCode "404". */
  noEncontrado400?: boolean;
  /** No mandar Content-Length al bajar (chunked). */
  sinLargo?: boolean;
}

export interface StorageFalso {
  url: string;
  clave: string;
  bucket: string;
  objetos: Map<string, ObjetoFalso>;
  /** Los pedidos recibidos (método, ruta sin query y encabezados de autenticación). */
  pedidos: Array<{ metodo: string; ruta: string; apikey: string | null; authorization: string | null }>;
  /** Pone un objeto directamente (para simular lo que subió un navegador sin pasar por los límites). */
  poner(ruta: string, datos: Uint8Array, tipo?: string, creado?: Date): void;
  cerrar(): Promise<void>;
}

const BASE = "/storage/v1";

async function leerCuerpo(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  return Buffer.concat(partes);
}

function json(res: ServerResponse, status: number, cuerpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

export async function levantarStorageFalso(o: OpcionesStorageFalso = {}): Promise<StorageFalso> {
  const clave = o.clave ?? `sb_secret_${randomBytes(16).toString("hex")}`;
  const bucket = o.bucket ?? "adjuntos";
  const limite = o.limiteBytes ?? 10 * 1024 * 1024;
  const tipos = o.tipos ?? ["application/pdf", "image/jpeg", "image/png"];
  const objetos = new Map<string, ObjetoFalso>();
  const tokens = new Map<string, string>();
  const pedidos: StorageFalso["pedidos"] = [];

  const noExiste = (res: ServerResponse) =>
    o.noEncontrado400 ? json(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" }) : json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });

  function guardar(res: ServerResponse, ruta: string, datos: Buffer, tipo: string): void {
    if (objetos.has(ruta)) return json(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    if (datos.length > limite) return json(res, 400, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
    if (!tipos.includes(tipo)) return json(res, 400, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${tipo} is not supported` });
    objetos.set(ruta, { datos, tipo, creado: new Date() });
    json(res, 200, { Key: `${bucket}/${ruta}`, Id: randomUUID() });
  }

  async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = new URL(req.url ?? "/", "http://falso");
    const metodo = req.method ?? "GET";
    const ruta = decodeURIComponent(u.pathname);
    pedidos.push({ metodo, ruta, apikey: (req.headers.apikey as string | undefined) ?? null, authorization: req.headers.authorization ?? null });
    if (!ruta.startsWith(BASE)) return json(res, 404, { error: "not_found" });
    const r = ruta.slice(BASE.length);
    const deBucket = (prefijo: string) => (r.startsWith(`${prefijo}/${bucket}/`) ? r.slice(`${prefijo}/${bucket}/`.length) : null);

    // La subida con URL firmada: la hace el navegador, sin clave.
    const firmada = deBucket("/object/upload/sign");
    if (metodo === "PUT" && firmada !== null) {
      const token = u.searchParams.get("token");
      if (!token || tokens.get(token) !== firmada) return json(res, 400, { statusCode: "403", error: "Unauthorized", message: "invalid signature" });
      return guardar(res, firmada, await leerCuerpo(req), String(req.headers["content-type"] ?? ""));
    }

    if (req.headers.apikey !== clave) return json(res, 400, { statusCode: "403", error: "Unauthorized", message: "Invalid Compact JWS" });

    if (metodo === "POST" && firmada !== null) {
      await leerCuerpo(req);
      const token = randomBytes(24).toString("base64url");
      tokens.set(token, firmada);
      return json(res, 200, { url: `/object/upload/sign/${bucket}/${firmada}?token=${token}` });
    }
    if (metodo === "POST" && r === "/object/move") {
      const c = JSON.parse((await leerCuerpo(req)).toString("utf8")) as { bucketId: string; sourceKey: string; destinationKey: string };
      const obj = c.bucketId === bucket ? objetos.get(c.sourceKey) : undefined;
      if (!obj) return noExiste(res);
      if (objetos.has(c.destinationKey)) return json(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      objetos.delete(c.sourceKey);
      objetos.set(c.destinationKey, obj);
      return json(res, 200, { message: "Successfully moved" });
    }
    if (metodo === "DELETE" && r === `/object/${bucket}`) {
      const c = JSON.parse((await leerCuerpo(req)).toString("utf8")) as { prefixes: string[] };
      const borrados = c.prefixes.filter((p) => objetos.delete(p)).map((p) => ({ name: p, bucket_id: bucket }));
      return json(res, 200, borrados);
    }
    const lista = r === `/object/list/${bucket}`;
    if (metodo === "POST" && lista) {
      const c = JSON.parse((await leerCuerpo(req)).toString("utf8")) as { prefix: string; limit: number; offset: number };
      const prefijo = c.prefix ? `${c.prefix.replace(/\/+$/, "")}/` : "";
      const nombres = new Map<string, ObjetoFalso | null>();
      for (const [k, v] of objetos) {
        if (!k.startsWith(prefijo)) continue;
        const resto = k.slice(prefijo.length);
        const i = resto.indexOf("/");
        if (i < 0) nombres.set(resto, v);
        else nombres.set(resto.slice(0, i), null);
      }
      const items = [...nombres]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, v]) =>
          v
            ? { name, id: randomUUID(), created_at: v.creado.toISOString(), updated_at: v.creado.toISOString(), metadata: { size: v.datos.length, mimetype: v.tipo } }
            : { name, id: null, created_at: null, updated_at: null, metadata: null },
        );
      return json(res, 200, items.slice(c.offset, c.offset + c.limit));
    }
    const objeto = deBucket("/object");
    if (objeto !== null && metodo === "POST") {
      return guardar(res, objeto, await leerCuerpo(req), String(req.headers["content-type"] ?? ""));
    }
    if (objeto !== null && metodo === "GET") {
      const obj = objetos.get(objeto);
      if (!obj) return noExiste(res);
      res.writeHead(200, { "content-type": obj.tipo, ...(o.sinLargo ? {} : { "content-length": String(obj.datos.length) }) });
      // En dos pedazos, para que el lector reciba más de uno.
      const mitad = Math.floor(obj.datos.length / 2);
      res.write(obj.datos.subarray(0, mitad));
      res.end(obj.datos.subarray(mitad));
      return;
    }
    json(res, 404, { error: "ruta_desconocida" });
  }

  const servidor: Server = createServer((req, res) => {
    atender(req, res).catch((e: unknown) => json(res, 500, { error: String(e) }));
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    clave,
    bucket,
    objetos,
    pedidos,
    poner(ruta, datos, tipo = "application/pdf", creado = new Date()) {
      objetos.set(ruta, { datos: Buffer.from(datos), tipo, creado });
    },
    cerrar: () =>
      new Promise<void>((ok) => {
        servidor.closeAllConnections();
        servidor.close(() => ok());
      }),
  };
}
