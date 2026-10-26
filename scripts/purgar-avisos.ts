// Purga de avisos leídos viejos (26/10/2026; política de retención en
// docs/despliegue.md, "Avisos"): borra los avisos LEÍDOS hace más de N días
// (90 como mínimo y por defecto). Los no leídos no se borran nunca, ni los
// leídos recientes. Un aviso es un recordatorio, no un registro: lo que pasó
// está en el historial del expediente (movimientos), que no se toca.
//
// La app (cementeria_app) no puede borrar avisos: este script se conecta con
// cementeria_deploy (MIGRATE_DATABASE_URL), como las migraciones. Lo corre el
// admin del sistema a mano, cuando haga falta (no hay timer): en desarrollo
// con `npm run avisos:purgar`; en el servidor, como dice docs/despliegue.md.
//
// Sin `--confirmar` solo cuenta lo que borraría. Escribe una línea JSON.
//
// Opciones:
//   --dias N      antigüedad de la lectura (por defecto y como mínimo, 90)
//   --confirmar   borra de verdad

import { config as cargarEnv } from "dotenv";
import { crearCliente } from "../src/lib/db/crear-cliente";
import { diasDePurga } from "../src/lib/dominio/avisos/tipos";

cargarEnv({ path: ".env.local", quiet: true });

function log(nivel: "info" | "error", evento: string, datos: Record<string, unknown>): void {
  const linea = JSON.stringify({ nivel, evento, ...datos });
  if (nivel === "error") console.error(linea);
  else console.log(linea);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--dias");
  const dias = diasDePurga(i >= 0 ? (argv[i + 1] ?? "") : undefined);
  const confirmar = argv.includes("--confirmar");
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("Falta MIGRATE_DATABASE_URL (rol cementeria_deploy): la app no puede borrar avisos.");

  const cliente = crearCliente(url);
  try {
    const intervalo = `${dias} days`;
    const [c] = await cliente.$queryRaw<Array<{ cantidad: number }>>`
      SELECT count(*)::int AS cantidad FROM public.avisos
       WHERE leido_en IS NOT NULL AND leido_en < now() - ${intervalo}::interval`;
    if (!confirmar) {
      log("info", "avisos.purga_simulada", { dias, se_borrarian: c?.cantidad ?? 0, ayuda: "agregar --confirmar para borrar" });
      return 0;
    }
    const borrados = await cliente.$executeRaw`
      DELETE FROM public.avisos WHERE leido_en IS NOT NULL AND leido_en < now() - ${intervalo}::interval`;
    log("info", "avisos.purgados", { dias, borrados });
    return 0;
  } finally {
    await cliente.$disconnect();
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    log("error", "avisos.purga_fallo", { mensaje: e instanceof Error ? e.message : String(e) });
    process.exit(2);
  });
