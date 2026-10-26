/**
 * Avisos en el sistema (26/10/2026; docs/api-dominio.md, sección 21).
 *
 * - Los que nacen de una acción (llegó, te devolvieron, concluido o archivado)
 *   los crea el dominio de expedientes en la transacción del movimiento
 *   (./eventos.ts): no hay nada que llamar desde la pantalla.
 * - Los que nacen del paso del tiempo (plazo DIM, sin confirmar, demorado),
 *   `generarAvisosPorTiempo()` (./tiempo.ts), que corre la tarea programada y,
 *   si ese día no corrió, la primera carga de un operador (`generarSiHaceFalta`).
 * - Lo que ve cada usuario (./consultas.ts): el contador, la campana, /avisos,
 *   marcar leído y las preferencias.
 *
 * La app usa `avisos` de ./servidor.ts; la semilla, los scripts y los tests
 * arman el servicio con `crearServicioAvisos({ leer, escribir })`.
 */

import type { UsuarioPermisos } from "../permisos";
import {
  cambiarPreferencia,
  contarNoLeidos,
  listarAvisos,
  marcarAvisos,
  marcarTodosLeidos,
  preferenciasAvisos,
  resumenAvisos,
  type FiltrosAvisos,
} from "./consultas";
import type { DependenciasAvisos } from "./dependencias";
import { generarAvisosPorTiempo, generarSiHaceFalta } from "./tiempo";

export function crearServicioAvisos(deps: DependenciasAvisos) {
  return {
    /** El número de la campana. */
    contarNoLeidos: (usuario: UsuarioPermisos) => contarNoLeidos(deps, usuario),
    /** La campana: no leídos y los últimos. */
    resumen: (usuario: UsuarioPermisos, limite?: number) => resumenAvisos(deps, usuario, limite),
    /** /avisos: paginada, con filtros (no leídos, tipo). */
    listar: (usuario: UsuarioPermisos, filtros?: FiltrosAvisos) => listarAvisos(deps, usuario, filtros),
    /** Al abrir un aviso, o "Marcar como leído". Solo los propios. */
    marcarLeidos: (usuario: UsuarioPermisos, ids: readonly unknown[]) => marcarAvisos(deps, usuario, ids, true),
    marcarNoLeidos: (usuario: UsuarioPermisos, ids: readonly unknown[]) => marcarAvisos(deps, usuario, ids, false),
    marcarTodosLeidos: (usuario: UsuarioPermisos) => marcarTodosLeidos(deps, usuario),
    preferencias: (usuario: UsuarioPermisos) => preferenciasAvisos(deps, usuario),
    cambiarPreferencia: (usuario: UsuarioPermisos, tipo: unknown, activo: boolean) => cambiarPreferencia(deps, usuario, tipo, activo),
    /** La tarea programada: genera los avisos por tiempo (idempotente) como SISTEMA. */
    generarPorTiempo: (opciones?: { ahora?: Date }) => generarAvisosPorTiempo(deps, opciones),
    /** El layout: la genera si hoy todavía no corrió (null si no hizo falta). */
    generarSiHaceFalta: () => generarSiHaceFalta(deps),
  };
}

export type ServicioAvisos = ReturnType<typeof crearServicioAvisos>;

export type { DependenciasAvisos, LectorAvisos } from "./dependencias";
export {
  AVISOS_EN_CAMPANA,
  AVISOS_POR_PAGINA,
  idsValidos,
  recibeAvisos,
  type AvisoVista,
  type FiltrosAvisos,
  type ListaAvisos,
  type PreferenciaAviso,
  type ResumenAvisos,
} from "./consultas";
export { avisarCierre, avisarLlegada, destinatariosDelArea, type EventoCierre, type EventoLlegada } from "./eventos";
export { avisosPorTiempo, generarAvisosPorTiempo, generarEn, generarYAnotar, type ExpedienteEnTrabajo, type ResultadoGeneracion } from "./tiempo";
export * from "./tipos";
