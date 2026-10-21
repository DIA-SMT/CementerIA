import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { ErrorDominio, errorValidacion, limpiarMotivo, type ErrorCampo } from "../expedientes/errores";
import { CampoUbicacion, leerCamposUbicacion } from "../expedientes/ubicacion";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { analizarDefinicion, destinoDePaso } from "../plantillas/esquema";
import { enSerie, type DependenciasAdmin, type LectorAdmin } from "./dependencias";
import { conErroresLegibles } from "./errores-base";

/**
 * Catálogos desde la administración (semana 5; docs/propuesta-mvp.md, 2.1 a
 * 2.3 y 2.13(d) y (e)): áreas, cementerios (con su nomenclatura y sus tipos
 * de monumento), tipos de monumento y tipos de trámite. Los feriados ya
 * tienen su API (expedientes/feriados.ts) y la pantalla la usa tal cual.
 *
 * No hay DELETE (la app no tiene el privilegio): la baja es `activo = false`.
 * El código no se cambia después del alta: las plantillas publicadas (JSON
 * congelado) nombran áreas y cementerios por código, y los expedientes guardan
 * el código del tipo de monumento.
 *
 * Reglas que la base no puede ver y se controlan acá, con un mensaje legible:
 * - Una clave de ubicación con valores en algún expediente no se renombra, no
 *   se borra y no cambia de tipo: se desactiva (2.13(d)). Así los valores
 *   viejos se siguen mostrando y `ubicacion_clave` no cambia.
 * - Un área no se desactiva si tiene usuarios activos, si es la de un
 *   cementerio activo o si la usa una plantilla publicada (sus pases irían a
 *   un área que no recibe nada).
 * Las reglas de los triggers (`areas_tipo_coherente`, `cementerios_area_externa`)
 * se controlan antes, para decirlo bien; si igual llega un rechazo de la base
 * (dos administradores a la vez), se muestra legible (errores-base.ts).
 *
 * Todo queda en `auditoria.cambios` por el trigger `auditar_cambio`.
 */

const RE_CODIGO = /^[A-Z][A-Z0-9_]*$/;
/** El CHECK de tipos_monumento.codigo. */
const RE_CODIGO_MONUMENTO = /^[A-Z_]+$/;

export interface ResultadoCatalogo {
  id: number;
  creado: boolean;
  repetido: boolean;
}

function leer<T extends z.ZodType>(esquema: T, valor: unknown): z.infer<T> {
  const r = esquema.safeParse(valor);
  if (r.success) return r.data;
  throw errorValidacion(r.error.issues.map((i) => ({ ruta: i.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replace(/\.\[/g, "["), mensaje: i.message })));
}

const Nombre = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Escribí el nombre").max(120, "Hasta 120 caracteres"));

const Codigo = (re: RegExp, ayuda: string) =>
  z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(re, ayuda).max(40, "Hasta 40 caracteres"));

const Id = z.int().positive().nullish();

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Áreas y cementerios que usa cada plantilla publicada (para no desactivarlos por error). */
async function usosEnPlantillas(lector: Pick<LectorAdmin, "plantilla">): Promise<{ areas: Map<string, Set<string>>; cementerios: Map<string, Set<string>> }> {
  const publicadas = await lector.plantilla.findMany({ where: { estado: "publicada" }, select: { codigo: true, definicion: true } });
  const areas = new Map<string, Set<string>>();
  const cementerios = new Map<string, Set<string>>();
  const anotar = (mapa: Map<string, Set<string>>, clave: string, plantilla: string) => mapa.set(clave, (mapa.get(clave) ?? new Set()).add(plantilla));
  for (const p of publicadas) {
    const r = analizarDefinicion(p.definicion);
    if (!r.ok) continue;
    for (const paso of r.definicion.pasos) {
      const d = destinoDePaso(paso.area);
      if (d.tipo === "area") anotar(areas, d.codigo, p.codigo);
      if (paso.custodia) anotar(areas, paso.custodia, p.codigo);
      for (const s of paso.subtareas) for (const c of [...(s.solo_cementerios ?? []), ...(s.excepto_cementerios ?? [])]) anotar(cementerios, c, p.codigo);
    }
    for (const x of [...r.definicion.documentos, ...r.definicion.conceptos]) {
      for (const c of [...(x.solo_cementerios ?? []), ...(x.excepto_cementerios ?? [])]) anotar(cementerios, c, p.codigo);
    }
  }
  return { areas, cementerios };
}

/** Las claves de ubicación que tienen algún valor en expedientes de ese cementerio, con cuántos. */
async function clavesUsadas(lector: Pick<LectorAdmin, "$queryRaw">, cementerioId: number): Promise<Map<string, number>> {
  const filas = await lector.$queryRaw<Array<{ clave: string; cantidad: number }>>`
    SELECT k AS clave, count(*)::int AS cantidad
      FROM public.expedientes e, jsonb_object_keys(e.ubicacion) AS k
     WHERE e.cementerio_id = ${cementerioId}
     GROUP BY k`;
  return new Map(filas.map((f) => [f.clave, f.cantidad]));
}

export interface FilaArea {
  id: number;
  codigo: string;
  nombre: string;
  tipo: "interna" | "externa";
  recibePases: boolean;
  activa: boolean;
  orden: number;
  usuariosActivos: number;
  cementerio: string | null;
  plantillas: string[];
}

export interface FilaCementerio {
  id: number;
  codigo: string;
  nombre: string;
  area: { id: number; codigo: string; nombre: string };
  activo: boolean;
  camposUbicacion: CampoUbicacion[];
  tiposMonumento: string[];
  /** Clave → cuántos expedientes la tienen: esas no se borran ni se renombran. */
  clavesUsadas: Record<string, number>;
  expedientes: number;
  plantillas: string[];
}

export interface Catalogos {
  areas: FilaArea[];
  cementerios: FilaCementerio[];
  tiposMonumento: Array<{ id: number; codigo: string; nombre: string; activo: boolean; cementerios: string[]; expedientes: number }>;
  tiposTramite: Array<{ id: number; codigo: string; nombre: string; activo: boolean; plantillas: string[] }>;
}

export async function listarCatalogos(deps: DependenciasAdmin, usuario: UsuarioPermisos): Promise<Catalogos> {
  exigirPermiso("administrar", null, usuario);
  const l = deps.leer;
  const [areas, cementerios, tiposMonumento, tiposTramite, usuarios, usos, porCementerio, porMonumento, plantillas] = await enSerie(
    () => l.area.findMany({ orderBy: [{ tipo: "asc" }, { orden: "asc" }, { nombre: "asc" }] }),
    () => l.cementerio.findMany({ include: { area: { select: { id: true, codigo: true, nombre: true } } }, orderBy: { nombre: "asc" } }),
    () => l.tipoMonumento.findMany({ orderBy: { nombre: "asc" } }),
    () => l.tipoTramite.findMany({ orderBy: { nombre: "asc" } }),
    () => l.usuario.findMany({ where: { activo: true, areaId: { not: null } }, select: { areaId: true } }),
    () => usosEnPlantillas(l),
    () => l.$queryRaw<Array<{ cementerio_id: number; cantidad: number }>>`SELECT cementerio_id, count(*)::int AS cantidad FROM public.expedientes GROUP BY cementerio_id`,
    () => l.$queryRaw<Array<{ tipo_monumento: string; cantidad: number }>>`SELECT tipo_monumento, count(*)::int AS cantidad FROM public.expedientes GROUP BY tipo_monumento`,
    () => l.plantilla.findMany({ where: { estado: { in: ["publicada", "borrador"] } }, select: { codigo: true, tipoTramiteId: true }, distinct: ["codigo"] }),
  );
  const usuariosPorArea = new Map<number, number>();
  for (const u of usuarios) if (u.areaId !== null) usuariosPorArea.set(u.areaId, (usuariosPorArea.get(u.areaId) ?? 0) + 1);
  const cementerioDeArea = new Map(cementerios.map((c) => [c.areaId, c.codigo]));
  const expedientesPorCementerio = new Map(porCementerio.map((f) => [f.cementerio_id, f.cantidad]));
  const expedientesPorMonumento = new Map(porMonumento.map((f) => [f.tipo_monumento, f.cantidad]));

  const filasCementerio: FilaCementerio[] = [];
  for (const c of cementerios) {
    filasCementerio.push({
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      area: c.area,
      activo: c.activo,
      camposUbicacion: leerCamposUbicacion(c.camposUbicacion, c.nombre),
      tiposMonumento: c.tiposMonumento,
      clavesUsadas: Object.fromEntries(await clavesUsadas(l, c.id)),
      expedientes: expedientesPorCementerio.get(c.id) ?? 0,
      plantillas: [...(usos.cementerios.get(c.codigo) ?? [])].sort(),
    });
  }

  return {
    areas: areas.map((a) => ({
      id: a.id,
      codigo: a.codigo,
      nombre: a.nombre,
      tipo: a.tipo === "externa" ? "externa" : "interna",
      recibePases: a.recibePases,
      activa: a.activa,
      orden: a.orden,
      usuariosActivos: usuariosPorArea.get(a.id) ?? 0,
      cementerio: cementerioDeArea.get(a.id) ?? null,
      plantillas: [...(usos.areas.get(a.codigo) ?? [])].sort(),
    })),
    cementerios: filasCementerio,
    tiposMonumento: tiposMonumento.map((t) => ({
      ...t,
      cementerios: cementerios.filter((c) => c.tiposMonumento.includes(t.codigo)).map((c) => c.nombre),
      expedientes: expedientesPorMonumento.get(t.codigo) ?? 0,
    })),
    tiposTramite: tiposTramite.map((t) => ({ ...t, plantillas: plantillas.filter((p) => p.tipoTramiteId === t.id).map((p) => p.codigo) })),
  };
}

// ---------------------------------------------------------------------------
// Áreas
// ---------------------------------------------------------------------------

const EntradaArea = z.object({
  id: Id,
  codigo: Codigo(RE_CODIGO, "Código inválido: mayúsculas, números y _, empezando con una letra (ej. MESA_ENTRADAS)"),
  nombre: Nombre,
  tipo: z.enum(["interna", "externa"], "Elegí interna o externa"),
  recibePases: z.boolean(),
  activa: z.boolean(),
  orden: z.int("Un número entero").min(0, "0 o más").max(999, "Hasta 999"),
});
export type EntradaArea = z.input<typeof EntradaArea>;

/** Lo que no cambia con un UPDATE (el código) y lo que ya está igual. */
function sinCambios(actual: object, nuevo: Record<string, unknown>): boolean {
  return Object.entries(nuevo).every(([k, v]) => isDeepStrictEqual((actual as Record<string, unknown>)[k], v));
}

function codigoFijo(actual: string, nuevo: string): void {
  if (actual !== nuevo) {
    throw errorValidacion([{ ruta: "codigo", mensaje: `El código no se cambia (es ${actual}): las plantillas y los expedientes lo nombran` }]);
  }
}

/**
 * Alta o modificación de un área (con `id`, modificación).
 *
 * @throws ErrorDominio `validacion`, `ya_existe`, `en_uso`, `no_encontrado`
 */
export async function guardarArea(deps: DependenciasAdmin, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoCatalogo> {
  exigirPermiso("administrar", null, usuario);
  const d = leer(EntradaArea, entrada);
  if (d.tipo === "externa" && !d.recibePases) throw errorValidacion([{ ruta: "recibePases", mensaje: "Un área externa siempre recibe pases (es un destino del papel)" }]);
  const datos = { nombre: d.nombre, tipo: d.tipo, recibePases: d.recibePases, activa: d.activa, orden: d.orden };
  return conErroresLegibles(
    () =>
      deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
        if (d.id == null) {
          const existente = await tx.area.findUnique({ where: { codigo: d.codigo } });
          if (existente) {
            if (sinCambios(existente, datos)) return { id: existente.id, creado: false, repetido: true };
            throw new ErrorDominio("ya_existe", `Ya hay un área ${d.codigo}`, [{ ruta: "codigo", mensaje: "Ese código ya existe" }]);
          }
          const a = await tx.area.create({ data: { codigo: d.codigo, ...datos }, select: { id: true } });
          return { id: a.id, creado: true, repetido: false };
        }
        const actual = await tx.area.findUnique({ where: { id: d.id } });
        if (!actual) throw new ErrorDominio("no_encontrado", "No existe esa área");
        codigoFijo(actual.codigo, d.codigo);
        if (sinCambios(actual, datos)) return { id: actual.id, creado: false, repetido: true };
        const errores: ErrorCampo[] = [];
        const cementerio = await tx.cementerio.findUnique({ where: { areaId: actual.id } });
        if (d.tipo !== actual.tipo) {
          if (d.tipo === "externa" && (await tx.usuario.count({ where: { areaId: actual.id } })) > 0) {
            errores.push({ ruta: "tipo", mensaje: `${actual.nombre} tiene usuarios (activos o no): cambialos de área antes de pasarla a externa` });
          }
          if (d.tipo === "interna" && cementerio) errores.push({ ruta: "tipo", mensaje: `${actual.nombre} es el área del cementerio ${cementerio.nombre}: tiene que seguir siendo externa` });
        }
        if (actual.activa && !d.activa) {
          const usuarios = await tx.usuario.count({ where: { areaId: actual.id, activo: true } });
          if (usuarios > 0) errores.push({ ruta: "activa", mensaje: `Tiene ${usuarios === 1 ? "1 usuario activo" : `${usuarios} usuarios activos`}: cambialos de área o desactivalos antes` });
          if (cementerio?.activo) errores.push({ ruta: "activa", mensaje: `Es el área del cementerio ${cementerio.nombre}: desactivá antes el cementerio` });
          const plantillas = [...((await usosEnPlantillas(tx)).areas.get(actual.codigo) ?? [])];
          if (plantillas.length > 0) errores.push({ ruta: "activa", mensaje: `La usan las plantillas publicadas ${plantillas.sort().join(", ")}: publicá antes versiones que no la usen` });
        }
        if (actual.recibePases && !d.recibePases) {
          const plantillas = [...((await usosEnPlantillas(tx)).areas.get(actual.codigo) ?? [])];
          if (plantillas.length > 0) errores.push({ ruta: "recibePases", mensaje: `La usan las plantillas publicadas ${plantillas.sort().join(", ")}: sus pases irían a un área que no recibe` });
        }
        if (errores.length > 0) throw new ErrorDominio("en_uso", errores[0].mensaje, errores);
        await tx.area.update({ where: { id: actual.id }, data: datos });
        return { id: actual.id, creado: false, repetido: false };
      }),
    `Ya hay un área ${d.codigo}`,
  );
}

// ---------------------------------------------------------------------------
// Cementerios
// ---------------------------------------------------------------------------

const EntradaCementerio = z.object({
  id: Id,
  codigo: Codigo(RE_CODIGO, "Código inválido: mayúsculas, números y _, empezando con una letra (ej. JARDIN_NORTE)"),
  nombre: Nombre,
  areaId: z.int("Elegí el área externa").positive("Elegí el área externa"),
  activo: z.boolean(),
  camposUbicacion: z.array(z.unknown()).max(12, "Hasta 12 campos"),
  tiposMonumento: z.array(z.string()).max(30),
});
export type EntradaCementerio = z.input<typeof EntradaCementerio>;

/**
 * Los campos de ubicación como se guardan: el esquema de
 * `cementerios.campos_ubicacion` (ubicacion.ts), claves únicas, patrones que
 * compilan, y las reglas de 2.13(d) contra las claves que ya tienen valores.
 */
export function controlarCamposUbicacion(
  valores: readonly unknown[],
  anteriores: readonly CampoUbicacion[],
  usadas: ReadonlyMap<string, number>,
): { campos: CampoUbicacion[]; errores: ErrorCampo[] } {
  const errores: ErrorCampo[] = [];
  const campos: CampoUbicacion[] = [];
  valores.forEach((v, i) => {
    const ruta = `camposUbicacion[${i}]`;
    const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
    const limpio = {
      clave: typeof o.clave === "string" ? o.clave.trim().toLowerCase() : o.clave,
      etiqueta: typeof o.etiqueta === "string" ? o.etiqueta.replace(/\s+/g, " ").trim() : o.etiqueta,
      tipo: o.tipo,
      obligatorio: o.obligatorio,
      patron: typeof o.patron === "string" && o.patron.trim() !== "" ? o.patron.trim() : null,
      activo: o.activo,
      ayuda: typeof o.ayuda === "string" && o.ayuda.trim() !== "" ? o.ayuda.replace(/\s+/g, " ").trim() : null,
    };
    const r = CampoUbicacion.safeParse(limpio);
    if (!r.success) {
      for (const issue of r.error.issues) {
        const campo = String(issue.path[0] ?? "");
        const mensaje =
          campo === "clave"
            ? "Clave inválida: minúsculas, números y _, empezando con una letra (ej. seccion)"
            : campo === "etiqueta"
              ? "Escribí la etiqueta"
              : campo === "tipo"
                ? "Elegí texto o entero"
                : issue.message;
        errores.push({ ruta: campo ? `${ruta}.${campo}` : ruta, mensaje });
      }
      return;
    }
    const c = r.data;
    if (c.patron !== null) {
      try {
        new RegExp(`^(?:${c.patron})$`, "u");
      } catch {
        errores.push({ ruta: `${ruta}.patron`, mensaje: "No es una expresión regular válida" });
      }
    }
    if (campos.some((x) => x.clave === c.clave)) errores.push({ ruta: `${ruta}.clave`, mensaje: `La clave ${c.clave} está repetida` });
    const anterior = anteriores.find((a) => a.clave === c.clave);
    if (anterior && usadas.has(c.clave) && anterior.tipo !== c.tipo) {
      errores.push({ ruta: `${ruta}.tipo`, mensaje: `La clave ${c.clave} ya tiene valores en expedientes: no cambia de tipo` });
    }
    campos.push(c);
  });
  for (const a of anteriores) {
    const cantidad = usadas.get(a.clave);
    if (cantidad !== undefined && !campos.some((c) => c.clave === a.clave)) {
      errores.push({
        ruta: "camposUbicacion",
        mensaje: `La clave ${a.clave} ("${a.etiqueta}") tiene valores en ${cantidad === 1 ? "1 expediente" : `${cantidad} expedientes`}: no se borra ni se renombra, se desactiva`,
      });
    }
  }
  return { campos, errores };
}

/**
 * Alta o modificación de un cementerio: nombre, su área externa, activo, la
 * nomenclatura (campos de ubicación) y los tipos de monumento habilitados.
 *
 * @throws ErrorDominio `validacion`, `ya_existe`, `en_uso`, `no_encontrado`
 */
export async function guardarCementerio(deps: DependenciasAdmin, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoCatalogo> {
  exigirPermiso("administrar", null, usuario);
  const d = leer(EntradaCementerio, entrada);
  return conErroresLegibles(
    () =>
      deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
        const actual = d.id == null ? null : await tx.cementerio.findUnique({ where: { id: d.id } });
        if (d.id != null && !actual) throw new ErrorDominio("no_encontrado", "No existe ese cementerio");
        if (actual) codigoFijo(actual.codigo, d.codigo);
        const errores: ErrorCampo[] = [];

        const anteriores = actual ? leerCamposUbicacion(actual.camposUbicacion, actual.nombre).map((c) => ({ ...c, ayuda: c.ayuda ?? null })) : [];
        const usadas = actual ? await clavesUsadas(tx, actual.id) : new Map<string, number>();
        const { campos, errores: erroresCampos } = controlarCamposUbicacion(d.camposUbicacion, anteriores, usadas);
        errores.push(...erroresCampos);

        const tipos = [...new Set(d.tiposMonumento.map((t) => t.trim().toUpperCase()))];
        const existentes = new Map((await tx.tipoMonumento.findMany({ where: { codigo: { in: tipos } } })).map((t) => [t.codigo, t]));
        tipos.forEach((t, i) => {
          const tipo = existentes.get(t);
          if (!tipo) errores.push({ ruta: `tiposMonumento[${i}]`, mensaje: `No existe el tipo de monumento ${t}` });
          else if (!tipo.activo && !actual?.tiposMonumento.includes(t)) errores.push({ ruta: `tiposMonumento[${i}]`, mensaje: `${tipo.nombre} está inactivo` });
        });

        const area = await tx.area.findUnique({ where: { id: d.areaId } });
        if (!area) errores.push({ ruta: "areaId", mensaje: "No existe esa área" });
        else if (area.tipo !== "externa") errores.push({ ruta: "areaId", mensaje: `${area.nombre} es un área interna: el área de un cementerio es la externa a donde va el papel` });
        else {
          const otro = await tx.cementerio.findUnique({ where: { areaId: area.id } });
          if (otro && otro.id !== actual?.id) errores.push({ ruta: "areaId", mensaje: `${area.nombre} ya es el área del cementerio ${otro.nombre}` });
          if (d.activo && !area.activa) errores.push({ ruta: "areaId", mensaje: `${area.nombre} está inactiva` });
        }
        if (errores.length > 0) {
          const enUso = erroresCampos.some((e) => e.ruta === "camposUbicacion" || e.mensaje.includes("ya tiene valores"));
          throw new ErrorDominio(enUso ? "en_uso" : "validacion", enUso ? (errores.find((e) => e.ruta === "camposUbicacion")?.mensaje ?? errores[0].mensaje) : "Revisá los datos marcados", errores);
        }

        const datos = { nombre: d.nombre, areaId: d.areaId, activo: d.activo, camposUbicacion: campos as unknown as Prisma.InputJsonArray, tiposMonumento: tipos };
        if (!actual) {
          const existente = await tx.cementerio.findUnique({ where: { codigo: d.codigo } });
          if (existente) {
            if (sinCambios(existente, { ...datos, camposUbicacion: campos })) return { id: existente.id, creado: false, repetido: true };
            throw new ErrorDominio("ya_existe", `Ya hay un cementerio ${d.codigo}`, [{ ruta: "codigo", mensaje: "Ese código ya existe" }]);
          }
          const c = await tx.cementerio.create({ data: { codigo: d.codigo, ...datos }, select: { id: true } });
          return { id: c.id, creado: true, repetido: false };
        }
        if (sinCambios({ ...actual, camposUbicacion: anteriores }, { ...datos, camposUbicacion: campos })) return { id: actual.id, creado: false, repetido: true };
        await tx.cementerio.update({ where: { id: actual.id }, data: datos });
        return { id: actual.id, creado: false, repetido: false };
      }),
    `Ya hay un cementerio ${d.codigo}`,
  );
}

// ---------------------------------------------------------------------------
// Tipos de monumento y de trámite
// ---------------------------------------------------------------------------

const EntradaTipoMonumento = z.object({
  id: Id,
  codigo: Codigo(RE_CODIGO_MONUMENTO, "Código inválido: mayúsculas y _ (ej. NICHO)"),
  nombre: Nombre,
  activo: z.boolean(),
});
export type EntradaTipoMonumento = z.input<typeof EntradaTipoMonumento>;

const EntradaTipoTramite = z.object({
  id: Id,
  codigo: Codigo(RE_CODIGO, "Código inválido: mayúsculas, números y _, empezando con una letra (ej. TRANSFERENCIA)"),
  nombre: Nombre,
  activo: z.boolean(),
});
export type EntradaTipoTramite = z.input<typeof EntradaTipoTramite>;

/** Lo común a los dos catálogos simples (código, nombre, activo). */
async function guardarSimple(
  tx: Transaccion,
  tabla: "tipoMonumento" | "tipoTramite",
  d: { id?: number | null; codigo: string; nombre: string; activo: boolean },
  que: string,
): Promise<ResultadoCatalogo> {
  const delegado = tabla === "tipoMonumento" ? tx.tipoMonumento : tx.tipoTramite;
  // Los dos delegados tienen la misma forma para estas columnas.
  const t = delegado as unknown as typeof tx.tipoTramite;
  const datos = { nombre: d.nombre, activo: d.activo };
  if (d.id == null) {
    const existente = await t.findUnique({ where: { codigo: d.codigo } });
    if (existente) {
      if (sinCambios(existente, datos)) return { id: existente.id, creado: false, repetido: true };
      throw new ErrorDominio("ya_existe", `Ya hay un ${que} ${d.codigo}`, [{ ruta: "codigo", mensaje: "Ese código ya existe" }]);
    }
    const nuevo = await t.create({ data: { codigo: d.codigo, ...datos }, select: { id: true } });
    return { id: nuevo.id, creado: true, repetido: false };
  }
  const actual = await t.findUnique({ where: { id: d.id } });
  if (!actual) throw new ErrorDominio("no_encontrado", `No existe ese ${que}`);
  codigoFijo(actual.codigo, d.codigo);
  if (sinCambios(actual, datos)) return { id: actual.id, creado: false, repetido: true };
  await t.update({ where: { id: actual.id }, data: datos });
  return { id: actual.id, creado: false, repetido: false };
}

/** Alta o modificación de un tipo de monumento (desactivarlo lo saca del alta en todos los cementerios). */
export async function guardarTipoMonumento(deps: DependenciasAdmin, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoCatalogo> {
  exigirPermiso("administrar", null, usuario);
  const d = leer(EntradaTipoMonumento, entrada);
  return conErroresLegibles(() => deps.escribir(usuario.id, limpiarMotivo(motivo), (tx) => guardarSimple(tx, "tipoMonumento", d, "tipo de monumento")), `Ya hay un tipo de monumento ${d.codigo}`);
}

/**
 * Alta o modificación de un tipo de trámite. Desactivarlo no retira sus
 * plantillas: eso se hace en Plantillas.
 */
export async function guardarTipoTramite(deps: DependenciasAdmin, usuario: UsuarioPermisos, entrada: unknown, motivo: string | null = null): Promise<ResultadoCatalogo> {
  exigirPermiso("administrar", null, usuario);
  const d = leer(EntradaTipoTramite, entrada);
  return conErroresLegibles(() => deps.escribir(usuario.id, limpiarMotivo(motivo), (tx) => guardarSimple(tx, "tipoTramite", d, "tipo de trámite")), `Ya hay un tipo de trámite ${d.codigo}`);
}
