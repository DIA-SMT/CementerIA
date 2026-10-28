import { isIP } from "node:net";
import { fechaDesdeDb, hoyEnTucuman, type FechaISO } from "@/lib/fechas";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { exigirNumero, registrarAcceso, type OpcionesAcceso } from "./acceso";
import { codigoConsultaLibre } from "./alta";
import type { DependenciasExpedientes } from "./dependencias";
import { exigirMotivo, noEncontrado } from "./errores";
import { numeroCorto } from "./numero";

/**
 * El código de consulta pública desde adentro (28/10/2026; docs/api-dominio.md,
 * sección 24): la hoja que se le entrega al concesionario y "Regenerar código
 * de consulta". La consulta misma, sin sesión, está en src/lib/dominio/publico/.
 */

export interface Comprobante {
  numero: string;
  numeroCorto: string;
  tipoTramite: string;
  cementerio: string;
  fechaInicio: FechaISO;
  /** Sin guion (`K7QM3XZP`): la pantalla lo muestra `K7QM-3XZP`. */
  codigoConsulta: string;
  /** Hoy en Tucumán: va al pie ("Emitido el …"). */
  emitidoEl: FechaISO;
}

/**
 * Los datos del comprobante para el concesionario (`?hoja=comprobante`), con el
 * registro de `imprimir` (`hoja: "comprobante"`), como la carátula. Sin
 * personas: es un papel que se lleva el concesionario y puede perder.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `no_encontrado`
 */
export async function datosComprobante(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  opciones: OpcionesAcceso = {},
): Promise<Comprobante> {
  exigirPermiso("imprimir", null, usuario);
  const numeroInterno = exigirNumero(numero);
  const hoy = hoyEnTucuman(deps.ahora?.() ?? new Date());
  return deps.escribir(usuario.id, null, async (tx) => {
    const e = await tx.expediente.findUnique({
      where: { numeroInterno },
      select: {
        id: true,
        numeroInterno: true,
        anio: true,
        secuencia: true,
        fechaInicio: true,
        codigoConsulta: true,
        tipoTramite: { select: { nombre: true } },
        cementerio: { select: { nombre: true } },
      },
    });
    if (!e) throw noEncontrado(numeroInterno);
    await registrarAcceso(tx, { usuarioId: usuario.id, accion: "imprimir", expedienteId: e.id, detalle: { hoja: "comprobante" }, ip: opciones.ip });
    return {
      numero: e.numeroInterno,
      numeroCorto: numeroCorto(e.anio, e.secuencia),
      tipoTramite: e.tipoTramite.nombre,
      cementerio: e.cementerio.nombre,
      fechaInicio: fechaDesdeDb(e.fechaInicio),
      codigoConsulta: e.codigoConsulta,
      emitidoEl: hoy,
    };
  });
}

export interface ResultadoRegenerarCodigo {
  numero: string;
  /** El código nuevo, sin guion. */
  codigoConsulta: string;
}

/**
 * "Regenerar código de consulta" (Mesa de Entradas y admin), con motivo: el
 * concesionario perdió el comprobante o el código se filtró. El anterior deja
 * de servir en el acto. El trigger expedientes_codigo_consulta rechaza todo
 * cambio del código que la transacción no haya pedido para ese expediente
 * (`app.regenerar_codigo_consulta`) o que venga sin motivo, y deja
 * `regenerar_codigo_consulta` en auditoria.accesos con el motivo y la IP
 * (`app.ip`), en la misma transacción. No es un movimiento: no cambia la
 * versión del expediente ni su historial.
 *
 * @throws PermisoDenegado
 * @throws ErrorDominio `motivo_requerido`, `no_encontrado`
 */
export async function regenerarCodigoConsulta(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  motivo: string | null,
  opciones: OpcionesAcceso = {},
): Promise<ResultadoRegenerarCodigo> {
  exigirPermiso("regenerar_codigo_consulta", null, usuario);
  const numeroInterno = exigirNumero(numero);
  const m = exigirMotivo(motivo, "Regenerar el código de consulta");
  const ip = opciones.ip && isIP(opciones.ip) !== 0 ? opciones.ip : null;
  return deps.escribir(usuario.id, m, async (tx) => {
    const e = await tx.expediente.findUnique({ where: { numeroInterno }, select: { id: true, numeroInterno: true } });
    if (!e) throw noEncontrado(numeroInterno);
    const codigo = await codigoConsultaLibre(tx, e.numeroInterno, deps.generarCodigoConsulta);
    // Para la base, el pedido de ESTE cambio (lo usa y lo borra el trigger) y la IP de la constancia.
    await tx.$executeRaw`SELECT set_config('app.regenerar_codigo_consulta', ${e.id.toString()}, true), set_config('app.ip', ${ip ?? ""}, true)`;
    await tx.expediente.update({ where: { id: e.id }, data: { codigoConsulta: codigo }, select: { id: true } });
    return { numero: e.numeroInterno, codigoConsulta: codigo };
  });
}
