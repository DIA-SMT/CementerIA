// Reemplazo de `server-only` en los tests (ver vitest.config.mts). En Next el
// paquete real hace fallar el build si un componente de cliente importa código
// del servidor; en Vitest no hay cliente y el paquete real tiraría error.
export {};
