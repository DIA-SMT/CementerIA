// Semilla. Corre con `npm run db:seed` (y al final de `npm run db:reset`).
//
// Carga, como SISTEMA y con el rol de la app (DATABASE_URL): áreas,
// cementerios con nomenclatura provisoria, tipos de monumento y de trámite,
// feriados 2026-2027 (años sin cerrar), las 4 plantillas publicadas como v1, el
// admin inicial (ADMIN_INICIAL_CUIL) y un usuario ficticio por área. Datos en
// prisma/semilla/; el porqué de cada uno, ahí.
//
// Después, y aparte, los 30 expedientes ficticios de la sección 6: los da de
// alta el usuario ficticio de Mesa de Entradas con la función de alta del
// dominio (prisma/semilla/expedientes.ts), cada uno en su transacción. Y
// después de ellos, los escenarios (prisma/semilla/escenarios.ts): otro grupo
// de expedientes ficticios repartidos por todo el circuito (las bandejas de
// cada área, la DIM, los estados, correcciones), movidos con las funciones del
// dominio por los usuarios ficticios de cada área.
//
// Al final, la generación de avisos por tiempo (plazo DIM, sin confirmar,
// demorado), como la tarea programada de cada mañana. Los avisos de los pases,
// devoluciones y cierres de los escenarios ya los creó el dominio en cada
// acción; los de pasos que el expediente ya dejó quedan leídos
// (prisma/semilla/avisos.ts). Así cada área ve los suyos al entrar.
//
// Es IDEMPOTENTE: crea lo que falta y deja como está lo que ya existe (ver
// prisma/semilla/sembrar.ts; los expedientes y los escenarios, por sus
// comando_id fijos). Correrla dos veces no cambia nada.
//
// Opciones:
//   --sin-ficticios   sin los usuarios de prueba por área, ni los expedientes
//                     ficticios ni los escenarios. Es la única forma en que
//                     corre con NODE_ENV=production.

import { config as cargarEnv } from "dotenv";
import { SISTEMA_ID } from "../src/lib/auth/ingreso";
import { conActorEn } from "../src/lib/db/actor";
import { crearCliente } from "../src/lib/db/crear-cliente";
import { generarYAnotar } from "../src/lib/dominio/avisos";
import { leerAvisosViejos } from "./semilla/avisos";
import { sembrarEscenarios } from "./semilla/escenarios";
import { sembrarExpedientes } from "./semilla/expedientes";
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

    if (!sinFicticios) {
      const expedientes = await sembrarExpedientes(cliente);
      console.log(
        expedientes.creados === 0
          ? `Expedientes ficticios: ya estaban los ${expedientes.existentes}.`
          : `Expedientes ficticios: ${expedientes.creados} creados (${expedientes.numeros[0]} a ${expedientes.numeros.at(-1)}).`,
      );
      // Después de los 30, para no cambiar su numeración.
      const escenarios = await sembrarEscenarios(cliente);
      console.log(
        escenarios.creados === 0
          ? `Escenarios: ya estaban sus ${escenarios.existentes} expedientes.`
          : `Escenarios: ${escenarios.creados} expedientes creados en ${escenarios.escenarios.length} escenarios (${escenarios.numeros[0]} a ${escenarios.numeros.at(-1)}).`,
      );
      // Los "llegó" de pasos que el expediente ya dejó, leídos (prisma/semilla/avisos.ts).
      const leidos = await leerAvisosViejos(cliente);
      // Los avisos por tiempo, como la tarea programada (npm run avisos:generar).
      const generados = await conActorEn(cliente, SISTEMA_ID, "Avisos por tiempo (semilla)", (tx) => generarYAnotar(tx, new Date()), {
        timeout: 120_000,
      });
      const detalle = Object.entries(generados.porTipo)
        .filter(([, n]) => n > 0)
        .map(([tipo, n]) => `${tipo} ${n}`)
        .join(", ");
      console.log(
        `Avisos: ${await cliente.aviso.count()} en total (${await cliente.aviso.count({ where: { leidoEn: null } })} sin leer; ${leidos} de pasos ya dejados quedaron leídos); la generación por tiempo creó ${generados.creados}${detalle ? ` (${detalle})` : ""}.`,
      );
    }
  } finally {
    await cliente.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
