// Semilla. Corre con `npm run db:seed` (y al final de `npm run db:reset`).
//
// Carga, como SISTEMA y con el rol de la app (DATABASE_URL): áreas,
// cementerios con nomenclatura provisoria, tipos de monumento y de trámite,
// feriados 2026-2027 (años sin cerrar), las 4 plantillas publicadas como v1, el
// admin inicial (ADMIN_INICIAL_CUIL) y un usuario ficticio por área. Datos en
// prisma/semilla/; el porqué de cada uno, ahí.
//
// Es IDEMPOTENTE: crea lo que falta y deja como está lo que ya existe (ver
// prisma/semilla/sembrar.ts). Correrla dos veces no cambia nada.
//
// Opciones:
//   --sin-ficticios   sin los usuarios de prueba por área. Es la única forma en
//                     que corre con NODE_ENV=production.
//
// Los 30 expedientes ficticios de la sección 6 llegan con el alta (semana 2):
// necesitan su lógica (número interno, movimiento `alta`, personas).

import { config as cargarEnv } from "dotenv";
import { crearCliente } from "../src/lib/db/crear-cliente";
import { sembrar } from "./semilla/sembrar";
import { ADMIN_CUIL_DESARROLLO } from "./semilla/usuarios";

cargarEnv({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  const produccion = process.env.NODE_ENV === "production";
  const sinFicticios = process.argv.includes("--sin-ficticios");
  if (produccion && !sinFicticios) {
    throw new Error("Con NODE_ENV=production la semilla solo corre con --sin-ficticios: no se cargan usuarios de prueba.");
  }

  let adminCuil = process.env.ADMIN_INICIAL_CUIL?.trim() ?? "";
  if (!adminCuil) {
    if (produccion) throw new Error("Falta ADMIN_INICIAL_CUIL: es el CUIL del primer administrador.");
    adminCuil = ADMIN_CUIL_DESARROLLO;
    console.log(`Sin ADMIN_INICIAL_CUIL: el admin de desarrollo es el CUIL ficticio ${adminCuil}.`);
  }

  const cliente = crearCliente();
  try {
    const { creados, avisos } = await sembrar(cliente, { adminCuil, usuariosFicticios: !sinFicticios });
    const total = Object.values(creados).reduce((a, b) => a + b, 0);
    console.log(
      total === 0
        ? "Semilla: no había nada que crear."
        : `Semilla: ${Object.entries(creados)
            .filter(([, n]) => n > 0)
            .map(([tabla, n]) => `${tabla} ${n}`)
            .join(", ")}.`,
    );
    for (const a of avisos) console.warn(`Aviso: ${a}`);
  } finally {
    await cliente.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
