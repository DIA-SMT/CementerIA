import { ArchivoMuyGrande, rutaParaAdjunto, type AlmacenAdjuntos, type ArchivoRecibido } from "@/lib/adjuntos/almacen";
import { detectarTipo, esHeic, limpiarNombreArchivo, MAXIMO_BYTES_ADJUNTO, type MimeAdjunto } from "@/lib/adjuntos/tipos";
import { log, resumenError } from "@/lib/log";
import { evaluarPermiso, exigirPermiso, PermisoDenegado, type UsuarioPermisos } from "../permisos";
import { exigirNumero, permisosDelExpediente, registrarAcceso, type OpcionesAcceso } from "./acceso";
import { validarComando } from "./alta";
import { leerDefinicion } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, errorValidacion, estadoNoAdmite, exigirMotivo, limpiarMotivo, noEncontrado } from "./errores";
import type { ItemsExpediente } from "./items";
import { leerItems } from "./items";
import { ejecutarAccion, idItem, recepcionImplicita } from "./operacion";

/**
 * Adjuntos (docs/propuesta-mvp.md, sección 6, "Adjuntos"; 3.2 y decisión 13).
 *
 * **Subida** (`subirAdjunto`): la llama el Route Handler
 * `POST /api/expedientes/[numero]/adjuntos` con `request.body` (sin
 * bufferear) y los metadatos. En orden:
 *
 * 1. Antes de leer el cuerpo: el comando ya usado (devuelve lo de entonces y
 *    cancela el cuerpo), el expediente, el estado, el permiso `adjuntar` y el
 *    documento. Así no se recibe un archivo que después se rechaza por algo que
 *    ya se sabía.
 * 2. El cuerpo, en streaming a `tmp/<uuid>` con sha256 al vuelo y fsync, con
 *    un máximo de 10 MB (si pasa, corta y borra).
 * 3. El tipo por magic bytes: PDF, JPG o PNG. Una foto HEIC se rechaza con
 *    "Subilo como JPG". Un archivo vacío, también.
 * 4. En `conActor()`: idempotencia, FOR UPDATE, versión, estado, permiso,
 *    recepción implícita, el movimiento `adjunto` con
 *    `{nombre, mime, bytes, sha256, documento, ruta}` e `items` (el adjunto
 *    vigente y, si es de un documento, en su lista). `version + 1`.
 * 5. Hecho el commit, el rename a `AAAA/MM/<uuid>`. Si la transacción falla,
 *    se borra el temporal.
 *
 * Adjuntar no marca el documento como presentado: eso es `marcarDocumento`.
 *
 * **Lectura** (`leerAdjunto`): la llama el Route Handler
 * `/adjuntos/[movimientoId]` (`?descargar=1` para bajarlo). Exige ver los
 * datos completos (3.2): quien no trabaja el expediente tiene que dar un
 * motivo, como en "Ver datos completos". Registra `ver_adjunto` o
 * `descargar_adjunto` en `auditoria.accesos`. Un adjunto retirado (semana 4)
 * no se sirve.
 */

export interface MetadatosAdjunto {
  /** El nombre del archivo como lo eligió el usuario (se limpia; en disco va con un UUID). */
  nombre: string;
  /** Clave del documento de la plantilla al que pertenece, o null (adjunto suelto). */
  documento: string | null;
}

export interface ResultadoAdjunto {
  numero: string;
  version: number;
  repetido: boolean;
  /** El id del movimiento `adjunto`: es el id del adjunto (`/adjuntos/[movimientoId]`). */
  movimientoId: string;
  documento: string | null;
  nombre: string;
  mime: string;
  bytes: number;
  sha256: string;
  recepcionImplicita: boolean;
}

function exigirAlmacen(deps: DependenciasExpedientes): AlmacenAdjuntos {
  if (!deps.almacen) throw new Error("Falta el almacenamiento de adjuntos en las dependencias del dominio");
  return deps.almacen;
}

interface DatosMovimientoAdjunto {
  nombre: string;
  mime: string;
  bytes: number;
  sha256: string;
  documento: string | null;
  ruta: string;
}

function datosAdjunto(valor: unknown): DatosMovimientoAdjunto {
  const d = (valor ?? {}) as Partial<DatosMovimientoAdjunto>;
  return {
    nombre: String(d.nombre ?? "archivo"),
    mime: String(d.mime ?? "application/octet-stream"),
    bytes: Number(d.bytes ?? 0),
    sha256: String(d.sha256 ?? ""),
    documento: typeof d.documento === "string" ? d.documento : null,
    ruta: String(d.ruta ?? ""),
  };
}

async function repetidoDesde(
  lector: Pick<DependenciasExpedientes["leer"], "expediente" | "movimiento">,
  expedienteId: bigint,
  movimientoId: bigint,
): Promise<ResultadoAdjunto> {
  const e = await lector.expediente.findUniqueOrThrow({ where: { id: expedienteId }, select: { numeroInterno: true, version: true } });
  const m = await lector.movimiento.findUniqueOrThrow({ where: { id: movimientoId }, select: { datos: true } });
  const d = datosAdjunto(m.datos);
  return {
    numero: e.numeroInterno,
    version: e.version,
    repetido: true,
    movimientoId: movimientoId.toString(),
    documento: d.documento,
    nombre: d.nombre,
    mime: d.mime,
    bytes: d.bytes,
    sha256: d.sha256,
    recepcionImplicita: false,
  };
}

/**
 * Sube un adjunto. Ver el comentario del módulo.
 *
 * @param contenido el cuerpo del request (`request.body`), sin leer.
 * @param versionVista la `version` que el usuario tenía en pantalla.
 * @param comandoId UUID generado por el formulario al abrirse.
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `conflicto_version`, `estado_no_admite`, `validacion` (documento),
 *   `adjunto_invalido` (tipo, vacío, HEIC), `adjunto_muy_grande`
 */
export async function subirAdjunto(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  contenido: ReadableStream<Uint8Array>,
  metadatos: MetadatosAdjunto,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoAdjunto> {
  const almacen = exigirAlmacen(deps);
  const ahora = deps.ahora?.() ?? new Date();
  const nombre = limpiarNombreArchivo(metadatos.nombre);
  const documento = metadatos.documento === null || metadatos.documento.trim() === "" ? null : metadatos.documento.trim();

  // 1. Lo que se puede saber sin leer el cuerpo.
  let previo: ResultadoAdjunto | null;
  try {
    previo = await controlesPrevios(deps, usuario, numero, comandoId, documento);
  } catch (error) {
    await contenido.cancel().catch(() => undefined);
    throw error;
  }
  if (previo) {
    await contenido.cancel().catch(() => undefined);
    return previo;
  }

  // 2 y 3. El archivo, a tmp/, y su tipo.
  let archivo: ArchivoRecibido;
  try {
    archivo = await almacen.recibir(contenido, MAXIMO_BYTES_ADJUNTO);
  } catch (error) {
    if (error instanceof ArchivoMuyGrande) {
      throw new ErrorDominio("adjunto_muy_grande", "El archivo supera los 10 MB", [{ ruta: "archivo", mensaje: "Máximo 10 MB" }]);
    }
    throw error;
  }
  const tipo = detectarTipo(archivo.cabecera);
  if (archivo.bytes === 0 || tipo === null) {
    await almacen.descartar(archivo);
    const mensaje = archivo.bytes === 0 ? "El archivo está vacío" : esHeic(archivo.cabecera) ? "Subilo como JPG" : "Solo se admiten PDF, JPG o PNG";
    throw new ErrorDominio("adjunto_invalido", mensaje, [{ ruta: "archivo", mensaje }]);
  }
  const ruta = rutaParaAdjunto(ahora, archivo.id);

  // 4. El movimiento.
  let resultado: ResultadoAdjunto;
  try {
    resultado = await registrarAdjunto(deps, usuario, numero, { archivo, mime: tipo.mime, nombre, documento, ruta }, versionVista, comandoId);
  } catch (error) {
    await almacen.descartar(archivo);
    throw error;
  }
  // Otro request con el mismo comando ganó la carrera: su archivo es el que vale.
  if (resultado.repetido) {
    await almacen.descartar(archivo);
    return resultado;
  }

  // 5. Recién con el commit hecho, el archivo va a su lugar.
  try {
    await almacen.confirmar(archivo, ruta);
  } catch (error) {
    // El movimiento ya está y el archivo quedó en tmp/: hay que moverlo a mano
    // antes del barrido de 24 h. Es un problema del disco, no del usuario.
    log.error("adjunto.confirmar_fallo", { movimiento: resultado.movimientoId, temporal: archivo.id, ruta, ...resumenError(error) });
    throw error;
  }
  return resultado;
}

async function controlesPrevios(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  comandoId: string,
  documento: string | null,
): Promise<ResultadoAdjunto | null> {
  const comando = validarComando(comandoId);
  const numeroInterno = exigirNumero(numero);
  const exp = await deps.leer.expediente.findUnique({
    where: { numeroInterno },
    include: { plantilla: { select: { codigo: true, version: true, definicion: true } } },
  });
  if (!exp) throw noEncontrado(numeroInterno);
  const previo = await deps.leer.movimiento.findUnique({
    where: { expedienteId_comandoId_tipo: { expedienteId: exp.id, comandoId: comando, tipo: "adjunto" } },
    select: { id: true },
  });
  if (previo) return repetidoDesde(deps.leer, exp.id, previo.id);
  if (exp.estado === "archivado" || exp.estado === "anulado") throw estadoNoAdmite(exp.estado, "adjuntar");
  exigirPermiso("adjuntar", await permisosDelExpediente(deps.leer, exp), usuario);
  const def = leerDefinicion(exp.plantilla.definicion, exp.plantilla.codigo, exp.plantilla.version);
  validarDocumento(def.documentos, documento);
  return null;
}

function validarDocumento(documentos: ReadonlyArray<{ clave: string; adjunto: string }>, documento: string | null): void {
  if (documento === null) return;
  const d = documentos.find((x) => x.clave === documento);
  if (!d) throw errorValidacion([{ ruta: "documento", mensaje: "No existe ese documento en la plantilla" }], "Documento desconocido");
  // `adjunto: no` es una decisión de la plantilla (por ejemplo, las actas de
  // defunción no se escanean por defecto: sección 6, Ley 25.326).
  if (d.adjunto === "no") throw errorValidacion([{ ruta: "documento", mensaje: "Este documento no se adjunta" }], "Este documento no lleva archivo");
}

interface Registro {
  archivo: ArchivoRecibido;
  mime: MimeAdjunto;
  nombre: string;
  documento: string | null;
  ruta: string;
}

function registrarAdjunto(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  r: Registro,
  versionVista: number,
  comandoId: string,
): Promise<ResultadoAdjunto> {
  return ejecutarAccion<ResultadoAdjunto>(
    deps,
    usuario,
    { numero, comandoId, tipo: "adjunto", motivo: null, versionVista, repetido: (tx, id, mov) => repetidoDesde(tx, id, mov) },
    async (ctx) => {
      const { tx, exp } = ctx;
      if (exp.estado === "archivado" || exp.estado === "anulado") throw estadoNoAdmite(exp.estado, "adjuntar");
      exigirPermiso("adjuntar", ctx.permisos, usuario);
      validarDocumento(ctx.def.documentos, r.documento);

      const recepcion = await recepcionImplicita(ctx, usuario);
      const m = await tx.movimiento.create({
        data: {
          expedienteId: exp.id,
          tipo: "adjunto",
          fechaEfectiva: ctx.ahora,
          precisionFecha: "minuto",
          usuarioId: usuario.id,
          datos: { nombre: r.nombre, mime: r.mime, bytes: r.archivo.bytes, sha256: r.archivo.sha256, documento: r.documento, ruta: r.ruta },
          comandoId: ctx.comando,
        },
        select: { id: true },
      });
      const id = idItem(m.id);
      const items: ItemsExpediente = {
        ...ctx.items,
        adjuntos: { ...ctx.items.adjuntos, [String(id)]: { documento: r.documento, vigente: true } },
      };
      if (r.documento !== null) {
        const doc = ctx.items.documentos[r.documento];
        items.documentos = {
          ...ctx.items.documentos,
          [r.documento]: doc ? { ...doc, adjuntos: [...doc.adjuntos, id] } : { estado: "pendiente", obs: null, mov: null, adjuntos: [id] },
        };
      }
      const actualizado = await tx.expediente.update({
        where: { id: exp.id },
        data: { items, ...(recepcion ? { recibidoEn: recepcion.recibidoEn } : {}), version: { increment: 1 } },
        select: { version: true },
      });
      return {
        numero: exp.numeroInterno,
        version: actualizado.version,
        repetido: false,
        movimientoId: m.id.toString(),
        documento: r.documento,
        nombre: r.nombre,
        mime: r.mime,
        bytes: r.archivo.bytes,
        sha256: r.archivo.sha256,
        recepcionImplicita: recepcion !== null,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface OpcionesLecturaAdjunto extends OpcionesAcceso {
  /** `?descargar=1`: `Content-Disposition: attachment` y registra `descargar_adjunto`. */
  descargar?: boolean;
  /** Para quien no trabaja el expediente (3.2): el motivo de abrirlo, como en "Ver datos completos". */
  motivo?: string | null;
}

export interface AdjuntoLeido {
  numero: string;
  movimientoId: string;
  nombre: string;
  mime: string;
  bytes: number;
  sha256: string;
  /** `inline` para el visor de la ficha; `attachment` para la descarga. */
  disposicion: "inline" | "attachment";
  /** El archivo. Quien lo recibe lo tiene que consumir o cancelar. */
  contenido: ReadableStream<Uint8Array>;
}

/**
 * Abre un adjunto para el visor o la descarga y registra el acceso. El Route
 * Handler responde con `Content-Type: mime`, `Content-Disposition` según
 * `disposicion` (con `nombre`), `Content-Security-Policy: sandbox; default-src
 * 'none'`, `X-Content-Type-Options: nosniff` y `Cache-Control: private,
 * no-store` (sección 6).
 *
 * @param movimientoId el id del movimiento `adjunto` (string de dígitos).
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado` (no existe, no es un adjunto o fue retirado), `motivo_requerido`
 */
export async function leerAdjunto(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  movimientoId: string,
  opciones: OpcionesLecturaAdjunto = {},
): Promise<AdjuntoLeido> {
  const almacen = exigirAlmacen(deps);
  exigirPermiso("ver_expediente", null, usuario);
  if (!/^\d{1,18}$/.test(movimientoId)) throw new ErrorDominio("no_encontrado", "No existe ese adjunto");
  const id = BigInt(movimientoId);

  return deps.escribir(usuario.id, limpiarMotivo(opciones.motivo), async (tx) => {
    const m = await tx.movimiento.findUnique({ where: { id }, select: { tipo: true, datos: true, expedienteId: true } });
    if (!m || m.tipo !== "adjunto") throw new ErrorDominio("no_encontrado", "No existe ese adjunto");
    const exp = await tx.expediente.findUniqueOrThrow({ where: { id: m.expedienteId } });
    const decision = evaluarPermiso("ver_datos_completos", await permisosDelExpediente(tx, exp), usuario);
    if (!decision.permitido) throw new PermisoDenegado("ver_datos_completos", decision.motivo);
    const motivo = decision.requiereMotivo ? exigirMotivo(opciones.motivo, "Abrir un adjunto de un expediente que no trabajás") : limpiarMotivo(opciones.motivo);

    const items = leerItems(exp.items);
    if (items.adjuntos[movimientoId]?.vigente !== true) throw new ErrorDominio("no_encontrado", "Ese adjunto fue retirado");
    const d = datosAdjunto(m.datos);
    // Se abre antes de registrar: si el archivo falta, no queda un acceso a algo que no se vio.
    const archivo = await almacen.abrir(d.ruta);
    const accion = opciones.descargar ? "descargar_adjunto" : "ver_adjunto";
    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion,
      expedienteId: exp.id,
      detalle: { movimiento: movimientoId, ...(motivo ? { motivo } : {}) },
      ip: opciones.ip,
    });
    return {
      numero: exp.numeroInterno,
      movimientoId,
      nombre: d.nombre,
      mime: d.mime,
      bytes: archivo.bytes,
      sha256: d.sha256,
      disposicion: opciones.descargar ? "attachment" : "inline",
      contenido: archivo.contenido,
    };
  });
}
