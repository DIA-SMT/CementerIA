/**
 * Dominio de expedientes. Semana 2: alta, edición, ficha, carátula, búsqueda y
 * aviso de duplicados. Semana 3: recepción, subtareas, documentos, adjuntos,
 * pase ("Faltan N"), devolución y bandejas. Referencia para las pantallas:
 * docs/api-dominio.md.
 *
 * Todo recibe sus dependencias (`DependenciasExpedientes`): la app usa
 * `expedientes` de ./servidor.ts, que ya las tiene puestas (cliente global y
 * `conActor()`); la semilla y los tests arman el servicio con
 * `crearServicioExpedientes({ leer: cliente, escribir: conActorEn(cliente, …) })`.
 *
 * Este módulo no importa `server-only` (lo necesitan la semilla y los tests),
 * pero es código de servidor. Lo que puede ir al navegador, para validar el
 * formulario antes de enviarlo, está en ./esquemas.ts (puro, solo zod).
 */

import { buscarExpedientes, type EntradaBusqueda } from "../busqueda";
import { leerAdjunto, subirAdjunto, type MetadatosAdjunto, type OpcionesLecturaAdjunto } from "./adjuntos";
import { bandeja, contadoresBandeja, contadorPorConfirmar, type PestanaBandeja } from "./bandejas";
import { devolver, type OpcionesDevolucion } from "./devolucion";
import { marcarDocumento, type EstadoMarcable, type OpcionesDocumento } from "./documentos";
import { darPase, validarPase, type OpcionesPase } from "./pase";
import { confirmarRecepcion, confirmarRecepciones, type ItemLoteRecepcion, type OpcionesRecepcion } from "./recepcion";
import { destildarSubtarea, tildarSubtarea, type OpcionesSubtarea } from "./subtareas";
import type { UsuarioPermisos } from "../permisos";
import type { OpcionesAcceso } from "./acceso";
import { alta } from "./alta";
import { datosCaratula } from "./caratula";
import { opcionesAlta, opcionesBusqueda } from "./contexto";
import type { DependenciasExpedientes } from "./dependencias";
import { avisosDuplicados, type ConsultaDuplicados } from "./duplicados";
import { editar } from "./editar";
import { obtenerFicha, verDatosCompletos } from "./ficha";
import { contextoAlta, formularioEdicion } from "./formulario";
import { datosHistorial } from "./historial";

export function crearServicioExpedientes(deps: DependenciasExpedientes) {
  return {
    /** Trámites (plantillas publicadas) y cementerios para el primer paso del alta. */
    opcionesAlta: () => opcionesAlta(deps.leer),
    /** Contexto del formulario de alta para una plantilla y un cementerio. */
    contextoAlta: (usuario: UsuarioPermisos, plantillaId: number, cementerioId: number) =>
      contextoAlta(deps, usuario, plantillaId, cementerioId),
    /** Otros expedientes con la misma ubicación, padrón o N° municipal. */
    avisosDuplicados: (usuario: UsuarioPermisos, consulta: ConsultaDuplicados) => avisosDuplicados(deps.leer, usuario, consulta),
    alta: (usuario: UsuarioPermisos, datos: unknown, comandoId: string) => alta(deps, usuario, datos, comandoId),
    /** Contexto y valores actuales del formulario de edición. */
    formularioEdicion: (usuario: UsuarioPermisos, numero: string, opciones?: OpcionesAcceso) =>
      formularioEdicion(deps, usuario, numero, opciones),
    editar: (
      usuario: UsuarioPermisos,
      numero: string,
      cambios: unknown,
      versionVista: number,
      motivo: string | null,
      comandoId: string,
    ) => editar(deps, usuario, numero, cambios, versionVista, motivo, comandoId),
    obtenerFicha: (usuario: UsuarioPermisos, numero: string, opciones?: OpcionesAcceso) => obtenerFicha(deps, usuario, numero, opciones),
    verDatosCompletos: (usuario: UsuarioPermisos, numero: string, motivo: string | null, opciones?: OpcionesAcceso) =>
      verDatosCompletos(deps, usuario, numero, motivo, opciones),
    datosCaratula: (usuario: UsuarioPermisos, numero: string, opciones?: OpcionesAcceso) => datosCaratula(deps, usuario, numero, opciones),
    /** La hoja imprimible del historial; registra `imprimir` (`hoja: "historial"`). */
    datosHistorial: (usuario: UsuarioPermisos, numero: string, opciones?: OpcionesAcceso) => datosHistorial(deps, usuario, numero, opciones),
    /** Catálogos para los filtros del buscador. No pide usuario, como `opcionesAlta`. */
    opcionesBusqueda: () => opcionesBusqueda(deps.leer),
    /** La caja única de `/expedientes?q=` y sus filtros. */
    buscar: (usuario: UsuarioPermisos, entrada: EntradaBusqueda) => buscarExpedientes(deps.leer, usuario, entrada),

    // --- Semana 3 ------------------------------------------------------------
    /** Confirmar la recepción de un expediente. */
    confirmarRecepcion: (usuario: UsuarioPermisos, numero: string, versionVista: number, comandoId: string, opciones?: OpcionesRecepcion) =>
      confirmarRecepcion(deps, usuario, numero, versionVista, comandoId, opciones),
    /** Confirmar la recepción en lote (cada expediente en su transacción). */
    confirmarRecepciones: (usuario: UsuarioPermisos, seleccion: readonly ItemLoteRecepcion[], comandoId: string, opciones?: OpcionesRecepcion) =>
      confirmarRecepciones(deps, usuario, seleccion, comandoId, opciones),
    tildarSubtarea: (
      usuario: UsuarioPermisos,
      numero: string,
      clave: string,
      dato: string | null,
      versionVista: number,
      comandoId: string,
      opciones?: OpcionesSubtarea,
    ) => tildarSubtarea(deps, usuario, numero, clave, dato, versionVista, comandoId, opciones),
    destildarSubtarea: (
      usuario: UsuarioPermisos,
      numero: string,
      clave: string,
      motivo: string | null,
      versionVista: number,
      comandoId: string,
      opciones?: OpcionesSubtarea,
    ) => destildarSubtarea(deps, usuario, numero, clave, motivo, versionVista, comandoId, opciones),
    marcarDocumento: (
      usuario: UsuarioPermisos,
      numero: string,
      clave: string,
      estado: EstadoMarcable,
      observacion: string | null,
      versionVista: number,
      comandoId: string,
      opciones?: OpcionesDocumento,
    ) => marcarDocumento(deps, usuario, numero, clave, estado, observacion, versionVista, comandoId, opciones),
    /** Subida en streaming (Route Handler `POST /api/expedientes/[numero]/adjuntos`). */
    subirAdjunto: (
      usuario: UsuarioPermisos,
      numero: string,
      contenido: ReadableStream<Uint8Array>,
      metadatos: MetadatosAdjunto,
      versionVista: number,
      comandoId: string,
    ) => subirAdjunto(deps, usuario, numero, contenido, metadatos, versionVista, comandoId),
    /** Visor y descarga (Route Handler `/adjuntos/[movimientoId]`); registra el acceso. */
    leerAdjunto: (usuario: UsuarioPermisos, movimientoId: string, opciones?: OpcionesLecturaAdjunto) =>
      leerAdjunto(deps, usuario, movimientoId, opciones),
    /** "Faltan N" y los destinos posibles, sin escribir. */
    validarPase: (usuario: UsuarioPermisos, numero: string) => validarPase(deps, usuario, numero),
    darPase: (usuario: UsuarioPermisos, numero: string, pasoDestino: string, versionVista: number, comandoId: string, opciones?: OpcionesPase) =>
      darPase(deps, usuario, numero, pasoDestino, versionVista, comandoId, opciones),
    devolver: (
      usuario: UsuarioPermisos,
      numero: string,
      pasoDestino: string,
      motivo: string | null,
      subtareasARehacer: readonly string[],
      versionVista: number,
      comandoId: string,
      opciones?: OpcionesDevolucion,
    ) => devolver(deps, usuario, numero, pasoDestino, motivo, subtareasARehacer, versionVista, comandoId, opciones),
    /** Una pestaña de `/bandeja`: `por_confirmar`, `en_mi_area` o `afuera`. */
    bandeja: (usuario: UsuarioPermisos, pestana: PestanaBandeja) => bandeja(deps, usuario, pestana),
    /** El contador "Por confirmar" del encabezado. */
    contadorPorConfirmar: (usuario: UsuarioPermisos) => contadorPorConfirmar(deps, usuario),
    /** Cuántos hay en cada pestaña de `/bandeja` (y cuál tiene trabajo). */
    contadoresBandeja: (usuario: UsuarioPermisos) => contadoresBandeja(deps, usuario),
  };
}

export type ServicioExpedientes = ReturnType<typeof crearServicioExpedientes>;

export type { DependenciasExpedientes, Escritor, Lector } from "./dependencias";
export type { OpcionesAcceso } from "./acceso";
export type { ResultadoAlta } from "./alta";
export type { Caratula, PasoCaratula, PersonaCaratula } from "./caratula";
export type {
  CementerioCargado,
  CementerioFiltro,
  CementerioOpcion,
  CodigoNombre,
  ContextoFormulario,
  OpcionesAlta,
  OpcionesBusqueda,
  PlantillaCargada,
  PlantillaOpcion,
} from "./contexto";
export type { AvisoDuplicado, ConsultaDuplicados, MotivoDuplicado } from "./duplicados";
export type { ResultadoEdicion } from "./editar";
export { ErrorDominio, MENSAJE_CONFLICTO_VERSION, LARGO_MINIMO_MOTIVO, type CodigoErrorDominio, type ErrorCampo } from "./errores";
export {
  construirEsquemaAlta,
  construirEsquemaEdicion,
  DIAS_RETROACTIVOS_MAX,
  validarCon,
  type AltaValidada,
  type CambiosEdicion,
  type ContextoEdicion,
  type ContextoEsquema,
  type DatosAlta,
  type EdicionValidada,
  type PersonaEntrada,
  type PersonaValidada,
  type ValorCampoExtra,
} from "./esquemas";
export type { AdjuntoLeido, MetadatosAdjunto, OpcionesLecturaAdjunto, ResultadoAdjunto } from "./adjuntos";
export {
  MAXIMO_FILAS_BANDEJA,
  PESTANAS_BANDEJA,
  type Bandeja,
  type ContadoresBandeja,
  type EtiquetaBandeja,
  type FilaBandeja,
  type PestanaBandeja,
} from "./bandejas";
export type { OpcionesDevolucion, ResultadoDevolucion } from "./devolucion";
export { ESTADOS_MARCABLES, type EstadoMarcable, type OpcionesDocumento, type ResultadoDocumento } from "./documentos";
export {
  destinosPosibles,
  faltantesDelPaso,
  faltantesParaSalir,
  interpretarFechaEfectiva,
  subtareasReiniciables,
  type DestinoPase,
  type EntradaFechaEfectiva,
  type Faltante,
  type FechaEfectiva,
  type PrecisionFecha,
  type RefPaso,
  type SubtareaReiniciable,
} from "./flujo";
export type { OpcionesPase, ResultadoPase, ValidacionPase } from "./pase";
export type { ItemLoteRecepcion, OpcionesRecepcion, ResultadoItemLote, ResultadoRecepcion } from "./recepcion";
export { LARGO_MAXIMO_DATO_TEXTO, type OpcionesSubtarea, type ResultadoSubtarea } from "./subtareas";
export type {
  AdjuntoFicha,
  AreaFicha,
  CampoExtraFicha,
  CampoValorFicha,
  ConceptoFicha,
  ContactoCompleto,
  DatosCompletos,
  DevolucionFicha,
  DocumentoFicha,
  Ficha,
  MovimientoFicha,
  PaseFicha,
  PasoFicha,
  PersonaFicha,
  PlazoFicha,
  Situacion,
  SubtareaFicha,
  UsuarioFicha,
} from "./ficha";
export type { FormularioEdicion } from "./formulario";
export type { HojaHistorial, PersonaHistorial } from "./historial";
export { canonizarNumeroInterno, formatearNumeroInterno, numeroCorto } from "./numero";
export type { CampoUbicacion, Ubicacion } from "./ubicacion";
export type {
  CampoCoincidencia,
  Coincidencia,
  ConsultaAnalizada,
  EntradaBusqueda,
  FiltrosBusqueda,
  ResultadoBusqueda,
  ResultadoBusquedaFila,
} from "../busqueda";
