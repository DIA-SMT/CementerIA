import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { fechaDesdeDb, hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { evaluarPermiso, exigirPermiso, type Decision, type EstadoExpediente, type UsuarioPermisos } from "../permisos";
import type { DefinicionPlantilla, PasoPlantilla } from "../plantillas/esquema";
import { comoEstado, exigirNumero, permisosDelExpediente, registrarAcceso, type OpcionesAcceso } from "./acceso";
import { leerCamposUbicacion } from "./ubicacion";
import { leerDefinicion, type CodigoNombre } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, exigirMotivo, limpiarMotivo, noEncontrado } from "./errores";
import { mostrarContacto, type ContactoMostrado } from "./enmascarar";
import { leerItems, type EstadoDocumento } from "./items";
import { numeroCorto } from "./numero";
import { areasDelPaso } from "./proyeccion";

/**
 * La ficha digital (docs/propuesta-mvp.md, sección 5, `/expedientes/[numero]`)
 * y "Ver datos completos" (decisión 13).
 *
 * `obtenerFicha()` arma todo lo que la pantalla muestra, en una transacción que
 * además registra `ver_expediente` en `auditoria.accesos`. El contacto
 * (teléfono, correo, domicilio) y los adjuntos van ENMASCARADOS salvo para quien
 * "trabaja el expediente" (3.2): área responsable, áreas por las que pasó, Mesa
 * de Entradas, Dirección y admin. El resto ve `contacto.enmascarado = true` y
 * el botón "Ver datos completos" (`acciones.verDatosCompletos.requiereMotivo`),
 * que llama a `verDatosCompletos()` con un motivo.
 */

// ---------------------------------------------------------------------------
// Tipos de la ficha
// ---------------------------------------------------------------------------

export interface AreaFicha extends CodigoNombre {
  id: number;
  tipo: string;
}

export type Situacion =
  /** El área actual no confirmó la recepción (`recibido_en` nulo). */
  | "sin_confirmar"
  /** Volvió por una devolución (`paso_retorno_clave`). */
  | "devuelto"
  /** "Expediente iniciado antes del sistema" con la transcripción abierta. */
  | "carga_historica"
  /** Viene de otro expediente o fue reiniciado en otro. */
  | "reiniciado"
  | "plazo_por_vencer"
  | "plazo_vencido";

export interface CampoValorFicha {
  clave: string;
  etiqueta: string;
  valor: string | number | null;
}

export interface CampoExtraFicha extends CampoValorFicha {
  tipo: string;
  obligatorio: boolean;
  /** Clave y nombre del paso al salir del cual se exige, o null (al concluir). */
  exigirAlSalirDe: { clave: string; nombre: string } | null;
  /** Para un campo de tipo cementerio, el nombre; para los demás, el valor. */
  valorTexto: string | null;
}

export interface SubtareaFicha {
  clave: string;
  nombre: string;
  obligatoria: boolean;
  dato: "fecha" | "texto" | null;
  datoObligatorio: boolean;
  hecha: boolean;
  /** El dato anotado al tildar (fecha YYYY-MM-DD o texto). */
  valor: string | null;
  movimientoId: string | null;
  historica: boolean;
  /** La destildó una devolución (3.4). */
  reiniciadaPorMovimientoId: string | null;
}

export interface PasoFicha {
  orden: number;
  clave: string;
  nombre: string;
  /** El área concreta (resuelto `$CEMENTERIO`), o null si sale de un campo extra sin valor. */
  area: AreaFicha | null;
  /** Texto de `pasos[].area` cuando no se puede resolver ("$CAMPO:cementerio_destino"). */
  areaDefinida: string;
  custodia: AreaFicha | null;
  estado: "en_tramite" | "espera_pago_dim";
  omitible: boolean;
  diasAlerta: number;
  instrucciones: string | null;
  plazo: DefinicionPlantilla["pasos"][number]["plazo"];
  situacion: "cumplido" | "actual" | "pendiente";
  subtareas: SubtareaFicha[];
}

export interface DocumentoFicha {
  clave: string;
  nombre: string;
  origen: "direccion" | "concesionario";
  obligatorio: boolean;
  exigirAlSalirDe: { clave: string; nombre: string } | null;
  /** no, sugerido u obligatorio. */
  adjunto: "no" | "sugerido" | "obligatorio";
  estado: EstadoDocumento;
  obs: string | null;
  movimientoId: string | null;
  /** Ids de los movimientos `adjunto` vigentes; null si están enmascarados. */
  adjuntos: string[] | null;
  cantidadAdjuntos: number;
}

export interface PersonaFicha {
  id: string;
  rol: string;
  /** La etiqueta del rol en la plantilla ("Titular de la concesión"). */
  etiquetaRol: string;
  orden: number;
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  fallecido: boolean;
  fechaDefuncion: FechaISO | null;
  vinculo: string | null;
  esContacto: boolean;
  vigente: boolean;
  /** Ley 25.326: quedan el rol y la constancia, sin datos. */
  suprimida: boolean;
  /** La versión que la reemplazó (en `historicas`). */
  reemplazadaPorId: string | null;
  /** El movimiento `alta` o `edicion` que creó esta versión. */
  creadaMovimientoId: string;
  contacto: ContactoMostrado;
}

export interface ConceptoFicha {
  clave: string;
  nombre: string;
  via: "boleta" | "plan_dim";
  paso: { clave: string; nombre: string };
}

export interface UsuarioFicha {
  id: number;
  nombre: string;
  apellido: string;
  /** "J. Pérez", como en la línea de tiempo (2.13(c)). */
  corto: string;
}

export interface MovimientoFicha {
  id: string;
  secuencia: number;
  tipo: string;
  fechaEfectiva: Date;
  precisionFecha: "dia" | "minuto";
  registradoEn: Date;
  /** Más de 48 h entre la fecha efectiva y la de registro (2.13(c)). */
  diferido: boolean;
  usuario: UsuarioFicha;
  areaUsuario: CodigoNombre | null;
  pasoOrigen: { clave: string; nombre: string } | null;
  pasoDestino: { clave: string; nombre: string } | null;
  areaOrigen: CodigoNombre | null;
  areaDestino: CodigoNombre | null;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  observacion: string | null;
  motivo: string | null;
  /** `movimientos.datos` (sin datos personales; con el contacto enmascarado, sin nombre ni ruta de los adjuntos). */
  datos: Prisma.JsonValue;
  cargaHistorica: boolean;
  fuente: string | null;
  corrigeMovimientoId: string | null;
  /** Ids de las correcciones de este movimiento: la línea de tiempo lo muestra tachado. */
  corregidoPor: string[];
  /** Personas que creó (alta o edición): las versiones nuevas dicen a cuál reemplazan. */
  personasCreadas: Array<{ id: string; rol: string; orden: number; reemplazaA: string | null }>;
}

export interface PlazoFicha {
  desde: FechaISO | null;
  diasHabiles: number;
  cumplidoEn: FechaISO | null;
  /** Vencimiento (f_sumar_dias_habiles), si el plazo ya empezó. */
  vence: FechaISO | null;
  /** Días hábiles que faltan (negativo: vencido hace N), si empezó. */
  faltan: number | null;
}

export interface Ficha {
  id: string;
  numero: string;
  numeroCorto: string;
  numeroMunicipal: string | null;
  estado: EstadoExpediente;
  estadoPrevio: string | null;
  /** Para el bloqueo optimista: se manda de vuelta con cada acción. */
  version: number;
  fechaInicio: FechaISO;
  cargaHistorica: boolean;
  ubicacionArchivo: string | null;
  tipoTramite: CodigoNombre;
  plantilla: {
    id: number;
    codigo: string;
    nombre: string;
    version: number;
    /** La versión publicada hoy de ese código (null si se retiró sin reemplazo). */
    versionPublicada: number | null;
    hayVersionNueva: boolean;
    /** "Renovación, pago de contado · v1 (hay v2)". */
    texto: string;
  };
  cementerio: { id: number } & CodigoNombre;
  tipoMonumento: CodigoNombre;
  /** Valores de ubicación con su etiqueta, en el orden del cementerio (también los campos desactivados que tengan valor). */
  ubicacion: CampoValorFicha[];
  ubicacionTexto: string;
  padron: string | null;
  formaPago: string | null;
  observaciones: string | null;
  datosExtra: CampoExtraFicha[];
  paso: { clave: string; nombre: string; orden: number; total: number; esFinal: boolean };
  areaActual: AreaFicha;
  areaResponsable: AreaFicha;
  enAreaDesde: Date;
  recibidoEn: Date | null;
  plazo: PlazoFicha | null;
  situaciones: Situacion[];
  expedienteAnterior: string | null;
  expedientesSiguientes: string[];
  creadoEn: Date;
  creadoPor: UsuarioFicha;
  recorrido: PasoFicha[];
  documentacion: { direccion: DocumentoFicha[]; concesionario: DocumentoFicha[] };
  /** Personas vigentes, por rol (en el orden de la plantilla) y orden. */
  personas: PersonaFicha[];
  /** Versiones anteriores y bajas, para la diferencia entre versiones en la línea de tiempo. */
  personasHistoricas: PersonaFicha[];
  conceptos: ConceptoFicha[];
  /** Ordenado por fecha efectiva y secuencia, del más viejo al más nuevo. */
  historial: MovimientoFicha[];
  /** true si el contacto y los adjuntos se ven completos. */
  datosCompletos: boolean;
  /** Qué puede hacer el usuario (los mismos permisos que exigen las acciones). */
  acciones: {
    verDatosCompletos: Decision;
    editarIdentificatorios: Decision;
    editarContacto: Decision;
    completarCamposExtra: Decision;
    imprimir: Decision;
  };
}

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

const MS_48_HORAS = 48 * 60 * 60 * 1000;

const INCLUIR = {
  tipoTramite: { select: { codigo: true, nombre: true } },
  plantilla: { select: { id: true, codigo: true, nombre: true, version: true, definicion: true } },
  cementerio: true,
  monumento: { select: { codigo: true, nombre: true } },
  areaActual: { select: { id: true, codigo: true, nombre: true, tipo: true } },
  areaResponsable: { select: { id: true, codigo: true, nombre: true, tipo: true } },
  creador: { select: { id: true, nombre: true, apellido: true } },
  expedienteAnterior: { select: { numeroInterno: true } },
  reiniciadoEn: { select: { numeroInterno: true } },
} as const satisfies Prisma.ExpedienteInclude;

function usuarioFicha(u: { id: number; nombre: string; apellido: string }): UsuarioFicha {
  const inicial = u.nombre.trim().charAt(0);
  return { id: u.id, nombre: u.nombre, apellido: u.apellido, corto: inicial ? `${inicial}. ${u.apellido}` : u.apellido };
}

function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Saca de `datos` lo que no tiene que ver quien no trabaja el expediente. */
function datosVisibles(tipo: string, datos: Prisma.JsonValue, completo: boolean): Prisma.JsonValue {
  if (completo || tipo !== "adjunto" || datos === null || typeof datos !== "object" || Array.isArray(datos)) return datos;
  const visibles: Record<string, Prisma.JsonValue> = {};
  for (const clave of ["documento", "mime", "bytes"]) {
    const valor = datos[clave];
    if (valor !== undefined) visibles[clave] = valor;
  }
  return visibles;
}

interface FilaPersona {
  id: bigint;
  rol: string;
  orden: number;
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  fallecido: boolean;
  fechaDefuncion: Date | null;
  vinculo: string | null;
  telefono: string | null;
  telefonoWhatsapp: boolean;
  email: string | null;
  domicilio: string | null;
  esContacto: boolean;
  vigente: boolean;
  reemplazadaPorId: bigint | null;
  creadaMovId: bigint;
  suprimidaEn: Date | null;
}

function personaFicha(p: FilaPersona, etiquetas: ReadonlyMap<string, string>, completo: boolean): PersonaFicha {
  return {
    id: p.id.toString(),
    rol: p.rol,
    etiquetaRol: etiquetas.get(p.rol) ?? p.rol,
    orden: p.orden,
    apellido: p.apellido,
    nombres: p.nombres,
    dni: p.dni,
    fallecido: p.fallecido,
    fechaDefuncion: fechaDesdeDb(p.fechaDefuncion),
    vinculo: p.vinculo,
    esContacto: p.esContacto,
    vigente: p.vigente,
    suprimida: p.suprimidaEn !== null,
    reemplazadaPorId: p.reemplazadaPorId?.toString() ?? null,
    creadaMovimientoId: p.creadaMovId.toString(),
    contacto: mostrarContacto(
      { telefono: p.telefono, telefonoWhatsapp: p.telefonoWhatsapp, email: p.email, domicilio: p.domicilio },
      completo,
    ),
  };
}

async function calcularPlazo(tx: Transaccion, e: { plazoDesde: Date | null; plazoDiasHabiles: number | null; plazoCumplidoEn: Date | null }, hoy: FechaISO): Promise<PlazoFicha | null> {
  if (e.plazoDiasHabiles === null) return null;
  const desde = fechaDesdeDb(e.plazoDesde);
  let vence: FechaISO | null = null;
  let faltan: number | null = null;
  if (desde !== null) {
    // El vencimiento se calcula al leer (3.6): si se carga un asueto, se corrige solo.
    const [r] = await tx.$queryRaw<Array<{ vence: string; faltan: number }>>`
      SELECT public.f_sumar_dias_habiles(${desde}::date, ${e.plazoDiasHabiles}::int)::text AS vence,
             public.f_dias_habiles_entre(${hoy}::date, public.f_sumar_dias_habiles(${desde}::date, ${e.plazoDiasHabiles}::int)) AS faltan`;
    vence = r?.vence ?? null;
    faltan = r?.faltan ?? null;
  }
  return { desde, diasHabiles: e.plazoDiasHabiles, cumplidoEn: fechaDesdeDb(e.plazoCumplidoEn), vence, faltan };
}

/** Días hábiles restantes a partir de los cuales el plazo se pinta "por vencer" (3.6). */
const DIAS_PLAZO_POR_VENCER = 5;

/** Arma la ficha sin registrar el acceso (lo registra quien llama: la ficha o la hoja del historial). */
export async function armarFicha(tx: Transaccion, usuario: UsuarioPermisos, numero: string, hoy: FechaISO) {
  const e = await tx.expediente.findUnique({ where: { numeroInterno: numero }, include: INCLUIR });
  if (!e) throw noEncontrado(numero);

  const permisos = await permisosDelExpediente(tx, e);
  const ver = evaluarPermiso("ver_datos_completos", permisos, usuario);
  const completo = ver.permitido && !ver.requiereMotivo;
  const def = leerDefinicion(e.plantilla.definicion, e.plantilla.codigo, e.plantilla.version);
  const items = leerItems(e.items);

  // De a una: dentro de la transacción todo va por la misma conexión.
  const publicada = await tx.plantilla.findFirst({ where: { codigo: e.plantilla.codigo, estado: "publicada" }, select: { version: true } });
  const personas = await tx.expedientePersona.findMany({ where: { expedienteId: e.id }, orderBy: { id: "asc" } });
  const movimientos = await tx.movimiento.findMany({
    where: { expedienteId: e.id },
    include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
    orderBy: [{ fechaEfectiva: "asc" }, { secuencia: "asc" }],
  });
  const areas = await tx.area.findMany({ select: { id: true, codigo: true, nombre: true, tipo: true } });
  const cementerios = await tx.cementerio.findMany({ select: { codigo: true, nombre: true, areaId: true } });
  const plazo = await calcularPlazo(tx, e, hoy);

  const areaPorId = new Map(areas.map((a) => [a.id, a]));
  const areaPorCodigo = new Map(areas.map((a) => [a.codigo, a]));
  const nombreCementerio = new Map(cementerios.map((c) => [c.codigo, c.nombre]));
  const pasoPorClave = new Map(def.pasos.map((p) => [p.clave, p]));
  const refPaso = (clave: string | null) => (clave === null ? null : { clave, nombre: pasoPorClave.get(clave)?.nombre ?? clave });
  const refArea = (id: number | null) => {
    const a = id === null ? undefined : areaPorId.get(id);
    return a ? { codigo: a.codigo, nombre: a.nombre } : null;
  };
  const datosExtra = e.datosExtra as Record<string, unknown>;

  const areasDe = (paso: PasoPlantilla) => {
    try {
      return areasDelPaso(paso, {
        areas: areaPorCodigo,
        areaCementerioId: e.cementerio.areaId,
        areaDeCementerio: new Map(cementerios.map((c) => [c.codigo, c.areaId])),
        datosExtra,
      });
    } catch (error) {
      if (error instanceof ErrorDominio) return null;
      throw error;
    }
  };

  const recorrido: PasoFicha[] = def.pasos.map((p, i) => {
    const resueltas = areasDe(p);
    const custodia = p.custodia === null ? null : (areaPorCodigo.get(p.custodia) ?? null);
    return {
      orden: i + 1,
      clave: p.clave,
      nombre: p.nombre,
      area: resueltas ? (areaPorId.get(resueltas.areaActualId) ?? null) : null,
      areaDefinida: p.area,
      custodia,
      estado: p.estado,
      omitible: p.omitible,
      diasAlerta: p.dias_alerta,
      instrucciones: p.instrucciones,
      plazo: p.plazo,
      situacion: i + 1 < e.pasoOrden ? "cumplido" : i + 1 === e.pasoOrden ? "actual" : "pendiente",
      subtareas: p.subtareas.map((s) => {
        const item = items.subtareas[s.clave];
        return {
          clave: s.clave,
          nombre: s.nombre,
          obligatoria: s.obligatoria,
          dato: s.dato,
          datoObligatorio: s.dato_obligatorio,
          hecha: item?.hecha ?? false,
          valor: item?.dato ?? null,
          movimientoId: item?.mov === null || item?.mov === undefined ? null : String(item.mov),
          historica: item?.historica ?? false,
          reiniciadaPorMovimientoId:
            item?.reiniciada_por_mov === null || item?.reiniciada_por_mov === undefined ? null : String(item.reiniciada_por_mov),
        };
      }),
    };
  });

  const documentos: DocumentoFicha[] = def.documentos.map((d) => {
    const item = items.documentos[d.clave];
    const vigentes = (item?.adjuntos ?? []).map(String).filter((id) => items.adjuntos[id]?.vigente !== false);
    return {
      clave: d.clave,
      nombre: d.nombre,
      origen: d.origen,
      obligatorio: d.obligatorio,
      exigirAlSalirDe: d.exigir_al_salir_de === null ? null : refPaso(d.exigir_al_salir_de),
      adjunto: d.adjunto,
      estado: item?.estado ?? "pendiente",
      obs: item?.obs ?? null,
      movimientoId: item?.mov === null || item?.mov === undefined ? null : String(item.mov),
      adjuntos: completo ? vigentes : null,
      cantidadAdjuntos: vigentes.length,
    };
  });

  const etiquetas = new Map(def.personas.map((r) => [r.rol, r.etiqueta]));
  const ordenRol = new Map(def.personas.map((r, i) => [r.rol, i]));
  const vigentes = personas
    .filter((p) => p.vigente)
    .sort((a, b) => (ordenRol.get(a.rol) ?? 99) - (ordenRol.get(b.rol) ?? 99) || a.orden - b.orden)
    .map((p) => personaFicha(p, etiquetas, completo));
  const historicas = personas.filter((p) => !p.vigente).map((p) => personaFicha(p, etiquetas, completo));

  const correcciones = new Map<string, string[]>();
  for (const m of movimientos) {
    if (m.corrigeMovimientoId !== null) {
      const clave = m.corrigeMovimientoId.toString();
      correcciones.set(clave, [...(correcciones.get(clave) ?? []), m.id.toString()]);
    }
  }
  const reemplaza = new Map<string, string>();
  for (const p of personas) if (p.reemplazadaPorId !== null) reemplaza.set(p.reemplazadaPorId.toString(), p.id.toString());

  const historial: MovimientoFicha[] = movimientos.map((m) => ({
    id: m.id.toString(),
    secuencia: m.secuencia,
    tipo: m.tipo,
    fechaEfectiva: m.fechaEfectiva,
    precisionFecha: m.precisionFecha === "dia" ? "dia" : "minuto",
    registradoEn: m.registradoEn,
    diferido: m.registradoEn.getTime() - m.fechaEfectiva.getTime() > MS_48_HORAS,
    usuario: usuarioFicha(m.usuario),
    areaUsuario: refArea(m.areaUsuarioId),
    pasoOrigen: refPaso(m.pasoOrigen),
    pasoDestino: refPaso(m.pasoDestino),
    areaOrigen: refArea(m.areaOrigenId),
    areaDestino: refArea(m.areaDestinoId),
    estadoAnterior: m.estadoAnterior,
    estadoNuevo: m.estadoNuevo,
    observacion: m.observacion,
    motivo: m.motivo,
    datos: datosVisibles(m.tipo, m.datos, completo),
    cargaHistorica: m.cargaHistorica,
    fuente: m.fuente,
    corrigeMovimientoId: m.corrigeMovimientoId?.toString() ?? null,
    corregidoPor: correcciones.get(m.id.toString()) ?? [],
    personasCreadas: personas
      .filter((p) => p.creadaMovId === m.id)
      .map((p) => ({ id: p.id.toString(), rol: p.rol, orden: p.orden, reemplazaA: reemplaza.get(p.id.toString()) ?? null })),
  }));

  const camposUbicacion = leerCamposUbicacion(e.cementerio.camposUbicacion, e.cementerio.nombre);
  const ubicacionValores = e.ubicacion as Record<string, string>;
  const ubicacion: CampoValorFicha[] = [
    ...camposUbicacion
      .filter((c) => c.activo || ubicacionValores[c.clave] !== undefined)
      .map((c) => ({ clave: c.clave, etiqueta: c.etiqueta, valor: ubicacionValores[c.clave] ?? null })),
    ...Object.entries(ubicacionValores)
      .filter(([clave]) => !camposUbicacion.some((c) => c.clave === clave))
      .map(([clave, valor]) => ({ clave, etiqueta: clave, valor })),
  ];

  const pasoActual = def.pasos[e.pasoOrden - 1] ?? pasoPorClave.get(e.pasoClave);
  const situaciones: Situacion[] = [];
  if (e.recibidoEn === null) situaciones.push("sin_confirmar");
  if (e.pasoRetornoClave !== null) situaciones.push("devuelto");
  if (e.cargaHistorica) situaciones.push("carga_historica");
  if (e.expedienteAnterior !== null || e.reiniciadoEn.length > 0) situaciones.push("reiniciado");
  if (plazo?.faltan !== null && plazo?.faltan !== undefined && plazo.cumplidoEn === null) {
    if (plazo.faltan < 0) situaciones.push("plazo_vencido");
    else if (plazo.faltan <= DIAS_PLAZO_POR_VENCER) situaciones.push("plazo_por_vencer");
  }

  const versionPublicada = publicada?.version ?? null;
  const hayVersionNueva = versionPublicada !== null && versionPublicada > e.plantilla.version;
  const toAreaFicha = (a: { id: number; codigo: string; nombre: string; tipo: string }): AreaFicha => a;

  const ficha: Ficha = {
    id: e.id.toString(),
    numero: e.numeroInterno,
    numeroCorto: numeroCorto(e.anio, e.secuencia),
    numeroMunicipal: e.numeroMunicipal,
    estado: comoEstado(e.estado),
    estadoPrevio: e.estadoPrevio,
    version: e.version,
    fechaInicio: fechaDesdeDb(e.fechaInicio),
    cargaHistorica: e.cargaHistorica,
    ubicacionArchivo: e.ubicacionArchivo,
    tipoTramite: e.tipoTramite,
    plantilla: {
      id: e.plantilla.id,
      codigo: e.plantilla.codigo,
      nombre: e.plantilla.nombre,
      version: e.plantilla.version,
      versionPublicada,
      hayVersionNueva,
      texto: `${e.plantilla.nombre} · v${e.plantilla.version}${hayVersionNueva ? ` (hay v${versionPublicada})` : ""}`,
    },
    cementerio: { id: e.cementerio.id, codigo: e.cementerio.codigo, nombre: e.cementerio.nombre },
    tipoMonumento: e.monumento,
    ubicacion,
    ubicacionTexto: e.ubicacionTexto,
    padron: e.padron,
    formaPago: e.formaPago,
    observaciones: e.observaciones,
    datosExtra: def.campos_extra.map((c) => {
      const valor = datosExtra[c.clave];
      const v = typeof valor === "string" || typeof valor === "number" ? valor : null;
      return {
        clave: c.clave,
        etiqueta: c.etiqueta,
        tipo: c.tipo,
        valor: v,
        valorTexto: v === null ? null : c.tipo === "cementerio" ? (nombreCementerio.get(String(v)) ?? String(v)) : String(v),
        obligatorio: c.obligatorio,
        exigirAlSalirDe: c.exigir_al_salir_de === null ? null : refPaso(c.exigir_al_salir_de),
      };
    }),
    paso: {
      clave: e.pasoClave,
      nombre: pasoActual?.nombre ?? e.pasoClave,
      orden: e.pasoOrden,
      total: def.pasos.length,
      esFinal: e.pasoOrden === def.pasos.length,
    },
    areaActual: toAreaFicha(e.areaActual),
    areaResponsable: toAreaFicha(e.areaResponsable),
    enAreaDesde: e.enAreaDesde,
    recibidoEn: e.recibidoEn,
    plazo,
    situaciones,
    expedienteAnterior: e.expedienteAnterior?.numeroInterno ?? null,
    expedientesSiguientes: e.reiniciadoEn.map((x) => x.numeroInterno),
    creadoEn: e.creadoEn,
    creadoPor: usuarioFicha(e.creador),
    recorrido,
    documentacion: {
      direccion: documentos.filter((d) => d.origen === "direccion"),
      concesionario: documentos.filter((d) => d.origen === "concesionario"),
    },
    personas: vigentes,
    personasHistoricas: historicas,
    conceptos: def.conceptos.map((c) => ({ clave: c.clave, nombre: c.nombre, via: c.via, paso: refPaso(c.paso) ?? { clave: c.paso, nombre: c.paso } })),
    historial,
    datosCompletos: completo,
    acciones: {
      verDatosCompletos: ver,
      editarIdentificatorios: evaluarPermiso("editar_identificatorios", permisos, usuario),
      editarContacto: evaluarPermiso("editar_contacto", permisos, usuario),
      completarCamposExtra: evaluarPermiso("completar_campos_extra", permisos, usuario),
      imprimir: evaluarPermiso("imprimir", permisos, usuario),
    },
  };
  return { ficha, id: e.id };
}

/**
 * La ficha de un expediente, con el registro de `ver_expediente`.
 *
 * @param numero número interno (`CEM-2026-00042` o `42/2026`).
 * @throws PermisoDenegado (usuario inactivo)
 * @throws ErrorDominio `no_encontrado`
 */
export async function obtenerFicha(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  opciones: OpcionesAcceso = {},
): Promise<Ficha> {
  exigirPermiso("ver_expediente", null, usuario);
  const numeroInterno = exigirNumero(numero);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());
  return deps.escribir(usuario.id, null, async (tx) => {
    const { ficha, id } = await armarFicha(tx, usuario, numeroInterno, hoy);
    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "ver_expediente",
      expedienteId: id,
      detalle: { enmascarado: !ficha.datosCompletos },
      ip: opciones.ip,
    });
    return ficha;
  });
}

// ---------------------------------------------------------------------------
// Ver datos completos
// ---------------------------------------------------------------------------

export interface ContactoCompleto {
  /** Id de la versión de la persona (vigente o histórica), como en la ficha. */
  id: string;
  rol: string;
  apellido: string | null;
  nombres: string | null;
  vigente: boolean;
  telefono: string | null;
  telefonoWhatsapp: boolean;
  email: string | null;
  domicilio: string | null;
}

export interface DatosCompletos {
  numero: string;
  personas: ContactoCompleto[];
  /** Adjuntos vigentes por documento (ids de movimientos `adjunto`). */
  adjuntos: Array<{ documento: string | null; movimientoId: string }>;
}

/**
 * "Ver datos completos" (decisión 13): devuelve el contacto sin enmascarar y
 * registra `ver_datos_completos` en `auditoria.accesos` con el motivo.
 *
 * El motivo es obligatorio (10 caracteres o más) para quien no trabaja el
 * expediente; quien lo trabaja ya ve todo en la ficha, pero si llama igual se
 * registra (con el motivo, si lo dio).
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`, `motivo_requerido`
 */
export async function verDatosCompletos(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  motivo: string | null,
  opciones: OpcionesAcceso = {},
): Promise<DatosCompletos> {
  exigirPermiso("ver_expediente", null, usuario);
  const numeroInterno = exigirNumero(numero);
  return deps.escribir(usuario.id, limpiarMotivo(motivo), async (tx) => {
    const e = await tx.expediente.findUnique({
      where: { numeroInterno },
      select: { id: true, estado: true, areaResponsableId: true, items: true },
    });
    if (!e) throw noEncontrado(numeroInterno);
    const permisos = await permisosDelExpediente(tx, e);
    const { requiereMotivo } = exigirPermiso("ver_datos_completos", permisos, usuario);
    const motivoFinal = requiereMotivo ? exigirMotivo(motivo, "Ver los datos completos") : limpiarMotivo(motivo);

    const personas = await tx.expedientePersona.findMany({
      where: { expedienteId: e.id, suprimidaEn: null },
      orderBy: { id: "asc" },
    });
    const items = leerItems(e.items);
    await registrarAcceso(tx, {
      usuarioId: usuario.id,
      accion: "ver_datos_completos",
      expedienteId: e.id,
      detalle: { motivo: motivoFinal },
      ip: opciones.ip,
    });
    return {
      numero: numeroInterno,
      personas: personas.map((p) => ({
        id: p.id.toString(),
        rol: p.rol,
        apellido: p.apellido,
        nombres: p.nombres,
        vigente: p.vigente,
        telefono: p.telefono,
        telefonoWhatsapp: p.telefonoWhatsapp,
        email: p.email,
        domicilio: p.domicilio,
      })),
      adjuntos: Object.entries(items.adjuntos)
        .filter(([, a]) => a.vigente)
        .map(([id, a]) => ({ documento: texto(a.documento), movimientoId: id })),
    };
  });
}
