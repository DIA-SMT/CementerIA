// Verificación de la cadena de hash del historial (26/10/2026; migración
// *_cadena_hash, docs/api-dominio.md sección 19): recalcula con
// f_verificar_cadena la cadena de TODOS los expedientes y deja el resumen en
// auditoria.accesos (accion 'verificar_historial', firmada por SISTEMA, sin
// expediente, con los números rotos).
//
// Corre con `npm run historial:verificar` (en desarrollo, contra DATABASE_URL
// de .env.local). En producción lo dispara el timer `cementeria-historial` una
// vez por noche (deploy/systemd/, docs/despliegue.md).
//
// Sale con 0 si todos están íntegros, con 1 si hay alguno roto (la unidad
// queda en `systemctl --failed` y el detalle en el journal) y con 2 si no pudo
// verificar. Escribe una línea JSON por evento, como el barrido de adjuntos.
//
// Opciones:
//   --sin-registro   no escribe en auditoria.accesos (para mirar sin dejar rastro
//                    en desarrollo; en producción no se usa)

import { config as cargarEnv } from "dotenv";
import { crearCliente } from "../src/lib/db/crear-cliente";
import { conActorEn } from "../src/lib/db/actor";
import { verificarCadenas, verificarIntegridadNocturna, type DependenciasExpedientes, type ResumenIntegridad } from "../src/lib/dominio/expedientes";

cargarEnv({ path: ".env.local", quiet: true });

function log(nivel: "info" | "error", evento: string, datos: Record<string, unknown>): void {
  const linea = JSON.stringify({ nivel, evento, ...datos });
  if (nivel === "error") console.error(linea);
  else console.log(linea);
}

async function main(): Promise<number> {
  const sinRegistro = process.argv.includes("--sin-registro");
  const cliente = crearCliente();
  try {
    const inicio = Date.now();
    let r: ResumenIntegridad;
    if (sinRegistro) {
      r = await verificarCadenas(cliente);
    } else {
      const deps: DependenciasExpedientes = { leer: cliente, escribir: (usuarioId, motivo, fn) => conActorEn(cliente, usuarioId, motivo, fn) };
      r = await verificarIntegridadNocturna(deps);
    }
    const resumen = {
      expedientes: r.expedientes,
      integros: r.integros,
      rotos: r.rotos.length,
      movimientos: r.movimientos,
      duracion_ms: Date.now() - inicio,
      registrado: !sinRegistro,
    };
    if (r.rotos.length === 0) {
      log("info", "historial.verificado", resumen);
      return 0;
    }
    log("error", "historial.roto", {
      ...resumen,
      detalle: r.rotos.map((x) => ({ numero: x.numero, secuencia_rota: x.secuenciaRota, motivo: x.motivo })),
    });
    return 1;
  } finally {
    await cliente.$disconnect();
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    log("error", "historial.verificacion_fallo", { mensaje: e instanceof Error ? e.message : String(e) });
    process.exit(2);
  });
