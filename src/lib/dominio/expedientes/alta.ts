import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Transaccion } from "@/lib/db/crear-cliente";
import { anioEnTucuman, fechaParaDb, hoyEnTucuman, inicioDelDiaEnTucuman } from "@/lib/fechas";
import { armarBusqueda } from "../busqueda";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import type { DefinicionPlantilla } from "../plantillas/esquema";
import { cargarCementerio, cargarContexto, cargarPlantilla } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { generarCodigoConsulta } from "./codigo-consulta";
import { buscarDuplicados, type AvisoDuplicado } from "./duplicados";
import { ErrorDominio, errorValidacion } from "./errores";
import { construirEsquemaAlta, erroresDeZod, validarCon, type AltaValidada, type PersonaValidada } from "./esquemas";
import { itemsIniciales } from "./items";
import { formatearNumeroInterno, numeroCorto } from "./numero";
import { areasDelPaso } from "./proyeccion";
import { claveDeUbicacion, textoDeUbicacion } from "./ubicacion";

/**
 * Alta de un expediente (docs/propuesta-mvp.md, 2.6, 2.7, 2.13(c), 2.13(f) y
 * 3.1). Todo en UNA transacción de `conActor()`, con el usuario como actor:
 *
 * 1. Permiso: Mesa de Entradas o admin; con carga histórica, el mismo permiso
 *    de "carga histórica".
 * 2. `pg_advisory_xact_lock(4242, año)`: serializa las altas del año. Recién
 *    con el lock tomado se mira la idempotencia (así dos reintentos simultáneos
 *    del mismo `comando_id` no crean dos expedientes) y se calcula la
 *    secuencia (`max + 1`). Si algo falla después, el número se deshace con la
 *    transacción: no quedan huecos.
 * 3. La plantilla tiene que ser la versión publicada; el cementerio, estar
 *    activo y configurado. Se valida con el esquema armado de los dos.
 * 4. Se inserta el expediente (la proyección), después el movimiento `alta` y
 *    después las personas, con `creada_mov_id` = ese movimiento (2.7: el
 *    movimiento no se puede actualizar, así que va primero).
 * 5. `items`: los documentos recibidos en el alta, presentados por ese movimiento.
 * 6. 28/10/2026: el código de consulta pública (./codigo-consulta.ts), que va
 *    en el comprobante del concesionario. No entra en el movimiento `alta`
 *    (es una credencial, no un dato del trámite).
 *
 * Fechas: alta normal con `fecha_inicio` de hasta 30 días atrás; histórica, de
 * 1950 a hoy y con fuente. El `alta` lleva `fecha_efectiva = fecha_inicio`: si
 * es hoy, ahora con precisión de minuto; si no, las 00:00 de ese día en
 * Tucumán con precisión de día. `en_area_desde` y `recibido_en` toman esa
 * fecha: Mesa recibe lo que crea (si el primer paso es de otra área interna,
 * queda sin confirmar).
 *
 * El número es `CEM-<año de registro>-NNNNN`: un expediente de 2019 cargado hoy
 * es `CEM-2026-…` y su ficha dice "Inicio: 15/03/2019".
 */

/** Clave del advisory lock de la numeración (2.13(f)): `pg_advisory_xact_lock(4242, año)`. */
export const LOCK_NUMERACION = 4242;

export interface ResultadoAlta {
  id: string;
  /** `CEM-2026-00042`: la clave pública del expediente (URL, búsqueda, carátula). */
  numero: string;
  /** `42/2026`. */
  numeroCorto: string;
  /** Versión para el bloqueo optimista de la próxima acción (0 recién creado). */
  version: number;
  /** El `comando_id` ya se había usado: no se creó nada y se devuelve el expediente de entonces. */
  repetido: boolean;
  /** Otros expedientes no anulados sobre la misma ubicación, padrón o N° municipal. */
  avisos: AvisoDuplicado[];
}

const Comando = z.uuid({ error: "comando_id inválido: tiene que ser un UUID generado por el formulario" });

/** Lo mínimo para saber qué plantilla y qué cementerio cargar, antes del esquema completo. */
const Cabecera = z.looseObject({
  plantillaId: z.int({ error: "Elegí el trámite" }).positive(),
  cementerioId: z.int({ error: "Elegí el cementerio" }).positive(),
  cargaHistorica: z.boolean().optional(),
  expedienteAnteriorId: z.string().nullable().optional(),
});

export function validarComando(comandoId: string): string {
  const r = Comando.safeParse(comandoId);
  if (!r.success) throw errorValidacion([{ ruta: "comandoId", mensaje: r.error.issues[0]?.message ?? "comando_id inválido" }]);
  return r.data.toLowerCase();
}

async function resultadoRepetido(tx: Transaccion, comandoId: string): Promise<ResultadoAlta | null> {
  const previo = await tx.movimiento.findFirst({
    where: { comandoId, tipo: "alta" },
    select: { expediente: { select: { id: true, numeroInterno: true, anio: true, secuencia: true, version: true } } },
  });
  if (!previo) return null;
  const e = previo.expediente;
  return {
    id: e.id.toString(),
    numero: e.numeroInterno,
    numeroCorto: numeroCorto(e.anio, e.secuencia),
    version: e.version,
    repetido: true,
    avisos: [],
  };
}

/** Los valores de los campos extra `buscable`, con el nombre del cementerio en los de tipo cementerio. */
export function extrasBuscables(
  def: DefinicionPlantilla,
  datosExtra: Readonly<Record<string, unknown>>,
  nombreCementerio: ReadonlyMap<string, string>,
): Array<string | number> {
  const valores: Array<string | number> = [];
  for (const campo of def.campos_extra) {
    if (!campo.buscable) continue;
    const v = datosExtra[campo.clave];
    if (typeof v === "number") valores.push(v);
    else if (typeof v === "string") valores.push(campo.tipo === "cementerio" ? (nombreCementerio.get(v) ?? v) : v);
  }
  return valores;
}

/** Una persona validada como fila de `expediente_personas`. */
export function filaPersona(
  p: PersonaValidada,
  expedienteId: bigint,
  creadaMovId: bigint,
  orden: number = p.orden,
): Prisma.ExpedientePersonaCreateManyInput {
  return {
    expedienteId,
    rol: p.rol,
    orden,
    tipoPersona: p.tipo,
    apellido: p.apellido,
    nombres: p.nombres,
    dni: p.dni,
    razonSocial: p.razonSocial,
    cuit: p.cuit,
    fallecido: p.fallecido,
    fechaDefuncion: fechaParaDb(p.fechaDefuncion),
    vinculo: p.vinculo,
    telefono: p.telefono,
    telefonoWhatsapp: p.telefonoWhatsapp,
    email: p.email,
    domicilio: p.domicilio,
    esContacto: p.esContacto,
    creadaMovId,
  };
}

function datosDelMovimiento(v: AltaValidada, plantilla: { codigo: string; version: number }, cementerio: string): Prisma.InputJsonObject {
  // Sin datos personales (2.8): las personas se obtienen por creada_mov_id.
  return {
    plantilla: { codigo: plantilla.codigo, version: plantilla.version },
    cementerio,
    tipo_monumento: v.tipoMonumento,
    ubicacion: v.ubicacion,
    padron: v.padron,
    numero_municipal: v.numeroMunicipal,
    forma_pago: v.formaPago,
    fecha_inicio: v.fechaInicio,
    datos_extra: v.datosExtra,
    documentos_recibidos: v.documentosRecibidos,
    observaciones: v.observaciones,
  };
}

/**
 * Da de alta un expediente. Ver el comentario del módulo.
 *
 * @param datos lo que manda el formulario (`DatosAlta`); se valida acá.
 * @param comandoId UUID generado por el formulario al abrirse: un doble clic o
 *   un reintento con el mismo comando devuelve el mismo expediente.
 * @throws PermisoDenegado
 * @throws ErrorDominio `validacion`, `plantilla_no_publicada`, `configuracion_incompleta`
 */
export async function alta(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  datos: unknown,
  comandoId: string,
): Promise<ResultadoAlta> {
  const comando = validarComando(comandoId);
  const cabecera = Cabecera.safeParse(datos);
  if (!cabecera.success) throw errorValidacion(erroresDeZod(cabecera.error));

  exigirPermiso("alta", null, usuario);
  if (cabecera.data.cargaHistorica) exigirPermiso("carga_historica", null, usuario);
  if (cabecera.data.expedienteAnteriorId) exigirPermiso("reiniciar_con_otra_plantilla", null, usuario);

  const ahora = deps.ahora?.() ?? new Date();
  return deps.escribir(usuario.id, null, (tx) => altaEn(tx, usuario, datos, comando, ahora, { generarCodigo: deps.generarCodigoConsulta }));
}

export interface OpcionesAltaEn {
  /**
   * Semana 4, "archivar y abrir vinculado" (caducidad): el expediente anterior
   * se archivó sin concluir en esta misma transacción y el nuevo lo
   * referencia sin que el anterior esté anulado.
   */
  anteriorVinculado?: { id: bigint; numero: string };
  /** El generador del código de consulta (`DependenciasExpedientes.generarCodigoConsulta`). */
  generarCodigo?: (numero: string) => string;
}

/**
 * Un código de consulta que ningún expediente tiene (el índice único lo
 * exige igual). Con el generador determinista de la semilla, si choca, uno al
 * azar. Lo usan el alta y "Regenerar código de consulta".
 */
export async function codigoConsultaLibre(
  tx: Pick<Transaccion, "expediente">,
  numero: string,
  generar: (numero: string) => string = generarCodigoConsulta,
): Promise<string> {
  for (let intento = 0; intento < 5; intento++) {
    const codigo = intento < 2 ? generar(numero) : generarCodigoConsulta();
    const ocupado = await tx.expediente.findUnique({ where: { codigoConsulta: codigo }, select: { id: true } });
    if (!ocupado) return codigo;
  }
  throw new Error("No se encontró un código de consulta libre en 5 intentos");
}

/**
 * El alta dentro de una transacción ya abierta (con el actor fijado). La usan
 * `alta()` y "archivar y abrir vinculado", que archiva el anterior y da de
 * alta el nuevo en una sola transacción.
 */
export async function altaEn(
  tx: Transaccion,
  usuario: UsuarioPermisos,
  datos: unknown,
  comando: string,
  ahora: Date,
  opciones: OpcionesAltaEn = {},
): Promise<ResultadoAlta> {
  const cabecera = Cabecera.safeParse(datos);
  if (!cabecera.success) throw errorValidacion(erroresDeZod(cabecera.error));
  const hoy = hoyEnTucuman(ahora);
  const anio = anioEnTucuman(ahora);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NUMERACION}::int, ${anio}::int)`;
  const repetido = await resultadoRepetido(tx, comando);
  if (repetido) return repetido;

  const plantilla = await cargarPlantilla(tx, cabecera.data.plantillaId);
  if (!plantilla) throw errorValidacion([{ ruta: "plantillaId", mensaje: "No existe ese trámite" }]);
  if (plantilla.estado !== "publicada") {
    throw new ErrorDominio(
      "plantilla_no_publicada",
      `La plantilla ${plantilla.codigo} v${plantilla.version} no está publicada: recargá el formulario para tomar la versión vigente`,
    );
  }
  const cementerio = await cargarCementerio(tx, cabecera.data.cementerioId);
  if (!cementerio || !cementerio.activo) throw errorValidacion([{ ruta: "cementerioId", mensaje: "Elegí un cementerio activo" }]);

  const contexto = await cargarContexto(tx, plantilla, cementerio, hoy);
  if (contexto.problemas.length > 0) throw new ErrorDominio("configuracion_incompleta", contexto.problemas.join(". "));
  const v = validarCon(construirEsquemaAlta(contexto.esquema), datos);
  const def = plantilla.definicion;
  const anterior = await validarAnterior(tx, v.expedienteAnteriorId, opciones.anteriorVinculado ?? null);

  const maximo = await tx.expediente.aggregate({ where: { anio }, _max: { secuencia: true } });
  const secuencia = (maximo._max.secuencia ?? 0) + 1;
  const numero = formatearNumeroInterno(anio, secuencia);

  // De a una: dentro de la transacción todo va por la misma conexión.
  const areas = await tx.area.findMany({ select: { id: true, codigo: true, tipo: true } });
  const cementerios = await tx.cementerio.findMany({ select: { codigo: true, nombre: true, areaId: true } });
  const primerPaso = def.pasos[0];
  const destino = areasDelPaso(primerPaso, {
    areas: new Map(areas.map((a) => [a.codigo, a])),
    areaCementerioId: cementerio.areaId,
    areaDeCementerio: new Map(cementerios.map((c) => [c.codigo, c.areaId])),
    datosExtra: v.datosExtra,
  });

  const esHoy = v.fechaInicio === hoy;
  const fechaEfectiva = esHoy ? ahora : inicioDelDiaEnTucuman(v.fechaInicio);
  const recibidoEn = destino.externa || usuario.area?.id === destino.areaActualId ? fechaEfectiva : null;
  const ubicacionTexto = textoDeUbicacion(cementerio.camposUbicacion, v.ubicacion);
  const busqueda = armarBusqueda({
    anio,
    secuencia,
    numeroMunicipal: v.numeroMunicipal,
    padron: v.padron,
    cementerio: cementerio.nombre,
    ubicacionTexto,
    personas: v.personas,
    extrasBuscables: extrasBuscables(def, v.datosExtra, new Map(cementerios.map((c) => [c.codigo, c.nombre]))),
  });

  const codigoConsulta = await codigoConsultaLibre(tx, numero, opciones.generarCodigo);

  const expediente = await tx.expediente.create({
    data: {
      codigoConsulta,
      anio,
      secuencia,
      numeroInterno: numero,
      numeroMunicipal: v.numeroMunicipal,
      fechaInicio: fechaParaDb(v.fechaInicio),
      tipoTramiteId: plantilla.tipoTramite.id,
      plantillaId: plantilla.id,
      expedienteAnteriorId: anterior?.id ?? null,
      cementerioId: cementerio.id,
      tipoMonumento: v.tipoMonumento,
      ubicacion: v.ubicacion,
      ubicacionTexto,
      padron: v.padron,
      formaPago: v.formaPago,
      observaciones: v.observaciones,
      datosExtra: v.datosExtra,
      estado: primerPaso.estado,
      pasoClave: primerPaso.clave,
      pasoOrden: 1,
      areaActualId: destino.areaActualId,
      areaResponsableId: destino.areaResponsableId,
      enAreaDesde: fechaEfectiva,
      recibidoEn,
      // El plazo arranca con la fecha de su subtarea de inicio, que en el alta no está tildada.
      plazoDiasHabiles: primerPaso.plazo?.dias_habiles ?? null,
      cargaHistorica: v.cargaHistorica,
      busqueda,
      creadoPor: usuario.id,
      version: 0,
    },
    select: { id: true },
  });

  const movimiento = await tx.movimiento.create({
    data: {
      expedienteId: expediente.id,
      tipo: "alta",
      fechaEfectiva,
      precisionFecha: esHoy ? "minuto" : "dia",
      usuarioId: usuario.id,
      pasoDestino: primerPaso.clave,
      areaDestinoId: destino.areaActualId,
      estadoNuevo: primerPaso.estado,
      datos: {
        ...datosDelMovimiento(v, plantilla, cementerio.codigo),
        ...(anterior ? { expediente_anterior: anterior.numero, vinculo: anterior.vinculo } : {}),
      },
      cargaHistorica: v.cargaHistorica,
      fuente: v.fuente,
      comandoId: comando,
    },
    select: { id: true },
  });

  await tx.expedientePersona.createMany({ data: v.personas.map((p) => filaPersona(p, expediente.id, movimiento.id)) });
  await tx.expediente.update({
    where: { id: expediente.id },
    data: { items: itemsIniciales(v.documentosRecibidos, movimiento.id) },
  });

  const avisos = await buscarDuplicados(tx, {
    cementerioId: cementerio.id,
    ubicacionClave: claveDeUbicacion(v.ubicacion),
    padron: v.padron,
    numeroMunicipal: v.numeroMunicipal,
    excluirId: expediente.id,
  });

  return {
    id: expediente.id.toString(),
    numero,
    numeroCorto: numeroCorto(anio, secuencia),
    version: 0,
    repetido: false,
    // El anterior está sobre el mismo espacio a propósito: no es un aviso.
    avisos: anterior ? avisos.filter((a) => a.numero !== anterior.numero) : avisos,
  };
}

/** Cómo se enlaza un expediente con el anterior (2.13(a) y docs/fuentes, punto 6). */
export type VinculoAnterior = "reinicio" | "vinculado";

/**
 * El expediente anterior de un alta (`expediente_anterior_id`):
 *
 * - **reinicio** (2.13(a)): el anterior existe, quedó anulado por
 *   "Reiniciar con otra plantilla" (su anulación lleva `datos.reinicio`) y
 *   todavía no tiene un expediente siguiente;
 * - **vinculado** (caducidad): lo fija "archivar y abrir vinculado", que acaba
 *   de archivar el anterior en la misma transacción. No se acepta desde el
 *   formulario.
 */
async function validarAnterior(
  tx: Transaccion,
  idTexto: string | null,
  vinculado: { id: bigint; numero: string } | null,
): Promise<{ id: bigint; numero: string; vinculo: VinculoAnterior } | null> {
  if (vinculado) {
    if (idTexto !== null && idTexto !== vinculado.id.toString()) {
      throw errorValidacion([{ ruta: "expedienteAnteriorId", mensaje: "El expediente vinculado es el que se archiva" }]);
    }
    return { ...vinculado, vinculo: "vinculado" };
  }
  if (idTexto === null) return null;
  const error = (mensaje: string) => errorValidacion([{ ruta: "expedienteAnteriorId", mensaje }], mensaje);
  const anterior = await tx.expediente.findUnique({
    where: { id: BigInt(idTexto) },
    select: { id: true, numeroInterno: true, estado: true, reiniciadoEn: { select: { numeroInterno: true } } },
  });
  if (!anterior) throw error("No existe el expediente anterior");
  if (anterior.estado !== "anulado") throw error(`${anterior.numeroInterno} no está anulado: se reinicia desde su ficha ("Reiniciar con otra plantilla")`);
  const anulacion = await tx.movimiento.findFirst({
    where: { expedienteId: anterior.id, tipo: "estado", estadoNuevo: "anulado" },
    orderBy: { secuencia: "desc" },
    select: { datos: true },
  });
  const datos = (anulacion?.datos ?? {}) as Record<string, unknown>;
  if (datos.reinicio !== true) throw error(`${anterior.numeroInterno} se anuló sin reiniciarlo: no se puede continuar en otro expediente`);
  const siguiente = anterior.reiniciadoEn[0];
  if (siguiente) throw error(`${anterior.numeroInterno} ya continúa en ${siguiente.numeroInterno}`);
  return { id: anterior.id, numero: anterior.numeroInterno, vinculo: "reinicio" };
}
