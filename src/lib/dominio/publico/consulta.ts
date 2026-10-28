import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { SISTEMA_ID } from "@/lib/auth/ingreso";
import { diaEnTucuman, fechaDesdeDb, type FechaISO } from "@/lib/fechas";
import { normalizarCodigoConsulta } from "../expedientes/codigo-consulta";
import { leerDefinicion } from "../expedientes/contexto";
import type { Escritor, Lector } from "../expedientes/dependencias";
import { canonizarNumeroInterno } from "../expedientes/numero";
import { ESTADOS_EXPEDIENTE, type EstadoExpediente } from "../permisos";

/**
 * La consulta pública del trámite (28/10/2026; docs/api-dominio.md, sección
 * 24): el concesionario escribe el número de expediente y el código de su
 * comprobante y ve en qué anda, sin sesión.
 *
 * - **Qué devuelve:** solo `TramitePublico` (número, tipo de trámite,
 *   cementerio, fecha de inicio, estado, área actual con su nombre público y
 *   desde cuándo, paso X de N y la fecha del último movimiento). Nunca
 *   personas, DNI o CUIL, ubicación de la sepultura, motivos, observaciones,
 *   adjuntos, usuarios ni el historial. `armarTramitePublico` es la única que
 *   arma la respuesta, con una lista cerrada de campos (probada).
 * - **Mismo mensaje** para número inexistente, código incorrecto o con otra
 *   forma: no dice si el expediente existe. El código se compara en tiempo
 *   constante (`timingSafeEqual`), también contra un señuelo si el número no
 *   existe.
 * - **Límite de intentos en la base** (auditoria.intentos_consulta, vale con
 *   varias instancias): 10 fallidos por IP y 5 por número en 15 minutos. Al
 *   llegar, ni se busca (queda `bloqueado`). Por número también frena a quien
 *   prueba códigos desde muchas IP; a cambio, alguien puede trabar la consulta
 *   de un número 15 minutos: el concesionario consulta igual en Mesa de
 *   Entradas.
 * - **Constancia:** cada fallido o bloqueado en intentos_consulta (IP y número,
 *   7 días: f_purgar_intentos_consulta); cada consulta correcta como
 *   `consulta_publica` en auditoria.accesos, sin usuario, para las métricas.
 *   Lo escribe SISTEMA (como un ingreso rechazado): no hay sesión.
 *
 * El número y el código llegan por POST (Server Action), nunca en la URL: el
 * QR del comprobante lleva el código en el fragmento (#), que el navegador no
 * manda al servidor.
 */

export const MAXIMO_FALLOS_IP = 10;
export const MAXIMO_FALLOS_NUMERO = 5;
export const VENTANA_MINUTOS = 15;

/** El único mensaje para lo que no se encontró, por el motivo que sea. */
export const MENSAJE_NO_ENCONTRADO = "No encontramos un trámite con ese número y código";
/** El límite no dice nada de ningún expediente: se puede explicar. */
export const MENSAJE_LIMITE = `Hubo demasiados intentos fallidos. Esperá ${VENTANA_MINUTOS} minutos y volvé a probar, o consultá en Mesa de Entradas.`;

/** Contra qué se compara cuando el número no existe: así el tiempo es el mismo. */
const CODIGO_SENUELO = "00000000";

export interface TramitePublico {
  numero: string;
  tipoTramite: string;
  cementerio: string;
  fechaInicio: FechaISO;
  /** El código; el texto para el ciudadano lo pone la pantalla (src/lib/presentacion/consulta-publica.ts). */
  estado: EstadoExpediente;
  /** Dónde está el papel, con su nombre público (un cementerio, por su nombre), y desde qué día. */
  area: { nombre: string; desde: FechaISO };
  paso: { orden: number; total: number; nombre: string };
  ultimoMovimiento: FechaISO;
}

export type ResultadoConsulta =
  | { ok: true; tramite: TramitePublico }
  | { ok: false; motivo: "no_encontrado" | "limite"; mensaje: string };

export interface DependenciasConsulta {
  leer: Pick<Lector, "$queryRaw" | "expediente" | "cementerio" | "movimiento">;
  /** conActor(): lo firma SISTEMA. */
  escribir: Escritor;
}

export interface EntradaConsulta {
  numero: string;
  codigo: string;
}

/** Lo que se lee del expediente para armar la respuesta. */
export interface FilaConsulta {
  numeroInterno: string;
  fechaInicio: Date;
  estado: string;
  pasoClave: string;
  pasoOrden: number;
  enAreaDesde: Date;
  tipoTramite: { nombre: string };
  cementerio: { nombre: string };
  plantilla: { codigo: string; version: number; definicion: unknown };
  areaActual: { id: number; nombre: string };
}

/**
 * La respuesta, campo por campo: lo que no está acá no sale, aunque la fila
 * traiga más. `cementerioDelArea` es el nombre del cementerio cuya área es la
 * actual (los cementerios se nombran como cementerios, no como áreas).
 */
export function armarTramitePublico(
  e: FilaConsulta,
  extra: { cementerioDelArea: string | null; ultimoMovimiento: Date | null },
): TramitePublico {
  const def = leerDefinicion(e.plantilla.definicion, e.plantilla.codigo, e.plantilla.version);
  const paso = def.pasos.find((p) => p.clave === e.pasoClave) ?? def.pasos[e.pasoOrden - 1];
  const estado = (ESTADOS_EXPEDIENTE as readonly string[]).includes(e.estado) ? (e.estado as EstadoExpediente) : "en_tramite";
  return {
    numero: e.numeroInterno,
    tipoTramite: e.tipoTramite.nombre,
    cementerio: e.cementerio.nombre,
    fechaInicio: fechaDesdeDb(e.fechaInicio),
    estado,
    area: { nombre: extra.cementerioDelArea ?? e.areaActual.nombre, desde: diaEnTucuman(e.enAreaDesde) },
    paso: { orden: e.pasoOrden, total: def.pasos.length, nombre: paso?.nombre ?? e.pasoClave },
    ultimoMovimiento: diaEnTucuman(extra.ultimoMovimiento ?? e.enAreaDesde),
  };
}

/** Iguales en tiempo constante (los dos tienen 8 caracteres ASCII; si no, se compara igual y da false). */
export function codigosIguales(escrito: string | null, guardado: string): boolean {
  const a = Buffer.from(escrito !== null && escrito.length === guardado.length ? escrito : guardado);
  const b = Buffer.from(guardado);
  return timingSafeEqual(a, b) && escrito !== null && escrito.length === guardado.length;
}

async function contarFallos(deps: DependenciasConsulta, ip: string | null, numero: string | null): Promise<{ porIp: number; porNumero: number }> {
  const [fila] = await deps.leer.$queryRaw<Array<{ por_ip: number; por_numero: number }>>`
    SELECT count(*) FILTER (WHERE ip IS NOT DISTINCT FROM ${ip}::inet)::int AS por_ip,
           count(*) FILTER (WHERE ${numero}::text IS NOT NULL AND numero = ${numero}::text)::int AS por_numero
      FROM auditoria.intentos_consulta
     WHERE resultado = 'fallido'
       AND en > now() - make_interval(mins => ${VENTANA_MINUTOS}::int)
       AND (ip IS NOT DISTINCT FROM ${ip}::inet OR numero = ${numero}::text)`;
  return { porIp: Number(fila?.por_ip ?? 0), porNumero: Number(fila?.por_numero ?? 0) };
}

function registrarIntento(deps: DependenciasConsulta, ip: string | null, numero: string | null, resultado: "fallido" | "bloqueado"): Promise<unknown> {
  return deps.escribir(SISTEMA_ID, "Consulta pública", (tx) => tx.intentoConsulta.create({ data: { ip, numero, resultado } }));
}

/**
 * La consulta: límite, búsqueda, comparación y constancia. Ver el comentario
 * del módulo. `ip` es la de ipDeSolicitud() (src/lib/auth/red.ts).
 */
export async function consultarTramite(deps: DependenciasConsulta, entrada: EntradaConsulta, ip: string | null): Promise<ResultadoConsulta> {
  const ipValida = ip && isIP(ip) !== 0 ? ip : null;
  // Recortados: lo que pase de 40 caracteres ya no es ni un número ni un código.
  const numero = canonizarNumeroInterno(entrada.numero.slice(0, 40));
  const codigo = normalizarCodigoConsulta(entrada.codigo.slice(0, 40));

  const fallos = await contarFallos(deps, ipValida, numero);
  if (fallos.porIp >= MAXIMO_FALLOS_IP || fallos.porNumero >= MAXIMO_FALLOS_NUMERO) {
    await registrarIntento(deps, ipValida, numero, "bloqueado");
    return { ok: false, motivo: "limite", mensaje: MENSAJE_LIMITE };
  }

  const e = numero
    ? await deps.leer.expediente.findUnique({
        where: { numeroInterno: numero },
        select: {
          id: true,
          numeroInterno: true,
          codigoConsulta: true,
          fechaInicio: true,
          estado: true,
          pasoClave: true,
          pasoOrden: true,
          enAreaDesde: true,
          tipoTramite: { select: { nombre: true } },
          cementerio: { select: { nombre: true } },
          plantilla: { select: { codigo: true, version: true, definicion: true } },
          areaActual: { select: { id: true, nombre: true } },
        },
      })
    : null;
  const coincide = codigosIguales(codigo, e?.codigoConsulta ?? CODIGO_SENUELO);
  if (!e || !coincide) {
    await registrarIntento(deps, ipValida, numero, "fallido");
    return { ok: false, motivo: "no_encontrado", mensaje: MENSAJE_NO_ENCONTRADO };
  }

  const cementerioDelArea = await deps.leer.cementerio.findFirst({ where: { areaId: e.areaActual.id }, select: { nombre: true } });
  const ultimo = await deps.leer.movimiento.findFirst({
    where: { expedienteId: e.id },
    orderBy: [{ fechaEfectiva: "desc" }, { secuencia: "desc" }],
    select: { fechaEfectiva: true },
  });
  const tramite = armarTramitePublico(e, { cementerioDelArea: cementerioDelArea?.nombre ?? null, ultimoMovimiento: ultimo?.fechaEfectiva ?? null });
  await deps.escribir(SISTEMA_ID, "Consulta pública", (tx) =>
    tx.auditoriaAcceso.create({ data: { usuarioId: null, accion: "consulta_publica", expedienteId: e.id, detalle: {}, ip: ipValida } }),
  );
  return { ok: true, tramite };
}
