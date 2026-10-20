/**
 * Dominio de expedientes (semana 2): alta, edición, ficha, carátula, búsqueda
 * y aviso de duplicados. Referencia para las pantallas: docs/api-dominio.md.
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
export type {
  AreaFicha,
  CampoExtraFicha,
  CampoValorFicha,
  ConceptoFicha,
  ContactoCompleto,
  DatosCompletos,
  DocumentoFicha,
  Ficha,
  MovimientoFicha,
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
