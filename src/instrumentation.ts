/**
 * Next corre `register()` una vez al arrancar el servidor, antes de atender el
 * primer request, y no durante `next build` (lo saltea en la fase de build).
 * Es el lugar para negarse a arrancar con una configuración peligrosa, como
 * AUTH_DEV_LOGIN en producción (sección 6, "Desarrollo local"). Cómo se niega
 * está en src/lib/arranque.ts.
 */
export async function register(): Promise<void> {
  // El proxy y el render corren en Node; el chequeo no tiene sentido en otro runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validarOTerminar } = await import("./lib/arranque");
  validarOTerminar();
}
