// Verificación de la cadena de hash del historial (26/10/2026; migración
// *_cadena_hash, docs/api-dominio.md sección 19): recalcula con
// f_verificar_cadena la cadena de TODOS los expedientes y deja el resumen en
// auditoria.accesos (accion 'verificar_historial', firmada por SISTEMA, sin
// expediente, con los números rotos).
//
// Corre con `npm run historial:verificar` (en desarrollo, contra DATABASE_URL
// de .env.local). En producción lo dispara el timer `cementeria-historial` una
// vez por noche (deploy/systemd/, docs/despliegue.md). En Vercel, lo mismo lo
// corre GET /api/cron/historial (src/lib/tareas/programadas.ts).
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
import { verificarCadenas } from "../src/lib/dominio/expedientes";
import { tareaHistorial, type ResumenHistorial } from "../src/lib/tareas/programadas";

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
    let r: ResumenHistorial;
    if (sinRegistro) {
      const v = await verificarCadenas(cliente);
      r = {
        expedientes: v.expedientes,
        integros: v.integros,
        rotos: v.rotos.length,
        movimientos: v.movimientos,
        duracionMs: Date.now() - inicio,
        detalleRotos: v.rotos.map((x) => ({ numero: x.numero, secuenciaRota: x.secuenciaRota ?? null, motivo: x.motivo ?? null })),
      };
    } else {
      r = await tareaHistorial(cliente);
    }
    const resumen = {
      expedientes: r.expedientes,
      integros: r.integros,
      rotos: r.rotos,
      movimientos: r.movimientos,
      duracion_ms: r.duracionMs,
      registrado: !sinRegistro,
    };
    if (r.rotos === 0) {
      log("info", "historial.verificado", resumen);
      return 0;
    }
    log("error", "historial.roto", {
      ...resumen,
      detalle: r.detalleRotos.map((x) => ({ numero: x.numero, secuencia_rota: x.secuenciaRota, motivo: x.motivo })),
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
