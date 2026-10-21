import { Prisma } from "@/generated/prisma/client";
import { esFechaValida, type FechaISO } from "@/lib/fechas";
import type { Lector } from "./expedientes/dependencias";
import { ErrorDominio } from "./expedientes/errores";
import { formatearNumeroInterno, interpretarFormaCorta, interpretarNumeroInterno, numeroCorto } from "./expedientes/numero";
import { leerCamposUbicacion, normalizarValorUbicacion } from "./expedientes/ubicacion";
import { dniDeCuil, normalizar, normalizarDni, normalizarNumero, tokens } from "./normalizar";
import { ESTADOS_EXPEDIENTE, exigirPermiso, type EstadoExpediente, type UsuarioPermisos } from "./permisos";

/**
 * Búsqueda de expedientes (docs/propuesta-mvp.md, 2.13(g)).
 *
 * Dos partes:
 * 1. `armarBusqueda()`: el texto de la columna `expedientes.busqueda`, que la
 *    app arma en la misma transacción de cada cambio (alta, edición). Es
 *    `f_normalizar()` de: número interno y su forma corta, N° municipal y
 *    padrón (como se escribieron y normalizados), cementerio, ubicación,
 *    nombres y DNI de las personas vigentes no suprimidas (de una persona
 *    jurídica, la razón social y el CUIT), y los campos extra `buscable`.
 * 2. `buscarExpedientes()`: la caja única de `/expedientes?q=`, que NO adivina
 *    el tipo de número:
 *    - **Prefijo explícito**: "CEM-2026-42" (o `^CEM\D*(\d{4})\D+(\d{1,6})$`)
 *      abre ese expediente directo.
 *    - **Solo dígitos y separadores** (`.`, `-`, `/`, espacios): se quitan los
 *      separadores y se busca por igualdad, en paralelo, en el N° interno en su
 *      forma corta (si vino como N/AAAA), el N° municipal, el padrón y el DNI
 *      de las personas (con 11 dígitos, también el DNI que contiene el CUIL y
 *      el CUIT de una persona jurídica).
 *      Cada resultado dice por dónde coincidió; si hay uno solo, se abre.
 *    - **Texto**: cada palabra normalizada tiene que aparecer en `busqueda`
 *      (LIKE, con el índice trigram) y se ordena por `similarity`.
 *    Filtros: cementerio y sus campos de ubicación (`ubicacion @> {…}`),
 *    estado, tipo de trámite, plantilla, área actual y fecha de inicio. Los
 *    anulados se excluyen salvo que se pidan. 50 resultados como máximo.
 *
 * La búsqueda no registra accesos: lo que queda en `auditoria.accesos` es abrir
 * la ficha (`ver_expediente`).
 */

export const MAXIMO_RESULTADOS = 50;

// ---------------------------------------------------------------------------
// La columna `busqueda`
// ---------------------------------------------------------------------------

export interface PersonaBusqueda {
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  /** Solo personas jurídicas. */
  razonSocial: string | null;
  cuit: string | null;
}

export interface DatosBusqueda {
  anio: number;
  secuencia: number;
  numeroMunicipal: string | null;
  padron: string | null;
  /** Nombre del cementerio. */
  cementerio: string;
  ubicacionTexto: string;
  /** Solo las vigentes y no suprimidas (quien llama las filtra). */
  personas: readonly PersonaBusqueda[];
  /** Los valores de los campos extra marcados `buscable`. */
  extrasBuscables: ReadonlyArray<string | number | null | undefined>;
}

/** El valor de `expedientes.busqueda`. Determinista: mismos datos, mismo texto. */
export function armarBusqueda(d: DatosBusqueda): string {
  const partes: string[] = [
    formatearNumeroInterno(d.anio, d.secuencia),
    numeroCorto(d.anio, d.secuencia),
    d.numeroMunicipal ?? "",
    normalizarNumero(d.numeroMunicipal) ?? "",
    d.padron ?? "",
    normalizarNumero(d.padron) ?? "",
    d.cementerio,
    d.ubicacionTexto,
  ];
  for (const p of d.personas) {
    partes.push(p.apellido ?? "", p.nombres ?? "", p.dni ?? "", p.razonSocial ?? "", p.cuit ?? "");
  }
  for (const v of d.extrasBuscables) {
    if (v !== null && v !== undefined) partes.push(String(v));
  }
  // Sin partes repetidas (el N° municipal que ya está normalizado, dos personas
  // con el mismo apellido): no cambian qué se encuentra y alargan el texto, y
  // un texto más largo baja la similarity de todo. Se deduplican partes y no
  // palabras para no separar "lote 12".
  const vistas = new Set<string>();
  const normalizadas: string[] = [];
  for (const parte of partes) {
    const n = normalizar(parte);
    if (n !== "" && !vistas.has(n)) {
      vistas.add(n);
      normalizadas.push(n);
    }
  }
  return normalizadas.join(" ");
}

// ---------------------------------------------------------------------------
// La consulta de la caja única
// ---------------------------------------------------------------------------

export type ConsultaAnalizada =
  | { tipo: "vacia" }
  /** "CEM…": abre ese número. */
  | { tipo: "numero_interno"; anio: number; secuencia: number; numero: string }
  /** Solo dígitos y separadores. */
  | {
      tipo: "numerica";
      /** Sin separadores: se compara con `numero_municipal_norm`, `padron_norm`. */
      digitos: string;
      /** Si vino como N/AAAA: también el número interno. */
      formaCorta: { anio: number; secuencia: number } | null;
      /** DNI a buscar: los dígitos y, si son 11, el DNI del CUIL. */
      dnis: string[];
      /** Con 11 dígitos, el CUIT de una persona jurídica. */
      cuits: string[];
    }
  | { tipo: "texto"; normalizada: string; palabras: string[] };

const RE_SOLO_NUMEROS = /^[\d.\-/\s]+$/;

export function analizarConsulta(q: string | null | undefined): ConsultaAnalizada {
  const texto = (q ?? "").trim();
  if (texto === "") return { tipo: "vacia" };

  if (/^cem/i.test(texto)) {
    const p = interpretarNumeroInterno(texto);
    if (p) return { tipo: "numero_interno", ...p, numero: formatearNumeroInterno(p.anio, p.secuencia) };
  }

  if (RE_SOLO_NUMEROS.test(texto) && /\d/.test(texto)) {
    const digitos = texto.replace(/\D/g, "");
    const dnis = new Set<string>();
    const cuits: string[] = [];
    const dni = normalizarDni(digitos);
    if (dni) dnis.add(dni);
    if (digitos.length === 11) {
      const delCuil = dniDeCuil(digitos);
      if (delCuil) dnis.add(delCuil);
      cuits.push(digitos);
    }
    return { tipo: "numerica", digitos, formaCorta: interpretarFormaCorta(texto), dnis: [...dnis], cuits };
  }

  const palabras = tokens(texto);
  if (palabras.length === 0) return { tipo: "vacia" };
  return { tipo: "texto", normalizada: normalizar(texto), palabras };
}

// ---------------------------------------------------------------------------
// Búsqueda en la base
// ---------------------------------------------------------------------------

export interface FiltrosBusqueda {
  cementerioId?: number;
  /** Valores de campos de ubicación (requiere `cementerioId`): se normalizan como en el alta. */
  ubicacion?: Record<string, string | null>;
  estados?: EstadoExpediente[];
  tipoTramiteId?: number;
  /** Todas las versiones de esa plantilla. */
  plantillaCodigo?: string;
  areaActualId?: number;
  fechaInicioDesde?: FechaISO;
  fechaInicioHasta?: FechaISO;
  /** Por defecto los anulados no aparecen. */
  incluirAnulados?: boolean;
  /**
   * Semana 4: `true`, solo los que tienen la carga histórica abierta; `false`,
   * solo los que no (lo usan los enlaces del panel, que no cuentan las cargas
   * abiertas). Sin valor, todos.
   */
  cargaHistorica?: boolean;
}

export interface OpcionesBusquedaInterna {
  /** Filas como máximo (por defecto 50). La exportación CSV pide más. */
  limite?: number;
  /**
   * El prefijo "CEM-…" lista ese expediente (si cumple los filtros) en vez de
   * pedir abrirlo: la exportación no abre fichas.
   */
  listarNumeroInterno?: boolean;
}

export interface EntradaBusqueda {
  /** Lo que se escribió en la caja única. Vacío: lista por filtros, los más nuevos primero. */
  q?: string | null;
  filtros?: FiltrosBusqueda;
}

export type CampoCoincidencia = "numero_interno" | "numero_municipal" | "padron" | "dni" | "cuit";

export interface Coincidencia {
  campo: CampoCoincidencia;
  /** "N° municipal", "N° interno", "Padrón", "DNI del solicitante". */
  etiqueta: string;
}

export interface ResultadoBusquedaFila {
  id: string;
  numero: string;
  numeroCorto: string;
  numeroMunicipal: string | null;
  estado: EstadoExpediente;
  fechaInicio: FechaISO;
  cargaHistorica: boolean;
  sinConfirmar: boolean;
  tipoTramite: { codigo: string; nombre: string };
  plantilla: { codigo: string; nombre: string; version: number };
  cementerio: { codigo: string; nombre: string };
  ubicacionTexto: string;
  paso: { clave: string; nombre: string };
  areaActual: { codigo: string; nombre: string };
  /** "APELLIDO, Nombres" (o la razón social) del primer titular vigente, o null. */
  titular: string | null;
  /** Por dónde coincidió (solo en la búsqueda numérica). */
  coincidencias: Coincidencia[];
  /** `similarity` con la consulta (solo en la búsqueda de texto). */
  similitud: number | null;
}

export interface ResultadoBusqueda {
  consulta: ConsultaAnalizada;
  /**
   * Número para abrir directo, sin mostrar la lista: el prefijo CEM (si existe)
   * o una búsqueda numérica con un solo resultado.
   */
  abrir: string | null;
  resultados: ResultadoBusquedaFila[];
  /** Había más de 50: conviene afinar la búsqueda. */
  hayMas: boolean;
}

interface FilaSql {
  id: bigint;
  numero_interno: string;
  anio: number;
  secuencia: number;
  numero_municipal: string | null;
  estado: string;
  fecha_inicio: string;
  carga_historica: boolean;
  sin_confirmar: boolean;
  paso_clave: string;
  paso_nombre: string | null;
  ubicacion_texto: string;
  tipo_codigo: string;
  tipo_nombre: string;
  plantilla_codigo: string;
  plantilla_nombre: string;
  plantilla_version: number;
  cementerio_codigo: string;
  cementerio_nombre: string;
  area_codigo: string;
  area_nombre: string;
  titular: string | null;
  coincidencias: Array<{ campo: CampoCoincidencia; rol: string | null }> | null;
  similitud: number | null;
}

const ETIQUETAS: Record<Exclude<CampoCoincidencia, "dni" | "cuit">, string> = {
  numero_interno: "N° interno",
  numero_municipal: "N° municipal",
  padron: "Padrón",
};

function etiquetaCoincidencia(campo: CampoCoincidencia, rol: string | null): string {
  if (campo !== "dni" && campo !== "cuit") return ETIQUETAS[campo];
  const que = campo === "dni" ? "DNI" : "CUIT";
  return rol ? `${que} del ${rol.replaceAll("_", " ")}` : que;
}

function esEstado(valor: string): valor is EstadoExpediente {
  return (ESTADOS_EXPEDIENTE as readonly string[]).includes(valor);
}

/** Arma las condiciones de los filtros (sin la consulta). */
async function condicionesDeFiltros(lector: Lector, f: FiltrosBusqueda): Promise<Prisma.Sql[]> {
  const c: Prisma.Sql[] = [];
  if (!f.incluirAnulados) c.push(Prisma.sql`e.estado <> 'anulado'`);
  if (f.estados && f.estados.length > 0) {
    const estados = f.estados.filter(esEstado);
    c.push(Prisma.sql`e.estado = ANY(${estados}::text[])`);
  }
  if (f.tipoTramiteId !== undefined) c.push(Prisma.sql`e.tipo_tramite_id = ${f.tipoTramiteId}`);
  if (f.plantillaCodigo !== undefined) c.push(Prisma.sql`pl.codigo = ${f.plantillaCodigo}`);
  if (f.areaActualId !== undefined) c.push(Prisma.sql`e.area_actual_id = ${f.areaActualId}`);
  if (f.cargaHistorica !== undefined) c.push(Prisma.sql`e.carga_historica = ${f.cargaHistorica}`);
  for (const [clave, valor] of [
    ["fechaInicioDesde", f.fechaInicioDesde],
    ["fechaInicioHasta", f.fechaInicioHasta],
  ] as const) {
    if (valor !== undefined && !esFechaValida(valor)) {
      throw new ErrorDominio("validacion", "Fecha inválida en el filtro", [{ ruta: `filtros.${clave}`, mensaje: "Fecha inválida (AAAA-MM-DD)" }]);
    }
  }
  if (f.fechaInicioDesde !== undefined) c.push(Prisma.sql`e.fecha_inicio >= ${f.fechaInicioDesde}::date`);
  if (f.fechaInicioHasta !== undefined) c.push(Prisma.sql`e.fecha_inicio <= ${f.fechaInicioHasta}::date`);

  const conValor = Object.entries(f.ubicacion ?? {}).filter(([, v]) => v !== null && v.trim() !== "");
  if (conValor.length > 0 && f.cementerioId === undefined) {
    throw new ErrorDominio("validacion", "Para filtrar por ubicación elegí el cementerio", [
      { ruta: "filtros.cementerioId", mensaje: "Elegí el cementerio" },
    ]);
  }
  if (f.cementerioId !== undefined) {
    c.push(Prisma.sql`e.cementerio_id = ${f.cementerioId}`);
    if (conValor.length > 0) {
      const cementerio = await lector.cementerio.findUnique({ where: { id: f.cementerioId } });
      const campos = cementerio ? leerCamposUbicacion(cementerio.camposUbicacion, cementerio.nombre) : [];
      const porClave = new Map(campos.map((campo) => [campo.clave, campo]));
      // Se normaliza igual que en el alta: "012" encuentra el lote "12".
      const contiene = Object.fromEntries(
        conValor.map(([clave, valor]) => [clave, normalizarValorUbicacion(porClave.get(clave) ?? { tipo: "texto" }, valor ?? "")]),
      );
      c.push(Prisma.sql`e.ubicacion @> ${JSON.stringify(contiene)}::jsonb`);
    }
  }
  return c;
}

/**
 * La caja única y los filtros. Ver el comentario del módulo.
 *
 * @throws PermisoDenegado si el usuario no puede ver expedientes (inactivo).
 * @throws ErrorDominio("validacion") si un filtro es inválido.
 */
export async function buscarExpedientes(
  lector: Lector,
  usuario: UsuarioPermisos,
  entrada: EntradaBusqueda,
  opciones: OpcionesBusquedaInterna = {},
): Promise<ResultadoBusqueda> {
  exigirPermiso("ver_expediente", null, usuario);
  const consulta = analizarConsulta(entrada.q);
  const limite = opciones.limite ?? MAXIMO_RESULTADOS;

  // El prefijo CEM abre el expediente aunque esté anulado o no cumpla los
  // filtros: es un número exacto.
  if (consulta.tipo === "numero_interno" && !opciones.listarNumeroInterno) {
    const e = await lector.expediente.findUnique({ where: { numeroInterno: consulta.numero }, select: { numeroInterno: true } });
    return { consulta, abrir: e?.numeroInterno ?? null, resultados: [], hayMas: false };
  }

  const condiciones = await condicionesDeFiltros(lector, entrada.filtros ?? {});
  if (consulta.tipo === "numero_interno") condiciones.push(Prisma.sql`e.numero_interno = ${consulta.numero}`);
  let conCoincidencias = Prisma.empty;
  let similitud = Prisma.sql`NULL::real`;
  let orden = Prisma.sql`e.anio DESC, e.secuencia DESC`;

  if (consulta.tipo === "numerica") {
    const partes: Prisma.Sql[] = [
      Prisma.sql`SELECT x.id, 'numero_municipal'::text AS campo, NULL::text AS rol FROM public.expedientes x WHERE x.numero_municipal_norm = ${consulta.digitos}`,
      Prisma.sql`SELECT x.id, 'padron'::text, NULL::text FROM public.expedientes x WHERE x.padron_norm = ${consulta.digitos}`,
    ];
    if (consulta.formaCorta) {
      partes.push(
        Prisma.sql`SELECT x.id, 'numero_interno'::text, NULL::text FROM public.expedientes x
                    WHERE x.anio = ${consulta.formaCorta.anio} AND x.secuencia = ${consulta.formaCorta.secuencia}`,
      );
    }
    if (consulta.dnis.length > 0) {
      partes.push(
        Prisma.sql`SELECT p.expediente_id, 'dni'::text, p.rol FROM public.expediente_personas p
                    WHERE p.dni = ANY(${consulta.dnis}::text[]) AND p.vigente AND p.suprimida_en IS NULL`,
      );
    }
    if (consulta.cuits.length > 0) {
      partes.push(
        Prisma.sql`SELECT p.expediente_id, 'cuit'::text, p.rol FROM public.expediente_personas p
                    WHERE p.cuit = ANY(${consulta.cuits}::text[]) AND p.vigente AND p.suprimida_en IS NULL`,
      );
    }
    conCoincidencias = Prisma.sql`WITH coincidencias AS (${Prisma.join(partes, " UNION ")})`;
    condiciones.push(Prisma.sql`e.id IN (SELECT k.id FROM coincidencias k)`);
  } else if (consulta.tipo === "texto") {
    for (const palabra of consulta.palabras) {
      // Las palabras normalizadas son [a-z0-9]: no hay % ni _ que escapar.
      condiciones.push(Prisma.sql`e.busqueda LIKE ${`%${palabra}%`}`);
    }
    similitud = Prisma.sql`public.similarity(e.busqueda, ${consulta.normalizada})`;
    orden = Prisma.sql`similitud DESC, e.anio DESC, e.secuencia DESC`;
  }

  const coincidenciasSql =
    consulta.tipo === "numerica"
      ? Prisma.sql`(SELECT json_agg(DISTINCT jsonb_build_object('campo', k.campo, 'rol', k.rol)) FROM coincidencias k WHERE k.id = e.id)`
      : Prisma.sql`NULL::json`;
  const donde = condiciones.length > 0 ? Prisma.sql`WHERE ${Prisma.join(condiciones, " AND ")}` : Prisma.empty;

  const filas = await lector.$queryRaw<FilaSql[]>`
    ${conCoincidencias}
    SELECT e.id, e.numero_interno, e.anio, e.secuencia, e.numero_municipal, e.estado,
           e.fecha_inicio::text AS fecha_inicio, e.carga_historica, (e.recibido_en IS NULL) AS sin_confirmar,
           e.paso_clave, e.ubicacion_texto,
           (SELECT x ->> 'nombre' FROM jsonb_array_elements(pl.definicion -> 'pasos') AS x
             WHERE x ->> 'clave' = e.paso_clave LIMIT 1) AS paso_nombre,
           tt.codigo AS tipo_codigo, tt.nombre AS tipo_nombre,
           pl.codigo AS plantilla_codigo, pl.nombre AS plantilla_nombre, pl.version::int AS plantilla_version,
           c.codigo AS cementerio_codigo, c.nombre AS cementerio_nombre,
           a.codigo AS area_codigo, a.nombre AS area_nombre,
           (SELECT nullif(coalesce(p.razon_social, concat_ws(', ', p.apellido, p.nombres)), '') FROM public.expediente_personas p
             WHERE p.expediente_id = e.id AND p.vigente AND p.rol = 'titular' ORDER BY p.orden LIMIT 1) AS titular,
           ${coincidenciasSql} AS coincidencias,
           ${similitud} AS similitud
      FROM public.expedientes e
      JOIN public.tipos_tramite tt ON tt.id = e.tipo_tramite_id
      JOIN public.plantillas pl ON pl.id = e.plantilla_id
      JOIN public.cementerios c ON c.id = e.cementerio_id
      JOIN public.areas a ON a.id = e.area_actual_id
      ${donde}
     ORDER BY ${orden}
     LIMIT ${limite + 1}`;

  const resultados = filas.slice(0, limite).map(
    (f): ResultadoBusquedaFila => ({
      id: f.id.toString(),
      numero: f.numero_interno,
      numeroCorto: numeroCorto(f.anio, f.secuencia),
      numeroMunicipal: f.numero_municipal,
      estado: esEstado(f.estado) ? f.estado : "en_tramite",
      fechaInicio: f.fecha_inicio,
      cargaHistorica: f.carga_historica,
      sinConfirmar: f.sin_confirmar,
      tipoTramite: { codigo: f.tipo_codigo, nombre: f.tipo_nombre },
      plantilla: { codigo: f.plantilla_codigo, nombre: f.plantilla_nombre, version: f.plantilla_version },
      cementerio: { codigo: f.cementerio_codigo, nombre: f.cementerio_nombre },
      ubicacionTexto: f.ubicacion_texto,
      paso: { clave: f.paso_clave, nombre: f.paso_nombre ?? f.paso_clave },
      areaActual: { codigo: f.area_codigo, nombre: f.area_nombre },
      titular: f.titular,
      coincidencias: (f.coincidencias ?? [])
        .map((k) => ({ campo: k.campo, etiqueta: etiquetaCoincidencia(k.campo, k.rol) }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es")),
      similitud: f.similitud === null ? null : Number(f.similitud),
    }),
  );

  return {
    consulta,
    abrir: consulta.tipo === "numerica" && resultados.length === 1 ? resultados[0].numero : null,
    resultados,
    hayMas: filas.length > limite,
  };
}
