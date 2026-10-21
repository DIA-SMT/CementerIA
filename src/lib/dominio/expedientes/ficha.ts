import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { fechaDesdeDb, hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { evaluarPermiso, exigirPermiso, type Decision, type EstadoExpediente, type UsuarioPermisos } from "../permisos";
import type { DefinicionPlantilla, PasoPlantilla } from "../plantillas/esquema";
import type { TipoPersona } from "./esquemas";
import { comoEstado, exigirNumero, permisosDelExpediente, registrarAcceso, type OpcionesAcceso } from "./acceso";
import { leerCamposUbicacion } from "./ubicacion";
import { definicionDelExpediente, type CodigoNombre } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { ErrorDominio, exigirMotivo, limpiarMotivo, noEncontrado } from "./errores";
import { mostrarContacto, type ContactoMostrado } from "./enmascarar";
import {
  destinosPosibles,
  faltantesDelPaso,
  faltantesParaConcluir,
  subtareasReiniciables,
  type DestinoPase,
  type Faltante,
  type PrecisionFecha,
  type RefPaso,
  type SubtareaReiniciable,
} from "./flujo";
import { leerItems, type EstadoDocumento } from "./items";
import { numeroCorto } from "./numero";
import type { VinculoAnterior } from "./alta";
import { correccionesPosibles, type TipoCorreccion } from "./correcciones";
import { calcularPlazo, type PlazoCalculado } from "./plazos";
import { fechasCorregidas, movimientosRevertidos, observacionesCorregidas } from "./reconstruccion";
import { pendientesHistoricos } from "./transcripcion";
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
  tipo: TipoPersona;
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  /** Persona jurídica: razón social y CUIT (11 dígitos). Como el nombre y el DNI, no se enmascaran. */
  razonSocial: string | null;
  cuit: string | null;
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
  /** Semana 4: lo revirtió una corrección (o lo arrastró la reversión de otro): ya no cuenta. */
  revertido: boolean;
  /** Semana 4: la fecha efectiva que vale, si se corrigió (la original es `fechaEfectiva`). */
  fechaCorregida: { fechaEfectiva: Date; precisionFecha: PrecisionFecha } | null;
  /** Semana 4: la observación que vale, si se corrigió (`{ valor: null }` si se borró). */
  observacionCorregida: { valor: string | null } | null;
  /** Semana 4: qué correcciones puede hacer el usuario sobre este movimiento (2.13(b)). */
  correcciones: TipoCorreccion[];
  /** Personas que creó (alta o edición): las versiones nuevas dicen a cuál reemplazan. */
  personasCreadas: Array<{ id: string; rol: string; orden: number; reemplazaA: string | null }>;
}

/** Un adjunto vigente, para el visor (`/adjuntos/[movimientoId]`). */
export interface AdjuntoFicha {
  /** El id del movimiento `adjunto`. */
  movimientoId: string;
  /** Clave del documento, o null si es suelto. */
  documento: string | null;
  nombre: string;
  mime: string;
  bytes: number;
  registradoEn: Date;
  usuario: UsuarioFicha;
}

/** Lo que la ficha necesita para el diálogo "Dar pase" y el botón "Faltan N" (3.3). */
export interface PaseFicha {
  /** Lo que falta para pasar al paso siguiente. Vacío en el último paso. */
  faltan: Faltante[];
  /** Destinos posibles, con lo que falta para cada uno. Vacío en el último paso. */
  destinos: DestinoPase[];
}

/** Lo que la ficha necesita para el diálogo "Devolver" (3.4). */
export interface DevolucionFicha {
  /** Los pasos anteriores al actual, del primero al último. */
  destinos: RefPaso[];
  /**
   * Las subtareas tildadas de los pasos anteriores. Al elegir el destino, se
   * ofrecen las de `paso.orden >= destino.orden`.
   */
  subtareasReiniciables: SubtareaReiniciable[];
}

/**
 * El plazo del paso (3.6): `desde`, `diasHabiles`, `cumplidoEn`, `vence`
 * (f_sumar_dias_habiles), `faltan` (negativo: vencido hace N) y, semana 4,
 * `semaforo`, `provisorio` (algún año sin cerrar en feriados),
 * `aniosSinCerrar` y `texto` ("vence 30/11 · faltan 3 días hábiles").
 */
export type PlazoFicha = PlazoCalculado;

/** Un expediente enlazado: el anterior (reinicio o vinculado) o uno siguiente. */
export interface EnlaceExpediente {
  numero: string;
  estado: string;
  plantilla: string;
  /** `reinicio` (Reiniciar con otra plantilla) o `vinculado` (archivar y abrir vinculado: la caducidad). */
  vinculo: VinculoAnterior;
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
  /**
   * La precisión con que se registró `enAreaDesde` (la del movimiento que lo
   * fijó): con `dia`, se muestra solo la fecha (`formatearSegunPrecision`).
   */
  enAreaDesdePrecision: PrecisionFecha;
  recibidoEn: Date | null;
  /** Ídem para `recibidoEn`. */
  recibidoEnPrecision: PrecisionFecha;
  plazo: PlazoFicha | null;
  situaciones: Situacion[];
  expedienteAnterior: string | null;
  expedientesSiguientes: string[];
  /** Semana 4: los enlaces con su estado y su tipo, para "Viene de…" y "Continúa en…". */
  enlaces: { anterior: EnlaceExpediente | null; siguientes: EnlaceExpediente[] };
  /** Semana 4: lo que falta para concluir ("Faltan N" del botón Concluir); vacío fuera del último paso. */
  concluir: { faltan: Faltante[] };
  /** Semana 4: con la carga histórica abierta, lo que "Terminar carga histórica" pasaría a histórico. */
  cargaHistoricaPendiente: { subtareas: string[]; documentos: string[] } | null;
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
  /** Adjuntos vigentes, del más viejo al más nuevo; null si están enmascarados (`datosCompletos` false). */
  adjuntos: AdjuntoFicha[] | null;
  cantidadAdjuntos: number;
  /** "Faltan N" y los destinos del pase. */
  pase: PaseFicha;
  devolucion: DevolucionFicha;
  /** true si el contacto y los adjuntos se ven completos. */
  datosCompletos: boolean;
  /** Qué puede hacer el usuario (los mismos permisos que exigen las acciones). */
  acciones: {
    verDatosCompletos: Decision;
    editarIdentificatorios: Decision;
    editarContacto: Decision;
    completarCamposExtra: Decision;
    imprimir: Decision;
    /**
     * Semana 3. `confirmarRecepcion` es el permiso: el botón va solo si
     * además `situaciones` incluye `sin_confirmar`. `darPase` también depende
     * de `pase.destinos` (con `faltan` vacío, se puede; si no, "Faltan N").
     */
    confirmarRecepcion: Decision;
    tildarSubtarea: Decision;
    marcarDocumento: Decision;
    adjuntar: Decision;
    darPase: Decision;
    devolver: Decision;
    /** Semana 4 (3.1). `concluir` además depende de `concluir.faltan`. */
    concluir: Decision;
    archivar: Decision;
    archivarSinConcluir: Decision;
    desarchivar: Decision;
    anular: Decision;
    reabrir: Decision;
    reiniciar: Decision;
    cambiarUbicacionArchivo: Decision;
    nota: Decision;
    /** Transcripción y "Terminar carga histórica" (2.13(c)). */
    transcribir: Decision;
    /** Ley 25.326 (admin): en cada persona y cada adjunto. */
    suprimirPersona: Decision;
    purgarAdjunto: Decision;
    /** Hay al menos un movimiento que el usuario puede corregir (ver `historial[i].correcciones`). */
    corregir: boolean;
  };
}

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

const MS_48_HORAS = 48 * 60 * 60 * 1000;

/** Los movimientos que fijan `en_area_desde` o `recibido_en`. */
const TIPOS_UBICACION: ReadonlySet<string> = new Set(["alta", "recepcion", "pase", "devolucion", "estado"]);

const INCLUIR = {
  tipoTramite: { select: { codigo: true, nombre: true } },
  plantilla: { select: { id: true, codigo: true, nombre: true, version: true, definicion: true } },
  cementerio: true,
  monumento: { select: { codigo: true, nombre: true } },
  areaActual: { select: { id: true, codigo: true, nombre: true, tipo: true } },
  areaResponsable: { select: { id: true, codigo: true, nombre: true, tipo: true } },
  creador: { select: { id: true, nombre: true, apellido: true } },
  expedienteAnterior: { select: { numeroInterno: true, estado: true, plantilla: { select: { nombre: true } } } },
  reiniciadoEn: { select: { numeroInterno: true, estado: true, plantilla: { select: { nombre: true } } }, orderBy: { id: "asc" } },
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
  tipoPersona: string;
  apellido: string | null;
  nombres: string | null;
  dni: string | null;
  razonSocial: string | null;
  cuit: string | null;
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
    tipo: p.tipoPersona === "juridica" ? "juridica" : "fisica",
    apellido: p.apellido,
    nombres: p.nombres,
    dni: p.dni,
    razonSocial: p.razonSocial,
    cuit: p.cuit,
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

/** Arma la ficha sin registrar el acceso (lo registra quien llama: la ficha o la hoja del historial). */
export async function armarFicha(tx: Transaccion, usuario: UsuarioPermisos, numero: string, hoy: FechaISO, ahora: Date = new Date()) {
  const e = await tx.expediente.findUnique({ where: { numeroInterno: numero }, include: INCLUIR });
  if (!e) throw noEncontrado(numero);

  // Resuelta para el cementerio y las personas: la ficha muestra lo mismo que
  // después exige el pase (conceptos, documentos y subtareas que corresponden).
  const def = await definicionDelExpediente(tx, e, e.plantilla);
  const permisos = await permisosDelExpediente(tx, e, def.pasos.length);
  const ver = evaluarPermiso("ver_datos_completos", permisos, usuario);
  const completo = ver.permitido && !ver.requiereMotivo;
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
    revertido: false,
    fechaCorregida: null,
    observacionCorregida: null,
    correcciones: [],
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
  if (plazo?.semaforo === "vencido") situaciones.push("plazo_vencido");
  else if (plazo?.semaforo === "por_vencer") situaciones.push("plazo_por_vencer");

  // La precisión de en_area_desde y recibido_en: la del último movimiento de
  // ubicación con esa fecha (un alta con fecha de inicio pasada o un pase
  // cargado "el 15" tienen precisión de día y no muestran "00:00"). Semana 4:
  // si la fecha del movimiento se corrigió, vale la corregida, con su precisión.
  const precisionDe = (instante: Date | null): PrecisionFecha => {
    if (instante === null) return "minuto";
    let precision: PrecisionFecha = "minuto";
    let secuencia = -1;
    for (const m of movimientos) {
      const corregida = fechas.get(m.id.toString());
      const fecha = corregida?.instante ?? m.fechaEfectiva;
      if (TIPOS_UBICACION.has(m.tipo) && fecha.getTime() === instante.getTime() && m.secuencia > secuencia) {
        secuencia = m.secuencia;
        precision = (corregida?.precision ?? m.precisionFecha) === "dia" ? "dia" : "minuto";
      }
    }
    return precision;
  };

  const movimientoPorId = new Map(movimientos.map((m) => [m.id.toString(), m]));
  const adjuntosVigentes: AdjuntoFicha[] = Object.entries(items.adjuntos)
    .filter(([, a]) => a.vigente)
    .map(([id, a]) => {
      const m = movimientoPorId.get(id);
      const d = (m?.datos ?? {}) as Record<string, unknown>;
      return {
        movimientoId: id,
        documento: a.documento,
        nombre: typeof d.nombre === "string" ? d.nombre : "archivo",
        mime: typeof d.mime === "string" ? d.mime : "application/octet-stream",
        bytes: typeof d.bytes === "number" ? d.bytes : 0,
        registradoEn: m?.registradoEn ?? e.creadoEn,
        usuario: m ? usuarioFicha(m.usuario) : usuarioFicha(e.creador),
      };
    })
    .sort((a, b) => a.registradoEn.getTime() - b.registradoEn.getTime());

  // Semana 4: reversiones, correcciones y enlaces.
  const revertidos = movimientosRevertidos(movimientos);
  const fechas = fechasCorregidas(movimientos);
  const observaciones = observacionesCorregidas(movimientos);
  const corregibles = correccionesPosibles({
    def,
    movimientos,
    items,
    pasoClave: e.pasoClave,
    pasoOrden: e.pasoOrden,
    estado: e.estado,
    permisos,
    usuario,
    ahora,
  });
  for (const h of historial) {
    h.revertido = revertidos.has(h.id);
    const f = fechas.get(h.id);
    h.fechaCorregida = f ? { fechaEfectiva: f.instante, precisionFecha: f.precision } : null;
    h.observacionCorregida = observaciones.has(h.id) ? { valor: observaciones.get(h.id) ?? null } : null;
    h.correcciones = corregibles.get(h.id) ?? [];
  }
  const altaMov = movimientos.find((m) => m.tipo === "alta");
  const vinculoAlta = (altaMov?.datos as Record<string, unknown> | null)?.vinculo;
  const enlaceAnterior: EnlaceExpediente | null = e.expedienteAnterior
    ? {
        numero: e.expedienteAnterior.numeroInterno,
        estado: e.expedienteAnterior.estado,
        plantilla: e.expedienteAnterior.plantilla.nombre,
        vinculo: vinculoAlta === "vinculado" ? "vinculado" : "reinicio",
      }
    : null;
  // El vínculo de un siguiente lo dice cómo quedó este: anulado (reinicio) o archivado (vinculado).
  const siguientes: EnlaceExpediente[] = e.reiniciadoEn.map((x) => ({
    numero: x.numeroInterno,
    estado: x.estado,
    plantilla: x.plantilla.nombre,
    vinculo: e.estado === "anulado" ? "reinicio" : "vinculado",
  }));

  const enCurso = e.pasoOrden < def.pasos.length;
  const pase: PaseFicha = {
    faltan: enCurso ? faltantesDelPaso(def, items, datosExtra, e.pasoOrden) : [],
    destinos: destinosPosibles(def, items, datosExtra, e.pasoOrden, e.pasoRetornoClave),
  };
  const devolucion: DevolucionFicha = {
    destinos: def.pasos.slice(0, Math.max(0, e.pasoOrden - 1)).map((p, i) => ({ clave: p.clave, nombre: p.nombre, orden: i + 1 })),
    subtareasReiniciables: subtareasReiniciables(def, items, e.pasoOrden),
  };

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
    enAreaDesdePrecision: precisionDe(e.enAreaDesde),
    recibidoEn: e.recibidoEn,
    recibidoEnPrecision: precisionDe(e.recibidoEn),
    plazo,
    situaciones,
    expedienteAnterior: e.expedienteAnterior?.numeroInterno ?? null,
    expedientesSiguientes: e.reiniciadoEn.map((x) => x.numeroInterno),
    enlaces: { anterior: enlaceAnterior, siguientes },
    concluir: {
      faltan:
        e.pasoOrden === def.pasos.length && (e.estado === "en_tramite" || e.estado === "espera_pago_dim")
          ? faltantesParaConcluir(def, items, datosExtra)
          : [],
    },
    cargaHistoricaPendiente: e.cargaHistorica
      ? pendientesHistoricos(def, items, e.pasoOrden, e.estado === "concluido" || (e.estado === "archivado" && e.estadoPrevio === "concluido"))
      : null,
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
    adjuntos: completo ? adjuntosVigentes : null,
    cantidadAdjuntos: adjuntosVigentes.length,
    pase,
    devolucion,
    datosCompletos: completo,
    acciones: {
      verDatosCompletos: ver,
      editarIdentificatorios: evaluarPermiso("editar_identificatorios", permisos, usuario),
      editarContacto: evaluarPermiso("editar_contacto", permisos, usuario),
      completarCamposExtra: evaluarPermiso("completar_campos_extra", permisos, usuario),
      imprimir: evaluarPermiso("imprimir", permisos, usuario),
      confirmarRecepcion: evaluarPermiso("confirmar_recepcion", permisos, usuario),
      tildarSubtarea: evaluarPermiso("tildar_subtarea", permisos, usuario),
      marcarDocumento: evaluarPermiso("marcar_documento", permisos, usuario),
      adjuntar: evaluarPermiso("adjuntar", permisos, usuario),
      darPase: evaluarPermiso("dar_pase", permisos, usuario),
      devolver: evaluarPermiso("devolver", permisos, usuario),
      concluir: evaluarPermiso("concluir", permisos, usuario),
      archivar: evaluarPermiso("archivar_concluido", permisos, usuario),
      archivarSinConcluir: evaluarPermiso("archivar_sin_concluir", permisos, usuario),
      desarchivar: evaluarPermiso("desarchivar", permisos, usuario),
      anular: evaluarPermiso("anular", permisos, usuario),
      reabrir: evaluarPermiso("reabrir", permisos, usuario),
      reiniciar: evaluarPermiso("reiniciar_con_otra_plantilla", permisos, usuario),
      cambiarUbicacionArchivo: evaluarPermiso("cambiar_ubicacion_archivo", permisos, usuario),
      nota: evaluarPermiso("nota", permisos, usuario),
      transcribir: evaluarPermiso("transcribir", permisos, usuario),
      suprimirPersona: evaluarPermiso("suprimir_persona", permisos, usuario),
      purgarAdjunto: evaluarPermiso("purgar_adjunto", permisos, usuario),
      corregir: corregibles.size > 0,
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
    const { ficha, id } = await armarFicha(tx, usuario, numeroInterno, hoy, deps.ahora?.() ?? new Date());
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
  razonSocial: string | null;
  vigente: boolean;
  telefono: string | null;
  telefonoWhatsapp: boolean;
  email: string | null;
  domicilio: string | null;
}

export interface DatosCompletos {
  numero: string;
  personas: ContactoCompleto[];
  /**
   * Adjuntos vigentes por documento (ids de movimientos `adjunto`), con el
   * nombre, el tipo y el tamaño para listarlos (la ficha los trae en `null`
   * para quien no trabaja el expediente).
   */
  adjuntos: Array<{ documento: string | null; movimientoId: string; nombre: string; mime: string; bytes: number }>;
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
    const idsAdjuntos = Object.entries(items.adjuntos)
      .filter(([id, a]) => a.vigente && /^\d{1,18}$/.test(id))
      .map(([id]) => BigInt(id));
    const movAdjuntos = await tx.movimiento.findMany({
      where: { id: { in: idsAdjuntos }, expedienteId: e.id, tipo: "adjunto" },
      select: { id: true, datos: true },
      orderBy: { id: "asc" },
    });
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
        razonSocial: p.razonSocial,
        vigente: p.vigente,
        telefono: p.telefono,
        telefonoWhatsapp: p.telefonoWhatsapp,
        email: p.email,
        domicilio: p.domicilio,
      })),
      adjuntos: movAdjuntos.map((m) => {
        const id = m.id.toString();
        const d = (m.datos ?? {}) as Record<string, unknown>;
        return {
          documento: texto(items.adjuntos[id]?.documento),
          movimientoId: id,
          nombre: typeof d.nombre === "string" ? d.nombre : "archivo",
          mime: typeof d.mime === "string" ? d.mime : "application/octet-stream",
          bytes: typeof d.bytes === "number" ? d.bytes : 0,
        };
      }),
    };
  });
}
