/**
 * Dominio de expedientes. Semana 2: alta, edición, ficha, carátula, búsqueda y
 * aviso de duplicados. Semana 3: recepción, subtareas, documentos, adjuntos,
 * pase ("Faltan N"), devolución y bandejas. Semana 4: estados (concluir,
 * archivar, anular, reabrir, desarchivar), reiniciar con otra plantilla y
 * archivar y abrir vinculado, correcciones, nota, transcripción histórica,
 * plazo DIM, pestañas Plazos y Carga histórica, panel, CSV y feriados.
 * Referencia para las pantallas: docs/api-dominio.md.
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
import { verificarIntegridad, verificarIntegridadTodos } from "./integridad";
import {
  corregirFecha,
  corregirObservacion,
  corregirSubtarea,
  purgarAdjunto,
  retirarAdjunto,
  revertir,
  suprimirPersona,
  type CambioSubtarea,
} from "./correcciones";
import {
  anular,
  archivar,
  archivarSinConcluir,
  archivarYAbrirVinculado,
  cambiarUbicacionArchivo,
  concluir,
  desarchivar,
  precargaAlta,
  reabrir,
  reiniciar,
  type EntradaArchivarSinConcluir,
  type OpcionesEstado,
} from "./estados";
import { exportarCsv } from "./exportar";
import { aniosDeFeriados, cerrarAnioFeriados, guardarFeriado, listarFeriados, quitarFeriado, reabrirAnioFeriados } from "./feriados";
import { agregarNota } from "./nota";
import { panel, type FiltrosPanel } from "./panel";
import {
  terminarCargaHistorica,
  tildarSubtareaHistorica,
  transcribir,
  transcribirEstado,
  type EntradaEstadoHistorico,
  type FilaTranscripcion,
  type OpcionesSubtareaHistorica,
} from "./transcripcion";
import type { EntradaFechaEfectiva } from "./flujo";

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

    // --- Semana 4: estados (3.1) ---------------------------------------------
    /** Concluir desde el último paso ("Faltan N" con lo de "al concluir"). */
    concluir: (usuario: UsuarioPermisos, numero: string, versionVista: number, comandoId: string, opciones?: OpcionesEstado) =>
      concluir(deps, usuario, numero, versionVista, comandoId, opciones),
    /** Archivar un concluido. */
    archivar: (usuario: UsuarioPermisos, numero: string, ubicacionArchivo: string, versionVista: number, comandoId: string, opciones?: OpcionesEstado) =>
      archivar(deps, usuario, numero, ubicacionArchivo, versionVista, comandoId, opciones),
    archivarSinConcluir: (usuario: UsuarioPermisos, numero: string, entrada: EntradaArchivarSinConcluir, versionVista: number, comandoId: string) =>
      archivarSinConcluir(deps, usuario, numero, entrada, versionVista, comandoId),
    desarchivar: (usuario: UsuarioPermisos, numero: string, motivo: string | null, versionVista: number, comandoId: string, opciones?: OpcionesEstado) =>
      desarchivar(deps, usuario, numero, motivo, versionVista, comandoId, opciones),
    anular: (usuario: UsuarioPermisos, numero: string, motivo: string | null, versionVista: number, comandoId: string, opciones?: OpcionesEstado) =>
      anular(deps, usuario, numero, motivo, versionVista, comandoId, opciones),
    reabrir: (usuario: UsuarioPermisos, numero: string, motivo: string | null, versionVista: number, comandoId: string, opciones?: OpcionesEstado) =>
      reabrir(deps, usuario, numero, motivo, versionVista, comandoId, opciones),
    cambiarUbicacionArchivo: (
      usuario: UsuarioPermisos,
      numero: string,
      ubicacionArchivo: string,
      versionVista: number,
      comandoId: string,
      opciones?: { motivo?: string | null },
    ) => cambiarUbicacionArchivo(deps, usuario, numero, ubicacionArchivo, versionVista, comandoId, opciones),
    /** Reiniciar con otra plantilla (2.13(a)): anula y devuelve la precarga del alta nueva. */
    reiniciar: (usuario: UsuarioPermisos, numero: string, motivo: string | null, versionVista: number, comandoId: string, opciones?: OpcionesEstado) =>
      reiniciar(deps, usuario, numero, motivo, versionVista, comandoId, opciones),
    /** Los datos de `/expedientes/nuevo?desde=<numero>`. */
    precargaAlta: (usuario: UsuarioPermisos, numero: string, opciones?: OpcionesAcceso) => precargaAlta(deps, usuario, numero, opciones),
    /** Archivar sin concluir y abrir un expediente vinculado (caducidad, docs/fuentes punto 6). */
    archivarYAbrirVinculado: (
      usuario: UsuarioPermisos,
      numero: string,
      entrada: EntradaArchivarSinConcluir,
      datosAlta: unknown,
      versionVista: number,
      comandoId: string,
    ) => archivarYAbrirVinculado(deps, usuario, numero, entrada, datosAlta, versionVista, comandoId),
    /** Nota libre. */
    agregarNota: (
      usuario: UsuarioPermisos,
      numero: string,
      texto: string | null,
      versionVista: number,
      comandoId: string,
      opciones?: { fechaEfectiva?: EntradaFechaEfectiva },
    ) => agregarNota(deps, usuario, numero, texto, versionVista, comandoId, opciones),

    // --- Semana 4: correcciones (2.13(b)) ----------------------------------
    revertir: (usuario: UsuarioPermisos, numero: string, movimientoId: string, motivo: string | null, versionVista: number, comandoId: string) =>
      revertir(deps, usuario, numero, movimientoId, motivo, versionVista, comandoId),
    corregirFecha: (
      usuario: UsuarioPermisos,
      numero: string,
      movimientoId: string,
      fecha: EntradaFechaEfectiva,
      motivo: string | null,
      versionVista: number,
      comandoId: string,
    ) => corregirFecha(deps, usuario, numero, movimientoId, fecha, motivo, versionVista, comandoId),
    corregirObservacion: (
      usuario: UsuarioPermisos,
      numero: string,
      movimientoId: string,
      observacion: string | null,
      motivo: string | null,
      versionVista: number,
      comandoId: string,
    ) => corregirObservacion(deps, usuario, numero, movimientoId, observacion, motivo, versionVista, comandoId),
    corregirSubtarea: (
      usuario: UsuarioPermisos,
      numero: string,
      clave: string,
      cambio: CambioSubtarea,
      motivo: string | null,
      versionVista: number,
      comandoId: string,
    ) => corregirSubtarea(deps, usuario, numero, clave, cambio, motivo, versionVista, comandoId),
    retirarAdjunto: (usuario: UsuarioPermisos, numero: string, adjuntoId: string, motivo: string | null, versionVista: number, comandoId: string) =>
      retirarAdjunto(deps, usuario, numero, adjuntoId, motivo, versionVista, comandoId),
    purgarAdjunto: (usuario: UsuarioPermisos, numero: string, adjuntoId: string, motivo: string | null, versionVista: number, comandoId: string) =>
      purgarAdjunto(deps, usuario, numero, adjuntoId, motivo, versionVista, comandoId),
    suprimirPersona: (usuario: UsuarioPermisos, numero: string, personaId: string, motivo: string | null, versionVista: number, comandoId: string) =>
      suprimirPersona(deps, usuario, numero, personaId, motivo, versionVista, comandoId),

    // --- Semana 4: transcripción histórica (2.13(c)) -------------------------
    transcribir: (usuario: UsuarioPermisos, numero: string, filas: readonly FilaTranscripcion[], versionVista: number) =>
      transcribir(deps, usuario, numero, filas, versionVista),
    tildarSubtareaHistorica: (
      usuario: UsuarioPermisos,
      numero: string,
      clave: string,
      dato: string | null,
      opciones: OpcionesSubtareaHistorica,
      versionVista: number,
      comandoId: string,
    ) => tildarSubtareaHistorica(deps, usuario, numero, clave, dato, opciones, versionVista, comandoId),
    transcribirEstado: (usuario: UsuarioPermisos, numero: string, entrada: EntradaEstadoHistorico, versionVista: number, comandoId: string) =>
      transcribirEstado(deps, usuario, numero, entrada, versionVista, comandoId),
    terminarCargaHistorica: (usuario: UsuarioPermisos, numero: string, versionVista: number, comandoId: string) =>
      terminarCargaHistorica(deps, usuario, numero, versionVista, comandoId),

    // --- Semana 4: panel, CSV y feriados -------------------------------------
    panel: (usuario: UsuarioPermisos, filtros?: FiltrosPanel) => panel(deps, usuario, filtros),
    /** CSV del buscador (Dirección y admin), sin contacto; registra `exportar`. */
    exportarCsv: (usuario: UsuarioPermisos, entrada: EntradaBusqueda, opciones?: OpcionesAcceso) => exportarCsv(deps, usuario, entrada, opciones),
    listarFeriados: (anio: number) => listarFeriados(deps, anio),
    aniosDeFeriados: () => aniosDeFeriados(deps),
    guardarFeriado: (
      usuario: UsuarioPermisos,
      entrada: { fecha: string; descripcion: string; ambito: string; norma?: string | null },
      motivo?: string | null,
    ) => guardarFeriado(deps, usuario, entrada, motivo ?? null),
    quitarFeriado: (usuario: UsuarioPermisos, fecha: string, motivo?: string | null) => quitarFeriado(deps, usuario, fecha, motivo ?? null),
    cerrarAnioFeriados: (usuario: UsuarioPermisos, anio: number, motivo?: string | null) => cerrarAnioFeriados(deps, usuario, anio, motivo ?? null),
    reabrirAnioFeriados: (usuario: UsuarioPermisos, anio: number, motivo: string | null) => reabrirAnioFeriados(deps, usuario, anio, motivo),

    // --- 26/10/2026: integridad del historial (cadena de hash) --------------
    /** "Verificar integridad" de la ficha; registra `verificar_historial`. */
    verificarIntegridad: (usuario: UsuarioPermisos, numero: string, opciones?: OpcionesAcceso) => verificarIntegridad(deps, usuario, numero, opciones),
    /** Todos los expedientes, con resumen (admin); registra `verificar_historial` sin expediente. */
    verificarIntegridadTodos: (usuario: UsuarioPermisos, opciones?: OpcionesAcceso) => verificarIntegridadTodos(deps, usuario, opciones),
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
  faltantesParaConcluir,
  semaforoPlazo,
  textoPlazo,
  DIAS_PLAZO_POR_VENCER,
  type SemaforoPlazo,
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
  EnlaceExpediente,
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
// Semana 4
export type { VinculoAnterior, OpcionesAltaEn } from "./alta";
export {
  UBICACION_ARCHIVO_DESCONOCIDA,
  type EntradaArchivarSinConcluir,
  type OpcionesEstado,
  type PrecargaAlta,
  type ResultadoEstado,
  type ResultadoReinicio,
  type ResultadoVinculado,
} from "./estados";
export {
  correccionesPosibles,
  objetivoDeReversion,
  type CambioSubtarea,
  type ObjetivoReversion,
  type ResultadoCorreccion,
  type TipoCorreccion,
} from "./correcciones";
export { LARGO_MAXIMO_NOTA, type ResultadoNota } from "./nota";
export {
  pendientesHistoricos,
  type EntradaEstadoHistorico,
  type FilaTranscripcion,
  type OpcionesSubtareaHistorica,
  type ResultadoAccionHistorica,
  type ResultadoFilaTranscripcion,
  type ResultadoTranscripcion,
} from "./transcripcion";
export { DIAS_SIN_CONFIRMAR, MAXIMO_FILAS_PANEL, type FilaPanel, type FilaPlazoPanel, type FiltrosPanel, type Lista, type MovimientoPanel, type Panel } from "./panel";
export { armarCsv, celdaCsv, COLUMNAS_CSV, MAXIMO_FILAS_CSV, type ExportacionCsv } from "./exportar";
export { AMBITOS_FERIADO, type AmbitoFeriado, type AnioFeriados, type Feriado } from "./feriados";
export type { PlazoCalculado } from "./plazos";
export {
  reconstruirProyeccion,
  proyeccionComparable,
  movimientosRevertidos,
  type MovimientoReconstruible,
  type ProyeccionFlujo,
} from "./reconstruccion";
export type { HojaHistorial, PersonaHistorial } from "./historial";
export {
  abreviarHash,
  LARGO_HUELLA,
  verificarCadenas,
  verificarIntegridadNocturna,
  type MotivoRotura,
  type ResultadoIntegridad,
  type ResumenIntegridad,
} from "./integridad";
export { agruparEnTramos, type TramoHistorial } from "./tramos";
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
