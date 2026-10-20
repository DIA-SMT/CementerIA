import { EntornoInvalido, validarEntornoAlIniciar } from "./entorno";
import { log } from "./log";

/**
 * Lo que hace `register()` de src/instrumentation.ts al arrancar el servidor.
 *
 * Que la validación tire no alcanza: `next start` (16.4) atrapa el error de
 * `register()`, lo escribe como "Failed to prepare server" y sigue escuchando
 * el puerto, respondiendo 500 a todo. Para systemd el servicio quedaría
 * "activo". Por eso, en producción, se termina el proceso con código 1: la
 * unidad queda en falla y el motivo, en journald. En desarrollo se relanza el
 * error, que `next dev` muestra en pantalla.
 *
 * Está aparte de instrumentation.ts porque ese archivo también se compila para
 * el runtime Edge, donde `process.exit` no existe; este módulo solo se importa
 * en el runtime de Node.
 */
export function validarOTerminar(fuente: Readonly<Record<string, string | undefined>> = process.env): void {
  try {
    validarEntornoAlIniciar(fuente);
  } catch (error) {
    if (fuente.NODE_ENV !== "production") throw error;
    // Los problemas nombran variable y regla, nunca el valor (ver entorno.ts).
    log.error("arranque.rechazado", {
      problemas: error instanceof EntornoInvalido ? error.problemas.join(" | ") : "error inesperado al validar el entorno",
    });
    process.exit(1);
  }
}
