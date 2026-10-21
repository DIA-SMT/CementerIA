import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { ErrorDominio, errorValidacion, exigirMotivo, type ErrorCampo } from "../expedientes/errores";
import { definicionEditable, definicionInicial } from "../plantillas/borrador";
import type { DefinicionPlantilla } from "../plantillas/esquema";
import { validarPublicacion, type CatalogosPlantilla } from "../plantillas/validar";
import { enSerie, type DependenciasAdmin, type LectorAdmin } from "./dependencias";
import { conErroresLegibles } from "./errores-base";

/**
 * Plantillas desde la administración (semana 5; docs/propuesta-mvp.md, 2.5 y
 * 2.13(a)): el catálogo por código, el borrador (crear, editar, guardar,
 * validar, descartar), "Publicar" y "Retirar".
 *
 * Cada código tiene como máximo una versión publicada y un borrador (índices
 * únicos parciales). Una versión publicada o retirada está congelada
 * (`plantillas_congelar`): "Editar" crea el borrador v+1 copiando la
 * publicada, y "Publicar" retira la anterior y publica el borrador en la misma
 * transacción. Los expedientes en curso conservan su `plantilla_id` y siguen
 * con su versión; las altas nuevas toman la publicada.
 *
 * Todas las escrituras quedan en `auditoria.cambios` por el trigger
 * `auditar_cambio` (con las notas de cambio o el motivo como `motivo`).
 *
 * Idempotencia: cada acción describe el estado al que se quiere llegar, así que
 * repetirla (doble clic, reintento) no hace nada nuevo y devuelve
 * `repetido: true`: guardar el mismo contenido, publicar una versión que ya
 * está publicada, descartar un borrador que ya no está, retirar una retirada.
 */

export const ESTADOS_PLANTILLA = ["borrador", "publicada", "retirada"] as const;
export type EstadoPlantilla = (typeof ESTADOS_PLANTILLA)[number];

/** Estados en los que un expediente "está en curso" para el catálogo. */
const ESTADOS_EN_CURSO = ["en_tramite", "espera_pago_dim"];

/** Igual que el CHECK de plantillas.codigo, empezando con letra como las claves. */
const RE_CODIGO = /^[A-Z][A-Z0-9_]*$/;
const LARGO_MAXIMO_NOMBRE = 200;
/** Una definición real ocupa unos 20 kB; esto frena un envío absurdo antes de la base. */
const LARGO_MAXIMO_DEFINICION = 500_000;

function estadoPlantilla(v: string): EstadoPlantilla {
  return (ESTADOS_PLANTILLA as readonly string[]).includes(v) ? (v as EstadoPlantilla) : "retirada";
}

function nombreDe(u: { nombre: string; apellido: string } | null): string | null {
  return u ? `${u.nombre} ${u.apellido}` : null;
}

/** JSON con las claves ordenadas: el jsonb de la base no conserva el orden de las claves. */
function jsonEstable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonEstable).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonEstable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * La huella de un borrador (nombre y definición): el bloqueo optimista del
 * editor. Si otro administrador guardó el mismo borrador en el medio, la
 * huella que trae el editor ya no coincide y el guardado se rechaza en vez de
 * pisar su trabajo.
 */
export function huellaBorrador(nombre: string, definicion: unknown): string {
  return createHash("sha256").update(jsonEstable({ nombre, definicion })).digest("hex").slice(0, 32);
}

async function catalogosDe(lector: Pick<LectorAdmin, "area" | "tipoMonumento" | "cementerio">): Promise<CatalogosPlantilla> {
  return {
    areas: await lector.area.findMany({ select: { codigo: true, tipo: true, activa: true, recibePases: true } }),
    tiposMonumento: await lector.tipoMonumento.findMany({ select: { codigo: true, activo: true } }),
    cementerios: await lector.cementerio.findMany({ select: { codigo: true, activo: true } }),
  };
}

/** Bloquea todas las versiones de un código: crear, publicar, descartar y retirar se hacen de a una. */
async function bloquearCodigo(tx: Transaccion, codigo: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM public.plantillas WHERE codigo = ${codigo} FOR UPDATE`;
}

function exigirCodigo(codigo: string): string {
  const c = codigo.trim().toUpperCase();
  if (!RE_CODIGO.test(c) || c.length > 60) {
    throw errorValidacion([{ ruta: "codigo", mensaje: "Código inválido: mayúsculas, números y _, empezando con una letra (ej. TRANSFERENCIA)" }]);
  }
  return c;
}

function exigirNombre(nombre: unknown): string {
  const n = typeof nombre === "string" ? nombre.replace(/\s+/g, " ").trim() : "";
  if (n === "" || n.length > LARGO_MAXIMO_NOMBRE) {
    throw errorValidacion([{ ruta: "nombre", mensaje: `Escribí el nombre de la plantilla (hasta ${LARGO_MAXIMO_NOMBRE} caracteres)` }]);
  }
  return n;
}

/** Lo que manda el editor, con la forma de la definición (ver plantillas/borrador.ts). */
function definicionDeEntrada(valor: unknown): DefinicionPlantilla {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw errorValidacion([], "La definición llegó incompleta: recargá la página");
  }
  if (JSON.stringify(valor).length > LARGO_MAXIMO_DEFINICION) {
    throw errorValidacion([], "La definición es demasiado grande");
  }
  return definicionEditable(valor);
}

const comoJson = (d: DefinicionPlantilla): Prisma.InputJsonObject => d as unknown as Prisma.InputJsonObject;

// ---------------------------------------------------------------------------
// Catálogo (/admin/plantillas)
// ---------------------------------------------------------------------------

export interface VersionCatalogo {
  id: number;
  version: number;
  estado: EstadoPlantilla;
  /** Expedientes en trámite o en espera de pago con esta versión. */
  enCurso: number;
  /** Todos los expedientes con esta versión (también concluidos, archivados y anulados). */
  total: number;
  publicadoEn: Date | null;
}

export interface FilaCatalogoPlantilla {
  codigo: string;
  /** El nombre de la publicada o, si no hay, de la última versión. */
  nombre: string;
  tipoTramite: { id: number; codigo: string; nombre: string };
  publicada: VersionCatalogo | null;
  borrador: (VersionCatalogo & { creadoEn: Date; creadoPor: string | null }) | null;
  /** Todas las versiones, de la más nueva a la más vieja. */
  versiones: VersionCatalogo[];
}

export async function catalogoPlantillas(deps: DependenciasAdmin, usuario: UsuarioPermisos): Promise<FilaCatalogoPlantilla[]> {
  exigirPermiso("administrar", null, usuario);
  const filas = await deps.leer.plantilla.findMany({
    select: {
      id: true,
      codigo: true,
      version: true,
      nombre: true,
      estado: true,
      publicadoEn: true,
      creadoEn: true,
      creador: { select: { nombre: true, apellido: true } },
      tipoTramite: { select: { id: true, codigo: true, nombre: true } },
    },
    orderBy: [{ codigo: "asc" }, { version: "desc" }],
  });
  const conteos = await deps.leer.$queryRaw<Array<{ plantilla_id: number; en_curso: number; total: number }>>`
    SELECT plantilla_id,
           (count(*) FILTER (WHERE estado = ANY (${ESTADOS_EN_CURSO}::text[])))::int AS en_curso,
           count(*)::int AS total
      FROM public.expedientes
     GROUP BY plantilla_id`;
  const porPlantilla = new Map(conteos.map((c) => [c.plantilla_id, c]));

  const porCodigo = new Map<string, FilaCatalogoPlantilla>();
  for (const p of filas) {
    const c = porPlantilla.get(p.id);
    const version: VersionCatalogo = { id: p.id, version: p.version, estado: estadoPlantilla(p.estado), enCurso: c?.en_curso ?? 0, total: c?.total ?? 0, publicadoEn: p.publicadoEn };
    let fila = porCodigo.get(p.codigo);
    if (!fila) {
      fila = { codigo: p.codigo, nombre: p.nombre, tipoTramite: p.tipoTramite, publicada: null, borrador: null, versiones: [] };
      porCodigo.set(p.codigo, fila);
    }
    fila.versiones.push(version);
    if (version.estado === "publicada") {
      fila.publicada = version;
      fila.nombre = p.nombre;
    } else if (version.estado === "borrador") {
      fila.borrador = { ...version, creadoEn: p.creadoEn, creadoPor: nombreDe(p.creador) };
    }
  }
  return [...porCodigo.values()];
}

// ---------------------------------------------------------------------------
// Una versión (/admin/plantillas/[codigo]/v/[version])
// ---------------------------------------------------------------------------

export interface VersionPlantilla {
  id: number;
  codigo: string;
  version: number;
  nombre: string;
  estado: EstadoPlantilla;
  tipoTramite: { id: number; codigo: string; nombre: string };
  notasCambio: string | null;
  creadoEn: Date;
  creadoPor: string | null;
  publicadoEn: Date | null;
  publicadoPor: string | null;
  /** Con la forma completa del esquema aunque sea un borrador a medio hacer. */
  definicion: DefinicionPlantilla;
  /** Para el bloqueo optimista del editor (se manda de vuelta al guardar o publicar). */
  huella: string;
  /** Las demás versiones del código, para navegar. */
  versiones: Array<{ version: number; estado: EstadoPlantilla }>;
  enCurso: number;
}

export async function obtenerVersion(deps: DependenciasAdmin, usuario: UsuarioPermisos, codigo: string, version: number): Promise<VersionPlantilla> {
  exigirPermiso("administrar", null, usuario);
  const c = codigo.trim().toUpperCase();
  if (!Number.isInteger(version) || version < 1 || version > 32_767) throw new ErrorDominio("no_encontrado", `No existe la versión ${version} de ${c}`);
  const p = await deps.leer.plantilla.findUnique({
    where: { codigo_version: { codigo: c, version } },
    include: {
      tipoTramite: { select: { id: true, codigo: true, nombre: true } },
      creador: { select: { nombre: true, apellido: true } },
      publicador: { select: { nombre: true, apellido: true } },
    },
  });
  if (!p) throw new ErrorDominio("no_encontrado", `No existe la versión ${version} de ${c}`);
  const versiones = await deps.leer.plantilla.findMany({ where: { codigo: c }, select: { version: true, estado: true }, orderBy: { version: "desc" } });
  const enCurso = await deps.leer.expediente.count({ where: { plantillaId: p.id, estado: { in: ESTADOS_EN_CURSO } } });
  return {
    id: p.id,
    codigo: p.codigo,
    version: p.version,
    nombre: p.nombre,
    estado: estadoPlantilla(p.estado),
    tipoTramite: p.tipoTramite,
    notasCambio: p.notasCambio,
    creadoEn: p.creadoEn,
    creadoPor: nombreDe(p.creador),
    publicadoEn: p.publicadoEn,
    publicadoPor: nombreDe(p.publicador),
    definicion: definicionEditable(p.definicion),
    huella: huellaBorrador(p.nombre, p.definicion),
    versiones: versiones.map((v) => ({ version: v.version, estado: estadoPlantilla(v.estado) })),
    enCurso,
  };
}

/** Los catálogos que el editor necesita para sus listas (áreas, cementerios, monumentos y tipos de trámite). */
export async function catalogosEditor(deps: DependenciasAdmin, usuario: UsuarioPermisos) {
  exigirPermiso("administrar", null, usuario);
  const [areas, cementerios, tiposMonumento, tiposTramite] = await enSerie(
    () => deps.leer.area.findMany({ select: { codigo: true, nombre: true, tipo: true, activa: true, recibePases: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
    () => deps.leer.cementerio.findMany({ select: { codigo: true, nombre: true, activo: true, tiposMonumento: true, area: { select: { nombre: true } } }, orderBy: { nombre: "asc" } }),
    () => deps.leer.tipoMonumento.findMany({ select: { codigo: true, nombre: true, activo: true }, orderBy: { nombre: "asc" } }),
    () => deps.leer.tipoTramite.findMany({ select: { id: true, codigo: true, nombre: true, activo: true }, orderBy: { nombre: "asc" } }),
  );
  return {
    areas,
    cementerios: cementerios.map((c) => ({ codigo: c.codigo, nombre: c.nombre, activo: c.activo, tiposMonumento: c.tiposMonumento, area: c.area.nombre })),
    tiposMonumento,
    tiposTramite,
  };
}
export type CatalogosEditor = Awaited<ReturnType<typeof catalogosEditor>>;

// ---------------------------------------------------------------------------
// Nueva y Editar
// ---------------------------------------------------------------------------

export interface ResultadoVersion {
  codigo: string;
  version: number;
  repetido: boolean;
}

/**
 * "Nueva": un código que no existe, su tipo de trámite y su nombre. Nace como
 * borrador v1 con la definición mínima (`definicionInicial()`).
 *
 * @throws ErrorDominio `validacion`, `ya_existe`
 */
export async function crearPlantilla(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  entrada: { codigo: string; tipoTramiteId: number; nombre: string },
): Promise<ResultadoVersion> {
  exigirPermiso("administrar", null, usuario);
  const codigo = exigirCodigo(entrada.codigo);
  const nombre = exigirNombre(entrada.nombre);
  return conErroresLegibles(
    () =>
      deps.escribir(usuario.id, "Nueva plantilla", async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4243, hashtext(${codigo}))`;
        const tipo = await tx.tipoTramite.findUnique({ where: { id: entrada.tipoTramiteId } });
        if (!tipo || !tipo.activo) throw errorValidacion([{ ruta: "tipoTramiteId", mensaje: "Elegí un tipo de trámite activo" }]);
        const existentes = await tx.plantilla.findMany({ where: { codigo }, select: { version: true, estado: true, nombre: true, tipoTramiteId: true, creadoPor: true } });
        if (existentes.length > 0) {
          const v1 = existentes.find((v) => v.version === 1);
          // El mismo pedido dos veces (doble clic): el borrador ya está.
          if (existentes.length === 1 && v1 && v1.estado === "borrador" && v1.nombre === nombre && v1.tipoTramiteId === tipo.id && v1.creadoPor === usuario.id) {
            return { codigo, version: 1, repetido: true };
          }
          throw new ErrorDominio("ya_existe", `Ya hay una plantilla ${codigo}: para cambiarla, usá Editar`, [{ ruta: "codigo", mensaje: `Ya existe ${codigo}` }]);
        }
        await tx.plantilla.create({
          data: { codigo, version: 1, tipoTramiteId: tipo.id, nombre, estado: "borrador", definicion: comoJson(definicionInicial()), creadoPor: usuario.id },
        });
        return { codigo, version: 1, repetido: false };
      }),
    `Ya hay una plantilla ${codigo}`,
  );
}

/**
 * "Editar": el borrador v+1 copiando la publicada (o, si se retiró y no hay
 * publicada, la última versión: así un trámite retirado vuelve con cambios).
 * Si ya hay un borrador, lo devuelve (`repetido`): hay uno solo por código.
 *
 * @throws ErrorDominio `no_encontrado`
 */
export async function editarPlantilla(deps: DependenciasAdmin, usuario: UsuarioPermisos, codigo: string): Promise<ResultadoVersion> {
  exigirPermiso("administrar", null, usuario);
  const c = codigo.trim().toUpperCase();
  return conErroresLegibles(
    () =>
      deps.escribir(usuario.id, "Borrador de una versión nueva", async (tx) => {
        await bloquearCodigo(tx, c);
        const versiones = await tx.plantilla.findMany({ where: { codigo: c }, orderBy: { version: "desc" } });
        if (versiones.length === 0) throw new ErrorDominio("no_encontrado", `No existe la plantilla ${c}`);
        const borrador = versiones.find((v) => v.estado === "borrador");
        if (borrador) return { codigo: c, version: borrador.version, repetido: true };
        const base = versiones.find((v) => v.estado === "publicada") ?? versiones[0];
        const version = versiones[0].version + 1;
        await tx.plantilla.create({
          data: {
            codigo: c,
            version,
            tipoTramiteId: base.tipoTramiteId,
            nombre: base.nombre,
            estado: "borrador",
            definicion: comoJson(definicionEditable(base.definicion)),
            creadoPor: usuario.id,
          },
        });
        return { codigo: c, version, repetido: false };
      }),
    `Ya hay un borrador de ${c}`,
  );
}

// ---------------------------------------------------------------------------
// Guardar, validar, publicar, descartar y retirar
// ---------------------------------------------------------------------------

export interface ContenidoBorrador {
  nombre: unknown;
  definicion: unknown;
}

/** Lee el borrador bloqueado y controla que sea el que vio el editor. */
async function borradorParaEscribir(tx: Transaccion, codigo: string, version: number) {
  await bloquearCodigo(tx, codigo);
  const p = await tx.plantilla.findUnique({ where: { codigo_version: { codigo, version } } });
  if (!p) throw new ErrorDominio("no_encontrado", `No existe la versión ${version} de ${codigo}: puede que otro administrador la haya descartado`);
  return p;
}

const MENSAJE_CONFLICTO_BORRADOR = "Otro administrador cambió este borrador mientras lo editabas: recargá para ver su versión (lo tuyo no se guardó)";

export interface ResultadoGuardado {
  huella: string;
  repetido: boolean;
  /** Cuántos errores tiene para publicar (el detalle, con Validar). */
  pendientes: number;
}

/**
 * Guarda el borrador tal como está en el editor, aunque todavía no pase la
 * validación de "Publicar": `pendientes` dice cuántos errores quedan.
 *
 * @param huella la que trajo el editor (`VersionPlantilla.huella` o el último guardado)
 * @throws ErrorDominio `no_encontrado`, `estado_no_admite` (no es borrador), `conflicto_version`, `validacion`
 */
export async function guardarBorrador(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  codigo: string,
  version: number,
  contenido: ContenidoBorrador,
  huella: string,
): Promise<ResultadoGuardado> {
  exigirPermiso("administrar", null, usuario);
  const c = codigo.trim().toUpperCase();
  const nombre = exigirNombre(contenido.nombre);
  const definicion = definicionDeEntrada(contenido.definicion);
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, "Guardar borrador de plantilla", async (tx) => {
      const p = await borradorParaEscribir(tx, c, version);
      if (p.estado !== "borrador") throw new ErrorDominio("estado_no_admite", `La versión ${version} de ${c} está ${p.estado}: no se modifica`);
      const pendientes = (r: ReturnType<typeof validarPublicacion>) => (r.ok ? 0 : r.errores.length);
      // Lo mismo que ya está (un doble clic, o guardar sin cambios): no se escribe.
      if (p.nombre === nombre && isDeepStrictEqual(definicionEditable(p.definicion), definicion)) {
        return { huella: huellaBorrador(p.nombre, p.definicion), repetido: true, pendientes: pendientes(validarPublicacion(definicion, await catalogosDe(tx))) };
      }
      if (huellaBorrador(p.nombre, p.definicion) !== huella) throw new ErrorDominio("conflicto_version", MENSAJE_CONFLICTO_BORRADOR);
      const guardado = await tx.plantilla.update({ where: { id: p.id }, data: { nombre, definicion: comoJson(definicion) }, select: { nombre: true, definicion: true } });
      return { huella: huellaBorrador(guardado.nombre, guardado.definicion), repetido: false, pendientes: pendientes(validarPublicacion(definicion, await catalogosDe(tx))) };
    }),
  );
}

/** Los errores de "Publicar" para lo que está en el editor (no escribe nada). */
export async function validarBorrador(deps: DependenciasAdmin, usuario: UsuarioPermisos, contenido: ContenidoBorrador): Promise<{ ok: boolean; errores: ErrorCampo[] }> {
  exigirPermiso("administrar", null, usuario);
  const errores: ErrorCampo[] = [];
  try {
    exigirNombre(contenido.nombre);
  } catch (e) {
    if (e instanceof ErrorDominio) errores.push(...e.errores);
    else throw e;
  }
  const r = validarPublicacion(definicionDeEntrada(contenido.definicion), await catalogosDe(deps.leer));
  if (!r.ok) errores.push(...r.errores.map((e) => ({ ruta: e.ruta, mensaje: e.mensaje })));
  return { ok: errores.length === 0, errores };
}

export interface ResultadoPublicacion extends ResultadoVersion {
  /** La versión que pasó a retirada, si había una publicada. */
  retirada: number | null;
}

/**
 * "Publicar" (2.13(a)), en UNA transacción: guarda lo que está en el editor,
 * valida el esquema y la integridad contra los catálogos de esa misma
 * transacción, pasa la versión publicada a `retirada` y el borrador a
 * `publicada` con las notas de cambio. Si algo falla no cambia nada (tampoco
 * se guarda el borrador).
 *
 * @throws ErrorDominio `validacion` (con `errores` por ruta, como Validar),
 *   `motivo_requerido` (notas), `conflicto_version`, `no_encontrado`, `estado_no_admite`
 */
export async function publicarBorrador(
  deps: DependenciasAdmin,
  usuario: UsuarioPermisos,
  codigo: string,
  version: number,
  contenido: ContenidoBorrador,
  huella: string,
  notas: string | null,
): Promise<ResultadoPublicacion> {
  exigirPermiso("administrar", null, usuario);
  const c = codigo.trim().toUpperCase();
  const notasCambio = exigirMotivo(notas, "Publicar una plantilla");
  const nombre = exigirNombre(contenido.nombre);
  const editada = definicionDeEntrada(contenido.definicion);
  const ahora = deps.ahora?.() ?? new Date();
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, notasCambio, async (tx) => {
      const p = await borradorParaEscribir(tx, c, version);
      if (p.estado === "publicada") return { codigo: c, version, repetido: true, retirada: null };
      if (p.estado !== "borrador") throw new ErrorDominio("estado_no_admite", `La versión ${version} de ${c} está ${p.estado}: no se publica`);
      const igual = p.nombre === nombre && isDeepStrictEqual(definicionEditable(p.definicion), editada);
      if (!igual && huellaBorrador(p.nombre, p.definicion) !== huella) throw new ErrorDominio("conflicto_version", MENSAJE_CONFLICTO_BORRADOR);

      const r = validarPublicacion(editada, await catalogosDe(tx));
      if (!r.ok) {
        throw errorValidacion(
          r.errores.map((e) => ({ ruta: e.ruta, mensaje: e.mensaje })),
          `No se puede publicar: ${r.errores.length === 1 ? "hay 1 error" : `hay ${r.errores.length} errores`} (marcados en cada pestaña)`,
        );
      }
      const anterior = await tx.plantilla.findFirst({ where: { codigo: c, estado: "publicada" }, select: { id: true, version: true } });
      // Primero se retira la anterior: el índice único parcial no admite dos publicadas.
      if (anterior) await tx.plantilla.update({ where: { id: anterior.id }, data: { estado: "retirada" } });
      await tx.plantilla.update({
        where: { id: p.id },
        // La definición que valida el esquema, con los valores por defecto completos: es la que se congela.
        data: { nombre, definicion: comoJson(r.definicion), estado: "publicada", notasCambio, publicadoPor: usuario.id, publicadoEn: ahora },
      });
      return { codigo: c, version, repetido: false, retirada: anterior?.version ?? null };
    }),
  );
}

/**
 * "Descartar borrador": lo borra (el trigger solo deja borrar borradores). Si
 * ya no está, `repetido`.
 */
export async function descartarBorrador(deps: DependenciasAdmin, usuario: UsuarioPermisos, codigo: string, version: number): Promise<{ repetido: boolean }> {
  exigirPermiso("administrar", null, usuario);
  const c = codigo.trim().toUpperCase();
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, "Descartar borrador de plantilla", async (tx) => {
      await bloquearCodigo(tx, c);
      const p = await tx.plantilla.findUnique({ where: { codigo_version: { codigo: c, version } } });
      if (!p) return { repetido: true };
      if (p.estado !== "borrador") throw new ErrorDominio("estado_no_admite", `La versión ${version} de ${c} está ${p.estado}: solo se descartan borradores`);
      // Un expediente no puede tener un borrador (el alta exige la publicada); igual, la FK lo frenaría.
      await tx.plantilla.delete({ where: { id: p.id } });
      return { repetido: false };
    }),
  );
}

/**
 * "Retirar" la versión publicada: el trámite deja de ofrecerse en el alta. Los
 * expedientes en curso siguen con su versión. Exige motivo (queda en
 * `auditoria.cambios`).
 *
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`, `estado_no_admite`
 */
export async function retirarPlantilla(deps: DependenciasAdmin, usuario: UsuarioPermisos, codigo: string, version: number, motivo: string | null): Promise<{ repetido: boolean }> {
  exigirPermiso("administrar", null, usuario);
  const c = codigo.trim().toUpperCase();
  const m = exigirMotivo(motivo, "Retirar una plantilla");
  return conErroresLegibles(() =>
    deps.escribir(usuario.id, m, async (tx) => {
      await bloquearCodigo(tx, c);
      const p = await tx.plantilla.findUnique({ where: { codigo_version: { codigo: c, version } } });
      if (!p) throw new ErrorDominio("no_encontrado", `No existe la versión ${version} de ${c}`);
      if (p.estado === "retirada") return { repetido: true };
      if (p.estado !== "publicada") throw new ErrorDominio("estado_no_admite", "Solo se retira la versión publicada (un borrador se descarta)");
      await tx.plantilla.update({ where: { id: p.id }, data: { estado: "retirada" } });
      return { repetido: false };
    }),
  );
}

