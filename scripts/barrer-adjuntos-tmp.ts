// Barrido de los temporales de adjuntos (docs/propuesta-mvp.md, sección 6,
// "Adjuntos"): borra lo que quedó en <ADJUNTOS_DIR>/tmp/ con más de 24 h. Un
// temporal queda si el proceso murió entre la subida y el rename posterior al
// commit; uno más nuevo puede ser una subida en curso y no se toca.
//
// Corre con `npm run adjuntos:barrer` (en desarrollo, sobre ./.data/adjuntos).
// En producción lo dispara el timer `cementeria-adjuntos-tmp` una vez por día.
//
// Opciones:
//   --horas N   antigüedad mínima en horas (por defecto 24).

import { config as cargarEnv } from "dotenv";
import { barrerTemporales, crearAlmacenEnDisco, HORAS_TEMPORALES, raizAdjuntos } from "../src/lib/adjuntos/almacen";

cargarEnv({ path: ".env.local", quiet: true });

function horasPedidas(): number {
  const i = process.argv.indexOf("--horas");
  if (i < 0) return HORAS_TEMPORALES;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n < 1) throw new Error("--horas: tiene que ser un número de 1 o más");
  return n;
}

async function main(): Promise<void> {
  const raiz = raizAdjuntos();
  const horas = horasPedidas();
  const borrados = await barrerTemporales(crearAlmacenEnDisco(raiz), new Date(), horas);
  console.log(JSON.stringify({ nivel: "info", evento: "adjuntos.barrido", raiz, horas, borrados }));
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ nivel: "error", evento: "adjuntos.barrido_fallo", mensaje: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
