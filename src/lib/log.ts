/**
 * Logs del servidor, una línea JSON por evento.
 *
 * En producción la app corre como unidad de systemd y journald guarda la salida
 * estándar (sección 6, "Otros"): una línea JSON por evento se filtra con
 * `journalctl -o cat | jq` sin depender de cómo se escribió cada mensaje.
 *
 * Nada de lo que pasa por acá puede llevar tokens, secretos ni datos personales
 * de los expedientes: quien llama elige los campos y los nombra.
 */

export type NivelLog = "info" | "warn" | "error";

export type DatosLog = Record<string, string | number | boolean | null | undefined>;

export function registrar(nivel: NivelLog, evento: string, datos: DatosLog = {}): void {
  const linea = JSON.stringify({ nivel, evento, ...datos });
  if (nivel === "error") console.error(linea);
  else if (nivel === "warn") console.warn(linea);
  else console.info(linea);
}

/**
 * Un error, resumido para el log: nombre, código y la PRIMERA línea del mensaje.
 * Los errores de Prisma vuelcan los argumentos de la consulta desde la segunda
 * línea, y esos argumentos pueden ser nombres, CUIL o correos.
 */
export function resumenError(error: unknown): DatosLog {
  if (!(error instanceof Error)) return { error: typeof error };
  const codigo = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { error: error.name, codigo, mensaje: error.message.split("\n", 1)[0]?.slice(0, 200) };
}

export const log = {
  info: (evento: string, datos?: DatosLog) => registrar("info", evento, datos),
  warn: (evento: string, datos?: DatosLog) => registrar("warn", evento, datos),
  error: (evento: string, datos?: DatosLog) => registrar("error", evento, datos),
};
