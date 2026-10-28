/**
 * Dominio del sitio público (28/10/2026; docs/api-dominio.md, sección 25): el
 * contenido de la página pública que carga la Dirección (cementerios,
 * recorridos y sus fechas, novedades, contacto y preguntas frecuentes), su
 * validación y lo que ve la página.
 *
 * Como los demás, recibe sus dependencias: la app usa `sitio` de
 * ./servidor.ts; los tests, `crearServicioSitio({ leer: cliente, escribir:
 * (u, m, fn) => conActorEn(cliente, u, m, fn) })`.
 */

import type { UsuarioPermisos } from "../permisos";
import {
  agregarFechaRecorrido,
  contenidoSitioAdmin,
  guardarCementerioSitio,
  guardarContacto,
  guardarNovedad,
  guardarPregunta,
  guardarRecorrido,
  quitarFechaRecorrido,
  quitarNovedad,
  type DependenciasSitio,
} from "./admin";
import { contenidoSitioPublico } from "./lectura";

export function crearServicioSitio(deps: DependenciasSitio) {
  const ahora = () => deps.ahora?.() ?? new Date();
  return {
    /** Lo que ve la página pública (sin sesión). */
    contenidoPublico: () => contenidoSitioPublico(deps.leer, ahora()),
    /** Todo, para /admin/sitio-publico. */
    contenidoAdmin: (usuario: UsuarioPermisos) => contenidoSitioAdmin(deps, usuario),
    guardarCementerio: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarCementerioSitio(deps, usuario, entrada, motivo ?? null),
    guardarRecorrido: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarRecorrido(deps, usuario, entrada, motivo ?? null),
    agregarFecha: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => agregarFechaRecorrido(deps, usuario, entrada, motivo ?? null),
    quitarFecha: (usuario: UsuarioPermisos, id: number, motivo?: string | null) => quitarFechaRecorrido(deps, usuario, id, motivo ?? null),
    guardarNovedad: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarNovedad(deps, usuario, entrada, motivo ?? null),
    quitarNovedad: (usuario: UsuarioPermisos, id: number, motivo?: string | null) => quitarNovedad(deps, usuario, id, motivo ?? null),
    guardarContacto: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarContacto(deps, usuario, entrada, motivo ?? null),
    guardarPregunta: (usuario: UsuarioPermisos, entrada: unknown, motivo?: string | null) => guardarPregunta(deps, usuario, entrada, motivo ?? null),
  };
}

export type ServicioSitio = ReturnType<typeof crearServicioSitio>;

export type {
  ContactoSitio,
  ContenidoSitioAdmin,
  DependenciasSitio,
  FilaCementerioSitio,
  FilaFechaRecorrido,
  FilaNovedad,
  FilaPregunta,
  FilaRecorrido,
  LectorSitio,
  ResultadoSitio,
} from "./admin";
export type { CementerioPublico, ContenidoSitioPublico, FechaRecorridoPublica, NovedadPublica, PreguntaPublica, RecorridoPublico } from "./lectura";
export * from "./validacion";
