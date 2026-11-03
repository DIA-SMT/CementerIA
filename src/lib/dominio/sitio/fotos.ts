import { randomUUID } from "node:crypto";
import { ArchivoMuyGrande, TemporalAusente, type AlmacenAdjuntos } from "@/lib/adjuntos/almacen";
import { FotoRechazada, MAXIMO_BYTES_FOTO, MAXIMO_FOTOS_ACTIVAS, MENSAJES_FOTO, type FotoProcesada } from "@/lib/imagenes/tipos";
import { ErrorDominio, limpiarMotivo } from "../expedientes/errores";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import type { DependenciasSitio } from "./admin";
import { urlFotoSitio } from "./imagenes";
import { EntradaEditarFoto, EntradaFotoSitio, leerEntradaSitio, RE_UUID } from "./validacion";

/**
 * Las fotos propias del sitio público (30/10/2026; docs/api-dominio.md,
 * sección 25.7): subir, corregir el texto alternativo y dar de baja. Mismo
 * permiso que el resto del sitio (`editar_sitio_publico`) y cada escritura con
 * `conActor()`: el trigger `auditar_cambio` la deja en auditoria.cambios.
 *
 * El archivo nunca se sirve como llegó: `procesar` (src/lib/imagenes/procesar.ts,
 * sharp) mira los magic bytes, decodifica, orienta, mide y re-codifica a dos
 * WebP sin metadatos. Se guardan solo esas dos versiones, en
 * `fotos/<id>/960.webp` y `fotos/<id>/1920.webp` del almacén de las fotos
 * (src/lib/adjuntos/fabrica.ts: el disco o el bucket privado `sitio-publico`),
 * ANTES de insertar la fila: hasta que la fila existe, nadie las nombra; si la
 * transacción falla, se borran.
 */

export interface DependenciasFotos {
  /** `crearAlmacenFotosDesdeEntorno()`. */
  almacen: AlmacenAdjuntos;
  /** `procesarFoto()` de src/lib/imagenes/procesar.ts. */
  procesar: (original: Uint8Array) => Promise<FotoProcesada>;
}

export interface ResultadoFoto {
  id: string;
  alt: string;
  /** La versión chica, para mostrarla enseguida. */
  src: string;
}

export interface UsoFoto {
  tipo: "cementerio" | "recorrido";
  id: number;
  nombre: string;
}

export interface FilaFoto {
  id: string;
  alt: string;
  credito: string | null;
  ancho: number;
  alto: number;
  bytes: number;
  /** La versión chica (960 px), para la miniatura y la vista previa. */
  src: string;
  subidaPor: string;
  creadoEn: Date;
  /** Dónde se usa: al darla de baja, esos quedan sin foto. */
  usos: UsoFoto[];
}

function dependencias(deps: DependenciasSitio): DependenciasFotos {
  if (!deps.fotos) throw new Error("El servicio del sitio no tiene almacén de fotos (DependenciasSitio.fotos)");
  return deps.fotos;
}

function limite(): ErrorDominio {
  return new ErrorDominio(
    "limite_alcanzado",
    `Ya hay ${MAXIMO_FOTOS_ACTIVAS} fotos activas: para subir otra, dá de baja alguna que no se use.`,
    [{ ruta: "archivo", mensaje: `Máximo ${MAXIMO_FOTOS_ACTIVAS} fotos activas` }],
  );
}

function invalida(mensaje: string): ErrorDominio {
  return new ErrorDominio("imagen_invalida", mensaje, [{ ruta: "archivo", mensaje }]);
}

function noExiste(): ErrorDominio {
  return new ErrorDominio("no_encontrado", "No existe esa foto: puede que otra persona la haya dado de baja. Recargá la página.");
}

function esUnico(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "P2002";
}

/** Un stream con los bytes de una versión (el almacén recibe streams, como con los adjuntos). */
function flujoDe(datos: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(datos);
      c.close();
    },
  });
}

/** Las rutas de las dos versiones de una foto en el almacén. */
export function rutasDeFoto(id: string): string[] {
  return [`fotos/${id}/960.webp`, `fotos/${id}/1920.webp`];
}

async function borrarVersiones(almacen: AlmacenAdjuntos, id: string): Promise<void> {
  for (const ruta of rutasDeFoto(id)) await almacen.borrar(ruta).catch(() => undefined);
}

/** Lo que se controla antes de leer o procesar el archivo: permiso, texto y lugar. */
async function controlesPrevios(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, bytes: number | null) {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const datos = leerEntradaSitio(EntradaFotoSitio, entrada);
  if (bytes !== null && bytes > MAXIMO_BYTES_FOTO) throw invalida(MENSAJES_FOTO.grande);
  if ((await deps.leer.sitioFoto.count({ where: { activa: true } })) >= MAXIMO_FOTOS_ACTIVAS) throw limite();
  return datos;
}

/**
 * Sube una foto: la procesa, guarda las dos versiones y la registra. El
 * original llega entero en memoria (15 MB como máximo: lo controla quien lo
 * lee, el Route Handler o `confirmarSubidaFoto`).
 *
 * @throws ErrorDominio `validacion` (el texto), `imagen_invalida`, `ya_existe`
 *   (la misma foto ya está activa), `limite_alcanzado`
 */
export async function subirFotoSitio(deps: DependenciasSitio, usuario: UsuarioPermisos, original: Uint8Array, entrada: unknown, motivo: string | null = null): Promise<ResultadoFoto> {
  const datos = await controlesPrevios(deps, usuario, entrada, original.byteLength);
  const { almacen, procesar } = dependencias(deps);

  let p: FotoProcesada;
  try {
    p = await procesar(original);
  } catch (e) {
    if (e instanceof FotoRechazada) throw invalida(e.message);
    throw e;
  }
  const repetida = await deps.leer.sitioFoto.findFirst({ where: { sha256: p.sha256, activa: true }, select: { alt: true } });
  if (repetida) throw new ErrorDominio("ya_existe", `Esa foto ya está subida («${repetida.alt}»).`, [{ ruta: "archivo", mensaje: "Ya está subida" }]);

  const id = randomUUID();
  try {
    for (const v of p.versiones) {
      const archivo = await almacen.recibir(flujoDe(v.datos), MAXIMO_BYTES_FOTO);
      await almacen.confirmar(archivo, `fotos/${id}/${v.nominal}.webp`);
    }
    await deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
      // Otra vez adentro: dos personas subiendo a la vez.
      if ((await tx.sitioFoto.count({ where: { activa: true } })) >= MAXIMO_FOTOS_ACTIVAS) throw limite();
      await tx.sitioFoto.create({
        data: { id, ruta: `fotos/${id}`, alt: datos.alt, credito: datos.credito, ancho: p.ancho, alto: p.alto, bytes: p.bytes, sha256: p.sha256, subidaPor: usuario.id },
      });
    });
  } catch (e) {
    await borrarVersiones(almacen, id);
    if (esUnico(e)) throw new ErrorDominio("ya_existe", "Esa foto ya está subida.", [{ ruta: "archivo", mensaje: "Ya está subida" }]);
    throw e;
  }
  return { id, alt: datos.alt, src: urlFotoSitio({ id, sha256: p.sha256 }, 960) };
}

/**
 * Primera mitad de la subida directa (Supabase Storage, Vercel): los mismos
 * controles y una URL firmada para que el navegador suba el original a
 * `tmp/<uuid>` del bucket `sitio-publico`.
 *
 * @throws ErrorDominio `validacion` (el texto, o un almacén sin subida directa), `imagen_invalida` (más de 15 MB), `limite_alcanzado`
 */
export async function autorizarSubidaFoto(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, bytes: number | null) {
  await controlesPrevios(deps, usuario, entrada, bytes);
  const { almacen } = dependencias(deps);
  if (!almacen.prepararSubidaDirecta) {
    throw new ErrorDominio("validacion", "Este servidor recibe las fotos a través de la app: recargá la página y probá de nuevo.");
  }
  return almacen.prepararSubidaDirecta();
}

/**
 * Segunda mitad: lee el original que subió el navegador (15 MB como máximo),
 * lo procesa y lo registra como `subirFotoSitio`. El temporal se borra
 * siempre: el original no se guarda.
 */
export async function confirmarSubidaFoto(deps: DependenciasSitio, usuario: UsuarioPermisos, idTemporal: string, entrada: unknown, motivo: string | null = null): Promise<ResultadoFoto> {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const { almacen } = dependencias(deps);
  if (!almacen.leerTemporal) throw new ErrorDominio("validacion", "Este servidor recibe las fotos a través de la app: recargá la página y probá de nuevo.");
  try {
    let original: Uint8Array;
    try {
      original = await almacen.leerTemporal(idTemporal, MAXIMO_BYTES_FOTO);
    } catch (e) {
      if (e instanceof ArchivoMuyGrande) throw invalida(MENSAJES_FOTO.grande);
      if (e instanceof TemporalAusente) throw new ErrorDominio("validacion", "La foto no llegó al almacenamiento: elegila de nuevo y volvé a subirla.");
      throw e;
    }
    return await subirFotoSitio(deps, usuario, original, entrada, motivo);
  } finally {
    await almacen.descartar({ id: idTemporal, bytes: 0, sha256: "", cabecera: new Uint8Array() }).catch(() => undefined);
  }
}

/**
 * Corrige el texto alternativo o el crédito. Sin cambios no escribe.
 *
 * @throws ErrorDominio `validacion`, `no_encontrado`
 */
export async function guardarFotoSitio(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null) {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const { id, ...datos } = leerEntradaSitio(EntradaEditarFoto, entrada);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const actual = await tx.sitioFoto.findUnique({ where: { id } });
    if (!actual || !actual.activa) throw noExiste();
    if (actual.alt === datos.alt && actual.credito === datos.credito) return { id, repetido: true };
    await tx.sitioFoto.update({ where: { id }, data: datos });
    return { id, repetido: false };
  });
}

/** Dónde se usa una foto (cementerios y recorridos, activos o no). */
async function usosDe(tx: Pick<DependenciasSitio["leer"], "sitioCementerio" | "sitioRecorrido">, id: string): Promise<UsoFoto[]> {
  const cementerios = await tx.sitioCementerio.findMany({ where: { fotoId: id }, select: { cementerioId: true, cementerio: { select: { nombre: true } } }, orderBy: { cementerioId: "asc" } });
  const recorridos = await tx.sitioRecorrido.findMany({ where: { fotoId: id }, select: { id: true, nombre: true }, orderBy: { id: "asc" } });
  return [
    ...cementerios.map((c) => ({ tipo: "cementerio" as const, id: c.cementerioId, nombre: c.cementerio.nombre })),
    ...recorridos.map((r) => ({ tipo: "recorrido" as const, id: r.id, nombre: r.nombre })),
  ];
}

export function textoUsos(usos: readonly UsoFoto[]): string {
  return usos.map((u) => (u.tipo === "cementerio" ? u.nombre : `el recorrido «${u.nombre}»`)).join(", ");
}

/**
 * Da de baja una foto (no se borra: deja de servirse y de ofrecerse). Si un
 * cementerio o un recorrido la usa, hace falta `confirmarUso`: en la misma
 * transacción quedan sin foto (cada cambio, en la auditoría) y después la baja.
 * Las dos versiones quedan en el almacén (la fila las nombra); la ruta
 * pública responde 404.
 *
 * @throws ErrorDominio `en_uso` (sin `confirmarUso`), `no_encontrado`
 */
export async function bajaFotoSitio(deps: DependenciasSitio, usuario: UsuarioPermisos, entrada: { id: string; confirmarUso?: boolean }, motivo: string | null = null) {
  exigirPermiso("editar_sitio_publico", null, usuario);
  const id = String(entrada.id ?? "").toLowerCase();
  if (!RE_UUID.test(id)) throw noExiste();
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const actual = await tx.sitioFoto.findUnique({ where: { id } });
    if (!actual) throw noExiste();
    if (!actual.activa) return { id, repetido: true, sinFoto: [] as UsoFoto[] };
    const usos = await usosDe(tx, id);
    if (usos.length > 0 && entrada.confirmarUso !== true) {
      throw new ErrorDominio("en_uso", `La foto está en uso en ${textoUsos(usos)}. Si la das de baja, quedan sin foto.`);
    }
    if (usos.length > 0) {
      await tx.sitioCementerio.updateMany({ where: { fotoId: id }, data: { fotoId: null } });
      await tx.sitioRecorrido.updateMany({ where: { fotoId: id }, data: { fotoId: null } });
    }
    await tx.sitioFoto.update({ where: { id }, data: { activa: false } });
    return { id, repetido: false, sinFoto: usos };
  });
}

/** Las fotos activas, de la más nueva a la más vieja, con dónde se usa cada una. */
export async function fotosSitioAdmin(deps: DependenciasSitio): Promise<{ fotos: FilaFoto[]; dadasDeBaja: number }> {
  const l = deps.leer;
  const fotos = await l.sitioFoto.findMany({
    where: { activa: true },
    orderBy: [{ creadoEn: "desc" }, { id: "asc" }],
    include: {
      subidor: { select: { nombre: true, apellido: true } },
      cementerios: { select: { cementerioId: true, cementerio: { select: { nombre: true } } }, orderBy: { cementerioId: "asc" } },
      recorridos: { select: { id: true, nombre: true }, orderBy: { id: "asc" } },
    },
  });
  const dadasDeBaja = await l.sitioFoto.count({ where: { activa: false } });
  return {
    fotos: fotos.map((f) => ({
      id: f.id,
      alt: f.alt,
      credito: f.credito,
      ancho: f.ancho,
      alto: f.alto,
      bytes: f.bytes,
      src: urlFotoSitio(f, 960),
      subidaPor: `${f.subidor.nombre} ${f.subidor.apellido}`,
      creadoEn: f.creadoEn,
      usos: [
        ...f.cementerios.map((c) => ({ tipo: "cementerio" as const, id: c.cementerioId, nombre: c.cementerio.nombre })),
        ...f.recorridos.map((r) => ({ tipo: "recorrido" as const, id: r.id, nombre: r.nombre })),
      ],
    })),
    dadasDeBaja,
  };
}
