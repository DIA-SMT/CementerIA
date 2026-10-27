// Generación de los avisos por tiempo (26/10/2026; docs/api-dominio.md,
// sección 21.3): plazo DIM por vencer y vencido, enviado sin confirmar y
// demorado. Idempotente: correrla dos veces, o todos los días, no repite ningún
// aviso (la clave es por expediente y situación, no por día). Anota la corrida
// del día en avisos_corridas, así la primera carga de un operador ya no la
// vuelve a correr.
//
// Corre con `npm run avisos:generar` (en desarrollo, contra DATABASE_URL de
// .env.local). En producción la dispara el timer `cementeria-avisos` todos los
// días a las 6:00 (deploy/systemd/, docs/despliegue.md). En Vercel, lo mismo lo
// corre GET /api/cron/avisos (src/lib/tareas/programadas.ts, docs/despliegue-vercel.md).
//
// Escribe una línea JSON (como el barrido de adjuntos y la verificación del
// historial). Sale con 0 si generó (aunque no haya creado ninguno) y con 2 si
// no pudo.
//
// Opciones:
//   --fecha AAAA-MM-DD   genera como si fuera ese día a las 6:00 de Tucumán
//                        (para probar; en producción no se usa)

import { config as cargarEnv } from "dotenv";
import { crearCliente } from "../src/lib/db/crear-cliente";
import { esFechaValida, inicioDelDiaEnTucuman } from "../src/lib/fechas";
import { tareaAvisos } from "../src/lib/tareas/programadas";

cargarEnv({ path: ".env.local", quiet: true });

function log(nivel: "info" | "error", evento: string, datos: Record<string, unknown>): void {
  const linea = JSON.stringify({ nivel, evento, ...datos });
  if (nivel === "error") console.error(linea);
  else console.log(linea);
}

function ahoraDe(argv: readonly string[]): Date {
  const i = argv.indexOf("--fecha");
  if (i < 0) return new Date();
  const fecha = argv[i + 1];
  if (!esFechaValida(fecha)) throw new Error(`--fecha: se esperaba AAAA-MM-DD y llegó "${fecha ?? ""}"`);
  return new Date(inicioDelDiaEnTucuman(fecha).getTime() + 6 * 60 * 60 * 1000);
}

async function main(): Promise<number> {
  const ahora = ahoraDe(process.argv);
  const cliente = crearCliente();
  try {
    const r = await tareaAvisos(cliente, ahora);
    log("info", "avisos.generados", { dia: r.dia, expedientes: r.expedientes, creados: r.creados, por_tipo: r.porTipo, duracion_ms: r.duracionMs });
    return 0;
  } finally {
    await cliente.$disconnect();
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    log("error", "avisos.generacion_fallo", { mensaje: e instanceof Error ? e.message : String(e) });
    process.exit(2);
  });
