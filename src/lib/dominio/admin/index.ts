/**
 * Dominio de la administración (semana 5): plantillas (catálogo, editor,
 * publicar y retirar), usuarios, catálogos y auditoría. Solo el admin (3.2:
 * permiso `administrar`). Referencia para las pantallas: docs/api-dominio.md,
 * sección 17.
 *
 * Como el de expedientes, recibe sus dependencias: la app usa `admin` de
 * ./servidor.ts; los tests, `crearServicioAdmin({ leer: cliente, escribir:
 * (u, m, fn) => conActorEn(cliente, u, m, fn) })`. Los feriados ya tenían su
 * API en el servicio de expedientes (`listarFeriados`, `guardarFeriado`,
 * `cerrarAnioFeriados`…) y la pantalla de catálogos la usa tal cual.
 */

import type { UsuarioPermisos } from "../permisos";
import { exportarAuditoria, listarAccesos, listarCambios, opcionesAuditoria, type FiltrosAccesos, type FiltrosCambios } from "./auditoria";
import { guardarArea, guardarCementerio, guardarTipoMonumento, guardarTipoTramite, listarCatalogos } from "./catalogos";
import type { DependenciasAdmin } from "./dependencias";
import {
  catalogoPlantillas,
  catalogosEditor,
  crearPlantilla,
  descartarBorrador,
  editarPlantilla,
  guardarBorrador,
  obtenerVersion,
  publicarBorrador,
  retirarPlantilla,
  validarBorrador,
  type ContenidoBorrador,
} from "./plantillas";
import { altaUsuario, cambiarAccesoUsuario, desactivarUsuario, listarUsuarios, reactivarUsuario } from "./usuarios";

export function crearServicioAdmin(deps: DependenciasAdmin) {
  return {
    // --- Plantillas (2.5, 2.13(a)) ---------------------------------------------
    catalogoPlantillas: (usuario: UsuarioPermisos) => catalogoPlantillas(deps, usuario),
    catalogosEditor: (usuario: UsuarioPermisos) => catalogosEditor(deps, usuario),
    obtenerVersion: (usuario: UsuarioPermisos, codigo: string, version: number) => obtenerVersion(deps, usuario, codigo, version),
    crearPlantilla: (usuario: UsuarioPermisos, entrada: { codigo: string; tipoTramiteId: number; nombre: string }) => crearPlantilla(deps, usuario, entrada),
    editarPlantilla: (usuario: UsuarioPermisos, codigo: string) => editarPlantilla(deps, usuario, codigo),
    guardarBorrador: (usuario: UsuarioPermisos, codigo: string, version: number, contenido: ContenidoBorrador, huella: string) =>
      guardarBorrador(deps, usuario, codigo, version, contenido, huella),
    validarBorrador: (usuario: UsuarioPermisos, contenido: ContenidoBorrador) => validarBorrador(deps, usuario, contenido),
    publicarBorrador: (usuario: UsuarioPermisos, codigo: string, version: number, contenido: ContenidoBorrador, huella: string, notas: string | null) =>
      publicarBorrador(deps, usuario, codigo, version, contenido, huella, notas),
    descartarBorrador: (usuario: UsuarioPermisos, codigo: string, version: number) => descartarBorrador(deps, usuario, codigo, version),
    retirarPlantilla: (usuario: UsuarioPermisos, codigo: string, version: number, motivo: string | null) => retirarPlantilla(deps, usuario, codigo, version, motivo),

    // --- Usuarios (2.4) --------------------------------------------------------
    listarUsuarios: (usuario: UsuarioPermisos) => listarUsuarios(deps, usuario),
    altaUsuario: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => altaUsuario(deps, usuario, entrada, motivo ?? null),
    cambiarAccesoUsuario: (usuario: UsuarioPermisos, id: number, entrada: unknown, motivo?: string | null) => cambiarAccesoUsuario(deps, usuario, id, entrada, motivo ?? null),
    desactivarUsuario: (usuario: UsuarioPermisos, id: number, motivo?: string | null) => desactivarUsuario(deps, usuario, id, motivo ?? null),
    reactivarUsuario: (usuario: UsuarioPermisos, id: number, motivo?: string | null) => reactivarUsuario(deps, usuario, id, motivo ?? null),

    // --- Catálogos (2.1 a 2.3, 2.13(d)) -----------------------------------------
    listarCatalogos: (usuario: UsuarioPermisos) => listarCatalogos(deps, usuario),
    guardarArea: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarArea(deps, usuario, entrada, motivo ?? null),
    guardarCementerio: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarCementerio(deps, usuario, entrada, motivo ?? null),
    guardarTipoMonumento: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarTipoMonumento(deps, usuario, entrada, motivo ?? null),
    guardarTipoTramite: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarTipoTramite(deps, usuario, entrada, motivo ?? null),

    // --- Auditoría (2.10) --------------------------------------------------------
    opcionesAuditoria: (usuario: UsuarioPermisos) => opcionesAuditoria(deps, usuario),
    listarAccesos: (usuario: UsuarioPermisos, filtros?: FiltrosAccesos) => listarAccesos(deps, usuario, filtros),
    listarCambios: (usuario: UsuarioPermisos, filtros?: FiltrosCambios) => listarCambios(deps, usuario, filtros),
    exportarAuditoria: (
      usuario: UsuarioPermisos,
      pedido: { vista: "accesos"; filtros: FiltrosAccesos } | { vista: "cambios"; filtros: FiltrosCambios },
      opciones?: { ip?: string | null },
    ) => exportarAuditoria(deps, usuario, pedido, opciones),
  };
}

export type ServicioAdmin = ReturnType<typeof crearServicioAdmin>;

export type { DependenciasAdmin, LectorAdmin } from "./dependencias";
export {
  ESTADOS_PLANTILLA,
  huellaBorrador,
  type CatalogosEditor,
  type ContenidoBorrador,
  type EstadoPlantilla,
  type FilaCatalogoPlantilla,
  type ResultadoGuardado,
  type ResultadoPublicacion,
  type ResultadoVersion,
  type VersionCatalogo,
  type VersionPlantilla,
} from "./plantillas";
export type { EntradaAccesoUsuario, EntradaAltaUsuario, FilaUsuarioAdmin, ListadoUsuarios } from "./usuarios";
export {
  controlarCamposUbicacion,
  type Catalogos,
  type EntradaArea,
  type EntradaCementerio,
  type EntradaTipoMonumento,
  type EntradaTipoTramite,
  type FilaArea,
  type FilaCementerio,
  type ResultadoCatalogo,
} from "./catalogos";
export {
  ACCIONES_ACCESO,
  ETIQUETA_ACCION_ACCESO,
  MAXIMO_FILAS_CSV_AUDITORIA,
  POR_PAGINA,
  TABLAS_AUDITADAS,
  type AccionAccesoAuditoria,
  type ExportacionAuditoria,
  type FilaAcceso,
  type FilaCambio,
  type FiltrosAccesos,
  type FiltrosCambios,
  type Pagina,
} from "./auditoria";
export { descripcionRegistro, diferenciasCambio, ETIQUETA_TABLA, type Diferencia } from "./diferencias";
export { traducirErrorBase } from "./errores-base";
