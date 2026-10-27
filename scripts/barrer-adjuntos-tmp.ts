// Barrido de los temporales de adjuntos (docs/propuesta-mvp.md, sección 6,
// "Adjuntos"): borra lo que quedó en tmp/ con más de 24 h. Un temporal queda
// si el proceso murió entre la subida y el traslado posterior al commit (o, con
// Supabase Storage, si el navegador subió el archivo y no llegó a confirmar);
// uno más nuevo puede ser una subida en curso y no se toca.
//
// Corre con `npm run adjuntos:barrer` sobre el almacén de ADJUNTOS_ALMACEN
// (src/lib/adjuntos/config.ts): el disco (en desarrollo, ./.data/adjuntos) o
// Supabase Storage. En el servidor municipal lo dispara el timer
// `cementeria-adjuntos-tmp` una vez por día; en Vercel, GET /api/cron/adjuntos-tmp.
//
// Opciones:
//   --horas N   antigüedad mínima en horas (por defecto 24).

import { config as cargarEnv } from "dotenv";
import { HORAS_TEMPORALES, raizAdjuntos } from "../src/lib/adjuntos/almacen";
import { tipoDeAlmacen } from "../src/lib/adjuntos/config";
import { crearAlmacenDesdeEntorno } from "../src/lib/adjuntos/fabrica";
import { tareaBarrerAdjuntos } from "../src/lib/tareas/programadas";

cargarEnv({ path: ".env.local", quiet: true });

function horasPedidas(): number {
  const i = process.argv.indexOf("--horas");
  if (i < 0) return HORAS_TEMPORALES;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n < 1) throw new Error("--horas: tiene que ser un número de 1 o más");
  return n;
}

async function main(): Promise<void> {
  const horas = horasPedidas();
  const tipo = tipoDeAlmacen();
  // La carpeta se muestra (como antes); de Supabase, solo que es Supabase (nada de URL ni clave).
  const donde = tipo === "disco" ? { raiz: raizAdjuntos() } : { almacen: "supabase" };
  const r = await tareaBarrerAdjuntos(crearAlmacenDesdeEntorno(), new Date(), horas);
  console.log(JSON.stringify({ nivel: "info", evento: "adjuntos.barrido", ...donde, horas, borrados: r.borrados }));
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ nivel: "error", evento: "adjuntos.barrido_fallo", mensaje: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
