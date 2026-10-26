import type { Transaccion } from "@/lib/db/crear-cliente";
import { exigirPermiso, type UsuarioPermisos } from "../permisos";
import { exigirNumero, registrarAcceso, type OpcionesAcceso } from "./acceso";
import type { DependenciasExpedientes, Lector } from "./dependencias";
import { noEncontrado } from "./errores";

/**
 * La integridad del historial: la cadena de hash de `movimientos` (migración
 * `*_cadena_hash`; docs/propuesta-mvp.md, 2.13(b), y docs/api-dominio.md,
 * sección 19).
 *
 * Cada movimiento lleva `hash` = SHA-256 de sus campos y del `hash_anterior`,
 * que es el hash del movimiento anterior del mismo expediente (el primero
 * encadena contra el número interno). Los fija el trigger `movimientos_sellar`
 * con `f_hash_movimiento()`; acá solo se lee y se verifica, siempre con la
 * función de la base (`f_verificar_cadena()`): la regla del hash vive en un
 * solo lugar.
 *
 * - `verificarIntegridad()`: "Verificar integridad" de la ficha. La puede
 *   pedir quien puede ver la ficha, y queda en `auditoria.accesos`
 *   (`verificar_historial`, con el resultado).
 * - `verificarIntegridadTodos()`: todos los expedientes, para el admin.
 * - `verificarIntegridadNocturna()`: lo mismo, firmado por SISTEMA, para el
 *   script `npm run historial:verificar` (scripts/verificar-historial.ts, el
 *   timer `cementeria-historial` en producción).
 * - `huellaDelHistorial()`: el hash del último movimiento abreviado, para los
 *   imprimibles: liga el papel con el estado digital del día en que se emitió.
 */

/** Caracteres del hash que van en el papel ("huella"): 16 hex son 64 bits, de sobra para cotejar a ojo. */
export const LARGO_HUELLA = 16;

/** Usuario técnico SISTEMA (id 1): firma la verificación nocturna, como la semilla. */
const SISTEMA = 1;

/** Cuántos números de expedientes rotos se guardan en el detalle del acceso. */
const MAXIMO_ROTOS_EN_DETALLE = 50;

export type MotivoRotura =
  /** Falta esa secuencia: un movimiento borrado. */
  | "secuencia_faltante"
  /** `hash_anterior` no es el hash del movimiento anterior. */
  | "hash_anterior_distinto"
  /** El hash guardado no es el que da recalcularlo: cambió algún campo. */
  | "hash_distinto"
  /** El expediente no tiene ni siquiera el alta. */
  | "sin_movimientos";

const MOTIVOS: readonly MotivoRotura[] = ["secuencia_faltante", "hash_anterior_distinto", "hash_distinto", "sin_movimientos"];

export interface ResultadoIntegridad {
  numero: string;
  integra: boolean;
  /** Cuántos movimientos tiene el expediente. */
  movimientos: number;
  /** El hash guardado del último movimiento (64 hex), o null si no tiene ninguno. */
  hashFinal: string | null;
  /** Los primeros `LARGO_HUELLA` caracteres de `hashFinal`: lo que va impreso. */
  huella: string | null;
  /** La primera secuencia con problemas, o null si está íntegra. */
  secuenciaRota: number | null;
  motivo: MotivoRotura | null;
}

export interface ResumenIntegridad {
  /** Cuándo empezó la verificación. */
  verificadoEn: Date;
  expedientes: number;
  integros: number;
  /** Movimientos recorridos, sumando todos los expedientes. */
  movimientos: number;
  /** Solo los rotos, en el orden de los expedientes. */
  rotos: ResultadoIntegridad[];
}

interface FilaCadena {
  integra: boolean;
  movimientos: number;
  hash_final: string | null;
  secuencia_rota: number | null;
  motivo: string | null;
}

/** La huella que se imprime: los primeros caracteres del hash. */
export function abreviarHash(hash: string | null): string | null {
  return hash === null ? null : hash.slice(0, LARGO_HUELLA);
}

function resultado(numero: string, f: FilaCadena): ResultadoIntegridad {
  const motivo = f.motivo === null ? null : ((MOTIVOS as readonly string[]).includes(f.motivo) ? (f.motivo as MotivoRotura) : "hash_distinto");
  return {
    numero,
    integra: f.integra,
    movimientos: Number(f.movimientos),
    hashFinal: f.hash_final,
    huella: abreviarHash(f.hash_final),
    secuenciaRota: f.secuencia_rota === null ? null : Number(f.secuencia_rota),
    motivo,
  };
}

/** `f_verificar_cadena()` de un expediente, por su id. */
async function cadenaDe(lector: Pick<Lector, "$queryRaw">, numero: string, id: bigint): Promise<ResultadoIntegridad> {
  const filas = await lector.$queryRaw<FilaCadena[]>`
    SELECT v.integra, v.movimientos, v.hash_final, v.secuencia_rota, v.motivo
      FROM public.f_verificar_cadena(${id}::bigint) AS v`;
  return resultado(numero, filas[0]);
}

/** Lo que queda en `auditoria.accesos.detalle` de un expediente: sin datos personales. */
function detalleExpediente(r: ResultadoIntegridad) {
  return {
    alcance: "expediente",
    integra: r.integra,
    movimientos: r.movimientos,
    hash_final: r.hashFinal,
    secuencia_rota: r.secuenciaRota,
    motivo: r.motivo,
  };
}

function detalleResumen(r: ResumenIntegridad, origen: "admin" | "nocturna") {
  return {
    alcance: "todos",
    origen,
    expedientes: r.expedientes,
    integros: r.integros,
    movimientos: r.movimientos,
    rotos: r.rotos.slice(0, MAXIMO_ROTOS_EN_DETALLE).map((x) => ({ numero: x.numero, secuencia_rota: x.secuenciaRota, motivo: x.motivo })),
    cantidad_rotos: r.rotos.length,
  };
}

/**
 * "Verificar integridad" de la ficha: recalcula la cadena del expediente y
 * registra `verificar_historial` en `auditoria.accesos` con el resultado. Un
 * resultado roto no es un error: se devuelve, para que la pantalla lo muestre.
 *
 * @throws PermisoDenegado (usuario inactivo: el mismo permiso que ver la ficha)
 * @throws ErrorDominio `no_encontrado`
 */
export async function verificarIntegridad(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  numero: string,
  opciones: OpcionesAcceso = {},
): Promise<ResultadoIntegridad> {
  exigirPermiso("ver_expediente", null, usuario);
  const numeroInterno = exigirNumero(numero);
  return deps.escribir(usuario.id, null, async (tx) => {
    const e = await tx.expediente.findUnique({ where: { numeroInterno }, select: { id: true } });
    if (!e) throw noEncontrado(numeroInterno);
    const r = await cadenaDe(tx, numeroInterno, e.id);
    await registrarAcceso(tx, { usuarioId: usuario.id, accion: "verificar_historial", expedienteId: e.id, detalle: detalleExpediente(r), ip: opciones.ip });
    return r;
  });
}

/**
 * Todos los expedientes, sin permisos ni registro: lo que comparten la
 * verificación del admin y la nocturna. Una sola consulta (cada expediente con
 * `f_verificar_cadena`), fuera de una transacción de escritura: puede tardar
 * más que el límite de `conActor()`.
 */
export async function verificarCadenas(lector: Pick<Lector, "$queryRaw">, ahora: Date = new Date()): Promise<ResumenIntegridad> {
  const filas = await lector.$queryRaw<Array<FilaCadena & { numero: string }>>`
    SELECT e.numero_interno AS numero, v.integra, v.movimientos, v.hash_final, v.secuencia_rota, v.motivo
      FROM public.expedientes e
     CROSS JOIN LATERAL public.f_verificar_cadena(e.id) AS v
     ORDER BY e.id`;
  const todos = filas.map((f) => resultado(f.numero, f));
  return {
    verificadoEn: ahora,
    expedientes: todos.length,
    integros: todos.filter((r) => r.integra).length,
    movimientos: todos.reduce((suma, r) => suma + r.movimientos, 0),
    rotos: todos.filter((r) => !r.integra),
  };
}

async function registrarResumen(tx: Transaccion, usuarioId: number, r: ResumenIntegridad, origen: "admin" | "nocturna", ip?: string | null) {
  await registrarAcceso(tx, { usuarioId, accion: "verificar_historial", expedienteId: null, detalle: detalleResumen(r, origen), ip });
}

/**
 * La cadena de todos los expedientes, con resumen (admin). Registra
 * `verificar_historial` sin expediente, con los números rotos (hasta 50).
 *
 * @throws PermisoDenegado (no es admin)
 */
export async function verificarIntegridadTodos(
  deps: DependenciasExpedientes,
  usuario: UsuarioPermisos,
  opciones: OpcionesAcceso = {},
): Promise<ResumenIntegridad> {
  exigirPermiso("administrar", null, usuario);
  const r = await verificarCadenas(deps.leer, deps.ahora?.() ?? new Date());
  await deps.escribir(usuario.id, null, (tx) => registrarResumen(tx, usuario.id, r, "admin", opciones.ip));
  return r;
}

/**
 * La verificación nocturna (scripts/verificar-historial.ts): todos los
 * expedientes, registrada como SISTEMA. No pasa por permisos: la corre el
 * servidor con la credencial de la app, que ya puede leer todo el historial.
 */
export async function verificarIntegridadNocturna(deps: DependenciasExpedientes): Promise<ResumenIntegridad> {
  const r = await verificarCadenas(deps.leer, deps.ahora?.() ?? new Date());
  await deps.escribir(SISTEMA, null, (tx) => registrarResumen(tx, SISTEMA, r, "nocturna"));
  return r;
}

/**
 * La huella del historial para los imprimibles: el hash del último movimiento
 * (completo y abreviado), cuántos hay y si la cadena estaba íntegra al
 * emitirse. Va dentro de la transacción que arma la hoja.
 */
export async function huellaDelHistorial(tx: Pick<Lector, "$queryRaw">, numero: string, expedienteId: bigint): Promise<ResultadoIntegridad> {
  return cadenaDe(tx, numero, expedienteId);
}
